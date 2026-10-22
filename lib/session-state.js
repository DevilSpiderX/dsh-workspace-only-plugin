import { pluginRecordOf, appendPluginRecord } from '@deepseek-ai/dsh-session';

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
 * record type (the boolean bypass switch). `foldScopeEntry` still reads those —
 * `enabled: true` maps to `outside-write` (完全放开), `false` to `workspace`
 * (仅工作区内) — so a released session keeps flying and an engaged one stays
 * confined across the upgrade.
 *
 * Subagent inheritance: a delegated child session (header `parentSession`)
 * STARTS at its parent's scope instead of the strict default — the same
 * one-shot snapshot semantics the platform itself uses for delegated sandbox
 * and approval policy. The snapshot is stamped onto the child's own log as a
 * `{ scope, inherited: true }` record at first resolution, so later parent
 * changes never leak into the child and vice versa. Lineage walking is
 * cycle-safe and depth-capped; any unresolvable link degrades to the strict
 * default. Losing a record re-derives the initial value (parent snapshot for
 * subagent children, strict default otherwise).
 */

/** Plugin-record types owned by this plugin (grammar: `plugin:` + lowercase slash segments). */
const RECORD = {
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
const SCOPE = {
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
function normalizeScope(value) {
	return SCOPES.has(value) ? value : SCOPE.workspace;
}

/** Per-process authority for the session scope, keyed by session id. */
const liveScope = new Map();

/** Best-effort audit append; a failure never breaks the gate itself. */
function recordEvent(session, type, data) {
	if (session === void 0) return undefined;
	try {
		return appendPluginRecord(session, type, data);
	} catch {
		return undefined;
	}
}

/**
 * Read one session's recorded scope fold (last record wins). Returns
 * `undefined` when the session's own log carries NO scope record — the caller
 * decides between the strict default (plain sessions) and parent inheritance
 * (subagent children). Accepts both the current `{ scope }` shape (including
 * the `{ scope, inherited: true }` snapshot stamp) and the legacy `{ enabled }`
 * bypass shape.
 */
function foldScopeEntry(session) {
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
		// A session that cannot be read is treated as recordless (fail safe).
	}
	return void 0;
}

/** Cap on parent-lineage walking; beyond it the chain degrades to the strict default. */
const INHERIT_MAX_DEPTH = 32;

/**
 * Effective scope of one session, resolved through: live value → the
 * session's own record → inherited parent snapshot (subagent children only).
 * The inheritance branch stamps the snapshot onto the child's own log so the
 * value is pinned at first resolution; `visited` (seeded with the starting
 * session id) plus `depth` make malformed lineage (loops) degrade to the
 * strict default instead of recursing forever.
 */
function scopeOf(session, resolveParent, visited, depth) {
	const live = liveScope.get(session.id);
	if (live !== void 0) return live;
	const folded = foldScopeEntry(session);
	if (folded !== void 0) {
		liveScope.set(session.id, folded);
		return folded;
	}
	const parentId = session.header?.parentSession;
	const chainable = typeof resolveParent === "function"
		&& typeof parentId === "string" && parentId !== ""
		&& !visited.has(parentId) && depth < INHERIT_MAX_DEPTH;
	if (!chainable) {
		liveScope.set(session.id, SCOPE.workspace);
		return SCOPE.workspace;
	}
	visited.add(parentId);
	let parent;
	try {
		parent = resolveParent(parentId);
	} catch {
		parent = void 0;
	}
	if (parent === void 0 || parent === null) {
		liveScope.set(session.id, SCOPE.workspace);
		return SCOPE.workspace;
	}
	const inherited = scopeOf(parent, resolveParent, visited, depth + 1);
	liveScope.set(session.id, inherited);
	// Pin the inherited snapshot onto the child's own log. A failed append is
	// re-asserted by `ensureScopePersisted` inside the next open turn.
	recordEvent(session, RECORD.bypass, { scope: inherited, inherited: true });
	return inherited;
}

/**
 * Effective session scope: live value first, replayed record after restart,
 * then (subagent children with a `resolveParent` resolver) the parent's
 * one-shot snapshot. Accepts a Session object or a bare session id (live
 * value only).
 */
function sessionScope(sessionOrId, resolveParent) {
	if (sessionOrId === void 0 || sessionOrId === null) return SCOPE.workspace;
	if (typeof sessionOrId === "string") {
		const live = liveScope.get(sessionOrId);
		return live === void 0 ? SCOPE.workspace : live;
	}
	return scopeOf(sessionOrId, resolveParent, new Set([sessionOrId.id]), 0);
}

/**
 * Set the session's access scope and persist it as a plugin record.
 * Accepts a Session object or a bare session id; an id-only change is held in
 * memory and re-asserted by {@link ensureScopePersisted} inside the next turn.
 */
function setSessionScope(sessionOrId, scope) {
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
function ensureScopePersisted(session) {
	if (session === void 0) return;
	const live = liveScope.get(session.id);
	if (live === void 0) return;
	// Recordless counts as the strict default here (same write timing as
	// before): only a live value DIFFERENT from the persisted fold is
	// re-asserted — including an inherited snapshot whose first stamp failed.
	const folded = foldScopeEntry(session) ?? SCOPE.workspace;
	if (folded === live) return;
	recordEvent(session, RECORD.bypass, { scope: live });
}

/** Audit pair for one gate ask, and the always-added trail (task B). */
function recordAsk(session, payload) {
	recordEvent(session, RECORD.asked, payload);
}

function recordDecision(session, payload) {
	recordEvent(session, RECORD.decided, payload);
}

function recordAlwaysAdded(session, payload) {
	recordEvent(session, RECORD.alwaysAdded, payload);
}

export { RECORD, SCOPE, ensureScopePersisted, normalizeScope, recordAlwaysAdded, recordAsk, recordDecision, recordEvent, sessionScope, setSessionScope };
