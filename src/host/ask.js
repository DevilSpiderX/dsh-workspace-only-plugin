/**
 * The three-choice gate's ask rendezvous (task B).
 *
 * Presentation: a three-button card that takes over the Conversation composer
 * — the same surface as the platform's permission-escalation panel
 * (`@deepseek-ai/dsh-client-ui-approval`), styled after it: a warning strip,
 * the offending tool/path/reason, and an action row of 仅此一次 / 总是允许该
 * 目录 / 拒绝 (Enter = allow once, Esc = deny).
 *
 * Transport: DSH's forwarded-event allowlist is compiled into
 * `@deepseek-ai/dsh-api-remotes`, so a plugin has no custom host→client
 * request event. The panel is raised through a channel that IS on the
 * allowlist — the `settings/document-updated` notification carrying an `ask`
 * payload — and answered over the plugin's own `workspaceOnly/decide` RPC
 * (see `remote-service.js`). A presence handshake (`announce`) tells the
 * Host that a panel actually appeared before it waits out the full timeout.
 *
 * Fallback chain (never weaker than the old behaviour):
 *   1. three-button composer card (Web client, presence-confirmed);
 *   2. `ctx.userQuestions` generic question (other answer UIs, e.g. TUI);
 *   3. the official `approval/request` waterfall (system dialog);
 *   4. deny (fail closed).
 *
 * A card that shows up after the presence window keeps its seat: a late
 * `decide()` on that requestId still wins and withdraws the fallback question,
 * so a slow client can never leave two answer surfaces fighting over one ask.
 *
 * Timeout and cancellation deny. Audit uses ignorable `plugin:` records,
 * never `approval/*` on the panel path, so the system dialog cannot
 * double-prompt.
 */
import { randomUUID } from "node:crypto";
import { requestApprovalViaWaterfall } from "./approval-compat.js";
import { recordAlwaysAdded, recordAsk, recordDecision } from "./session-state.js";

/** What the user chose. */
export const CHOICE = {
	once: "once",
	always: "always",
	deny: "deny"
};

/** Human labels for the panel's three buttons (stable copy). */
export const LABELS = {
	once: "仅此一次",
	always: "总是允许该目录",
	deny: "拒绝"
};

/** Where the decision came from. */
export const CHANNEL = {
	panel: "panel",
	question: "question",
	systemDialog: "system-dialog",
	none: "none",
	/** Task T2: released by another ask's "always allow this directory". */
	alwaysBatch: "always-batch",
	/** Task T6: fast fail-closed — no answer channel, denied without the fallbacks. */
	fastDeny: "fast-deny"
};

const DEFAULT_TIMEOUT_MS = 120_000;
/** How long the Host waits for a panel to announce itself before falling back (env-overridable for tests). */
const PRESENCE_WAIT_MS = (() => {
	const raw = Number(process.env.WORKSPACE_ONLY_PRESENCE_WAIT_MS);
	return Number.isFinite(raw) && raw >= 0 ? raw : 3_000;
})();

/** Normalize a decision token from the client or a question answer. */
export function normalizeChoice(value) {
	return value === CHOICE.once || value === CHOICE.always || value === CHOICE.deny ? value : CHOICE.deny;
}

/** Map a `user-questions` answer batch to a choice; anything unrecognised denies. */
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
 *   persists a directory into `Config.always`; `allowPattern(pattern)` persists
 *   a sensitive pattern into `Config.sensitiveAlways` (task T4); `isAlwaysAllowed(path)`
 *   says a path is now covered by the whitelist (task T2's batch release);
 *   `isPatternAllowed(pattern)` says a sensitive pattern is already persisted
 *   (task T12's queue follow-up); `fastDenyMs()` reads `Config.fastDenyMs`
 *   (task T6: >0 enables fast fail-closed for calls with no answer channel);
 *   `notify(payload)` pushes a `settings/document-updated` payload to every
 *   connected client (task T12: card withdrawal).
 * @returns `{ askOutside, announce, decide, pendingList }` — the last three are
 *   wired into the `workspaceOnly` Remote service.
 */
export function createAskFlow({ timeoutMs, allowAlways, allowPattern, isAlwaysAllowed, isPatternAllowed, fastDenyMs, notify }) {
	const pending = new Map();
	// Task T12: the composer's pending-interaction projection keeps ONE
	// interaction per session (`ui-session`'s publishPendingInteractions picks
	// a single winner per sessionId), so two concurrent asks of one session
	// fight over one seat — answering the visible card merely revealed the
	// hidden one behind it ("the card won't close"). Subagents hit this
	// constantly (parallel tool calls share one session id), so asks of one
	// session run strictly one after another. A queued call that a whitelist
	// entry granted meanwhile now covers settles at once (T2's batch release,
	// carried by the dequeue re-check below).
	const queues = new Map();
	/** Remove one seat and tell every connected client to withdraw its card. */
	function drop(requestId) {
		if (!pending.delete(requestId)) return;
		if (typeof notify !== "function") return;
		try {
			notify({ askDone: { requestId } });
		} catch {
			// A lost notice only leaves a stale card whose next click dismisses
			// it; never fail the ask over it.
		}
	}
	const readTimeout = () => {
		const value = timeoutMs?.();
		return Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_TIMEOUT_MS;
	};
	// Task T6: a non-zero budget turns "nobody is there to answer" into an
	// immediate deny instead of riding the full chain to the system dialog.
	const readFastDenyMs = () => {
		const value = fastDenyMs?.();
		return Number.isSafeInteger(value) && value >= 1 ? value : 0;
	};

	/**
	 * Task T2 (MiMo parity): one "always allow this directory" also settles
	 * every pending ask of the SAME session whose targets the fresh whitelist
	 * entry now covers — those calls run at once instead of queueing their own
	 * cards. Unmatched pendings (other directories, other sessions) keep
	 * waiting for their own decision.
	 *
	 * @returns how many pendings were released.
	 */
	function releaseMatching(sessionId) {
		if (typeof sessionId !== "string" || sessionId === "" || typeof isAlwaysAllowed !== "function") return 0;
		let released = 0;
		for (const [requestId, entry] of [...pending.entries()]) {
			if (entry.sessionId !== sessionId) continue;
			const targets = Array.isArray(entry.targets) ? entry.targets : [];
			// Task T9: the root rides the pending so workspace-scoped entries
			// match only under their own session root.
			if (!targets.some((target) => isAlwaysAllowed(target, entry.root) === true)) continue;
			drop(requestId);
			entry.releaseVia = CHANNEL.alwaysBatch;
			entry.resolve(CHOICE.always);
			released += 1;
		}
		return released;
	}

	/** A client panel reports it is on screen. */
	function announce(requestId) {
		const entry = typeof requestId === "string" ? pending.get(requestId) : void 0;
		if (entry === void 0) return { ok: false };
		entry.announced = true;
		entry.wakePresence?.();
		return { ok: true };
	}

	/** The panel (or any management caller) submits a decision. */
	function decide(requestId, choice) {
		const entry = typeof requestId === "string" ? pending.get(requestId) : void 0;
		if (entry === void 0) return { ok: false };
		drop(requestId);
		entry.resolve(normalizeChoice(choice));
		return { ok: true };
	}

	/** Diagnostic view for the settings surface. */
	function pendingList() {
		return [...pending.entries()].map(([requestId, entry]) => ({
			requestId,
			toolName: entry.toolName,
			dir: entry.dir,
			sessionId: entry.sessionId,
			targets: Array.isArray(entry.targets) ? entry.targets.slice() : [],
			announced: entry.announced === true
		}));
	}

	/**
	 * Ask the human about one outside-workspace call. Asks of ONE session run
	 * strictly one at a time (task T12: one composer seat per session), so
	 * every ask gets its own card and answering it really closes it.
	 *
	 * @returns `{ choice, channel, label? }`.
	 */
	async function askOutside(params) {
		const sessionId = params.session?.id;
		const queueKey = typeof sessionId === "string" && sessionId !== "" ? sessionId : "\u0000anonymous";
		const tail = queues.get(queueKey) ?? Promise.resolve();
		// The queue advances whether the previous ask resolved or threw.
		const run = tail.then(() => runAsk(params), () => runAsk(params));
		const keep = run.then(() => void 0, () => void 0);
		queues.set(queueKey, keep);
		keep.then(() => {
			if (queues.get(queueKey) === keep) queues.delete(queueKey);
		});
		return run;
	}

	/** One ask, behind every earlier ask of the same session. */
	async function runAsk({ ctx, agent, session, exec, reason, dir, targets, grantKinds, patterns, sensitive, signal }) {
		const kinds = Array.isArray(grantKinds) && grantKinds.length > 0 ? grantKinds : ["dir"];
		const sensitivePatterns = Array.isArray(patterns) ? [...new Set(patterns)] : [];
		const targetList = Array.isArray(targets) ? targets : [];
		const root = session?.header?.cwd;
		// Fail closed: a call cancelled while it waited its turn never asks.
		if (signal?.aborted === true) {
			recordDecision(session, { toolName: exec.name, dir, channel: CHANNEL.none, choice: CHOICE.deny, label: LABELS.deny, ms: 0 });
			return { choice: CHOICE.deny, channel: CHANNEL.none, label: LABELS.deny };
		}
		// Task T2's queue follow-up: a whitelist entry granted while this call
		// waited its turn already covers it — settle as a batch release without
		// raising a card. The dimensions never mix (D5): a directory entry never
		// releases a sensitive ask, and only persisted patterns (never a
		// directory) release a sensitive one.
		const dirCovered = !kinds.includes("dir") || targetList.some((target) => isAlwaysAllowed?.(target, root) === true);
		const patternCovered = !kinds.includes("pattern") || (sensitivePatterns.length > 0 && typeof isPatternAllowed === "function" && sensitivePatterns.every((pattern) => isPatternAllowed(pattern) === true));
		if (dirCovered && patternCovered) {
			recordDecision(session, { toolName: exec.name, dir, channel: CHANNEL.alwaysBatch, choice: CHOICE.always, label: LABELS.always, ms: 0 });
			return { choice: CHOICE.always, channel: CHANNEL.alwaysBatch, label: LABELS.always };
		}
		const askedAt = Date.now();
		recordAsk(session, { toolName: exec.name, dir, reason });
		let choice = CHOICE.deny;
		let channel = CHANNEL.none;
		let label = void 0;
		// `via` marks a batch release: the whitelist write already happened on
		// the ask that triggered it, so only record the decision here.
		const grant = async (picked, via) => {
			if (picked !== CHOICE.always) return picked;
			if (via === CHANNEL.alwaysBatch) return CHOICE.always;
			try {
				if (kinds.includes("dir")) {
					// The granting session's root scopes the entry: an ask-card
					// grant is always SESSION-scoped (managed in the session
					// page's whitelist view), never global.
					await allowAlways(dir, session?.header?.cwd);
					// Task T2: a fresh whitelist entry releases the same session's
					// other pendings that it now covers.
					releaseMatching(session?.id);
					recordAlwaysAdded(session, { dir, toolName: exec.name, kind: "dir" });
				}
				// Task T4: a sensitive hit persists its pattern ("always allow
				// files like this") — pattern scope, never mixed into `Config.always`.
				if (kinds.includes("pattern") && typeof allowPattern === "function") {
					for (const pattern of sensitivePatterns) {
						await allowPattern(pattern);
						recordAlwaysAdded(session, { dir: pattern, toolName: exec.name, kind: "pattern" });
					}
				}
				return CHOICE.always;
			} catch (error) {
				// A failed whitelist write still grants this one call, but the
				// failure must stay visible — a silent drop here made "always
				// allow this directory" look like a dead button.
				console.warn(`[workspace-only] whitelist write failed for ${dir}; granting this one call only`, error);
				return CHOICE.once;
			}
		};

		// 1) The three-button composer card, presence-confirmed.
		const requestId = randomUUID();
		const panel = await askPanel(ctx, { requestId, exec, reason, dir, targets, sensitive, signal, session }, pending, drop, readTimeout());
		if (panel.kind === "answered") {
			channel = panel.via === CHANNEL.alwaysBatch ? CHANNEL.alwaysBatch : CHANNEL.panel;
			choice = await grant(panel.choice, panel.via);
			label = labelOf(choice);
		} else if (panel.kind === "no-panel") {
			// 2) Generic question (other answer UIs), then 3) the system dialog.
			// The panel seat stays live through the fallback: a late decision
			// from the card withdraws the question and is treated as panel input.
			// Task T6: with a fast-deny budget the question gets only that much
			// time and an absent answerer denies at once — no system dialog.
			const fast = readFastDenyMs();
			console.warn(`[workspace-only] panel presence timed out for ${exec.name}; asking through the generic question (requestId ${requestId})`);
			const aborter = new AbortController();
			const late = panel.lateDecide.then((outcome) => {
				aborter.abort();
				return outcome;
			});
			const asked = await Promise.race([
				askQuestion(ctx, { agent, exec, reason, dir, sensitive, signal: anySignal([signal, aborter.signal]) }, fast > 0 ? Math.min(readTimeout(), fast) : readTimeout()),
				late
			]);
			// Task T16: settle the generic question on EVERY exit path. Its
			// card lives until the request settles — racing past a local
			// timeout without aborting left the three-button question card
			// in the composer forever ("the card never goes away"). The abort
			// reaches the platform as ASK_ABORTED (a non-answer) wherever the
			// answer did not already arrive; a settled request ignores it.
			aborter.abort();
			panel.cancel();
			if (asked.kind === "answered") {
				channel = asked.via === CHANNEL.alwaysBatch ? CHANNEL.alwaysBatch : CHANNEL.panel;
				choice = await grant(asked.choice, asked.via);
				label = labelOf(choice);
			} else if (asked.kind === "answer") {
				channel = CHANNEL.question;
				choice = await grant(asked.choice, asked.via);
				label = labelOf(choice);
			} else if (asked.kind === "fallback") {
				if (fast > 0) {
					// Task T6: no answer channel within the fast budget.
					choice = CHOICE.deny;
					channel = CHANNEL.fastDeny;
				} else {
					choice = await fallbackToSystemDialog(ctx, agent, session, exec, reason, signal);
					channel = choice === CHOICE.once ? CHANNEL.systemDialog : CHANNEL.none;
				}
			} else if (fast > 0) {
				// Task T6: the question ran out of the fast budget — deny fast.
				channel = CHANNEL.fastDeny;
			}
		}
		recordDecision(session, { toolName: exec.name, dir, channel, choice, label, ms: Date.now() - askedAt });
		return { choice, channel, label };
	}

	return { askOutside, announce, decide, pendingList, releaseMatching };
}

/** Button label for one choice. */
function labelOf(choice) {
	return choice === CHOICE.always ? LABELS.always : choice === CHOICE.once ? LABELS.once : LABELS.deny;
}

/** Combine abort signals so a late panel decision can withdraw the fallback question. */
function anySignal(signals) {
	const list = signals.filter((item) => item !== void 0);
	if (list.length === 0) return void 0;
	if (list.length === 1) return list[0];
	const controller = new AbortController();
	for (const item of list) {
		if (item.aborted) {
			controller.abort(item.reason);
			break;
		}
		item.addEventListener("abort", () => controller.abort(item.reason), { once: true });
	}
	return controller.signal;
}

/**
 * Raise the composer card and wait: first for its presence announcement (a
 * panel that never appears means no Web client), then for its decision until
 * the dialog timeout. Timeout and cancellation deny.
 */
async function askPanel(ctx, { requestId, exec, reason, dir, targets, sensitive, signal, session }, pending, drop, timeoutMs) {
	const entry = {
		toolName: exec.name,
		dir,
		reason,
		targets: Array.isArray(targets) ? targets.slice() : [],
		sessionId: session?.id,
		root: session?.header?.cwd,
		releaseVia: void 0,
		announced: false,
		resolve: () => {},
		wakePresence: () => {}
	};
	let settled = false;
	let wakeLate = () => {};
	const lateDecide = new Promise((resolve) => {
		wakeLate = resolve;
	});
	const answered = new Promise((resolve) => {
		entry.resolve = (choice) => {
			if (settled) return;
			settled = true;
			resolve({ kind: "answered", choice, via: entry.releaseVia });
		};
	});
	const presence = new Promise((resolve) => {
		entry.wakePresence = () => resolve(void 0);
	});
	pending.set(requestId, entry);
	try {
		ctx.emit("settings/document-updated", "workspace-only", {
			ask: {
				requestId,
				toolName: exec.name,
				reason,
				dir,
				// Session identity: the composer's pending-interaction projection
				// is per-session and drops entries without one.
				sessionId: session?.id,
				// Task T4: the card swaps its always-button copy for the
				// pattern-scoped wording on a sensitive hit.
				...sensitive === true ? { sensitive: true } : {}
			}
		});
	} catch {
		drop(requestId);
		return { kind: "no-panel", lateDecide, cancel: () => {} };
	}
	const presenceTimeout = new Promise((resolve) => setTimeout(() => resolve("presence-timeout"), Math.min(PRESENCE_WAIT_MS, timeoutMs)));
	const presenceOutcome = await Promise.race([presence.then(() => "announced"), presenceTimeout]);
	// The announced flag closes the race where announce() landed in the same
	// tick the presence timer fired.
	if (presenceOutcome !== "announced" && entry.announced !== true) {
		if (!settled) {
			// Keep the seat: the card may mount a moment later, and its decide()
			// must still count. The caller races this against the fallback ask.
			entry.resolve = (choice) => {
				if (settled) return;
				settled = true;
				drop(requestId);
				wakeLate({ kind: "answered", choice, via: entry.releaseVia });
			};
			return {
				kind: "no-panel",
				lateDecide,
				cancel: () => {
					if (settled) return;
					settled = true;
					drop(requestId);
				}
			};
		}
	}
	let timer;
	const deadline = new Promise((resolve) => {
		timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
	});
	const abort = new Promise((resolve) => {
		if (signal === void 0) return;
		if (signal.aborted) return resolve({ kind: "aborted" });
		signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
	});
	try {
		return await Promise.race([answered, deadline, abort]);
	} finally {
		clearTimeout(timer);
		if (!settled) {
			settled = true;
			drop(requestId);
		}
	}
}

/** One question with the three stable options on the generic question seam. */
async function askQuestion(ctx, { agent, exec, reason, dir, sensitive, signal }, timeoutMs) {
	const questionService = (() => {
		try {
			return ctx.get("userQuestions");
		} catch {
			return void 0;
		}
	})();
	if (questionService === void 0 || typeof questionService.ask !== "function") return { kind: "fallback" };
	const question = {
		id: "workspace-only",
		header: "Workspace Only",
		question: `[Workspace Only] ${exec.name} 请求访问工作区外的路径`,
		detail: `原因：${reason}\n目标目录：${dir}\n工具：${exec.name}`,
		options: [
			{ label: LABELS.once, description: "只放行这一次调用" },
			{ label: LABELS.always, description: sensitive === true ? "总是允许此类文件（按 pattern 持久化）" : "把该目录加入白名单，之后不再询问" },
			{ label: LABELS.deny, description: "拒绝这次调用" }
		],
		multiSelect: false
	};
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
	});
	const pendingAnswer = Promise.resolve()
		.then(() => questionService.ask({ questions: [question], ...agent !== void 0 ? { agent } : {}, ...signal !== void 0 ? { signal } : {} }))
		.then((answer) => ({ kind: "answer", choice: choiceFromAnswer(answer) }))
		.catch((error) => classifyAskFailure(error));
	try {
		return await Promise.race([pendingAnswer, timeout]);
	} finally {
		clearTimeout(timer);
		pendingAnswer.catch(() => {});
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
