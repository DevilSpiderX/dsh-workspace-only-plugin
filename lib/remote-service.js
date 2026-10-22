import { Service } from '@deepseek-ai/cordis';

/**
 * Client↔Host management RPC for Workspace Only (tasks B and D).
 *
 * The Web client cannot push state into the Host on its own, and the Host's
 * forwarded-event allowlist is compiled into `dsh-api-remotes`, so the two
 * directions are split:
 *
 *   Host → Client (asking):  `ctx.userQuestions.ask()`  — see `ask.js`.
 *   Client → Host (managing): this service, a Typert "source-mode" Remote
 *   service under the `workspaceOnly` namespace. The API Gateway discovers
 *   services whose instance carries a `typertRemote` binding and whose class
 *   prototype carries the Remote method descriptor (the exact structure
 *   `bindTypertRemote`/`Remote` produce), then dispatches
 *   `ctx.remote.<namespace>.<method>(...)` calls here. No generated Typert
 *   artifact is required: source-mode descriptors validate arguments as plain
 *   JSON, and method parameter names are read from the source signature.
 *
 * `@deepseek-ai/dsh-typert-protocol` is deliberately NOT imported — the
 * binding and descriptor shapes are reproduced literally so this plugin keeps
 * loading on compositions where that package is absent.
 */

/** Prototype key the Gateway's `remoteMethods()` reads. */
const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** The service key and wire namespace of this plugin's Remote surface. */
const REMOTE_SERVICE_KEY = "workspaceOnly";
const REMOTE_NAMESPACE = "workspaceOnly";

/** Remote method names exposed to `ctx.remote.workspaceOnly.*` / `workspaceOnly/*` RPC. */
const REMOTE_METHODS = ["snapshot", "setScope", "addAlways", "addGlobalAlways", "removeAlways", "addDeny", "removeDeny", "clearRecent", "announce", "decide", "pendingList"];

/**
 * Management surface handed in by the plugin: pure operations over Config and
 * session state. Every hook returns plain JSON.
 */
var WorkspaceOnlyRemoteService = class extends Service {
	hooks;
	constructor(ctx, hooks) {
		super(ctx, REMOTE_SERVICE_KEY);
		this.hooks = hooks;
		// Equivalent of `bindTypertRemote(this, key, { namespace })`: the frozen
		// binding the Gateway validates on every source-mode dispatch.
		this.typertRemote = Object.freeze({
			service: this,
			serviceKey: REMOTE_SERVICE_KEY,
			namespace: REMOTE_NAMESPACE
		});
	}
	/** Current switch, whitelist (plus the resolved BUILT-IN default whitelist), recent asks, and one session's access scope. */
	async snapshot(sessionId) {
		return this.hooks.snapshot(sessionId);
	}
	/** Set one session's access scope: `workspace` / `outside-read` / `outside-write`. */
	async setScope(sessionId, scope) {
		return this.hooks.setScope(sessionId, scope);
	}
	/** Persist a SESSION-SCOPED whitelist entry (stamped with the granting session's root). */
	async addAlways(dir, sessionId) {
		return this.hooks.addAlways(dir, sessionId);
	}
	/** Persist a GLOBAL whitelist entry (plain string; managed in Settings). */
	async addGlobalAlways(dir) {
		return this.hooks.addGlobalAlways(dir);
	}
	/** Remove one whitelist entry (string or `{ root, dir }`, task T9). */
	async removeAlways(entry) {
		return this.hooks.removeAlways(entry);
	}
	/** Task T5: persist one never-allow rule (directory prefix or glob). */
	async addDeny(entry) {
		return this.hooks.addDeny(entry);
	}
	/** Remove one deny rule. */
	async removeDeny(entry) {
		return this.hooks.removeDeny(entry);
	}
	/** Drop the recent-ask list shown in settings. */
	async clearRecent() {
		return this.hooks.clearRecent();
	}
	/** Task B: a composer panel reports it is on screen for `requestId`. */
	async announce(requestId) {
		return this.hooks.announce(requestId);
	}
	/** Task B: the composer panel submits `once` / `always` / `deny`. */
	async decide(requestId, choice) {
		return this.hooks.decide(requestId, choice);
	}
	/** Pending gate asks (diagnostics for the settings surface). */
	async pendingList() {
		return this.hooks.pendingList();
	}
};

// Remote method descriptor, byte-compatible with what `Remote` + `mark()`
// attach under the class prototype (version 1, direct invocation markers).
Object.defineProperty(WorkspaceOnlyRemoteService.prototype, REMOTE_METHODS_KEY, {
	configurable: true,
	value: Object.freeze({
		version: 1,
		methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({
			method,
			invocation: Object.freeze({ kind: "direct" })
		})))
	})
});

/**
 * Register the Remote service on the host context.
 *
 * @param ctx - host context.
 * @param hooks - management operations (see {@link WorkspaceOnlyRemoteService}).
 * @returns the service instance, or `undefined` when the Cordis Service base
 *   is unavailable in this composition (management UI then degrades to the
 *   settings form only).
 */
function createRemoteService(ctx, hooks) {
	if (Service === void 0) return void 0;
	try {
		const service = new WorkspaceOnlyRemoteService(ctx, hooks);
		return service;
	} catch {
		return void 0;
	}
}

export { REMOTE_METHODS, REMOTE_NAMESPACE, REMOTE_SERVICE_KEY, createRemoteService };
