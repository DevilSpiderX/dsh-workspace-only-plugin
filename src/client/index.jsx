import { createSnapshotStore } from "./snapshot-store.js";
import { installStyles } from "./styles.js";
import { en, zh } from "./locales.js";
import { WorkspaceOnlySettingsController } from "./settings-store.js";
import { WorkspaceOnlySection } from "./WorkspaceOnlySection.jsx";
import { WorkspaceOnlyScopeSelect } from "./WorkspaceOnlyScopeSelect.jsx";
import { WorkspaceOnlyWhitelistView } from "./WorkspaceOnlyWhitelistView.jsx";
import { WorkspaceOnlyAskCard } from "./WorkspaceOnlyAskCard.jsx";
import { WorkspaceOnlyPendingBadge, WorkspaceOnlyToast } from "./pending-notice.jsx";

const inject = ["connection", "slots", "locale", "remote", "remote.settings", "uiSession", "sessions", "uiWorkspace"];
function apply(ctx) {
	installStyles(document);
	const controller = new WorkspaceOnlySettingsController(ctx.remote, ctx.connection);
	const load = () => controller.load();
	const select = (enabled) => controller.select(enabled);
	const injected = () => ({
		hooks: { workspaceOnly: controller.store },
		load,
		select,
		addGlobalAlways: (dir) => controller.addGlobalAlways(dir),
		removeAlways: (entry) => controller.removeAlways(entry),
		addDeny: (entry) => controller.addDeny(entry),
		removeDeny: (entry) => controller.removeDeny(entry),
		clearRecent: () => controller.clearRecent(),
		setScope: (sessionId, scope) => controller.setScope(sessionId, scope)
	});
	ctx.effect(() => ctx.locale.register("settings.workspaceOnly", {
		zh,
		en
	}), "workspace-only: settings dictionaries");
	const t = ctx.locale.bind("settings.workspaceOnly");
	// The Workspace Only settings live on their OWN settings page (one
	// `settings.section` nav entry) instead of a `settings.general.item`
	// row — the card grew too tall for the General column. Content is
	// unchanged; the nav label is a thunk, so locale switches re-read it.
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "workspace-only",
		order: 25,
		locale: "settings.workspaceOnly",
		label: () => t("title"),
		inject: injected
	}, WorkspaceOnlySection));
	// Task D (revised): the session-scope picker sits in the composer's
	// tool row, at the same level as the platform permission selector
	// (`conversation.input.permission` renders right before this slot).
	ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
		name: "conversation.input.left",
		id: "workspace-only-scope",
		order: 10,
		locale: "settings.workspaceOnly",
		inject: (sessionId) => ({
			hooks: { workspaceOnly: controller.store },
			sessionId,
			load,
			setScope: (scope) => controller.setScope(sessionId, scope)
		})
	}, WorkspaceOnlyScopeSelect));
	// Session-page view: the SESSION-SCOPED whitelist of this workspace
	// root (conversation.view tab, beside 对话 / 轨迹).
	ctx.slots.inject("conversation.view", () => ctx.slots.register({
		name: "conversation.view",
		id: "whitelist",
		order: 20,
		locale: "settings.workspaceOnly",
		label: () => t("view.whitelist"),
		inject: (sessionId) => ({
			hooks: { workspaceOnly: controller.store },
			sessionId,
			load,
			addEntry: (dir) => controller.allowAlways(dir, sessionId),
			removeEntry: (entry) => controller.removeAlways(entry)
		})
	}, WorkspaceOnlyWhitelistView));
	// Task B's three-button panel: seat one pending ask in the composer,
	// exactly like the platform's permission-escalation takeover.
	const registerPendingInteraction = ctx.uiSession.registerPendingInteraction(() => 0);
	// Task T12: live cards by requestId. A re-delivered ask payload must
	// never seat twice — the platform domain throws on duplicate keys and
	// the stray seat's card can never be closed ("the card won't close").
	const seats = new Map();
	// Task T13: the notice surface's two stores. `pendingStore` mirrors
	// the live seats for the header badge; `toastStore` is the FIFO
	// one-shot toast queue. Both are objects so `update`'s shallow-draft
	// mutators stay safe (a bare-array state would be spread into an
	// object and lose Array.prototype).
	const pendingStore = createSnapshotStore({ entries: [] });
	const toastStore = createSnapshotStore({ queue: [] });
	let toastSeq = 0;
	const dismissToast = (seq) => {
		toastStore.update((state) => {
			state.queue = state.queue.filter((item) => item.seq !== seq);
		});
	};
	const raisePanel = (ask) => {
		if (ask === null || ask === void 0 || typeof ask.requestId !== "string") return;
		if (seats.has(ask.requestId)) return;
		// Shape matches the platform's PendingApproval contract: the
		// composer's pending-interaction projection is per-session and
		// keys rendering off `kind`/`key`/`sessionId`/`result`.
		// `kind: "approval"` borrows the sidebar's visible-pending
		// whitelist (`visiblePendingKind` accepts only
		// approval/plan-review/question), so the session row lights its
		// warning dot while the ask is pending. Safe against the
		// official panels: the composer chain election matches them by
		// `instanceof PendingApproval`/`PendingQuestion`, never by
		// `kind`, so this borrowed value cannot hand our card to them
		// (verified on DSH 0.2.1-rc.2; if a future release elects by
		// `kind` string this collides and must be revisited). `source`
		// is the flip side: our selector must never claim an official
		// PendingApproval, whose `kind` is also "approval".
		const completion = Promise.withResolvers();
		let settled = false;
		let remove = () => {};
		// One idempotent unseat path. The click settle and the Host-side
		// dismiss MUST clear the notice store synchronously — leaving
		// the clear to `completion.promise.then` alone is what kept
		// stale badge entries alive after every card was approved
		// ("badge still says 3"). The microtask below only re-runs it
		// as belt-and-braces and withdraws the composer seat.
		const cleanup = () => {
			seats.delete(ask.requestId);
			pendingStore.update((state) => {
				state.entries = state.entries.filter((entry) => entry.requestId !== ask.requestId);
			});
		};
		const settle = (choice) => {
			if (settled) return Promise.resolve();
			settled = true;
			cleanup();
			completion.resolve(choice);
			return controller.call("decide", { requestId: ask.requestId, choice }).catch((error) => {
				console.warn("[workspace-only] decide RPC failed:", error);
				throw error;
			});
		};
		// Task T12: unseat WITHOUT a decision — the Host already settled
		// this ask (dialog timeout, batch release, or another client's
		// click), so no decide RPC is owed and the stale card must go.
		const dismiss = () => {
			if (settled) return;
			settled = true;
			cleanup();
			completion.resolve("deny");
		};
		const pending = {
			kind: "approval",
			source: "workspace-only",
			key: ask.requestId,
			// The card's presence handshake reports this id back to the
			// Host; without it announce() cannot match this ask and the
			// Host falls back to the generic question (double panels).
			requestId: ask.requestId,
			sessionId: ask.sessionId,
			toolName: String(ask.toolName ?? "tool"),
			reason: String(ask.reason ?? ""),
			dir: String(ask.dir ?? ""),
			result: completion.promise,
			get answerable() {
				return !settled;
			},
			answer: (choice) => settle(choice)
		};
		// The platform's answerApproval pattern: registerPendingInteraction
		// returns the seat's remove(), and the seat must be removed once
		// the result settles — otherwise the card never leaves the
		// composer even after a decision. cleanup() is idempotent, so
		// this microtask is just the fallback for paths that resolve
		// `completion` without settling (none today).
		completion.promise.then(() => {
			cleanup();
			try {
				remove();
			} catch {
				// Already withdrawn by the framework.
			}
		});
		remove = registerPendingInteraction(pending, async () => {
			// Withdrawn (panel replaced or disposed): deny the ask.
			try {
				await settle("deny");
			} catch {
				// The Host-side timeout settles the ask anyway.
			}
		});
		seats.set(ask.requestId, dismiss);
		// T13: mirror the seat for the header badge and queue one notice
		// toast. The `seats` dedupe above makes both once per requestId.
		const notice = {
			requestId: ask.requestId,
			sessionId: ask.sessionId,
			toolName: String(ask.toolName ?? "tool"),
			dir: String(ask.dir ?? "")
		};
		pendingStore.update((state) => {
			state.entries = [...state.entries, notice];
		});
		toastSeq += 1;
		toastStore.update((state) => {
			state.queue = [...state.queue, { seq: toastSeq, text: t("pending.toast", { dir: notice.dir }) }];
		});
		// Presence: this handler running at all proves a Web client is
		// here. Announce now instead of waiting for React to mount the
		// card, so the Host's presence window never loses a race with
		// the render cycle; the card's own announce stays as an
		// idempotent second chance.
		controller.call("announce", { requestId: ask.requestId }).catch((error) => {
			console.warn("[workspace-only] announce RPC failed:", error);
		});
	};
	// Task T12: the Host broadcasts `askDone` whenever an ask settles
	// without this client's own click (dialog timeout, batch release,
	// another tab's decision) — withdraw the card instead of leaving a
	// stale seat in the composer.
	const closePanel = (done) => {
		if (done === null || done === void 0 || typeof done.requestId !== "string") return;
		seats.get(done.requestId)?.dismiss();
	};
	ctx.slots.inject("conversation.composer", () => ctx.slots.register({
		name: "conversation.composer",
		priority: 1,
		select: ({ sessionId, pendingInteraction }) => pendingInteraction?.source === "workspace-only" ? pendingInteraction : null,
		locale: "settings.workspaceOnly",
		inject: () => ({
			// Presence handshake: the card announces itself once actually
			// mounted, so the Host never waits out a panel that never
			// rendered. Idempotent with the arrival announce in raisePanel.
			announce: (requestId) => {
				controller.call("announce", { requestId }).catch((error) => {
					console.warn("[workspace-only] announce RPC failed:", error);
				});
			}
		})
	}, WorkspaceOnlyAskCard));
	// T13: the session-header badge, right beside the subagent catalog
	// dropdown. `conversation.session.header.actions` is the
	// title-adjacent list hosting `SubagentCatalogAction` (id
	// 'subagent-catalog', order 10) — the "N 个子智能体" dropdown — so
	// order 11 puts the badge immediately behind it. The platform
	// passes the open Session as `sessionId` plus its `useSessions`
	// hook. Clicking the badge opens the first hidden ask with
	// `uiWorkspace.openSession`: a subagent must be addressed by its
	// `SubagentAddress` — a bare SessionId loads it as a plain session
	// and history loading dies with `subagent/not-found`.
	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
		name: "conversation.session.header.actions",
		id: "workspace-only-pending",
		// Right behind the subagent catalog dropdown (order 10).
		order: 11,
		locale: "settings.workspaceOnly",
		inject: (sessionId) => ({
			hooks: { pending: pendingStore },
			sessionId,
			openPending: (target) => {
				// Fail closed on a malformed payload: no navigation.
				if (typeof target === "string") {
					if (target.length > 0) ctx.uiWorkspace.openSession(target);
					return;
				}
				if (target === null || target === void 0 || typeof target.childSessionId !== "string") return;
				ctx.uiWorkspace.openSession(target);
			}
		})
	}, WorkspaceOnlyPendingBadge));
	// T13: the one-shot notice toast. `shell.overlay` is the official
	// additive float surface (slot-catalog: register your own global
	// banner here); the banner itself is the shared Toast primitive.
	ctx.slots.inject("shell.overlay", () => ctx.slots.register({
		name: "shell.overlay",
		id: "workspace-only-toast",
		inject: () => ({
			hooks: { toasts: toastStore },
			dismissToast
		})
	}, WorkspaceOnlyToast));
	ctx.effect(() => {
		const refresh = () => {
			controller.load();
		};
		const disposers = [ctx.remote.$on("settings/document-updated", (ns, extra) => {
			if (extra?.ask != null) {
				raisePanel(extra.ask);
				return;
			}
			if (extra?.askDone != null) {
				closePanel(extra.askDone);
				return;
			}
			if (ns !== "workspace-only") return;
			refresh();
		})];
		return () => {
			controller.dispose();
			for (const dispose of disposers) dispose();
		};
	}, "workspace-only: settings invalidations");
}
export { apply, inject };
