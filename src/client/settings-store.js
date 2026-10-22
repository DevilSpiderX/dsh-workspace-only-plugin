import { createSnapshotStore } from "./snapshot-store.js";

/**
* Workspace Only state controller over the DSH 0.2 channels:
* `ctx.remote.settings` (Config forms of the plugin's profile entry,
* ns = "workspace-only") for the persisted switch/whitelist, and the
* plugin's own `workspaceOnly/*` Remote endpoints for session scope and
* whitelist management. The management calls ride the Gateway's public
* unary RPC (`connection.rpc.call("/api", endpoint, { args })`): a
* third-party namespace gets no `remote.<ns>` accessor unless it ships a
* generated client contribution. The store interface is unchanged so the
* settings page and the composer selector stay presentation-only.
*/
var WorkspaceOnlySettingsController = class {
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
		// Task T16: the Host's ask deadline, for the card's self-destruct
		// backstop (a lost `askDone` must not leave a stale card forever).
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
	/** Call one `workspaceOnly/<method>` endpoint through the Gateway RPC. */
	call(method, args) {
		return this.connection.rpc.call("/api", `workspaceOnly/${method}`, { args: args ?? {} });
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
	/** Pull management state (whitelist, recent asks, session scopes) from the plugin's Remote service. */
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
			// Older hosts without the management service keep the settings-only UI.
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
			// `settings/mutate` returns the refreshed namespace view.
			this.accept(next?.ns === "workspace-only" ? next : view, true);
		} catch (error) {
			if (generation !== this.generation) return;
			this.fail(error);
		}
	}
	/** Persist a SESSION-SCOPED whitelist entry through the plugin service (ask card, session page). */
	async allowAlways(dir, sessionId) {
		try {
			this.unwrap(await this.call("addAlways", { dir, sessionId }));
			await this.refreshRemote();
		} catch (error) {
			this.fail(error);
		}
	}
	/** Persist a GLOBAL whitelist entry through the plugin service (settings page). */
	async addGlobalAlways(dir) {
		try {
			this.unwrap(await this.call("addGlobalAlways", { dir }));
			await this.refreshRemote();
		} catch (error) {
			this.fail(error);
		}
	}
	async removeAlways(entry) {
		try {
			this.unwrap(await this.call("removeAlways", { entry }));
			await this.refreshRemote();
		} catch (error) {
			this.fail(error);
		}
	}
	/** Task T5: persist a never-allow rule through the plugin service (writes Config.deny). */
	async addDeny(entry) {
		try {
			this.unwrap(await this.call("addDeny", { entry }));
			await this.refreshRemote();
		} catch (error) {
			this.fail(error);
		}
	}
	async removeDeny(entry) {
		try {
			this.unwrap(await this.call("removeDeny", { entry }));
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
	/** Task D: set one session's access scope (workspace / outside-read / outside-write). */
	async setScope(sessionId, scope) {
		try {
			this.unwrap(await this.call("setScope", { sessionId, scope }));
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
export { WorkspaceOnlySettingsController };
