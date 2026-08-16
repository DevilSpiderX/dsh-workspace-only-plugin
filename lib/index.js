import { isAbsolute, join, normalize, relative, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

/**
 * Workspace Only: a global switch that confines file access of EVERY sandbox
 * mode (read-only / workspace-write / danger-full-access / auto) to the
 * session workspace.
 *
 * Enforcement:
 * 1. `sandboxPolicy.resolve` is wrapped so any mode wider than
 *    `workspace-write` is capped to it while the switch is on (`read-only`
 *    stays read-only — the switch caps, never raises). The kernel backends
 *    (seatbelt/bwrap/landlock) and the filesystem fence then refuse writes
 *    outside the session cwd in EVERY mode, and the built-in policy narration
 *    follows the capped mode automatically.
 * 2. A `tools/pre-execute` handler turns every file-touching call that
 *    references a path outside the session workspace into an approval ask —
 *    the user decides, nothing is hard-denied. Rejecting (or an absent
 *    approval channel) denies the call; approving lets it proceed under the
 *    capped mode (reads run; writes outside the workspace are additionally
 *    kernel-fenced under `workspace-write`, where the tool's own
 *    `sandbox_permissions` escalation is the sanctioned completion path, so
 *    the user is asked again before any outside write actually lands).
 *    Escalation itself stays available: it is another user-consent path.
 *
 * The permanent display rename of the `workspace-write` preset to
 * "Write Only" happens once at composition, independent of the switch.
 */

export const name = "workspace-only";
export const inject = ["sandboxPolicy", "permissionPresets", "tools", "settings"];

export const Config = z.object({
	workspaceRoot: z.string()
});

const SETTINGS_NS = settingsNamespace("workspace-only");
const SETTINGS_SCHEMA = z.object({ enabled: z.boolean().default(false) });
const SETTINGS_DEFAULT = { enabled: false };

/** File tools whose single path argument names a target (value = arg name). */
const PATH_TOOLS = { read: "file_path", write: "file_path", edit: "file_path", read_image: "file_path" };
/** Search tools whose optional `path` arg (and absolute `pattern`) must stay inside. */
const SEARCH_TOOLS = new Set(["glob", "grep"]);
/** Shell tools whose command text is scanned for escaping paths. */
const SHELL_TOOLS = new Set(["bash", "pwsh"]);

/** Lexical containment: `target` resolved against `root` must not escape it. */
function lexicallyWithin(target, root) {
	const abs = isAbsolute(target) ? target : join(root, target);
	const rel = relative(normalize(root), normalize(abs));
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Split a shell line into whitespace tokens, keeping quoted (space-containing) segments intact. */
function shellTokens(input) {
	const tokens = [];
	let index = 0;
	while (index < input.length) {
		while (index < input.length && /\s/.test(input[index])) index += 1;
		if (index >= input.length) break;
		const start = index;
		const quote = input[index] === '"' || input[index] === "'" ? input[index] : null;
		if (quote !== null) {
			index += 1;
			while (index < input.length && input[index] !== quote) index += 1;
			index += 1;
		} else {
			while (index < input.length && !/\s/.test(input[index])) index += 1;
		}
		tokens.push(input.slice(start, index));
	}
	return tokens;
}

/** Reason when a single path argument points outside the workspace, else undefined. */
function pathReason(value, root, what) {
	if (typeof value !== "string" || value === "") return undefined;
	if (value.startsWith("~")) return `${what} references the user home: ${value}`;
	if (!lexicallyWithin(value, root)) return `${what} is outside the workspace: ${value}`;
	return undefined;
}

/**
 * Match absolute-path substrings embedded inside a token (interpreter string
 * literals such as `node -e "...'/etc/passwd'..."`), where the path is not the
 * token's own leading segment. Requires the path to start right after a quote,
 * backtick, space, parenthesis, or token start, so relative segments like
 * `src/x` inside a plain word are never misread as absolute.
 */
const INTERIOR_PATH = /(?:^|['"`\s(])((?:~\/|\/)[^'"`;|&<>()]*)/g;

/** Reason when a bash/pwsh command line references paths outside the workspace, else undefined. */
function shellReason(command, root) {
	if (typeof command !== "string" || command === "") return undefined;
	if (/\$\{?HOME\}?/i.test(command)) return "command references the user home ($HOME)";
	for (const token of shellTokens(command)) {
		// Strip surrounding quotes, backslash escapes, and redirection prefixes ("2>", "&>>", ">", "<").
		let t = token.replace(/^["']+|["']+$/g, "").replace(/\\(.)/g, "$1").replace(/^(?:\d+[<>]|&>>?|[<>]+)/, "");
		if (t === "") continue;
		if (t === "/dev/null" || t.startsWith("/dev/null")) continue;
		if (t.startsWith("~")) return `command references the user home: ${token}`;
		if (t.startsWith("/")) {
			if (!lexicallyWithin(t, root)) return `command references a path outside the workspace: ${token}`;
			continue;
		}
		if (t === ".." || t.startsWith("../") || t.includes("/../")) {
			if (!lexicallyWithin(t, root)) return `command escapes the workspace: ${token}`;
		}
		for (const match of t.matchAll(INTERIOR_PATH)) {
			const path = match[1];
			if (path.startsWith("~")) return `command references the user home: ${path}`;
			if (path === "/dev/null" || path.startsWith("/dev/null")) continue;
			if (!lexicallyWithin(path, root)) return `command references a path outside the workspace: ${path}`;
		}
	}
	return undefined;
}

/** Reason when a tool call touches anything outside the workspace, else undefined. */
function outsideReason(exec, root) {
	const args = exec.arguments ?? {};
	const pathArg = Object.hasOwn(PATH_TOOLS, exec.name) ? PATH_TOOLS[exec.name] : void 0;
	if (pathArg !== void 0) return pathReason(args[pathArg], root, `${exec.name} target`);
	if (SEARCH_TOOLS.has(exec.name)) {
		if (args.path !== void 0) {
			const reason = pathReason(args.path, root, `${exec.name} search path`);
			if (reason !== void 0) return reason;
		}
		if (typeof args.pattern === "string" && (args.pattern.startsWith("/") || args.pattern.startsWith("~") || args.pattern.startsWith("../"))) {
			return `${exec.name} pattern is absolute or escapes the workspace: ${args.pattern}`;
		}
		return undefined;
	}
	if (SHELL_TOOLS.has(exec.name)) {
		if (args.workdir !== void 0) {
			const reason = pathReason(args.workdir, root, `${exec.name} working directory`);
			if (reason !== void 0) return reason;
		}
		return shellReason(args.command, root);
	}
	return undefined;
}

export function apply(ctx, config = {}) {
	let readSettings = () => SETTINGS_DEFAULT;
	installSettingsSection(ctx, SETTINGS_NS, SETTINGS_SCHEMA, SETTINGS_DEFAULT, {
		setSource: (source) => {
			readSettings = source;
		},
		onChange: () => {}
	});
	const isEnabled = () => readSettings().enabled === true;

	// Permanent display rename (independent of the switch).
	const presets = ctx.permissionPresets.presets;
	if (Object.hasOwn(presets, "workspace-write") && presets["workspace-write"] !== void 0) {
		presets["workspace-write"].name = "Write Only";
	}

	// Cap every resolved mode to workspace-write while enabled (never raise read-only).
	const service = ctx.sandboxPolicy;
	const originalResolve = service.resolve.bind(service);
	service.resolve = (request = {}) => {
		const policy = originalResolve(request);
		if (!isEnabled()) return policy;
		const mode = policy.mode === "read-only" ? "read-only" : "workspace-write";
		return mode === policy.mode ? policy : { ...policy, mode };
	};

	// Pre-execution gate: outside-workspace access asks the user instead of
	// hard-denying. Calls that already carry an escalation request skip the
	// ask — their own escalation approval is the user-consent path.
	ctx.on("tools/pre-execute", async (exec, next) => {
		if (!isEnabled()) return next();
		const args = exec.arguments ?? {};
		if (args.sandbox_permissions !== void 0) return next();
		const root = exec.agent?.session?.header.cwd;
		if (root === void 0) return next();
		const reason = outsideReason(exec, root);
		if (reason === void 0) return next();
		return {
			kind: "ask",
			reason: `[workspace-only] ${reason} — approve to allow this one call to access outside the workspace`
		};
	});
}
