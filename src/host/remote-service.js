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
 *   **wire 字段名的三方契约（T22）**：source-mode 用 `Function.prototype.toString()`
 *   从方法形参名提取 `args` 的 wire 字段名，并要求客户端 `args` 键与之精确一致。
 *   而 `lib/remote-service.js` 是全压缩产物、形参名会被 mangle 成 `e`/`t`，曾使
 *   全部带参端点报 `args fields do not match the descriptor: unexpected "..."`。
 *   现在优先向 typert registry 注册 strict `InvocationDescriptor`（wire 名固化为
 *   字面量、免疫压缩；Gateway 的 `resolveDescriptor` 优先命中 strict 定义），
 *   source-mode 仅留作缺 typert 的 composition 上的兜底。三方一致
 *   （源码形参名 == `REMOTE_WIRES` == 客户端 `args` 键）由
 *   `scripts/verify-remote-service.mjs` 看守——改方法签名必须同步 `REMOTE_WIRES`。
 *
 * `@deepseek-ai/dsh-typert-protocol` 是刻意不 import 的 —— binding 与描述符的
 * 形状按字面复刻，这样在缺少该包的 composition 上本插件仍可加载。
 */
import {Service} from "@deepseek-ai/cordis";

/** Gateway 的 `remoteMethods()` 读取的原型键。 */
const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** 本插件 Remote 表面的服务键、线上命名空间与 TypertContribution 包名。 */
export const REMOTE_SERVICE_KEY = "workspaceOnly";
export const REMOTE_NAMESPACE = "workspaceOnly";
const REMOTE_PACKAGE = "dsh-workspace-only-plugin";

/**
 * Remote 方法的 wire 契约表：`方法名 -> 按形参顺序排列的 wire 字段名`。
 *
 * 三方必须一致：本表 == 类方法的形参名 == 客户端 `call()` 发出的 `args` 键。
 * 值是字符串字面量，因此在全压缩产物里原样保留——这是 strict 描述符的
 * wire 来源（见文件头 T22 注释）。`scripts/verify-remote-service.mjs` 看守。
 */
export const REMOTE_WIRES = Object.freeze({
    snapshot: Object.freeze(["sessionId"]),
    setScope: Object.freeze(["sessionId", "scope"]),
    addAlways: Object.freeze(["dir", "sessionId"]),
    addGlobalAlways: Object.freeze(["dir"]),
    removeAlways: Object.freeze(["entry"]),
    addDeny: Object.freeze(["entry"]),
    removeDeny: Object.freeze(["entry"]),
    clearRecent: Object.freeze([]),
    announce: Object.freeze(["requestId"]),
    decide: Object.freeze(["requestId", "choice"]),
    pendingList: Object.freeze([])
});

/** 暴露给 `ctx.remote.workspaceOnly.*` / `workspaceOnly/*` RPC 的 Remote 方法名。 */
export const REMOTE_METHODS = Object.freeze(Object.keys(REMOTE_WIRES));

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

/** JSON 参数/结果的 SRC codec（`{mode: "src-json"}` 形状按字面复刻，普通 JSON 值不需编解码）。 */
const SRC_JSON_CODEC = Object.freeze({mode: "src-json"});

/**
 * 由 `REMOTE_WIRES` 生成各端点的 strict `InvocationDescriptor`，字段形状按
 * `@deepseek-ai/dsh-typert-protocol` 的 `InvocationDescriptor` 字面复刻。
 * `parameters` 的顺序即类方法的形参顺序（Gateway 按它位置传参）。
 */
function invocationDescriptors() {
    return Object.entries(REMOTE_WIRES).map(([method, wires]) => Object.freeze({
        id: `${REMOTE_PACKAGE}#${REMOTE_NAMESPACE}/${method}`,
        service: REMOTE_SERVICE_KEY,
        namespace: REMOTE_NAMESPACE,
        method,
        invocation: Object.freeze({kind: "direct"}),
        parameters: Object.freeze(wires.map((wire) => Object.freeze({
            name: wire,
            wire,
            source: "json",
            codec: SRC_JSON_CODEC
        }))),
        result: SRC_JSON_CODEC
    }));
}

/**
 * 向 typert registry 注册 strict 调用描述符：Gateway 的 `resolveDescriptor`
 * 优先命中 `ctx.typert.local` 的 strict 定义，wire 字段名不再从方法形参名推断。
 *
 * typert 缺席或注册被拒时降级 source-mode 并告警，绝不阻塞插件加载——
 * 源码直跑（smoke）下 source-mode 的形参名通道仍然正确。
 *
 * @param ctx - 宿主上下文。
 * @returns 注册的 disposer（交给 `ctx.effect` 随插件 fiber 释放）；降级时为空函数。
 */
export function registerRemoteDescriptors(ctx) {
    try {
        const typert = typeof ctx?.get === "function" ? ctx.get("typert") : void 0;
        if (typert === void 0 || typeof typert.register !== "function") return () => {};
        return typert.register({
            package: REMOTE_PACKAGE,
            face: "host",
            schemas: [],
            model: {services: [], events: [], objects: []},
            invocations: invocationDescriptors()
        });
    } catch (error) {
        console.warn("[workspace-only] typert descriptor registration failed; falling back to source-mode", error);
        return () => {};
    }
}

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
        // strict 调用描述符随本服务注册、随插件 fiber 撤回（见文件头 T22 注释）。
        if (typeof ctx?.effect === "function") {
            ctx.effect(() => registerRemoteDescriptors(ctx), "workspace-only: typert descriptors");
        } else {
            registerRemoteDescriptors(ctx);
        }
        return service;
    } catch {
        return void 0;
    }
}
