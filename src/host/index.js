import {realpathSync} from "node:fs";
import {basename, dirname, isAbsolute, join, resolve} from "node:path";
import z from "@deepseek-ai/schemastery";
import {CHANNEL, CHOICE, createAskFlow} from "./ask.js";
import {createRemoteService} from "./remote-service.js";
import {
    builtinAlwaysDirs,
    denyMatch,
    directoryOf,
    expandHomeSpelling,
    genericTargets,
    isPlatformTempTarget,
    isPreciselyScanned,
    lexicallyWithin,
    scanTargets,
    sensitiveMatch,
    toolAccessKind
} from "./scanner.js";
import {ensureScopePersisted, rootSessionIdOf, SCOPE, sessionScope, setSessionScope} from "./session-state.js";

/**
 * Workspace Only：一个全局开关，把每种沙箱模式（read-only / workspace-write /
 * danger-full-access / auto）的文件访问都限制在会话工作区内 —— 各模式下行为一致 ——
 * 并带有按会话旁路（任务 B）与持久的 always 白名单（任务 B），外加一份内置默认
 * 白名单：`<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`（运行时目录，从 `DSH_HOME`
 * 环境变量解析，否则 `~/.dsh`）总是像全局条目一样放行。该默认值按机器在代码里
 * 解析、绝不持久化 —— home 路径因安装而异，任何配置值都无法安全承载它。
 *
 * 整个限制就是一道门禁：`tools/pre-execute` 处理器把每个引用了会话工作区外路径的
 * 文件类调用都变成一次用户决策。主决策通道是三键提问（"仅此一次 / 总是允许该目录 /
 * 拒绝"），经 `ctx.userQuestions` 发出 —— 即 DSH 路由给权限插件的通道 —— 回退是官方
 * 的 `approval/request` waterfall，派发时不带 `ApprovalService` 的 `never` 策略短路，
 * 因此 Full access 会话同样会弹窗。携带沙箱升级请求的调用仅当官方升级流程保证会
 * 弹出自己的用户确认时才跳过门禁 —— 即请求的模式严格宽于会话当前模式（任务 T1）。
 * 重复或畸形请求在 `approveEscalation` 处零弹窗通过（`if (mode === effectiveMode) return`），
 * 因此这些调用仍要走本门禁而不是静默执行。
 *
 * 配置放在插件的 DSH 0.2 Config（持久化在活动 profile 的 `cordis.patch.yml`）里，
 * 取代已废弃的 0.1 设置通道及其 apiproxy 白名单 patch。运行时写入的字段
 * （`enabled`、`always`）是 `.volatile()` 的，设置表单与本插件共享同一实时引用，
 * 经设置服务写回。
 *
 * 工作区外的写还要额外受 `workspace-write` 模式会话的内核围栏约束（此时工具的
 * `sandbox_permissions` 升权是被认可的完成路径，其本身又是另一次用户确认）。
 * 扫描器是尽力而为的词法围栏（起始路径、引号内与解释器内嵌的绝对路径、POSIX
 * 写法、盘符与 UNC 写法、`~`/`$HOME`、`..\` 逃逸）；静态看不见的读写是文档记载的
 * Level-A 残余，与 auto-mode 插件的立场一致。默认不解析符号链接（任务 T11 记载了
 * 该残余；`realpathCheck` 可选启用对词法"内部"命中的 realpath 复核）。
 *
 * 把 `workspace-write` 预设的显示名改成 "Write Only" 是可选启用的
 * （`renamePresetLabel`，默认关闭），这样除非操作者主动要求，auto-mode 插件
 * 仍能匹配原始标签。
 */

export const name = "workspace-only";
export const inject = ["permissionPresets", "tools", "settings", "systemPrompt"];

/** 任务 T4 默认值：工作区内也要询问的文件名模式，及其豁免。 */
const DEFAULT_SENSITIVE_PATTERNS = ["*.env", "*.env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*"];
const DEFAULT_SENSITIVE_ALLOWS = ["*.env.example", "*.env.sample", "*.env.template", "*.env.defaults"];

export const Config = z.object({
    /** 门禁的主开关（运行时写入）。 */
    enabled: z.boolean().default(true).volatile(),
    /**
     * 总是放行的目录（运行时写入）。三种条目形状：
     * 纯字符串是全局条目（在设置页管理），`{ session, dir }` 是会话级的
     * （在会话页的"白名单目录"视图里管理）—— `session` 是授权会话的**血缘根**
     *（顶层主会话）id，只在该主会话及其子代理/fork 内放行，不同主会话互相
     * 隔离（T20）。`{ root, dir }` 是 T9 的旧项目级形状：仅为不炸配置加载而
     * 保留接受，**匹配与展示一律软忽略**（不放行、不显示）。
     *
     * 元素 schema 必须同时接受所有形状：只声明字符串会让对象条目的每次设置
     * 写回都过不了 schemastery 校验（"expected string but got [object Object]"），
     * 而它静默降级了 ask 卡片的"总是允许该目录"（授权回退成仅此一次）和白名单视图的
     * 添加按钮（写入被拒）成无操作。
     *
     * 内置默认值（`<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`）刻意不是这里的条目：
     * 它在门禁时从实时环境解析（见 `builtinAlwaysDirs`），因此能扛过配置替换，
     * 并在每台机器上保持正确。
     */
    always: z.array(z.union([z.string(), z.object({
        session: z.string(),
        dir: z.string()
    }).required(), z.object({
        root: z.string(),
        dir: z.string()
    }).required()])).default([]).volatile(),
    /** 工作区内也要询问的敏感文件名（任务 T4）。 */
    sensitivePatterns: z.array(z.string()).default([...DEFAULT_SENSITIVE_PATTERNS]),
    /** 在 `sensitivePatterns` 之前判定的豁免（如 `*.env.example`）。 */
    sensitiveAllowPatterns: z.array(z.string()).default([...DEFAULT_SENSITIVE_ALLOWS]),
    /** "总是允许此类文件"的回答所持久化的 pattern（运行时写入）。 */
    sensitiveAlways: z.array(z.string()).default([]).volatile(),
    /** 任务 T5：永不允许规则（目录前缀或 glob）—— 优先级最高（运行时写入）。 */
    deny: z.array(z.string()).default([]).volatile(),
    /** 把 `workspace-write` 预设改名为 "Write Only"（会与 dsh-auto-mode 之类的标签匹配器冲突）。 */
    renamePresetLabel: z.boolean().default(false),
    /** 三键提问的截止毫秒数；超时即拒绝。 */
    dialogTimeoutMs: z.number().step(1).min(1_000).default(120_000),
    /** 任务 T6：对没有应答通道的调用的快速 fail-closed 预算（毫秒；0 = 走完整条回退链）。 */
    fastDenyMs: z.number().step(1).min(0).default(0),
    /** 任务 T8：可选启用对精确 8 工具表之外工具的保守扫描。 */
    scanAllTools: z.boolean().default(false),
    /** 任务 T8：从保守扫描中豁免的工具（误报逃生口）。 */
    scanIgnoreTools: z.array(z.string()).default([]),
    /**
     * 任务 T11：通过 `fs.realpath` 复核词法"内部"命中，使工作区内指向工作区外
     * 真实目标的符号链接仍被询问。每个引用路径多花一次同步 fs 调用，因此默认关闭
     * （保持围栏纯词法，与 MiMo 的 `AppFileSystem.contains` 一致）。
     */
    realpathCheck: z.boolean().default(false)
});

/** 读取 `.volatile()` 引用（或已是普通值的值）。 */
function readVolatile(value) {
    return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

// `@deepseek-ai/dsh-sandbox` 的升权语义，此处内联（本插件不依赖该包；
// scripts/check-compat.mjs 探测 11 会对照真实安装重新核实这些形状）：
// - `ESCALATION_TARGETS` —— 升权目标模式的闭合 schema 枚举；
// - `WIDER_MODES` —— 执行时检查的严格更宽阶梯；
// - `approveEscalation`：`if (mode === effectiveMode) return effectiveMode;`
//   重复请求零弹窗返回当前模式，只有严格更宽的才会弹出审批对话框。
const ESCALATION_TARGETS = new Set(["workspace-write", "danger-full-access"]);
const WIDER_MODES = {
    "read-only": ["workspace-write", "danger-full-access"],
    "workspace-write": ["danger-full-access"]
};
const STANDING_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

/**
 * 会话当前的沙箱模式，经 `ctx.sandboxPolicy.resolve({ session })` 获取
 * （与执行强制时调用的是同一个接口）。策略服务缺席或抛错时返回 `undefined` ——
 * 决策 D1：不确定时绝不跳过。
 */
function standingModeOf(ctx, session) {
    try {
        const policy = ctx.get("sandboxPolicy");
        if (policy === void 0 || typeof policy.resolve !== "function") return void 0;
        const mode = policy.resolve(session === void 0 ? {} : {session})?.mode;
        return STANDING_MODES.has(mode) ? mode : void 0;
    } catch {
        return void 0;
    }
}

/**
 * 仅当官方升级流程保证会为这次调用弹出自己的用户确认时返回 true，即跳过本门禁
 * 不会丢失一次人工决策：有效的升权配对（`sandbox_permissions` 在闭合目标枚举内 +
 * 非空 `justification`）且目标严格宽于会话当前模式。重复（相等）与更窄的请求在
 * 上游绝不弹窗 —— `approveEscalation` 不经审批直接返回当前模式或抛错 —— 因此它们
 * 必须走本门禁（任务 T1）。
 */
function isGuaranteedEscalationPrompt(ctx, session, args) {
    const requested = args.sandbox_permissions;
    if (typeof requested !== "string" || !ESCALATION_TARGETS.has(requested)) return false;
    const justification = args.justification;
    if (typeof justification !== "string" || justification.trim() === "") return false;
    const standing = standingModeOf(ctx, session);
    if (standing === void 0) return false;
    return (WIDER_MODES[standing] ?? []).includes(requested);
}

/** 供设置表面展示的最近 ask 目录（仅显示元数据）。 */
const RECENT_LIMIT = 20;

/**
 * 任务 T11：经最深的现存祖先目录规范化路径，再把缺失的尾巴接回去
 * （MiMo 的 `realpathBestEffort`），这样尚未创建的写目标仍能穿过符号链接父目录
 * 解析。`fs.realpathSync`（刻意不用 `.native`）是跨平台原语：Linux/macOS 上是
 * `realpath(3)` 语义，Windows 上是 `GetFinalPathNameByHandleW`（junction 与
 * 符号链接都能解析；`.native` 可能返回 `\\?\` 前缀写法）。任何失败都返回
 * `undefined` —— 调用方按 fail-closed 处理，即当作外部。
 */
function canonicalizeBestEffort(target) {
    if (typeof target !== "string" || target === "") return void 0;
    const tail = [];
    let head = target;
    for (let depth = 0; depth < 64; depth += 1) {
        try {
            const real = realpathSync(head);
            return tail.length === 0 ? real : join(real, ...tail.slice().reverse());
        } catch (err) {
            // ENOENT 向上走一级；其他任何错误（以及根本身消失）都是硬失败。
            if (err?.code !== "ENOENT") return void 0;
            const parent = dirname(head);
            if (parent === head) return void 0;
            tail.push(basename(head));
            head = parent;
        }
    }
    return void 0;
}

/**
 * 任务 T11：当词法围栏判为内部的路径实际解析到 root 之外时返回 true ——
 * 即指向工作区外的工作区符号链接。两侧都做规范化（root 本身可能是符号链接，
 * 如 macOS 的 `/tmp` -> `/private/tmp`），最终包含判定复用 `lexicallyWithin`，
 * 这样 win32 的大小写/盘符/UNC 语义成立，磁盘上的大小写差异无关紧要。
 * 任何解析失败都算外部（fail-closed）。
 */
function escapesViaRealpath(target, root) {
    const abs = isAbsolute(target) ? target : resolve(root, target);
    const realTarget = canonicalizeBestEffort(abs);
    const realRoot = canonicalizeBestEffort(root);
    if (realTarget === void 0 || realRoot === void 0) return true;
    return !lexicallyWithin(realTarget, realRoot);
}

/**
 * 任务 T14：门禁针对单个会话档位的运行时上下文叙述。
 *
 * 平台会把自己的 `sandbox:policy`（"danger-full-access … does not restrict file
 * modifications"）、`approval:policy`（"approval prompts are disabled … rejected
 * automatically"）与委派条款（"permission scope … cannot be widened"）拼进同一份
 * 运行时上下文快照。并排读下来它们互相抵消 —— 模型无法判断工作区外的写到底会
 * 弹窗、被拒还是静默执行。因此每个变体都以显式的优先级断言开头：门禁生效期间
 * 它的规则压过上面任何冲突措辞。工具表与 `toolAccessKind` 完全一致（shell 始终
 * 算写），并列出生效的 always 白名单，让模型知道哪些目录永不弹窗。
 */
function narrationFor(scope, dirs) {
    const list = Array.isArray(dirs) ? dirs : [];
    const granted = list.length === 0
        ? "none"
        : `${list.slice(0, 20).join(", ")}${list.length > 20 ? ` (+${list.length - 20} more)` : ""}`;
    const override = "Workspace Only is ACTIVE for this session and OVERRIDES every sandbox/approval statement above — where they conflict with this paragraph, this paragraph wins.";
    // 两个限制性档位共有的规则（完全放开不含）。
    const never = " Rules that never relax: sensitive files (*.env, *.pem, *.key, …) ask even INSIDE the workspace; deny (never-allow) rules beat every scope and whitelist entry and cannot be granted. An unanswered card or a timeout DENIES the call (fail closed). Do not try to bypass this gate with `sandbox_permissions` — it is skipped only when the official escalation prompt is guaranteed to appear; a repeated or identical escalation request still hits this card. When a card appears, wait for the user's decision: never guess its outcome, never retry a denied call unchanged, and if this scope forbids access you need, state the limitation to the user instead of fighting the gate.";
    const always = ` Always-allowed directories (granted WITHOUT a prompt): ${granted}.`;
    if (scope === SCOPE.outsideWrite) {
        return `${override} Scope: 完全放开 (fully released): file access outside the session workspace runs WITHOUT the Workspace Only prompt for every tool — the user released this session. Sensitive files (*.env, *.pem, *.key, …) still ask in every case, and deny (never-allow) rules still block.`;
    }
    if (scope === SCOPE.outsideRead) {
        return `${override} Scope: 工作区外只读 (outside-read): READ-only tools (read, read_image, glob, grep) may freely READ outside-workspace paths; write and edit still ask before touching an outside path. Command-line tools (bash, pwsh) always count as WRITES — command text cannot be told apart statically, so ANY outside path inside a shell command asks the user even when the command only reads. Any other tool counts as a write too.${always}${never}`;
    }
    return `${override} Scope: 仅工作区内 (workspace-only): every file access OUTSIDE the session workspace asks the user on a three-choice card (allow once / always allow this directory / deny) — in every sandbox mode, and even when the approval policy is never. Inside the workspace runs normally except sensitive files.${always}${never}`;
}

export function apply(ctx, config = {}) {
    const isEnabled = () => readVolatile(config.enabled) === true;
    /**
     * 一条白名单条目。三种形状：全局字符串、`{ session, dir }` 会话级条目
     *（T20，session=主会话血缘根 id）、`{ root, dir }` 旧项目级条目（T9，
     * 软忽略，仅保留在配置里不炸加载）。`kind` 是匹配与去重键的判别依据。
     */
    const alwaysEntry = (entry) => {
        if (typeof entry === "string" && entry !== "") return {kind: "global", session: void 0, root: void 0, dir: entry};
        if (entry !== null && typeof entry === "object" && typeof entry.dir === "string" && entry.dir !== "") {
            if (typeof entry.session === "string" && entry.session !== "") {
                return {kind: "session", session: entry.session, root: void 0, dir: entry.dir};
            }
            return {
                kind: "legacy",
                session: void 0,
                root: typeof entry.root === "string" && entry.root !== "" ? entry.root : void 0,
                dir: entry.dir
            };
        }
        return void 0;
    };
    const alwaysKey = (entry) => {
        const parsed = alwaysEntry(entry);
        return parsed === void 0 ? "" : `${parsed.kind}:${parsed.session ?? parsed.root ?? ""}|${parsed.dir}`;
    };
    const alwaysList = () => {
        const value = readVolatile(config.always);
        return Array.isArray(value) ? value.filter((entry) => alwaysEntry(entry) !== void 0) : [];
    };
    const stringList = (value, fallback) => {
        const list = readVolatile(value);
        return Array.isArray(list) ? list.filter((entry) => typeof entry === "string") : fallback;
    };
    /** 任务 T4 的敏感文件匹配器输入（patterns 是普通值，always 是 volatile）。 */
    const sensitiveConfigOf = () => ({
        patterns: stringList(config.sensitivePatterns, DEFAULT_SENSITIVE_PATTERNS),
        allowPatterns: stringList(config.sensitiveAllowPatterns, DEFAULT_SENSITIVE_ALLOWS),
        alwaysPatterns: stringList(config.sensitiveAlways, [])
    });
    /** 任务 T5 的 deny 规则（运行时写入）。 */
    const denyList = () => stringList(config.deny, []);
    const timeoutMs = () => readVolatile(config.dialogTimeoutMs);
    const recentAsks = [];
    const settingsOf = () => {
        try {
            return ctx.get("settings");
        } catch {
            return void 0;
        }
    };

    /** 经设置服务持久化 Config 补丁（profile cordis.patch.yml）。 */
    async function writeConfig(patch) {
        const settings = settingsOf();
        if (settings === void 0 || typeof settings.update !== "function") throw new Error("settings service is unavailable");
        await settings.update("workspace-only", patch);
    }

    async function allowAlways(dir, session) {
        const normalized = String(dir);
        // ask 卡片与会话页的授权绑授权会话的**血缘根**（主会话 id，T20）：
        // 主会话及其子代理共享一批条目，不同主会话互相隔离。设置页的授权
        //（无 session）保持全局；解析不到会话时降级为全局条目（设置页可见
        // 可删），绝不静默写成永不生效的孤儿条目。
        const scoped = rootSessionIdOf(session, resolveParent);
        const entry = typeof scoped === "string" && scoped !== "" ? {session: scoped, dir: normalized} : normalized;
        const key = alwaysKey(entry);
        const next = [...alwaysList().filter((item) => alwaysKey(item) !== key), entry];
        await writeConfig({always: next});
    }

    /** 任务 T4：持久化一条敏感 pattern（"总是允许此类文件"）。 */
    async function allowPattern(pattern) {
        const normalized = String(pattern);
        const current = stringList(config.sensitiveAlways, []);
        const next = [...new Set([...current, normalized])];
        await writeConfig({sensitiveAlways: next});
    }

    /** 任务 T5：持久化一条永不允许规则（目录前缀或 glob）。 */
    async function addDeny(entry) {
        const normalized = String(entry);
        const next = [...new Set([...denyList(), normalized])];
        await writeConfig({deny: next});
    }

    async function removeDeny(entry) {
        const normalized = String(entry);
        const next = denyList().filter((item) => item !== normalized);
        await writeConfig({deny: next});
    }

    async function removeAlways(entry) {
        const key = alwaysKey(entry);
        const next = alwaysList().filter((item) => alwaysKey(item) !== key);
        await writeConfig({always: next});
    }

    function noteRecent(dir, toolName) {
        const entry = {dir: String(dir), toolName, at: Date.now()};
        const index = recentAsks.findIndex((item) => item.dir === entry.dir);
        if (index >= 0) recentAsks.splice(index, 1);
        recentAsks.unshift(entry);
        if (recentAsks.length > RECENT_LIMIT) recentAsks.length = RECENT_LIMIT;
    }

    /** 白名单命中：目标位于某条 always 目录之内（T3 两侧展开；T20 先比条目归属会话）。 */
    function alwaysAllows(target, session) {
        const resolved = expandHomeSpelling(target) ?? target;
        // 内置默认白名单（`<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`，按机器解析）
        // 像全局条目一样放行 —— 代码解析、绝不持久化，因此没有设置会烘焙出错误路径，
        // 也没有条目会被误删。deny 规则仍然压过它（它们在门禁里更早返回），敏感文件
        // 维度也不受影响（D5：目录授权从不放行敏感 ask）。
        if (builtinAlwaysDirs().some((dir) => lexicallyWithin(resolved, dir))) return true;
        // T20：会话级条目只在自己的主会话（血缘根）下放行；旧 `{root, dir}`
        // 项目级条目（legacy）软忽略——不匹配；全局字符串条目处处生效。
        // 解析不到会话身份时会话级条目一律不命中（fail-closed 收紧）。
        const sessionKey = rootSessionIdOf(session, resolveParent);
        return alwaysList().some((raw) => {
            const entry = alwaysEntry(raw);
            if (entry === void 0) return false;
            if (entry.kind === "session" && entry.session !== sessionKey) return false;
            if (entry.kind === "legacy") return false;
            return lexicallyWithin(resolved, expandHomeSpelling(entry.dir) ?? entry.dir);
        });
    }

    /**
     * 任务 T14：对某个会话生效的 always 目录，供运行时上下文叙述使用 ——
     * 内置默认值加全局条目加该会话（血缘根）的会话级条目。匹配方式与
     * {@link alwaysAllows} 相同，只是不做路径包含判定。
     */
    function activeAlwaysDirs(session) {
        const dirs = builtinAlwaysDirs();
        const sessionKey = rootSessionIdOf(session, resolveParent);
        for (const raw of alwaysList()) {
            const entry = alwaysEntry(raw);
            if (entry === void 0 || entry.kind === "legacy") continue;
            if (entry.kind === "session" && entry.session !== sessionKey) continue;
            if (!dirs.includes(entry.dir)) dirs.push(entry.dir);
        }
        return dirs;
    }

    // 可选启用的 `workspace-write` 预设显示名改写。
    if (config.renamePresetLabel === true) {
        const presets = ctx.permissionPresets.presets;
        if (Object.hasOwn(presets, "workspace-write") && presets["workspace-write"] !== void 0) {
            presets["workspace-write"].name = "Write Only";
        }
    }

    // 子代理子会话以一次性快照继承父会话档位（创建时语义，与平台的委派沙箱与
    // 审批 seed 一致）：session-state 经这个解析器走父链，并把结果钉在子会话
    // 自己的日志上。
    const resolveParent = (id) => resolveSession(ctx, id);

    // 叙述（任务 T14）：模型必须知道门禁生效且压过平台自己的 sandbox/approval
    // 条款、哪些工具在本会话档位下算读或写，以及哪些目录永不弹窗。
    ctx.systemPrompt.context({
        name: "workspace-only",
        // 排在平台的 sandbox:policy（110）/ approval:policy（115）与委派条款
        // （120/125）之后，这样这一段读起来是权限的最后 —— 也是最终 —— 话语权。
        order: 126,
        text: (context) => {
            const session = context.agent?.session;
            if (session === void 0 || !isEnabled()) return "";
            const scope = sessionScope(session, resolveParent);
            return narrationFor(scope, activeAlwaysDirs(session));
        }
    });

    const askFlow = createAskFlow({
        timeoutMs,
        allowAlways,
        allowPattern,
        fastDenyMs: () => readVolatile(config.fastDenyMs),
        // 任务 T2：新白名单条目批量放行匹配的待决 ask。
        // 任务 T20：回调携带待决项的会话对象，会话级条目只在自己的主会话
        //（血缘根）下匹配。
        isAlwaysAllowed: (path, session) => alwaysAllows(path, session),
        // 任务 T12：敏感 pattern 已持久化的排队 ask 不弹卡片直接结算
        // （pattern 维度，绝不是目录）。
        isPatternAllowed: (pattern) => stringList(config.sensitiveAlways, []).includes(pattern),
        // 任务 T12：在每个已连接客户端上撤掉已结算 ask 的卡片 —— 与 ask 载荷走
        // 同一条白名单通知通道。
        notify: (payload) => {
            try {
                ctx.emit("settings/document-updated", "workspace-only", payload);
            } catch {
                // 通知丢了最多留下一张过期卡片，下次点击会关掉它。
            }
        }
    });

    // 门禁：工作区外的文件访问在任何模式下都要询问用户。
    // 检查顺序：官方升级弹窗有保证的调用跳过（任务 T1 —— 任何更弱的情形都走本门禁），
    // 然后 deny 规则（优先级最高），然后会话档位（任务 D），然后主开关，然后
    // always 白名单，然后三键提问及其系统对话框回退。
    ctx.on("tools/pre-execute", async (exec, next) => {
        const args = exec.arguments ?? {};
        const session = exec.agent?.session;
        const root = session?.header?.cwd;
        if (root === void 0) return next();
        // 任务 T8：精确 8 工具表之外的工具仅当 `scanAllTools` 启用时才做保守扫描
        // （且未被显式忽略）。
        const genericScan = readVolatile(config.scanAllTools) === true && !isPreciselyScanned(exec.name) && !stringList(config.scanIgnoreTools, []).includes(exec.name);
        const entries = genericScan ? genericTargets(exec, root) : scanTargets(exec, root);
        // 任务 T5：deny 规则压过一切 —— 升权跳过、会话旁路、主开关、白名单、
        // 平台临时目录豁免。不弹任何提问。
        const denied = entries.map((entry) => denyMatch(entry.path, denyList())).find((rule) => rule !== void 0);
        if (denied !== void 0) return {kind: "deny", reason: `[workspace-only] denied by deny rule: ${denied}`};
        // 任务 T1：仅当官方升级弹窗有保证时才跳过。重复请求（`sandbox_permissions`
        // 与当前模式相等）在上游是零弹窗放行，因此这里绝不能跳过。
        if (isGuaranteedEscalationPrompt(ctx, session, args)) return next();
        // 任务 D：会话档位在开放轮次内重新落盘。档位只过滤工作区外维度：
        // `outside-write`（完全放开）放行所有工作区外读写，`outside-read`（工作区外只读）
        // 放行纯读取工具的工作区外读。敏感文件询问（任务 T4）在所有档位都会触发 ——
        // 两个维度正交（上面的 deny 规则压过它们全部）。
        ensureScopePersisted(session);
        const scope = sessionScope(session, resolveParent);
        if (!isEnabled()) return next();
        const outsideReadsPass = scope === SCOPE.outsideWrite || (scope === SCOPE.outsideRead && toolAccessKind(exec.name) === "read");
        // 两个正交维度合并为一次提问（任务 T4）：工作区外引用 —— 白名单维度 ——
        // 以及敏感文件名（工作区内也要询问）。平台临时草稿目录对两者都豁免
        // （DSH 自己的溢出/工作目录）。
        // 任务 T11：`realpathCheck` 开启时，词法"内部"命中经 realpath 复核 ——
        // 工作区内真实目标逃逸出去的符号链接翻转为外部，与其他外部引用一样被询问
        // （白名单/deny 匹配仍保持词法）。
        const recheckRealpath = readVolatile(config.realpathCheck) === true;
        const outside = [];
        const sensitive = [];
        const sensitiveSeen = new Set();
        const sensitiveConfig = sensitiveConfigOf();
        for (const entry of entries) {
            if (isPlatformTempTarget(entry.path)) continue;
            const escaped = entry.outside === true || (recheckRealpath && escapesViaRealpath(entry.path, root));
            if (escaped && !outsideReadsPass && !alwaysAllows(entry.path, session)) {
                outside.push(entry.outside === true ? entry : {
                    ...entry,
                    outside: true,
                    reason: `${entry.what ?? "path"} resolves outside the workspace through a symlink: ${entry.path}`
                });
            }
            const match = sensitiveMatch(entry.path, sensitiveConfig);
            if (match !== void 0 && !sensitiveSeen.has(entry.path)) {
                sensitiveSeen.add(entry.path);
                sensitive.push({...entry, ...match});
            }
        }
        if (outside.length === 0 && sensitive.length === 0) return next();
        const reason = [...outside.slice(0, 1), ...sensitive.slice(0, 1)].map((entry) => entry.reason).join("；");
        if (exec.agent === void 0) return {kind: "deny", reason: `[workspace-only] ${reason}`};
        const focus = outside[0] ?? sensitive[0];
        noteRecent(directoryOf(focus.path), exec.name);
        const verdict = await askFlow.askOutside({
            ctx,
            agent: exec.agent,
            session,
            exec,
            reason,
            dir: directoryOf(focus.path),
            // 批量放行（T2）的目标始终是工作区外集合：目录白名单绝不能放行敏感 ask（D5）。
            targets: outside.map((entry) => entry.path),
            grantKinds: [...outside.length > 0 ? ["dir"] : [], ...sensitive.length > 0 ? ["pattern"] : []],
            patterns: [...new Set(sensitive.map((entry) => entry.pattern))],
            sensitive: sensitive.length > 0,
            signal: exec.signal
        });
        // "仅此一次"与"总是允许该目录"都放行这次调用
        // （后者已经把白名单条目持久化了）。
        if (verdict.choice === CHOICE.once || verdict.choice === CHOICE.always) return {kind: "allow"};
        if (verdict.channel === CHANNEL.systemDialog) return {
            kind: "deny",
            reason: `[workspace-only] the user rejected ${exec.name}: ${reason}`
        };
        return {kind: "deny", reason: `[workspace-only] ${reason} — the user denied this call`};
    });

    // 面向客户端的管理表面（任务 B 与 D）：白名单条目、最近 ask，以及按会话的旁路开关。
    createRemoteService(ctx, {
        snapshot(sessionId) {
            const sessions = liveSessions(ctx).map((session) => ({
                id: session.id,
                // T20：血缘根（主会话）id——客户端白名单视图按它过滤会话级条目，
                // 子代理会话与主会话共享同一批条目。
                rootId: rootSessionIdOf(session, resolveParent),
                cwd: session.header?.cwd ?? "",
                scope: sessionScope(session, resolveParent)
            }));
            return {
                enabled: isEnabled(),
                always: alwaysList(),
                // 为这台机器解析好的内置默认白名单（仅供显示：设置行以只读展示；
                // 授权与移除只动 `always`）。
                builtinAlways: builtinAlwaysDirs(),
                deny: denyList(),
                recent: recentAsks.slice(),
                renamePresetLabel: config.renamePresetLabel === true,
                dialogTimeoutMs: timeoutMs(),
                // 优先用 Session 对象：继承需要 header 来走父链；裸 id 只降级到实时值。
                scope: sessionScope(resolveSession(ctx, sessionId) ?? sessionId, resolveParent),
                sessions
            };
        },
        setScope(sessionId, scope) {
            const session = resolveSession(ctx, sessionId);
            const applied = setSessionScope(session ?? sessionId, scope);
            return {scope: applied};
        },
        addAlways: (dir, sessionId) => {
            // 会话级授权（ask 卡片、会话页）：条目绑授权会话的血缘根（显式 id，
            // 否则取第一个活跃会话）。解析不到会话则降级为全局条目。
            const session = resolveSession(ctx, sessionId) ?? liveSessions(ctx)[0];
            return allowAlways(dir, session).then(() => ({always: alwaysList()}));
        },
        // 全局授权（设置页）：纯字符串条目，处处生效。
        addGlobalAlways: (dir) => allowAlways(dir).then(() => ({always: alwaysList()})),
        removeAlways: (entry) => removeAlways(entry).then(() => ({always: alwaysList()})),
        addDeny: (entry) => addDeny(entry).then(() => ({deny: denyList()})),
        removeDeny: (entry) => removeDeny(entry).then(() => ({deny: denyList()})),
        clearRecent() {
            recentAsks.length = 0;
            return {recent: []};
        },
        // 任务 B 的 composer 面板：presence 握手与决策。
        announce: (requestId) => askFlow.announce(requestId),
        decide: (requestId, choice) => askFlow.decide(requestId, choice),
        pendingList: () => askFlow.pendingList()
    });
}

/** 本宿主的全部活跃会话，防御性写法（sessions 服务可能缺席）。 */
function liveSessions(ctx) {
    try {
        const sessions = ctx.get("sessions");
        const list = typeof sessions?.list === "function" ? sessions.list() : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

/** 经 sessions 服务按 id 解析活跃 Session，若已组合进上下文。 */
function resolveSession(ctx, sessionId) {
    if (typeof sessionId !== "string" || sessionId === "") return void 0;
    try {
        const sessions = ctx.get("sessions");
        const session = typeof sessions?.get === "function" ? sessions.get(sessionId) : void 0;
        return session;
    } catch {
        return void 0;
    }
}
