/**
 * Session-scoped plugin state: the per-session access SCOPE (task D, revised to
 * a three-level gate: 仅工作区内 / 工作区外只读 / 完全放开) and the audit trail
 * of the three-choice gate (task B).
 *
 * DSH persistence constraints (verified against the bundled 0.2.1-rc.2
 * sources): the durable log's read path refuses any event whose `type` is
 * outside `KNOWN_SESSION_EVENT_TYPES` unless the envelope carries
 * `ignorable: true`, and `Session.append()` cannot set that marker. Plugin
 * state therefore travels as ignorable `plugin:` records through
 * `appendPluginRecord()` — the documented plugin-record channel — never as a
 * bare custom event type. Records stay out of the model-visible surface,
 * which is exactly right for audit and switch state.
 *
 * Reliability: a `plugin:` record written between turns can be treated as a
 * crash tail on reload, so the live value is also held in a per-process map
 * and re-asserted inside the next open turn (`ensureScopePersisted`), where
 * the durable log commits reliably. Losing a record degrades to the safe
 * side: the gate re-engages at the STRICTEST scope.
 *
 * Record compatibility: earlier releases wrote `{ enabled }` on the same
 * record type (the boolean bypass switch). `foldScope` still reads those —
 * `enabled: true` maps to `outside-write` (完全放开), `false` to `workspace`
 * (仅工作区内) — so a released session keeps flying and an engaged one stays
 * confined across the upgrade.
 */
import { appendPluginRecord, pluginRecordOf } from "@deepseek-ai/dsh-session";

/** Plugin-record types owned by this plugin (grammar: `plugin:` + lowercase slash segments). */
export const RECORD = {
	asked: "plugin:workspace-only/asked",
	decided: "plugin:workspace-only/decided",
	alwaysAdded: "plugin:workspace-only/always-added",
	bypass: "plugin:workspace-only/bypass"
};

/**
 * Per-session access scope. The gate reads it on every outside-workspace
 * reference:
 * - `workspace` (仅工作区内, default): every outside-workspace read or write asks;
 * - `outside-read` (工作区外只读): outside READS pass, outside WRITES still ask;
 * - `outside-write` (完全放开): outside reads and writes pass without asking.
 * Sensitive-file asks (task T4) and deny rules (task T5) are orthogonal: both
 * fire at EVERY scope.
 */
export const SCOPE = {
	/** 仅工作区内 — the strict default. */
	workspace: "workspace",
	/** 工作区外只读 — outside reads pass, outside writes ask. */
	outsideRead: "outside-read",
	/** 完全放开 — outside access passes without asking. */
	outsideWrite: "outside-write"
};

/** Every recognized scope value (unknown input falls back to the strictest). */
const SCOPES = new Set(Object.values(SCOPE));

/** Normalize any user/record input to a scope; anything unknown is strictest. */
export function normalizeScope(value) {
	return SCOPES.has(value) ? value : SCOPE.workspace;
}

/** Per-process authority for the session scope, keyed by session id. */
const liveScope = new Map();

/** Best-effort audit append; a failure never breaks the gate itself. */
export function recordEvent(session, type, data) {
	if (session === void 0) return undefined;
	try {
		return appendPluginRecord(session, type, data);
	} catch {
		return undefined;
	}
}

/**
 * Read one session's recorded scope fold (last record wins), else the strict
 * default. Accepts both the current `{ scope }` shape and the legacy
 * `{ enabled }` bypass shape.
 */
function foldScope(session) {
	try {
		const events = session.snapshotEvents();
		for (let index = events.length - 1; index >= 0; index -= 1) {
			const record = pluginRecordOf(events[index]);
			if (record === void 0 || record.type !== RECORD.bypass) continue;
			const data = record.data;
			if (typeof data?.scope === "string") return normalizeScope(data.scope);
			// Legacy boolean bypass: released = 完全放开, engaged = 仅工作区内.
			return data?.enabled === true ? SCOPE.outsideWrite : SCOPE.workspace;
		}
	} catch {
		// A session that cannot be read is treated as strictest (fail safe).
	}
	return SCOPE.workspace;
}

/**
 * Effective session scope: live value first, replayed record after restart.
 * Accepts a Session object (replays its log when no live value exists) or a
 * bare session id (live value only).
 */
export function sessionScope(sessionOrId) {
	if (sessionOrId === void 0 || sessionOrId === null) return SCOPE.workspace;
	const session = typeof sessionOrId === "string" ? void 0 : sessionOrId;
	const id = session === void 0 ? String(sessionOrId) : session.id;
	const live = liveScope.get(id);
	if (live !== void 0) return live;
	if (session === void 0) return SCOPE.workspace;
	const folded = foldScope(session);
	liveScope.set(id, folded);
	return folded;
}

/**
 * Set the session's access scope and persist it as a plugin record.
 * Accepts a Session object or a bare session id; an id-only change is held in
 * memory and re-asserted by {@link ensureScopePersisted} inside the next turn.
 */
export function setSessionScope(sessionOrId, scope) {
	if (sessionOrId === void 0 || sessionOrId === null) return SCOPE.workspace;
	const session = typeof sessionOrId === "string" ? void 0 : sessionOrId;
	const id = session === void 0 ? String(sessionOrId) : session.id;
	const next = normalizeScope(scope);
	liveScope.set(id, next);
	if (session !== void 0) recordEvent(session, RECORD.bypass, { scope: next });
	return next;
}

/**
 * Re-assert a live scope whose record has not reached the durable log yet.
 * Called from the gate (inside an open turn) so a UI-toggled scope survives
 * restart even when the change happened between turns.
 */
export function ensureScopePersisted(session) {
	if (session === void 0) return;
	const live = liveScope.get(session.id);
	if (live === void 0) return;
	const folded = foldScope(session);
	if (folded === live) return;
	recordEvent(session, RECORD.bypass, { scope: live });
}

/** Audit pair for one gate ask, and the always-added trail (task B). */
export function recordAsk(session, payload) {
	recordEvent(session, RECORD.asked, payload);
}

export function recordDecision(session, payload) {
	recordEvent(session, RECORD.decided, payload);
}

export function recordAlwaysAdded(session, payload) {
	recordEvent(session, RECORD.alwaysAdded, payload);
}
