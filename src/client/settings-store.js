import {createSnapshotStore} from "./snapshot-store.js";

/**
 * 基于 DSH 0.2 通道的 Workspace Only 状态控制器：持久化的开关/白名单
 * 走 `ctx.remote.settings`（插件 profile 条目的 Config 表单，
 * ns = "workspace-only"），会话档位与白名单管理走插件自己的
 * `workspaceOnly/*` Remote 端点。管理调用搭 Gateway 的公开一元 RPC
 *（`connection.rpc.call("/api", endpoint, { args })`）：第三方 namespace
 * 拿不到 `remote.<ns>` 访问器，除非自带生成的 client contribution。
 * store 接口保持不变，设置页与 composer 选择器仍是纯展示层。
 */
const WorkspaceOnlySettingsController = class {
    remote;
    connection;
    store = createSnapshotStore({
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
    view;

    constructor(remote, connection) {
        this.remote = remote;
        this.connection = connection;
    }

    unwrap(result) {
        if (result === null || result === void 0 || result.ok !== true) throw new Error(result?.error?.message ?? "remote call failed");
        return result.value;
    }

    /** 经 Gateway RPC 调用一个 `workspaceOnly/<method>` 端点。 */
    call(method, args) {
        return this.connection.rpc.call("/api", `workspaceOnly/${method}`, {args: args ?? {}});
    }

    async load() {
        const generation = ++this.generation;
        this.store.update((state) => {
            state.status = "loading";
            state.error = null;
        });
        try {
            const response = this.unwrap(await this.remote.settings.describe());
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
    async refreshRemote() {
        try {
            const snapshot = this.unwrap(await this.call("snapshot", {}));
            this.store.update((state) => {
                state.always = Array.isArray(snapshot.always) ? snapshot.always : [];
                state.builtinAlways = Array.isArray(snapshot.builtinAlways) ? snapshot.builtinAlways : [];
                state.deny = Array.isArray(snapshot.deny) ? snapshot.deny : [];
                state.recent = Array.isArray(snapshot.recent) ? snapshot.recent : [];
                state.sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
                if (Number.isSafeInteger(snapshot.dialogTimeoutMs) && snapshot.dialogTimeoutMs >= 1) state.dialogTimeoutMs = snapshot.dialogTimeoutMs;
            });
        } catch {
            // 没有管理服务的旧宿主保持仅设置页的 UI。
        }
    }

    async select(enabled) {
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
            }], view.revision));
            if (generation !== this.generation) return;
            // `settings/mutate` 返回刷新后的 namespace 视图。
            this.accept(next?.ns === "workspace-only" ? next : view, true);
        } catch (error) {
            if (generation !== this.generation) return;
            this.fail(error);
        }
    }

    /** 经插件服务持久化一条会话级白名单条目（询问卡片、会话页）。 */
    async allowAlways(dir, sessionId) {
        try {
            this.unwrap(await this.call("addAlways", {dir, sessionId}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 经插件服务持久化一条全局白名单条目（设置页）。 */
    async addGlobalAlways(dir) {
        try {
            this.unwrap(await this.call("addGlobalAlways", {dir}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    async removeAlways(entry) {
        try {
            this.unwrap(await this.call("removeAlways", {entry}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 任务 T5：经插件服务持久化一条永不放行规则（写入 Config.deny）。 */
    async addDeny(entry) {
        try {
            this.unwrap(await this.call("addDeny", {entry}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    async removeDeny(entry) {
        try {
            this.unwrap(await this.call("removeDeny", {entry}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    async clearRecent() {
        try {
            this.unwrap(await this.call("clearRecent", {}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    /** 任务 D：设置某个会话的访问档位（workspace / outside-read / outside-write）。 */
    async setScope(sessionId, scope) {
        try {
            this.unwrap(await this.call("setScope", {sessionId, scope}));
            await this.refreshRemote();
        } catch (error) {
            this.fail(error);
        }
    }

    dispose() {
        this.generation += 1;
        this.view = void 0;
    }

    accept(view, writable) {
        this.view = view;
        this.store.update((state) => {
            state.status = "ready";
            state.error = null;
            state.writable = writable;
            state.enabled = view.value?.enabled === true;
            state.revision = view.revision;
        });
    }

    fail(error) {
        this.store.update((state) => {
            state.status = "error";
            state.error = error instanceof Error ? error.message : String(error);
        });
    }
};
export {WorkspaceOnlySettingsController};
