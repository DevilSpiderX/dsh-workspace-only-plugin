import { Toast } from "@deepseek-ai/dsh-client-ui-primitives";

/**
* T13: the pending-ask notice surface. The session-header badge counts
* the seated asks the CURRENT view cannot show — a subagent's three-button
* card lives in that subagent's own composer — and clicking opens the
* first one, where the card itself is waiting. The toast queue carries one
* entry per ask (the `seats` requestId dedupe already guarantees once).
* Both read the plugin's own ask lifecycle ONLY: official approval and
* question interactions are deliberately out of scope.
*/
export function WorkspaceOnlyPendingBadge({ sessionId, useSessions, usePending, openPending, t }) {
	const entries = usePending((snapshot) => snapshot.entries);
	const byId = useSessions((state) => state.byId);
	// The badge belongs to the PARENT session of a parked ask: the card
	// lives in that subagent's own composer and the parent view cannot
	// see it. Unrelated sessions must stay clean — this is a navigation
	// hint for THIS conversation's children, not a global alarm.
	// The list row's subagent link is `SessionSummary.parentId` (paired
	// with `origin: 'subagent'`); `byId` rows carry NO `subagent.address`
	// — that shape lives on the per-Session `useSession` snapshot. Read
	// the wrong field and the filter never matches: cards show, no badge.
	const visible = entries.filter((entry) => byId[entry.sessionId]?.parentId === sessionId);
	if (visible.length === 0) return null;
	const tip = [t("pending.tip", { n: visible.length }), ...visible.map((entry) => {
		const label = byId[entry.sessionId]?.title ?? entry.toolName;
		return `${label} → ${entry.dir}`;
	})].join("\n");
	return (
		<button
			type="button"
			data-workspace-only-pending
			title={tip}
			onClick={() => {
				const entry = visible[0];
				if (entry === null || entry === void 0 || typeof entry.sessionId !== "string") return;
				// Navigate by the SubagentAddress when the target session is
				// a subagent: a bare SessionId opens it as a plain session
				// and history loading dies with `subagent/not-found`. The
				// list row only carries the parent link, so build the
				// address from `parentId` with an unknown mode; `openPending`
				// refines the mode through `sessions.subagentAddress`.
				const summary = byId[entry.sessionId];
				const target = summary?.parentId == null
					? entry.sessionId
					: { parentSessionId: summary.parentId, childSessionId: entry.sessionId, mode: "unknown" };
				openPending(target);
			}}
		>
			<span data-workspace-only-pendingDot />
			{t("pending.badge", { n: visible.length })}
		</button>
	);
}
/** One banner at a time (FIFO); the queue entry retires through onDone. */
export function WorkspaceOnlyToast({ useToasts, dismissToast }) {
	const queue = useToasts((snapshot) => snapshot.queue);
	const head = queue[0];
	if (head === void 0) return null;
	return (
		// Keyed by the show sequence: a reused instance would keep the
		// first banner's elapsed timer and never retire the next entry.
		<Toast
			key={head.seq}
			text={head.text}
			onDone={() => {
				dismissToast(head.seq);
			}}
		/>
	);
}
