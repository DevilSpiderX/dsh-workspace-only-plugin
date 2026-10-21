import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Workspace Only lexical path scanner — the pure, dependency-free core of the
 * gate. Everything here is static analysis over tool arguments: which calls
 * reference paths outside the session workspace root.
 *
 * Windows support is first-class (task A): drive-letter and UNC absolute
 * paths, backslash separators, and `..\` escapes are recognised exactly like
 * their POSIX spellings, and containment picks `path.win32` semantics
 * (case-insensitive) whenever either side looks like a Windows path, so the
 * verdict is correct on any host platform.
 */

/** `C:\` / `C:/` drive-absolute, any letter case. */
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
/** `\\server\share` UNC absolute. */
const UNC_ABSOLUTE = /^\\\\/;
/** `~`, `~\user`, `~/x` home expansion (any spelling). */
const HOME_PREFIX = /^~/;
/** Any `..\` / `../` segment, wherever it sits in a token. */
const DOTDOT_SEGMENT = /\.\.[\\/]/;
/** Windows-looking spelling: drive letter, UNC, or any backslash. */
const WINDOWS_SHAPE = (value) => DRIVE_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || value.includes("\\");

/**
 * Every home spelling the scanner expands before judging (task T3): POSIX
 * `~` and `$HOME`/`${HOME}`, cmd `%USERPROFILE%`/`%HOMEPATH%`, and PowerShell
 * `$env:USERPROFILE`/`$env:HOMEPATH`. A spelling must END there or continue
 * with a separator, so `~user` or `$HOMEDIR` are not misread.
 */
const HOME_SPELLINGS = [
	{ re: /^~(?=$|[\\/])/i, envKey: void 0 },
	{ re: /^\$\{?HOME\}?(?=$|[\\/])/i, envKey: void 0 },
	{ re: /^%USERPROFILE%(?=$|[\\/])/i, envKey: "USERPROFILE" },
	{ re: /^%HOMEPATH%(?=$|[\\/])/i, envKey: void 0 },
	{ re: /^\$env:USERPROFILE(?=$|[\\/])/i, envKey: "USERPROFILE" },
	{ re: /^\$env:HOMEPATH(?=$|[\\/])/i, envKey: void 0 }
];

/**
 * Expand one home spelling to the real user-home path, or `undefined` when
 * the value is not home-shaped or the home cannot be resolved (task T3).
 * All spellings unify on the same root: `env.HOME`, else `env.USERPROFILE`,
 * else `os.homedir()` for the real environment. `%HOMEPATH%` is a drive-
 * relative fragment, so it maps onto the same full home. An explicit `env`
 * without HOME/USERPROFILE yields `undefined` — the fail-safe the gate keeps
 * judging as outside (decision D3).
 */
export function expandHomeSpelling(value, env = process.env) {
	if (typeof value !== "string" || value === "") return void 0;
	const spelling = HOME_SPELLINGS.find((entry) => entry.re.test(value));
	if (spelling === void 0) return void 0;
	const home = (spelling.envKey === void 0 ? void 0 : env?.[spelling.envKey]) ?? env?.HOME ?? env?.USERPROFILE ?? (env === process.env ? homedir() : void 0);
	if (typeof home !== "string" || home === "") return void 0;
	const rest = value.replace(spelling.re, "");
	return rest === "" ? home : home.replace(/[\\/]$/, "") + rest;
}

/** Select path semantics for one target/root pair: win32 for Windows shapes, POSIX otherwise. */
function pathModuleFor(target, root) {
	return WINDOWS_SHAPE(target) || (root !== void 0 && WINDOWS_SHAPE(root)) ? win32 : posix;
}

/**
 * Lexical containment: `target` resolved against `root` must not escape it.
 * Windows-shaped inputs compare case-insensitively under `path.win32`; POSIX
 * inputs keep `path.posix` semantics regardless of the host platform.
 */
export function lexicallyWithin(target, root) {
	if (typeof target !== "string" || target === "") return true;
	// Home expansion never resolves inside a workspace root.
	if (HOME_PREFIX.test(target)) return false;
	const mod = pathModuleFor(target, root);
	const fold = (value) => (mod === win32 ? value.toLowerCase() : value);
	const abs = mod.isAbsolute(target) ? target : mod.join(root, target);
	const rel = mod.relative(fold(mod.normalize(root)), fold(mod.normalize(abs)));
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${mod.sep}`) && !mod.isAbsolute(rel));
}

/** Split a shell line into whitespace tokens, keeping quoted (space-containing) segments intact. */
export function shellTokens(input) {
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

/**
 * Match absolute-path substrings embedded inside a token (interpreter string
 * literals such as `node -e "...'/etc/passwd'..."`, `node -e "...'C:\tmp\file'..."`),
 * where the path is not the token's own leading segment. The path must start
 * right after a quote, backtick, space, parenthesis, `=` (task T7: `FOO=/etc/x`,
 * `--out=C:\x` — the assignment/option-value form), or token start, so relative
 * segments like `src/x` inside a plain word are never misread as absolute.
 * Covers POSIX `/`, home `~/` / `~\`, drive letters, and UNC `\\`. Accepted
 * false-positive direction: `cmd -d a=/etc/x` (value behind a standalone
 * token's `=`) fires too — conservative, never a silent miss.
 */
export const INTERIOR_PATH = /(?:^|['"`\s(=])((?:~[\\/]|[A-Za-z]:[\\/]|\\\\|\/)[^'"`;|&<>()]*)/g;

/** True when a shell token spells an absolute path in any supported syntax. */
function isAbsoluteToken(token) {
	return token.startsWith("/") || DRIVE_ABSOLUTE.test(token) || UNC_ABSOLUTE.test(token);
}

/** True when a shell token escapes the workspace through `..` in any separator spelling. */
function isEscapeToken(token) {
	return token === ".." || token.startsWith("../") || token.startsWith("..\\") || DOTDOT_SEGMENT.test(token);
}

/** Reason when a single path argument points outside the workspace, else undefined. */
export function pathReason(value, root, what) {
	const target = pathEntry(value, root, what);
	return target === void 0 || !target.outside ? void 0 : target.reason;
}

/**
 * One referenced path of a single argument, inside or outside the workspace:
 * the path (home-expanded), its argument label, and — when it escapes — the
 * reason. Task T4 judges sensitive basenames on ALL entries, so `outside` is
 * a flag instead of a filter.
 */
function pathEntry(value, root, what) {
	if (typeof value !== "string" || value === "") return void 0;
	// Task T3: home spellings expand to the real home and are judged there,
	// so a whitelist covering the home also covers `~/x`. The reason keeps the
	// original spelling — it is what the user recognises.
	const expanded = expandHomeSpelling(value);
	if (expanded !== void 0) {
		const outside = !lexicallyWithin(expanded, root);
		return { path: expanded, what, outside, ...outside ? { reason: `${what} references the user home: ${value}` } : {} };
	}
	// Unresolvable home spelling (or `~user`): fail-safe, judged outside.
	if (HOME_PREFIX.test(value)) return { path: value, what, outside: true, reason: `${what} references the user home: ${value}` };
	const outside = !lexicallyWithin(value, root);
	return { path: value, what, outside, ...outside ? { reason: `${what} is outside the workspace: ${value}` } : {} };
}

/**
 * Candidate spellings of one shell token: the quote-stripped form (keeps
 * backslashes, so Windows paths stay intact) and the backslash-unescaped form
 * (POSIX `\"`-style escapes). Both are judged, because an escape strip turns
 * `C:\tmp` into `C:tmp` — losing a Windows path — while leaving backslashes in
 * place misses `\/etc\/passwd`. Over-approximating is the safe direction.
 */
function tokenCandidates(token) {
	const quoteStripped = token.replace(/^["']+|["']+$/g, "");
	const unescaped = quoteStripped.replace(/\\(.)/g, "$1");
	return quoteStripped === unescaped ? [quoteStripped] : [quoteStripped, unescaped];
}

/**
 * Every referenced path of a bash/pwsh command line, inside and outside the
 * workspace, in discovery order (task T4 judges sensitive basenames on all).
 */
export function shellEntries(command, root) {
	const found = [];
	if (typeof command !== "string" || command === "") return found;
	// Task T3: no whole-command `$HOME` rejection — home spellings expand per
	// token and are judged as real paths. A single-quoted token is a literal
	// string (`echo '$HOME'` prints text, it does not reference a path).
	for (const token of shellTokens(command)) {
		const literal = /^'.*'$/s.test(token);
		for (const candidate of tokenCandidates(token)) {
			// Strip redirection prefixes ("2>", "&>>", ">", "<") after unescaping.
			const t = candidate.replace(/^(?:\d+[<>]|&>>?|[<>]+)/, "");
			if (t === "") continue;
			if (t === "/dev/null" || t.startsWith("/dev/null")) continue;
			if (!literal) {
				const expanded = expandHomeSpelling(t);
				if (expanded !== void 0) {
					const outside = !lexicallyWithin(expanded, root);
					found.push({ path: expanded, what: "command", outside, ...outside ? { reason: `command references the user home: ${token}` } : {} });
					if (outside) return found;
					continue;
				}
			}
			if (HOME_PREFIX.test(t)) {
				// Unresolvable home spelling (or `~user`), or a literal `~` word:
				// fail-safe, flagged as outside (decision D3).
				found.push({ path: t, what: "command", outside: true, reason: `command references the user home: ${token}` });
				return found;
			}
			if (isAbsoluteToken(t)) {
				const outside = !lexicallyWithin(t, root);
				found.push({ path: t, what: "command", outside, ...outside ? { reason: `command references a path outside the workspace: ${token}` } : {} });
				continue;
			}
			if (isEscapeToken(t)) {
				const outside = !lexicallyWithin(t, root);
				found.push({ path: t, what: "command", outside, ...outside ? { reason: `command escapes the workspace: ${token}` } : {} });
			}
			for (const match of t.matchAll(INTERIOR_PATH)) {
				const path = match[1];
				if (path === "/dev/null" || path.startsWith("/dev/null")) continue;
				// Interior home spellings expand too; unresolvable stays fail-safe.
				const expandedPath = expandHomeSpelling(path);
				if (expandedPath !== void 0) {
					const outside = !lexicallyWithin(expandedPath, root);
					found.push({ path: expandedPath, what: "command", outside, ...outside ? { reason: `command references the user home: ${path}` } : {} });
					continue;
				}
				if (HOME_PREFIX.test(path)) {
					found.push({ path, what: "command", outside: true, reason: `command references the user home: ${path}` });
					return found;
				}
				const outside = !lexicallyWithin(path, root);
				found.push({ path, what: "command", outside, ...outside ? { reason: `command references a path outside the workspace: ${path}` } : {} });
			}
		}
	}
	return found;
}

/** Outside-workspace references of a bash/pwsh command line, in discovery order. */
export function shellTargets(command, root) {
	return shellEntries(command, root).filter((entry) => entry.outside);
}

/** Reason when a bash/pwsh command line references paths outside the workspace, else undefined. */
export function shellReason(command, root) {
	return shellTargets(command, root)[0]?.reason;
}

/** True when a search pattern is absolute or escapes in any supported spelling. */
export function isAbsoluteOrEscapingPattern(pattern) {
	return pattern.startsWith("/") || HOME_PREFIX.test(pattern) || isAbsoluteToken(pattern) || isEscapeToken(pattern) || DOTDOT_SEGMENT.test(pattern);
}

/**
 * Every referenced path of one tool call, inside AND outside the workspace,
 * in discovery order (task T4: sensitive basenames are judged on all of them).
 */
export function scanTargets(exec, root) {
	const args = exec.arguments ?? {};
	const pathArg = Object.hasOwn(PATH_TOOLS, exec.name) ? PATH_TOOLS[exec.name] : void 0;
	if (pathArg !== void 0) {
		const target = pathEntry(args[pathArg], root, `${exec.name} target`);
		return target === void 0 ? [] : [target];
	}
	if (SEARCH_TOOLS.has(exec.name)) {
		const found = [];
		if (args.path !== void 0) {
			const target = pathEntry(args.path, root, `${exec.name} search path`);
			if (target !== void 0) found.push(target);
		}
		if (typeof args.pattern === "string" && isAbsoluteOrEscapingPattern(args.pattern)) {
			found.push({ path: args.pattern, what: `${exec.name} pattern`, outside: true, reason: `${exec.name} pattern is absolute or escapes the workspace: ${args.pattern}` });
		}
		return found;
	}
	if (SHELL_TOOLS.has(exec.name)) {
		const workdir = args.workdir !== void 0 ? pathEntry(args.workdir, root, `${exec.name} working directory`) : void 0;
		const commandTargets = shellEntries(args.command, root);
		return workdir === void 0 ? commandTargets : [workdir, ...commandTargets];
	}
	return [];
}

/**
 * Every outside-workspace reference of one tool call, in discovery order.
 * Used by the gate to decide which targets the `always` whitelist still covers.
 */
export function outsideTargets(exec, root) {
	return scanTargets(exec, root).filter((entry) => entry.outside);
}

/** Reason when a tool call touches anything outside the workspace, else undefined. */
export function outsideReason(exec, root) {
	return outsideTargets(exec, root)[0]?.reason;
}

/**
 * The directory a whitelist entry should cover for one offending path: the
 * path's parent for file-like targets, the path itself when it already reads
 * as a directory (`/`- or `\`-terminated).
 */
export function directoryOf(target) {
	if (typeof target !== "string" || target === "") return target;
	if (HOME_PREFIX.test(target)) return target;
	const mod = WINDOWS_SHAPE(target) ? win32 : posix;
	if (target.endsWith("/") || target.endsWith("\\")) return mod.normalize(target);
	const dir = mod.dirname(mod.normalize(target));
	return dir === "." ? target : dir;
}

/**
 * Platform temp targets DSH itself generates: first-level child directories of
 * the platform temp root (`os.tmpdir()` — `%TEMP%` on Windows) whose basename
 * starts with `dsh-` / `.dsh-`, subtree included. These are the runtime's own
 * working/spill directories — `dsh-subprocess-*` (process-output spill files),
 * `dsh-spill-*` (tool-result overflow), `dsh-*` (the sandbox runner's private
 * TEMP it rewrites `TMP`/`TEMP` to), `dsh-shell-*`, `dsh-subprocess-launch-*`,
 * `dsh-office-to-pdf-*`, `dsh-open-in-app-*`, `dsh-native-command-*`,
 * `dsh-workspace-changes-*`, `dsh-hmr-clock-*`, `dsh-acl-skill-*` — so tool
 * calls that follow a `spillPath` or expand `%TEMP%` never need a prompt.
 * Only absolute spellings inside ONE such child match: the temp root itself,
 * its plain files, and any same-named directory elsewhere stay gated.
 */
export function isPlatformTempTarget(value, tempRoot = tmpdir()) {
	if (typeof value !== "string" || value === "") return false;
	const mod = pathModuleFor(value, tempRoot);
	if (!mod.isAbsolute(value)) return false;
	const fold = (v) => (mod === win32 ? v.toLowerCase() : v);
	const rel = mod.relative(fold(mod.normalize(tempRoot)), fold(mod.normalize(value)));
	if (rel === "" || rel === ".." || rel.startsWith(`..${mod.sep}`) || mod.isAbsolute(rel)) return false;
	const first = rel.split(/[\\/]/)[0];
	return first.startsWith("dsh-") || first.startsWith(".dsh-");
}

/** Compiled-glob cache (patterns are config constants in practice). */
const globCache = new Map();

/** Compile one glob (`*` any run, `?` one char) to an anchored case-insensitive RegExp. */
export function globToRegExp(pattern) {
	let compiled = globCache.get(pattern);
	if (compiled === void 0) {
		const source = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
		compiled = new RegExp(`^${source}$`, "i");
		globCache.set(pattern, compiled);
	}
	return compiled;
}

/** Basename of a path in any separator spelling ("" when none). */
function basenameOf(value) {
	const parts = String(value).split(/[\\/]/);
	return parts[parts.length - 1] ?? "";
}

/**
 * Task T4's sensitive-file dimension: match a path's basename against
 * `patterns`, with `allowPatterns` (e.g. `*.env.example`) and the persisted
 * `alwaysPatterns` exempting first. Returns the matched pattern plus a reason,
 * or `undefined` when the file is not sensitive. Judged independently of the
 * workspace boundary — a sensitive file asks INSIDE the workspace too.
 */
export function sensitiveMatch(value, config = {}) {
	if (typeof value !== "string" || value === "") return void 0;
	const name = basenameOf(value);
	if (name === "") return void 0;
	const matches = (list) => (Array.isArray(list) ? list : []).some((pattern) => globToRegExp(pattern).test(name));
	if (matches(config.allowPatterns)) return void 0;
	if (matches(config.alwaysPatterns)) return void 0;
	const hit = (Array.isArray(config.patterns) ? config.patterns : []).find((pattern) => globToRegExp(pattern).test(name));
	return hit === void 0 ? void 0 : { pattern: hit, reason: `sensitive file (matches ${hit}): ${value}` };
}

/** Reason when a path names a sensitive file, else undefined (task T4). */
export function sensitiveReason(value, config = {}) {
	return sensitiveMatch(value, config)?.reason;
}

/** File tools whose single path argument names a target (value = arg name). */
export const PATH_TOOLS = { read: "file_path", write: "file_path", edit: "file_path", read_image: "file_path" };
/** Search tools whose optional `path` arg (and absolute `pattern`) must stay inside. */
export const SEARCH_TOOLS = new Set(["glob", "grep"]);
/** Shell tools whose command text is scanned for escaping paths. */
export const SHELL_TOOLS = new Set(["bash", "pwsh"]);
