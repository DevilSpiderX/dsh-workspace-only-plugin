import { isAbsolute, join, normalize, relative, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

/**
 * Workspace Only: a global switch that confines file access of EVERY sandbox
 * mode (read-only / workspace-write / danger-full-access / auto) to the
 * session workspace.
 *
 * Enforcement has two layers:
 * 1. `sandboxPolicy.resolve` is wrapped so any mode wider than
 *    `workspace-write` is capped to it while the switch is on (`read-only`
 *    stays read-only — the switch caps, never raises). The kernel backends
 *    (seatbelt/bwrap/landlock) and the filesystem fence then refuse writes
 *    outside the session cwd, and the built-in policy narration follows the
 *    capped mode automatically.
 * 2. A `ctx.tools.guard` denies, before execution, any file-tool call that
 *    (a) requests `sandbox_permissions` escalation (the escalation stamp
 *    bypasses `resolve`, so it must be blocked at the registry) or
 *    (b) references a path outside the session workspace. The guard is a
 *    best-effort lexical fence for reads and for bash command paths; writes
 *    are additionally kernel-fenced by layer 1.
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

/** Reason when a single path argument points outside the workspace, else undefined. */
function pathReason(value, root, what) {
	if (typeof value !== "string" || value === "") return undefined;
	if (value.startsWith("~")) return `${what} references the user home: ${value}`;
	if (!lexicallyWithin(value, root)) return `${what} is outside the workspace: ${value}`;
	return undefined;
}

/** Reason when a bash/pwsh command line references paths outside the workspace, else undefined. */
function shellReason(command, root) {
	if (typeof command !== "string" || command === "") return undefined;
	if (/\$\{?HOME\}?/i.test(command)) return "command references the user home ($HOME)";
	const tokens = command.split(/\s+/).filter(Boolean);
	for (const token of tokens) {
		// Strip surrounding quotes and redirection prefixes ("2>", "&>>", ">", "<").
		let t = token.replace(/^["']+|["']+$/g, "").replace(/^(?:\d+[<>]|&>>?|[<>]+)/, "");
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

	// Pre-execution fence: no escalation, no file access outside the workspace.
	ctx.tools.guard((exec) => {
		if (!isEnabled()) return undefined;
		const args = exec.arguments ?? {};
		if (args.sandbox_permissions !== void 0) {
			return "[workspace-only] sandbox escalation is disabled while Workspace Only is on";
		}
		const root = exec.agent?.session?.header.cwd;
		if (root === void 0) return undefined;
		const pathArg = Object.hasOwn(PATH_TOOLS, exec.name) ? PATH_TOOLS[exec.name] : void 0;
		if (pathArg !== void 0) {
			const reason = pathReason(args[pathArg], root, `${exec.name} target`);
			return reason === void 0 ? void 0 : `[workspace-only] ${reason}`;
		}
		if (SEARCH_TOOLS.has(exec.name)) {
			if (args.path !== void 0) {
				const reason = pathReason(args.path, root, `${exec.name} search path`);
				if (reason !== void 0) return `[workspace-only] ${reason}`;
			}
			if (typeof args.pattern === "string" && (args.pattern.startsWith("/") || args.pattern.startsWith("~") || args.pattern.startsWith("../"))) {
				return `[workspace-only] ${exec.name} pattern is absolute or escapes the workspace: ${args.pattern}`;
			}
			return undefined;
		}
		if (SHELL_TOOLS.has(exec.name)) {
			const reason = shellReason(args.command, root);
			return reason === void 0 ? void 0 : `[workspace-only] ${reason}`;
		}
		return undefined;
	});
}
