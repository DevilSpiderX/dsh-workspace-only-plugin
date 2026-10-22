import { randomUUID } from 'node:crypto';
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval';
import { scopeTarget } from '@deepseek-ai/dsh-scope';

/**
 * Approval-compat (task E3): the single home of the plugin's remaining coupling
 * to `@deepseek-ai/dsh-user-approval`'s audit conventions.
 *
 * The three-choice gate answers on its own channel first (see `ask.js`); this
 * module is the FALLBACK that reuses the official `approval/request` waterfall
 * — the same channel the GUI web answerer renders — for headless/TUI runs or
 * when the question seam is unavailable. It writes the exact audit pair the
 * official `ApprovalService.request()` writes (`approval/asked` +
 * `approval/decided`, id branded with the exported `ApprovalRequestId`), minus
 * the `never`-policy shortcut: a Full access session still gets the prompt,
 * which is this plugin's whole point.
 */

/** The closed outcome vocabulary, mirrored from `dsh-user-approval`. */
const APPROVAL_OUTCOMES = ["allowed-once", "rejected", "cancelled", "unavailable"];

/** Normalize an answerer's return value to the closed outcome vocabulary. */
function normalizeOutcome(value) {
	return APPROVAL_OUTCOMES.includes(value) ? value : "unavailable";
}

/**
 * Dispatch one approval request on the `approval/request` waterfall with the
 * official audit pair. Returns the closed outcome.
 *
 * @param ctx - host context.
 * @param request - `{ agent, toolName, callId?, reason, signal? }`.
 * @param session - the session the audit pair belongs to.
 */
async function requestApprovalViaWaterfall(ctx, request, session) {
	const { agent, toolName, callId, reason, signal } = request;
	const id = ApprovalRequestId(randomUUID());
	session.append("approval/asked", {
		id,
		toolName,
		...callId !== void 0 ? { callId } : {},
		...reason !== void 0 ? { reason } : {}
	});
	const outcome = normalizeOutcome(await ctx.waterfall(
		scopeTarget(ctx, agent),
		"approval/request",
		{
			agent,
			toolName,
			...callId !== void 0 ? { callId } : {},
			reason,
			...signal !== void 0 ? { signal } : {}
		},
		() => Promise.resolve("unavailable")
	));
	session.append("approval/decided", { id, outcome });
	return outcome;
}

export { APPROVAL_OUTCOMES, normalizeOutcome, requestApprovalViaWaterfall };
