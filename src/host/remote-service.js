/**
 * Client↔Host 管理 RPC（任务 B 与 D）。
 *
 * Web 客户端无法自行向 Host 推送状态，而 Host 的转发事件白名单是编译进
 * `dsh-api-remotes` 的，因此两个方向被拆开：
 *
 *   Host → Client（提问）：`ctx.userQuestions.ask()` —— 见 `ask.js`。
 *   Client → Host（管理）：即本服务，一个 Typert "source-mode" Remote 服务，
 *   命名空间为 `workspaceOnly`。API Gateway 会发现实例携带 `typertRemote` binding、
 *   且类原型携带 Remote 方法描述符（即 `bindTypertRemote`/`Remote` 产出的确切结构）
 *   的服务，然后把 `ctx.remote.<namespace>.<method>(...)` 调用派发到这里。
 *   不需要生成 Typert 产物：source-mode 描述符以普通 JSON 校验参数，方法参数名
 *   从源码签名读取。
 *
 * `@deepseek-ai/dsh-typert-protocol` 是刻意不 import 的 —— binding 与描述符的
 * 形状按字面复刻，这样在缺少该包的 composition 上本插件仍可加载。
 */
import {Service} from "@deepseek-ai/cordis";

/** Gateway 的 `remoteMethods()` 读取的原型键。 */
const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** 本插件 Remote 表面的服务键与线上命名空间。 */
export const REMOTE_SERVICE_KEY = "workspaceOnly";
export const REMOTE_NAMESPACE = "workspaceOnly";

/** 暴露给 `ctx.remote.workspaceOnly.*` / `workspaceOnly/*` RPC 的 Remote 方法名。 */
export const REMOTE_METHODS = ["snapshot", "setScope", "addAlways", "addGlobalAlways", "removeAlways", "addDeny", "removeDeny", "clearRecent", "announce", "decide", "pendingList"];

/**
 * 插件交进来的管理表面：对 Config 与会话状态的纯操作。每个钩子都返回普通 JSON。
 */
var WorkspaceOnlyRemoteService = class extends Service {
    hooks;

    constructor(ctx, hooks) {
        super(ctx, REMOTE_SERVICE_KEY);
        this.hooks = hooks;
        // 等价于 `bindTypertRemote(this, key, { namespace })`：Gateway 在每次
        // source-mode 派发时校验的冻结 binding。
        this.typertRemote = Object.freeze({
            service: this,
            serviceKey: REMOTE_SERVICE_KEY,
            namespace: REMOTE_NAMESPACE
        });
    }

    /** 当前开关、白名单（含解析后的内置默认白名单）、最近的 ask，以及单个会话的访问档位。 */
    async snapshot(sessionId) {
        return this.hooks.snapshot(sessionId);
    }

    /** 设置单个会话的访问档位：`workspace` / `outside-read` / `outside-write`。 */
    async setScope(sessionId, scope) {
        return this.hooks.setScope(sessionId, scope);
    }

    /** 持久化一条会话级白名单条目（盖上授权会话的 root）。 */
    async addAlways(dir, sessionId) {
        return this.hooks.addAlways(dir, sessionId);
    }

    /** 持久化一条全局白名单条目（纯字符串；在设置页管理）。 */
    async addGlobalAlways(dir) {
        return this.hooks.addGlobalAlways(dir);
    }

    /** 移除一条白名单条目（字符串或 `{ root, dir }`，任务 T9）。 */
    async removeAlways(entry) {
        return this.hooks.removeAlways(entry);
    }

    /** 任务 T5：持久化一条永不允许规则（目录前缀或 glob）。 */
    async addDeny(entry) {
        return this.hooks.addDeny(entry);
    }

    /** 移除一条 deny 规则。 */
    async removeDeny(entry) {
        return this.hooks.removeDeny(entry);
    }

    /** 清空设置页展示的最近 ask 列表。 */
    async clearRecent() {
        return this.hooks.clearRecent();
    }

    /** 任务 B：composer 面板报告自己已出现在 `requestId` 对应的屏幕上。 */
    async announce(requestId) {
        return this.hooks.announce(requestId);
    }

    /** 任务 B：composer 面板提交 `once` / `always` / `deny`。 */
    async decide(requestId, choice) {
        return this.hooks.decide(requestId, choice);
    }

    /** 待决的门禁 ask（供设置表面做诊断）。 */
    async pendingList() {
        return this.hooks.pendingList();
    }
};

// Remote 方法描述符，与 `Remote` + `mark()` 挂到类原型下的结构字节级兼容
// （version 1，直接调用标记）。
Object.defineProperty(WorkspaceOnlyRemoteService.prototype, REMOTE_METHODS_KEY, {
    configurable: true,
    value: Object.freeze({
        version: 1,
        methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({
            method,
            invocation: Object.freeze({kind: "direct"})
        })))
    })
});

/**
 * 在宿主上下文上注册 Remote 服务。
 *
 * @param ctx - 宿主上下文。
 * @param hooks - 管理操作（见 {@link WorkspaceOnlyRemoteService}）。
 * @returns 服务实例；若本 composition 中 Cordis Service 基类不可用则返回 `undefined`
 *   （此时管理 UI 降级为仅设置表单）。
 */
export function createRemoteService(ctx, hooks) {
    if (Service === void 0) return void 0;
    try {
        const service = new WorkspaceOnlyRemoteService(ctx, hooks);
        return service;
    } catch {
        return void 0;
    }
}
