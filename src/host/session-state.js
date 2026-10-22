/**
 * 会话级插件状态：每会话的访问档位（任务 D，已修订为三档门禁：仅工作区内 / 工作区外只读 / 完全放开）
 * 以及三键门禁的审计轨迹（任务 B）。
 *
 * DSH 持久化约束（已对照随附的 0.2.1-rc.2 源码核实）：持久日志的读取路径会拒绝
 * 任何 `type` 不在 `KNOWN_SESSION_EVENT_TYPES` 内的事件，除非信封携带
 * `ignorable: true`，而 `Session.append()` 无法设置该标记。因此插件状态一律以
 * 可忽略的 `plugin:` 记录经 `appendPluginRecord()` 传递 —— 即文档记载的插件记录
 * 通道 —— 绝不用裸自定义事件类型。记录不进入模型可见表面，这对审计与开关状态
 * 正合适。
 *
 * 可靠性：写在两轮之间的 `plugin:` 记录在重载时可能被视为崩溃尾巴，因此实时值
 * 同时保存在进程内 map 中，并在下一个开放轮次内重新落盘（`ensureScopePersisted`），
 * 那里持久日志能可靠提交。丢记录会降级到安全一侧：门禁以最严档位重新生效。
 *
 * 记录兼容性：早期版本在同一记录类型上写 `{ enabled }`（布尔旁路开关）。
 * `foldScopeEntry` 仍读取它们 —— `enabled: true` 映射为 `outside-write`（完全放开），
 * `false` 映射为 `workspace`（仅工作区内）—— 这样已发布的会话升级后继续放行，
 * 而已加锁的会话依旧受限。
 *
 * 子代理继承：委派出去的子会话（header `parentSession`）以父会话档位为起点，
 * 而非最严默认值 —— 与平台自身对委派沙箱与审批策略采用的一次性快照语义一致。
 * 首次解析时快照以 `{ scope, inherited: true }` 记录盖在子会话自己的日志上，
 * 此后父会话的变更绝不会渗入子会话，反之亦然。血缘行走防环且有深度上限；
 * 任何无法解析的链路都降级到最严默认值。丢记录会重新推导初始值
 * （子代理子会话取父快照，其余取最严默认值）。
 */
import {appendPluginRecord, pluginRecordOf} from "@deepseek-ai/dsh-session";

/** 本插件拥有的插件记录类型（语法：`plugin:` + 小写斜杠分段）。 */
export const RECORD = {
    asked: "plugin:workspace-only/asked",
    decided: "plugin:workspace-only/decided",
    alwaysAdded: "plugin:workspace-only/always-added",
    bypass: "plugin:workspace-only/bypass"
};

/**
 * 每会话访问档位。门禁在每次工作区外引用时读取它：
 * - `workspace`（仅工作区内，默认）：工作区外的读或写都要询问；
 * - `outside-read`（工作区外只读）：工作区外的读放行，工作区外的写仍要询问；
 * - `outside-write`（完全放开）：工作区外的读写都放行，不再询问。
 * 敏感文件询问（任务 T4）与 deny 规则（任务 T5）是正交的：两者在所有档位都会触发。
 */
export const SCOPE = {
    /** 仅工作区内 —— 最严默认值。 */
    workspace: "workspace",
    /** 工作区外只读 —— 工作区外读放行，写要询问。 */
    outsideRead: "outside-read",
    /** 完全放开 —— 工作区外访问放行，不再询问。 */
    outsideWrite: "outside-write"
};

/** 所有可识别的档位值（未知输入回退到最严档位）。 */
const SCOPES = new Set(Object.values(SCOPE));

/** 把任意用户/记录输入归一化为档位；未知一律取最严档位。 */
export function normalizeScope(value) {
    return SCOPES.has(value) ? value : SCOPE.workspace;
}

/** 会话档位的进程内权威值，按会话 id 索引。 */
const liveScope = new Map();

/** 尽力而为的审计追加；失败绝不会打断门禁本身。 */
export function recordEvent(session, type, data) {
    if (session === void 0) return undefined;
    try {
        return appendPluginRecord(session, type, data);
    } catch {
        return undefined;
    }
}

/**
 * 读取单个会话已记录的档位折叠值（最后一条记录胜出）。当会话自己的日志里
 * 没有任何档位记录时返回 `undefined` —— 由调用方在最严默认值（普通会话）与
 * 父继承（子代理子会话）之间做选择。同时接受当前的 `{ scope }` 形状
 * （含 `{ scope, inherited: true }` 快照戳记）与旧版 `{ enabled }` 旁路形状。
 */
function foldScopeEntry(session) {
    try {
        const events = session.snapshotEvents();
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const record = pluginRecordOf(events[index]);
            if (record === void 0 || record.type !== RECORD.bypass) continue;
            const data = record.data;
            if (typeof data?.scope === "string") return normalizeScope(data.scope);
            // 旧版布尔旁路：released = 完全放开，engaged = 仅工作区内。
            return data?.enabled === true ? SCOPE.outsideWrite : SCOPE.workspace;
        }
    } catch {
        // 读不出来的会话按无记录处理（fail-safe）。
    }
    return void 0;
}

/** 父血缘行走的深度上限；超过后整条链降级到最严默认值。 */
const INHERIT_MAX_DEPTH = 32;

/**
 * 单个会话的生效档位，解析顺序：实时值 → 会话自己的记录 → 继承的父快照
 * （仅子代理子会话）。继承分支会把快照盖到子会话自己的日志上，使该值在
 * 首次解析时定格；`visited`（以起始会话 id 为种子）加上 `depth` 保证畸形血缘
 * （成环）降级到最严默认值而不是无限递归。
 */
function scopeOf(session, resolveParent, visited, depth) {
    const live = liveScope.get(session.id);
    if (live !== void 0) return live;
    const folded = foldScopeEntry(session);
    if (folded !== void 0) {
        liveScope.set(session.id, folded);
        return folded;
    }
    const parentId = session.header?.parentSession;
    const chainable = typeof resolveParent === "function"
        && typeof parentId === "string" && parentId !== ""
        && !visited.has(parentId) && depth < INHERIT_MAX_DEPTH;
    if (!chainable) {
        liveScope.set(session.id, SCOPE.workspace);
        return SCOPE.workspace;
    }
    visited.add(parentId);
    let parent;
    try {
        parent = resolveParent(parentId);
    } catch {
        parent = void 0;
    }
    if (parent === void 0 || parent === null) {
        liveScope.set(session.id, SCOPE.workspace);
        return SCOPE.workspace;
    }
    const inherited = scopeOf(parent, resolveParent, visited, depth + 1);
    liveScope.set(session.id, inherited);
    // 把继承来的快照钉在子会话自己的日志上。追加失败由下一个开放轮次里的
    // `ensureScopePersisted` 重新落盘。
    recordEvent(session, RECORD.bypass, {scope: inherited, inherited: true});
    return inherited;
}

/**
 * 生效的会话档位：实时值优先，重启后回放记录，然后（带 `resolveParent` 解析器的
 * 子代理子会话）取父会话的一次性快照。接受 Session 对象或裸会话 id（仅查实时值）。
 */
export function sessionScope(sessionOrId, resolveParent) {
    if (sessionOrId === void 0 || sessionOrId === null) return SCOPE.workspace;
    if (typeof sessionOrId === "string") {
        const live = liveScope.get(sessionOrId);
        return live === void 0 ? SCOPE.workspace : live;
    }
    return scopeOf(sessionOrId, resolveParent, new Set([sessionOrId.id]), 0);
}

/**
 * 设置会话的访问档位并以插件记录持久化。
 * 接受 Session 对象或裸会话 id；仅 id 的变更先留在内存里，由下一个轮次中的
 * {@link ensureScopePersisted} 重新落盘。
 */
export function setSessionScope(sessionOrId, scope) {
    if (sessionOrId === void 0 || sessionOrId === null) return SCOPE.workspace;
    const session = typeof sessionOrId === "string" ? void 0 : sessionOrId;
    const id = session === void 0 ? String(sessionOrId) : session.id;
    const next = normalizeScope(scope);
    liveScope.set(id, next);
    if (session !== void 0) recordEvent(session, RECORD.bypass, {scope: next});
    return next;
}

/**
 * 对尚未落进持久日志的实时档位重新落盘。
 * 在门禁内（开放轮次中）调用，这样即使变更发生在两轮之间，UI 切换的档位也能
 * 在重启后存活。
 */
export function ensureScopePersisted(session) {
    if (session === void 0) return;
    const live = liveScope.get(session.id);
    if (live === void 0) return;
    // 这里无记录按最严默认值处理（写入时机与之前一致）：只有实时值与持久化
    // 折叠值不同才重新落盘 —— 包括首次戳记失败的继承快照。
    const folded = foldScopeEntry(session) ?? SCOPE.workspace;
    if (folded === live) return;
    recordEvent(session, RECORD.bypass, {scope: live});
}

/** 单次门禁 ask 的审计事件对，以及 always-added 轨迹（任务 B）。 */
export function recordAsk(session, payload) {
    recordEvent(session, RECORD.asked, payload);
}

export function recordDecision(session, payload) {
    recordEvent(session, RECORD.decided, payload);
}

export function recordAlwaysAdded(session, payload) {
    recordEvent(session, RECORD.alwaysAdded, payload);
}
