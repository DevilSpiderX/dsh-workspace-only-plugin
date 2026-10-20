/**
 * Session-scoped plugin state: the per-session "bypass" switch (task D) and the
 * audit trail of the three-choice gate (task B).
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
 * and re-asserted inside the next open turn (`ensureBypassPersisted`), where
 * the durable log commits reliably. Losing a record degrades to the safe
 * side: the gate re-engages.
 */
import { appendPluginRecord, pluginRecordOf } from "@deepseek-ai/dsh-session";

/** Plugin-record types owned by this plugin (grammar: `plugin:` + lowercase slash segments). */
export const RECORD = {
	asked: "plugin:workspace-only/asked",
	decided: "plugin:workspace-only/decided",
	alwaysAdded: "plugin:workspace-only/always-added",
	bypass: "plugin:workspace-only/bypass"
};

/** Per-process authority for the bypass switch, keyed by session id. */
const liveBypass = new Map();

/** Best-effort audit append; a failure never breaks the gate itself. */
export function recordEvent(session, type, data) {
	if (session === void 0) return undefined;
	try {
		return appendPluginRecord(session, type, data);
	} catch {
		return undefined;
	}
}

/** Read one session's recorded bypass fold (last record wins), else false. */
function foldBypass(session) {
	try {
		const events = session.snapshotEvents();
		for (let index = events.length - 1; index >= 0; index -= 1) {
			const record = pluginRecordOf(events[index]);
			if (record !== void 0 && record.type === RECORD.bypass) return record.data?.enabled === true;
		}
	} catch {
		// A session that cannot be read is treated as not bypassed (fail safe).
	}
	return false;
}

/**
 * Effective bypass state: live switch first, replayed record after restart.
 * Accepts a Session object (replays its log when no live value exists) or a
 * bare session id (live value only).
 */
export function isBypassed(sessionOrId) {
	if (sessionOrId === void 0 || sessionOrId === null) return false;
	const session = typeof sessionOrId === "string" ? void 0 : sessionOrId;
	const id = session === void 0 ? String(sessionOrId) : session.id;
	const live = liveBypass.get(id);
	if (live !== void 0) return live;
	if (session === void 0) return false;
	const folded = foldBypass(session);
	liveBypass.set(id, folded);
	return folded;
}

/**
 * Flip the session's bypass switch and persist it as a plugin record.
 * Accepts a Session object or a bare session id; an id-only flip is held in
 * memory and re-asserted by {@link ensureBypassPersisted} inside the next turn.
 */
export function setBypass(sessionOrId, enabled) {
	if (sessionOrId === void 0 || sessionOrId === null) return false;
	const session = typeof sessionOrId === "string" ? void 0 : sessionOrId;
	const id = session === void 0 ? String(sessionOrId) : session.id;
	liveBypass.set(id, enabled === true);
	if (session !== void 0) recordEvent(session, RECORD.bypass, { enabled: enabled === true });
	return enabled === true;
}

/**
 * Re-assert a live switch whose record has not reached the durable log yet.
 * Called from the gate (inside an open turn) so a UI-toggled switch survives
 * restart even when the toggle itself happened between turns.
 */
export function ensureBypassPersisted(session) {
	if (session === void 0) return;
	const live = liveBypass.get(session.id);
	if (live === void 0) return;
	if (foldBypass(session) === live) return;
	recordEvent(session, RECORD.bypass, { enabled: live });
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
