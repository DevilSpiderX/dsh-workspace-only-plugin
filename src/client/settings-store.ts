import {createSnapshotStore} from "./snapshot-store.ts";

/**
 * 基于 DSH 0.2 通道的 Workspace Only 状态控制器：持久化的开关/白名单
 * 走 `ctx.remote.settings`（插件 profile 条目的 Config 表单，
 * ns = "workspace-only"），会话档位与白名单管理走插件自己的
 * `workspaceOnly/*` Remote 端点。管理调用搭 Gateway 的公开一元 RPC
 *（`connection.rpc.call("/api", endpoint, { args })`）：第三方 namespace
 * 拿不到 `remote.<ns>` 访问器，除非自带生成的 client contribution。
 * store 接口保持不变，设置页与 composer 选择器仍是纯展示层。
 */

/** `ctx.remote.settings` 的最小形状（平台面，类型在未钉进 devDeps 的包里）。 */
export interface SettingsRemoteApi {
    describe(): Promise<unknown>;
    mutate(ns: string, ops: unknown, revision: number | undefined): Promise<unknown>;
}

/** `ctx.remote` 的最小形状（仅用到 settings 子面）。 */
export interface RemoteWithSettings {
    settings: SettingsRemoteApi;
}

/** `ctx.connection` 的最小形状（Gateway 公开一元 RPC）。 */
export interface GatewayConnection {
    rpc: {call(path: string, endpoint: string, payload: {args: Record<string, unknown>}): Promise<unknown>};
}

/** settings/describe 的响应（wire 形状：host 侧产出，读取处宽松判定）。 */
interface SettingsDescribeResponse {
    readonly namespaces?: ReadonlyArray<Record<string, unknown>> | undefined;
    readonly writable?: unknown;
}

/** 任务 T39：学习层 Config 字段的展示形状（LLM 整理开关/模型/推理等级）。 */
export interface LearnConfigView {
    llmAssist: boolean;
    llmModel: string;
    llmReasoningEffort: string;
}

/** 一条「最近询问」记录的展示形状。 */
export interface RecentAskView {
    dir: string;
    toolName: string;
    at: number;
}

/** 一个会话档位条目的展示形状。 */
export interface SessionScopeView {
    id: string;
    rootId: string | undefined;
    cwd: string;
    scope: string;
}

/** 设置控制器的快照状态（展示层消费的形状）。 */
export interface SettingsState {
    status: "idle" | "loading" | "unavailable" | "saving" | "ready" | "error";
    error: string | null;
    writable: boolean;
    enabled: boolean;
    revision: number;
    always: unknown[];
    builtinAlways: string[];
    deny: string[];
    recent: RecentAskView[];
    sessions: SessionScopeView[];
    /** 任务 T16：Host 的 ask 截止时间，供卡片自毁兜底（丢失的 `askDone` 不能让过期卡片永远赖着）。 */
    dialogTimeoutMs: number;
    /** 任务 T39：学习层 Config 字段（可缺席=旧宿主/未加载，UI 取默认值）。 */
    learnConfig?: LearnConfigView;
}

/** settings 的 namespace 视图（wire 形状，宽松读取）。 */
interface NamespaceViewLike {
    readonly ns?: unknown;
    readonly revision?: unknown;
    readonly value?: Record<string, unknown> | undefined;
}

/** `workspaceOnly/snapshot` 的响应（wire 形状，宽松读取）。 */
interface RemoteSnapshotLike {
    readonly always?: unknown;
    readonly builtinAlways?: unknown;
    readonly deny?: unknown;
    readonly recent?: unknown;
    readonly sessions?: unknown;
    readonly dialogTimeoutMs?: unknown;
}

const WorkspaceOnlySettingsController = class {
    remote: RemoteWithSettings;
    connection: GatewayConnection;
    store = createSnapshotStore<SettingsState>({
        status: "idle",
        error: null,
        writable: false,
        enabled: false,
        revision: 0,
        always: [],
        builtinAlways: [],
        deny: [],
        recent: [],
        sessions: [],
        // 任务 T16：Host 的 ask 截止时间，供卡片自毁兜底
        //（丢失的 `askDone` 不能让过期卡片永远赖着）。
        dialogTimeoutMs: 120_000
    });
    generation = 0;
    view: NamespaceViewLike | undefined;

    constructor(remote: RemoteWithSettings, connection: GatewayConnection) {
        this.remote = remote;
        this.connection = connection;
    }

    unwrap(result: unknown): unknown {
        const envelope = (result ?? {}) as {ok?: unknown; error?: {message?: unknown} | undefined; value?: unknown};
        if (result === null || result === void 0 || envelope.ok !== true) throw new Error(String(envelope.error?.message ?? "remote call failed"));
        return envelope.value;
    }

    /** 经 Gateway RPC 调用一个 `workspaceOnly/<method>` 端点。 */
    call(method: string, args?: Record<string, unknown> | undefined): Promise<unknown> {
        return this.connection.rpc.call("/api", `workspaceOnly/${method}`, {args: args ?? {}});
    }

    async load(): Promise<void> {
        const generation = ++this.generation;
        this.store.update((state) => {
            state.status = "loading";
            state.error = null;
        });
        try {
            const response = this.unwrap(await this.remote.settings.describe()) as SettingsDescribeResponse;
            if (generation !== this.generation) return;
            const view = (response.namespaces ?? []).find((entry) => entry.ns === "workspace-only");
            if (view === void 0) {
                this.view = void 0;
                this.store.update((state) => {
                    state.status = "unavailable";
                    state.writable = false;
                    state.enabled = false;
                });
                return;
            }
            this.accept(view, response.writable === true);
            await this.refreshRemote();
        } catch (error) {
            if (generation !== this.generation) return;
            this.fail(error);
        }
    }

    /** 从插件的 Remote 服务拉取管理状态（白名单、最近询问、会话档位）。 */
    async refreshRemote(): Promise<void> {
        try {
            const snapshot = this.unwrap(await this.call("snapshot", {})) as RemoteSnapshotLike;
            this.store.update((state) => {
                // wire 边界：集合由 Host 侧产出，形状与 RecentAskView/SessionScopeView 一致，集中归一。
                state.always = Array.isArray(snapshot.always) ? snapshot.always : [];
                state.builtinAlways = Array.isArray(snapshot.builtinAlways) ? snapshot.builtinAlways as string[] : [];
                state.deny = Array.isArray(snapshot.deny) ? snapshot.deny as string[] : [];
                state.recent = Array.isArray(snapshot.recent) ? snapshot.recent as RecentAskView[] : [];
                state.sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions as SessionScopeView[] : [];
                if (Number.isSafeInteger(snapshot.dialogTimeoutMs) && (snapshot.dialogTimeoutMs as number) >= 1) state.dialogTimeoutMs = snapshot.dialogTimeoutMs as number;
            });
        } catch {
            // 没有管理服务的旧宿主保持仅设置页的 UI。
        }
    }

    async select(enabled: boolean): Promise<void> {
        const view = this.view;
        const state = this.store.getSnapshot();
        if (view === void 0 || !state.writable) return;
        const generation = ++this.generation;
        this.store.update((draft) => {
            draft.status = "saving";
            draft.error = null;
        });
        try {
            const next = this.unwrap(await this.remote.settings.mutate("workspace-only", [{
                op: "set",
                path: ["enabled"],
                value: enabled
            }], typeof view.revision === "number" ? view.revision : void 0)) as NamespaceViewLike | undefined;
            if (generation !== this.generation) return;
            // `settings/mutate` 返回刷新后的 namespace 视图。
            this.accept(next?.ns === "workspace-only" && next !== void 0 ? next : view, true);
        } catch (error) {
            if (generation !== this.generation) return;
            this.fail(error);
        }
    }

    /** 经插件服务持久化一条会话级白名单条目（询问卡片、会话页）。 */
    async allowAlways(dir: string, sessionId: string | undefined): Promise<void> {
        try {
            this.unwrap(await this.call("addAlways", {dir, sessionId}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 经插件服务持久化一条全局白名单条目（设置页）。 */
    async addGlobalAlways(dir: string): Promise<void> {
        try {
            this.unwrap(await this.call("addGlobalAlways", {dir}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    async removeAlways(entry: unknown): Promise<void> {
        try {
            this.unwrap(await this.call("removeAlways", {entry}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 任务 T5：经插件服务持久化一条永不放行规则（写入 Config.deny）。 */
    async addDeny(entry: string): Promise<void> {
        try {
            this.unwrap(await this.call("addDeny", {entry}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    async removeDeny(entry: string): Promise<void> {
        try {
            this.unwrap(await this.call("removeDeny", {entry}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    async clearRecent(): Promise<void> {
        try {
            this.unwrap(await this.call("clearRecent", {}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 任务 D：设置某个会话的访问档位（workspace / outside-read / outside-write）。 */
    async setScope(sessionId: string, scope: string): Promise<void> {
        try {
            this.unwrap(await this.call("setScope", {sessionId, scope}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 任务 T39：写回学习层 Config 字段（LLM 整理开关/模型/推理等级）。 */
    async setLearnConfig(fields: Record<string, unknown>): Promise<void> {
        const view = this.view;
        const state = this.store.getSnapshot();
        if (view === void 0 || !state.writable) return;
        const generation = ++this.generation;
        this.store.update((draft) => {
            draft.status = "saving";
            draft.error = null;
        });
        try {
            const ops = Object.entries(fields).map(([key, value]) => ({
                op: "set",
                path: [key],
                value
            }));
            const next = this.unwrap(await this.remote.settings.mutate("workspace-only", ops, typeof view.revision === "number" ? view.revision : void 0)) as NamespaceViewLike | undefined;
            if (generation !== this.generation) return;
            this.accept(next?.ns === "workspace-only" && next !== void 0 ? next : view, true);
        } catch (error) {
            if (generation !== this.generation) return;
            this.fail(error);
        }
    }

    /** 任务 T39：重置学习数据（learn.sqlite3 全部学习表清空、重新开始学习）。 */
    async resetLearnData(): Promise<unknown> {
        try {
            const result = this.unwrap(await this.call("resetLearnData", {}));
            await this.refreshRemote();
            return result;
        } catch (error) {
            this.fail(error);
            return void 0;
        }
    }

    /** 任务 T39：立即执行一轮 LLM 整理，返回运行摘要（TidyRunSummary 宽松形状）。 */
    async runLlmTidy(): Promise<unknown> {
        try {
            return this.unwrap(await this.call("runLlmTidy", {}));
        } catch (error) {
            this.fail(error);
            return void 0;
        }
    }

    dispose(): void {
        this.generation += 1;
        this.view = void 0;
    }

    accept(view: NamespaceViewLike, writable: boolean): void {
        this.view = view;
        this.store.update((state) => {
            state.status = "ready";
            state.error = null;
            state.writable = writable;
            state.enabled = view.value?.enabled === true;
            state.learnConfig = {
                llmAssist: view.value?.llmAssist !== false,
                llmModel: typeof view.value?.llmModel === "string" ? view.value.llmModel as string : "auto",
                llmReasoningEffort: typeof view.value?.llmReasoningEffort === "string" ? view.value.llmReasoningEffort as string : "default"
            };
            state.revision = typeof view.revision === "number" ? view.revision : state.revision;
        });
    }

    fail(error: unknown): void {
        this.store.update((state) => {
            state.status = "error";
            state.error = error instanceof Error ? error.message : String(error);
        });
    }
};
export {WorkspaceOnlySettingsController};
