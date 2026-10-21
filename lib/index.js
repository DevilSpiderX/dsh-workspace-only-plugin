import z from "@deepseek-ai/schemastery";
import { createAskFlow, CHANNEL, CHOICE } from "./ask.js";
import { createRemoteService } from "./remote-service.js";
import { directoryOf, expandHomeSpelling, isPlatformTempTarget, lexicallyWithin, scanTargets, sensitiveMatch } from "./scanner.js";
import { ensureBypassPersisted, isBypassed, setBypass } from "./session-state.js";

/**
 * Workspace Only: a global switch that confines file access of EVERY sandbox
 * mode (read-only / workspace-write / danger-full-access / auto) to the
 * session workspace, identically in every mode — with per-session bypass
 * (task D) and a persistent always-whitelist (task B).
 *
 * The whole confinement is one gate: a `tools/pre-execute` handler turns every
 * file-touching call that references a path outside the session workspace into
 * a user decision. The primary decision channel is the three-choice question
 * ("allow once / always allow this directory / deny") asked through
 * `ctx.userQuestions` — the channel DSH routes to permission plugins — with
 * the official `approval/request` waterfall as the fallback, dispatched
 * WITHOUT `ApprovalService`'s `never`-policy shortcut so a Full access session
 * is still asked. A call carrying a sandbox escalation request skips the gate
 * ONLY when the official escalation flow is guaranteed to raise its own
 * user-consent prompt — i.e. the requested mode is strictly wider than the
 * session's standing mode (task T1). A repeated or malformed request passes
 * `approveEscalation` without any prompt (`if (mode === effectiveMode) return`),
 * so those calls still walk this gate instead of running silently.
 *
 * Configuration lives in the plugin's DSH 0.2 Config (persisted in the active
 * profile's `cordis.patch.yml`), replacing the retired 0.1 settings channel
 * and its apiproxy allowlist patch. Runtime-written fields (`enabled`,
 * `always`) are `.volatile()` so the settings form and this plugin share one
 * live reference, written back through the settings service.
 *
 * Writes outside the workspace additionally stay subject to the kernel fence
 * of a `workspace-write`-mode session (the tool's `sandbox_permissions`
 * escalation is then the sanctioned completion path, itself another
 * user-consent prompt). The scanner is a best-effort lexical fence (leading
 * paths, quoted and interpreter-embedded absolute paths in POSIX, drive-letter
 * and UNC spellings, `~`/`$HOME`, `..\` escapes); reads and writes it cannot
 * statically see are the documented Level-A residual, shared with the
 * auto-mode plugin's stance.
 *
 * The display rename of the `workspace-write` preset to "Write Only" is opt-in
 * (`renamePresetLabel`, default off) so the auto-mode plugin keeps matching
 * the stock label unless the operator asks for the rename.
 */

export const name = "workspace-only";
export const inject = ["permissionPresets", "tools", "settings", "systemPrompt"];

/** Task T4 defaults: basenames asked even inside the workspace, and their exemptions. */
const DEFAULT_SENSITIVE_PATTERNS = ["*.env", "*.env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*"];
const DEFAULT_SENSITIVE_ALLOWS = ["*.env.example", "*.env.sample", "*.env.template", "*.env.defaults"];

export const Config = z.object({
	/** Master switch for the gate (runtime-written). */
	enabled: z.boolean().default(false).volatile(),
	/** Directories whose outside-workspace access is always allowed (runtime-written). */
	always: z.array(z.string()).default([]).volatile(),
	/** Sensitive basenames asked even INSIDE the workspace (task T4). */
	sensitivePatterns: z.array(z.string()).default([...DEFAULT_SENSITIVE_PATTERNS]),
	/** Exemptions judged before `sensitivePatterns` (e.g. `*.env.example`). */
	sensitiveAllowPatterns: z.array(z.string()).default([...DEFAULT_SENSITIVE_ALLOWS]),
	/** Patterns a "always allow files like this" answer persists (runtime-written). */
	sensitiveAlways: z.array(z.string()).default([]).volatile(),
	/** Rename the `workspace-write` preset to "Write Only" (collides with label matchers such as dsh-auto-mode). */
	renamePresetLabel: z.boolean().default(false),
	/** Three-choice question deadline in milliseconds; timeout denies. */
	dialogTimeoutMs: z.number().step(1).min(1_000).default(120_000)
});

/** Read a `.volatile()` reference (or an already-plain value). */
function readVolatile(value) {
	return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

// The escalation semantics of `@deepseek-ai/dsh-sandbox`, inlined (the plugin
// composes no dependency on that package; scripts/check-compat.mjs probe 11
// re-verifies these shapes against the real installation):
// - `ESCALATION_TARGETS` — the closed schema enum of escalate-TO modes;
// - `WIDER_MODES` — the strictly-wider ladder checked at execution;
// - `approveEscalation`: `if (mode === effectiveMode) return effectiveMode;`
//   a REPEATED request returns the standing mode with zero prompts, and only a
//   strictly wider one raises the approval dialog.
const ESCALATION_TARGETS = new Set(["workspace-write", "danger-full-access"]);
const WIDER_MODES = {
	"read-only": ["workspace-write", "danger-full-access"],
	"workspace-write": ["danger-full-access"]
};
const STANDING_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

/**
 * The session's standing sandbox mode via `ctx.sandboxPolicy.resolve({ session })`
 * (the same call the enforcement executors make). `undefined` whenever the
 * policy service is absent or throws — decision D1: never skip on uncertainty.
 */
function standingModeOf(ctx, session) {
	try {
		const policy = ctx.get("sandboxPolicy");
		if (policy === void 0 || typeof policy.resolve !== "function") return void 0;
		const mode = policy.resolve(session === void 0 ? {} : { session })?.mode;
		return STANDING_MODES.has(mode) ? mode : void 0;
	} catch {
		return void 0;
	}
}

/**
 * True only when the official escalation flow is GUARANTEED to raise its own
 * user-consent prompt for this call, i.e. when skipping this gate cannot lose
 * a human decision: a valid escalation pairing (`sandbox_permissions` in the
 * closed target enum + a non-empty `justification`) whose target is STRICTLY
 * wider than the session's standing mode. Repeated (equal) and narrower
 * requests never prompt upstream — `approveEscalation` returns the standing
 * mode without approval or throws — so they must walk this gate (task T1).
 */
function isGuaranteedEscalationPrompt(ctx, session, args) {
	const requested = args.sandbox_permissions;
	if (typeof requested !== "string" || !ESCALATION_TARGETS.has(requested)) return false;
	const justification = args.justification;
	if (typeof justification !== "string" || justification.trim() === "") return false;
	const standing = standingModeOf(ctx, session);
	if (standing === void 0) return false;
	return (WIDER_MODES[standing] ?? []).includes(requested);
}

/** Recent ask directories kept for the settings surface (display metadata only). */
const RECENT_LIMIT = 20;

export function apply(ctx, config = {}) {
	const isEnabled = () => readVolatile(config.enabled) === true;
	const alwaysList = () => {
		const value = readVolatile(config.always);
		return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
	};
	const stringList = (value, fallback) => {
		const list = readVolatile(value);
		return Array.isArray(list) ? list.filter((entry) => typeof entry === "string") : fallback;
	};
	/** Task T4's sensitive-file matcher input (patterns are plain, always is volatile). */
	const sensitiveConfigOf = () => ({
		patterns: stringList(config.sensitivePatterns, DEFAULT_SENSITIVE_PATTERNS),
		allowPatterns: stringList(config.sensitiveAllowPatterns, DEFAULT_SENSITIVE_ALLOWS),
		alwaysPatterns: stringList(config.sensitiveAlways, [])
	});
	const timeoutMs = () => readVolatile(config.dialogTimeoutMs);
	const recentAsks = [];
	const settingsOf = () => {
		try {
			return ctx.get("settings");
		} catch {
			return void 0;
		}
	};

	/** Persist a Config patch through the settings service (profile cordis.patch.yml). */
	async function writeConfig(patch) {
		const settings = settingsOf();
		if (settings === void 0 || typeof settings.update !== "function") throw new Error("settings service is unavailable");
		await settings.update("workspace-only", patch);
	}

	async function allowAlways(dir) {
		const normalized = String(dir);
		const next = [...new Set([...alwaysList(), normalized])];
		await writeConfig({ always: next });
	}

	/** Task T4: persist one sensitive pattern ("always allow files like this"). */
	async function allowPattern(pattern) {
		const normalized = String(pattern);
		const current = stringList(config.sensitiveAlways, []);
		const next = [...new Set([...current, normalized])];
		await writeConfig({ sensitiveAlways: next });
	}

	async function removeAlways(dir) {
		const normalized = String(dir);
		const next = alwaysList().filter((entry) => entry !== normalized);
		await writeConfig({ always: next });
	}

	function noteRecent(dir, toolName) {
		const entry = { dir: String(dir), toolName, at: Date.now() };
		const index = recentAsks.findIndex((item) => item.dir === entry.dir);
		if (index >= 0) recentAsks.splice(index, 1);
		recentAsks.unshift(entry);
		if (recentAsks.length > RECENT_LIMIT) recentAsks.length = RECENT_LIMIT;
	}

	/** Whitelist hit: the target sits inside one always-allowed directory (both sides home-expanded, task T3). */
	function alwaysAllows(target) {
		const resolved = expandHomeSpelling(target) ?? target;
		return alwaysList().some((dir) => lexicallyWithin(resolved, expandHomeSpelling(dir) ?? dir));
	}

	// Opt-in display rename of the `workspace-write` preset.
	if (config.renamePresetLabel === true) {
		const presets = ctx.permissionPresets.presets;
		if (Object.hasOwn(presets, "workspace-write") && presets["workspace-write"] !== void 0) {
			presets["workspace-write"].name = "Write Only";
		}
	}

	// Narration: the model must know the gate is active in every mode, and
	// must know when this session is deliberately flying without it.
	ctx.systemPrompt.context({
		name: "workspace-only",
		order: 116,
		text: (context) => {
			const session = context.agent?.session;
			if (session === void 0) return "";
			if (isBypassed(session)) return "Workspace Only is bypassed for this session: file access outside the session workspace runs without the Workspace Only prompt (the user released this session).";
			return isEnabled() ? "Workspace Only is on: in every mode, file access outside the session workspace asks the user for approval — the approval prompt appears even when the approval policy is never." : "";
		}
	});

	const askFlow = createAskFlow({
		timeoutMs,
		allowAlways,
		allowPattern,
		// Task T2: a fresh whitelist entry batch-releases matching pendings.
		isAlwaysAllowed: (path) => alwaysAllows(path)
	});

	// The gate: outside-workspace file access asks the user in ANY mode.
	// Order of checks: calls whose official escalation prompt is guaranteed to
	// appear skip (task T1 — anything weaker walks this gate), per-session
	// bypass wins over everything else, then the master switch, then the
	// always-whitelist, then the three-choice question with its system-dialog
	// fallback.
	ctx.on("tools/pre-execute", async (exec, next) => {
		const args = exec.arguments ?? {};
		const session = exec.agent?.session;
		const root = session?.header?.cwd;
		if (root === void 0) return next();
		// Task T1: skip ONLY for a guaranteed official escalation prompt. A
		// repeated request (`sandbox_permissions` equal to the standing mode)
		// is a no-prompt pass-through upstream, so it must not skip here.
		if (isGuaranteedEscalationPrompt(ctx, session, args)) return next();
		// Task D: a UI-toggled switch is re-asserted inside the open turn.
		ensureBypassPersisted(session);
		if (isBypassed(session)) return next();
		if (!isEnabled()) return next();
		// Two orthogonal dimensions merge into ONE question (task T4):
		// outside-workspace references — the whitelist dimension — and
		// sensitive basenames, asked even INSIDE the workspace. Platform-temp
		// scratch is exempt from both (DSH's own spill/work directories).
		const entries = scanTargets(exec, root);
		const outside = [];
		const sensitive = [];
		const sensitiveSeen = new Set();
		const sensitiveConfig = sensitiveConfigOf();
		for (const entry of entries) {
			if (isPlatformTempTarget(entry.path)) continue;
			if (entry.outside && !alwaysAllows(entry.path)) outside.push(entry);
			const match = sensitiveMatch(entry.path, sensitiveConfig);
			if (match !== void 0 && !sensitiveSeen.has(entry.path)) {
				sensitiveSeen.add(entry.path);
				sensitive.push({ ...entry, ...match });
			}
		}
		if (outside.length === 0 && sensitive.length === 0) return next();
		const reason = [...outside.slice(0, 1), ...sensitive.slice(0, 1)].map((entry) => entry.reason).join("；");
		if (exec.agent === void 0) return { kind: "deny", reason: `[workspace-only] ${reason}` };
		const focus = outside[0] ?? sensitive[0];
		noteRecent(directoryOf(focus.path), exec.name);
		const verdict = await askFlow.askOutside({
			ctx,
			agent: exec.agent,
			session,
			exec,
			reason,
			dir: directoryOf(focus.path),
			// The batch-release (T2) targets stay the outside-workspace set:
			// a directory whitelist must never release a sensitive ask (D5).
			targets: outside.map((entry) => entry.path),
			grantKinds: [...outside.length > 0 ? ["dir"] : [], ...sensitive.length > 0 ? ["pattern"] : []],
			patterns: [...new Set(sensitive.map((entry) => entry.pattern))],
			sensitive: sensitive.length > 0,
			signal: exec.signal
		});
		// Both "allow once" and "always allow this directory" let THIS call run
		// (the latter has already persisted the whitelist entry).
		if (verdict.choice === CHOICE.once || verdict.choice === CHOICE.always) return { kind: "allow" };
		if (verdict.channel === CHANNEL.systemDialog) return { kind: "deny", reason: `[workspace-only] the user rejected ${exec.name}: ${reason}` };
		return { kind: "deny", reason: `[workspace-only] ${reason} — the user denied this call` };
	});

	// Client-facing management surface (tasks B and D): whitelist entries,
	// recent asks, and the per-session bypass switch.
	createRemoteService(ctx, {
		snapshot(sessionId) {
			const sessions = liveSessions(ctx).map((session) => ({
				id: session.id,
				cwd: session.header?.cwd ?? "",
				bypass: isBypassed(session)
			}));
			return {
				enabled: isEnabled(),
				always: alwaysList(),
				recent: recentAsks.slice(),
				renamePresetLabel: config.renamePresetLabel === true,
				dialogTimeoutMs: timeoutMs(),
				bypass: isBypassed(sessionId),
				sessions
			};
		},
		setBypass(sessionId, enabled) {
			const session = resolveSession(ctx, sessionId);
			setBypass(session ?? sessionId, enabled);
			return { bypass: enabled === true };
		},
		addAlways: (dir) => allowAlways(dir).then(() => ({ always: alwaysList() })),
		removeAlways: (dir) => removeAlways(dir).then(() => ({ always: alwaysList() })),
		clearRecent() {
			recentAsks.length = 0;
			return { recent: [] };
		},
		// Task B's composer panel: presence handshake and decision.
		announce: (requestId) => askFlow.announce(requestId),
		decide: (requestId, choice) => askFlow.decide(requestId, choice),
		pendingList: () => askFlow.pendingList()
	});
}

/** All live sessions of this host, defensively (the sessions service may be absent). */
function liveSessions(ctx) {
	try {
		const sessions = ctx.get("sessions");
		const list = typeof sessions?.list === "function" ? sessions.list() : [];
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

/** Resolve a live Session by id through the sessions service, when composed. */
function resolveSession(ctx, sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") return void 0;
	try {
		const sessions = ctx.get("sessions");
		const session = typeof sessions?.get === "function" ? sessions.get(sessionId) : void 0;
		return session;
	} catch {
		return void 0;
	}
}
