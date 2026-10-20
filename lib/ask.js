/**
 * The three-choice gate's ask rendezvous (task B).
 *
 * Channel (verified against bundled 0.2.1-rc.2 sources): DSH's forwarded-event
 * allowlist is compiled into `@deepseek-ai/dsh-api-remotes`, so a plugin cannot
 * add its own host→client request event. The supported channel for
 * "permission plugins" to ask the human is `ctx.userQuestions.ask()` — the
 * `user-questions/request` waterfall, answered by the Web question panel (an
 * answerable card beside the composer) or any other answer UI. The question
 * carries exactly three options, so the interaction keeps the confirmed
 * three-key semantics:
 *
 *   仅此一次 / 总是允许本目录 / 拒绝
 *
 * Fallback chain (never weaker than the old behaviour):
 *   1. three-choice question on `ctx.userQuestions` (with a dialog timeout);
 *   2. on NO_PROVIDER (headless/TUI), delegated caller (subagent), or a
 *      missing question seam — the official `approval/request` waterfall
 *      (system dialog), same as this plugin always did;
 *   3. no answerer at all — deny (fail closed).
 *
 * Closing the question panel is not an answer (the seam reports
 * `ASK_CANCELLED`): the call is denied. Audit uses ignorable `plugin:`
 * records, never `approval/*` events on the three-choice path, so the system
 * dialog cannot double-prompt.
 */
import { requestApprovalViaWaterfall } from "./approval-compat.js";
import { recordAlwaysAdded, recordAsk, recordDecision } from "./session-state.js";

/** What the user chose. */
export const CHOICE = {
	once: "once",
	always: "always",
	deny: "deny"
};

/** Option labels; the answer is matched by label, so keep them stable. */
export const LABELS = {
	once: "仅此一次",
	always: "总是允许本目录",
	deny: "拒绝"
};

/** Outcome kinds reported back to the gate. */
export const CHANNEL = {
	question: "question",
	systemDialog: "system-dialog",
	none: "none"
};

const DEFAULT_TIMEOUT_MS = 120_000;

/** Map a question answer to a choice. Anything unrecognised denies (fail closed). */
export function choiceFromAnswer(answer) {
	const selected = answer?.answers?.find((item) => item?.id === "workspace-only")?.selected ?? answer?.answers?.[0]?.selected ?? [];
	const label = Array.isArray(selected) ? selected[0] : void 0;
	if (label === LABELS.always) return CHOICE.always;
	if (label === LABELS.once) return CHOICE.once;
	return CHOICE.deny;
}

/**
 * Build the ask flow bound to this plugin's runtime.
 *
 * @param options - `timeoutMs()` reads `Config.dialogTimeoutMs`; `allowAlways(dir)`
 *   persists a directory into `Config.always`; `hasAnswerer()` is consulted for
 *   diagnostics only.
 */
export function createAskFlow({ timeoutMs, allowAlways }) {
	const readTimeout = () => {
		const value = timeoutMs?.();
		return Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_TIMEOUT_MS;
	};

	/**
	 * Ask the human about one outside-workspace call.
	 *
	 * @returns `{ choice, channel, label? }` where choice is a {@link CHOICE}.
	 */
	return async function askOutside({ ctx, agent, session, exec, reason, dir, signal }) {
		const askedAt = Date.now();
		recordAsk(session, { toolName: exec.name, dir, reason });
		const questionService = ctx.get("userQuestions");
		let choice = CHOICE.deny;
		let channel = CHANNEL.none;
		let label = void 0;
		if (questionService !== void 0 && typeof questionService.ask === "function") {
			const asked = askQuestion(questionService, { agent, exec, reason, dir, signal }, readTimeout());
			const verdict = await asked;
			channel = CHANNEL.question;
			if (verdict.kind === "answer") {
				choice = verdict.choice;
				label = verdict.label;
				if (choice === CHOICE.always) {
					try {
						await allowAlways(dir);
						recordAlwaysAdded(session, { dir, toolName: exec.name });
					} catch {
						// A failed whitelist write still grants this one call.
						choice = CHOICE.once;
					}
				}
			} else if (verdict.kind === "fallback") {
				choice = await fallbackToSystemDialog(ctx, agent, session, exec, reason, signal);
				channel = choice === CHOICE.once ? CHANNEL.systemDialog : CHANNEL.none;
			}
			// verdict.kind === "timeout" | "cancelled" leaves CHOICE.deny.
		} else {
			choice = await fallbackToSystemDialog(ctx, agent, session, exec, reason, signal);
			channel = choice === CHOICE.once ? CHANNEL.systemDialog : CHANNEL.none;
		}
		recordDecision(session, { toolName: exec.name, dir, channel, choice, label, ms: Date.now() - askedAt });
		return { choice, channel, label };
	};
}

/** One question with the three stable options; races the dialog timeout. */
async function askQuestion(questionService, { agent, exec, reason, dir, signal }, timeoutMs) {
	const question = {
		id: "workspace-only",
		header: "Workspace Only",
		question: `[Workspace Only] ${exec.name} 请求访问工作区外的路径`,
		detail: `原因：${reason}\n目标目录：${dir}\n工具：${exec.name}`,
		options: [
			{ label: LABELS.once, description: "只放行这一次调用" },
			{ label: LABELS.always, description: "把该目录加入白名单，之后不再询问" },
			{ label: LABELS.deny, description: "拒绝这次调用" }
		],
		multiSelect: false
	};
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
	});
	const pending = Promise.resolve()
		.then(() => questionService.ask({ questions: [question], ...agent !== void 0 ? { agent } : {}, ...signal !== void 0 ? { signal } : {} }))
		.then((answer) => {
			const choice = choiceFromAnswer(answer);
			return { kind: "answer", choice, label: choice === CHOICE.always ? LABELS.always : choice === CHOICE.once ? LABELS.once : LABELS.deny };
		})
		.catch((error) => classifyAskFailure(error));
	try {
		return await Promise.race([pending, timeout]);
	} finally {
		clearTimeout(timer);
		pending.catch(() => {});
	}
}

/**
 * Classify a question-seam failure: "the answerer is not here" falls back to
 * the system dialog; an explicit non-answer denies.
 */
function classifyAskFailure(error) {
	const code = typeof error?.code === "string" ? error.code : void 0;
	if (code === "NO_PROVIDER" || code === "DELEGATED_CALLER" || code === "CALLER_NOT_LIVE") return { kind: "fallback" };
	// ASK_CANCELLED (panel closed), ASK_ABORTED, ASK_TIMED_OUT, and anything
	// else are non-answers: deny this call.
	return { kind: "timeout" };
}

/** The pre-existing behaviour: ask on the official `approval/request` waterfall. */
async function fallbackToSystemDialog(ctx, agent, session, exec, reason, signal) {
	if (agent === void 0) return CHOICE.deny;
	try {
		const outcome = await requestApprovalViaWaterfall(ctx, {
			agent,
			toolName: exec.name,
			...exec.callId !== void 0 ? { callId: exec.callId } : {},
			reason: `[workspace-only] ${reason} — approve to allow this one call to access outside the workspace`,
			...signal !== void 0 ? { signal } : {}
		}, session);
		return outcome === "allowed-once" ? CHOICE.once : CHOICE.deny;
	} catch {
		return CHOICE.deny;
	}
}
