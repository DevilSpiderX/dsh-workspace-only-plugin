import { tmpdir, homedir } from 'node:os';
import { win32, posix, join } from 'node:path';

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
function expandHomeSpelling(value, env = process.env) {
	if (typeof value !== "string" || value === "") return void 0;
	const spelling = HOME_SPELLINGS.find((entry) => entry.re.test(value));
	if (spelling === void 0) return void 0;
	const home = (spelling.envKey === void 0 ? void 0 : env?.[spelling.envKey]) ?? env?.HOME ?? env?.USERPROFILE ?? (env === process.env ? homedir() : void 0);
	if (typeof home !== "string" || home === "") return void 0;
	const rest = value.replace(spelling.re, "");
	return rest === "" ? home : home.replace(/[\\/]$/, "") + rest;
}

/**
 * Expand `~`, `~/x`, `~\x` against the OS home — the host's `expandHomePath`
 * from `@deepseek-ai/dsh-home-paths`, inlined (this plugin composes no
 * dependency on that package; scripts/check-compat.mjs probe 12 re-verifies
 * the shape against the real installation).
 */
function expandTildePath(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}

/**
 * The built-in DEFAULT whitelist (always-allowed roots): the DSH runtime
 * directory under the harness home — `<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`,
 * the exact root the Desktop host installs the bundled Python/Node/pnpm
 * payload into (`desktop-host`'s `root`). The home follows the host's
 * `resolveDshHome()` (`@deepseek-ai/dsh-home-paths`), inlined here: `$DSH_HOME`
 * wins when set and NON-BLANK (a blank override must never resolve to the
 * current working directory), else `~/.dsh`; tilde spellings expand and the
 * result resolves to an absolute path. Resolved fresh on every call and NEVER
 * persisted: the harness home differs per machine and user, so a baked-in
 * default value (or a persisted absolute path) would be wrong on any other
 * machine. Returned entries are plain spellings judged exactly like GLOBAL
 * `always` entries — no session root, effective everywhere (see the gate's
 * `alwaysAllows`).
 */
function builtinAlwaysDirs(env = process.env) {
	const fromEnv = env?.DSH_HOME;
	const selected = typeof fromEnv === "string" && fromEnv.trim() !== "" ? fromEnv : join(homedir(), ".dsh");
	const home = expandTildePath(selected);
	// Join in the semantics of the home's own shape, not the host's, so a
	// Windows-shaped home yields `\` separators on any host (and vice versa).
	const mod = WINDOWS_SHAPE(home) ? win32 : posix;
	return [mod.join(mod.resolve(home), "dsh-runtimes", "dsh-primary-runtime")];
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
function lexicallyWithin(target, root) {
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

/** `//server/share` UNC slash spelling (the share segment is mandatory). */
const UNC_SLASH_RUN = /^\/\/[A-Za-z0-9.~_-]+[\\/]/;
function isRegexOrCommentSlash(value) {
	if (typeof value !== "string" || value[0] !== "/") return false;
	const second = value[1];
	if (second === "\\") return true;
	if (second === "/") return !UNC_SLASH_RUN.test(value);
	if (second === "*") {
		// A bare `/*` keeps its root-glob meaning (`echo /*`); anything that
		// stops the run right after (`/* comment */`, `/*|...`) is a comment
		// or regex fragment.
		const third = value[2];
		if (third === void 0) return false;
		return !/[A-Za-z0-9.~_]/.test(third);
	}
	return false;
}


/**
 * Match absolute-path substrings embedded inside a token (interpreter string
 * literals such as `node -e "...'/etc/passwd'..."`, `node -e "...'C:\tmp\file'..."`),
 * where the path is not the token's own leading segment. The path must start
 * right after a quote, backtick, space, parenthesis, `=` (task T7: `FOO=/etc/x`,
 * `--out=C:\x` — the assignment/option-value form), or token start, so relative
 * segments like `src/x` inside a plain word are never misread as absolute.
 * Covers POSIX `/`, home `~/` / `~\`, drive letters, and UNC `\\`. The `/`
 * form skips regex/comment fragments (task T15, see
 * {@link isRegexOrCommentSlash}; the inline form treats any `/*`-style run as
 * a fragment — an embedded root glob is rare enough to leave gated through
 * its own token instead). Accepted false-positive direction: `cmd -d a=/etc/x`
 * (value behind a standalone token's `=`) fires too — conservative, never a
 * silent miss.
 */
const INTERIOR_PATH = /(?:^|['"`\s(=])((?:~[\\/]|[A-Za-z]:[\\/]|\\\\|\/(?!(?:\\|\/(?![A-Za-z0-9.~_-]+[\\/])|[*](?![A-Za-z0-9.~_]))))[^'"`;|&<>()]*)/g;

/** True when a shell token spells an absolute path in any supported syntax. */
function isAbsoluteToken(token) {
	return token.startsWith("/") || DRIVE_ABSOLUTE.test(token) || UNC_ABSOLUTE.test(token);
}

/** True when a shell token escapes the workspace through `..` in any separator spelling. */
function isEscapeToken(token) {
	return token === ".." || token.startsWith("../") || token.startsWith("..\\") || DOTDOT_SEGMENT.test(token);
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
function shellEntries(command, root) {
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
			// Task T15: a token that starts as a regex/comment slash fragment
			// (`//`, `/* comment`, `/\*`) is pattern text, not a path carrier —
			// skip it whole (its unescaped twin can otherwise resurrect the
			// fragment as a UNC-looking run).
			if (isRegexOrCommentSlash(t)) continue;
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

/** True when a search pattern is absolute or escapes in any supported spelling. Regex/comment slash fragments (task T15) are pattern text, not paths. */
function isAbsoluteOrEscapingPattern(pattern) {
	if (isRegexOrCommentSlash(pattern)) return false;
	return pattern.startsWith("/") || HOME_PREFIX.test(pattern) || isAbsoluteToken(pattern) || isEscapeToken(pattern) || DOTDOT_SEGMENT.test(pattern);
}

/**
 * Every referenced path of one tool call, inside AND outside the workspace,
 * in discovery order (task T4: sensitive basenames are judged on all of them).
 */
function scanTargets(exec, root) {
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

/** True when the precise per-tool scanners above already cover this tool. */
function isPreciselyScanned(name) {
	return Object.hasOwn(PATH_TOOLS, name) || SEARCH_TOOLS.has(name) || SHELL_TOOLS.has(name);
}

/** Task T8: one argument leaf with a path shape judged generically. */
function genericEntry(value, root, what) {
	const expanded = expandHomeSpelling(value);
	// Task T15: a regex/comment slash fragment is pattern text, not a path.
	const shaped = !isRegexOrCommentSlash(value) && (expanded !== void 0 || isAbsoluteToken(value) || isEscapeToken(value) || HOME_PREFIX.test(value));
	// Only path-shaped values are judged; ordinary text is never a target.
	if (!shaped) return void 0;
	if (expanded !== void 0) {
		const outside = !lexicallyWithin(expanded, root);
		return { path: expanded, what, outside, ...outside ? { reason: `${what} references the user home: ${value}` } : {} };
	}
	const outside = HOME_PREFIX.test(value) ? true : !lexicallyWithin(value, root);
	return { path: value, what, outside, ...outside ? { reason: `${what} is outside the workspace: ${value}` } : {} };
}

/**
 * Task T8 (opt-in, `Config.scanAllTools`): conservative scan of a tool the
 * precise scanners do not cover — every string leaf of `arguments` that LOOKS
 * like a path (absolute, `..` escaping, home spelling; expanded first) is
 * judged and returned as a target. Plain text and values longer than 4096
 * characters are skipped so prose arguments never false-positive.
 */
function genericTargets(exec, root) {
	const found = [];
	const seen = new Set();
	const visit = (value, key) => {
		if (typeof value === "string") {
			if (value.length === 0 || value.length > 4096 || seen.has(value)) return;
			seen.add(value);
			const entry = genericEntry(value, root, key === "" ? `${exec.name} argument` : `${exec.name} ${key}`);
			if (entry !== void 0) found.push(entry);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((item, index) => visit(item, `${key}[${index}]`));
			return;
		}
		if (value !== null && typeof value === "object") {
			for (const [childKey, child] of Object.entries(value)) visit(child, key === "" ? childKey : `${key}.${childKey}`);
		}
	};
	visit(exec.arguments ?? {}, "");
	return found;
}

/**
 * The directory a whitelist entry should cover for one offending path: the
 * path's parent for file-like targets, the path itself when it already reads
 * as a directory (`/`- or `\`-terminated).
 */
function directoryOf(target) {
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
function isPlatformTempTarget(value, tempRoot = tmpdir()) {
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
function globToRegExp(pattern) {
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
function sensitiveMatch(value, config = {}) {
	if (typeof value !== "string" || value === "") return void 0;
	const name = basenameOf(value);
	if (name === "") return void 0;
	const matches = (list) => (Array.isArray(list) ? list : []).some((pattern) => globToRegExp(pattern).test(name));
	if (matches(config.allowPatterns)) return void 0;
	if (matches(config.alwaysPatterns)) return void 0;
	const hit = (Array.isArray(config.patterns) ? config.patterns : []).find((pattern) => globToRegExp(pattern).test(name));
	return hit === void 0 ? void 0 : { pattern: hit, reason: `sensitive file (matches ${hit}): ${value}` };
}

/**
 * True when two spellings name the same location lexically (task T9 matches
 * a workspace-scoped whitelist entry's root against the session root).
 */
function sameLocation(a, b) {
	if (typeof a !== "string" || typeof b !== "string" || a === "" || b === "") return false;
	return lexicallyWithin(a, b) && lexicallyWithin(b, a);
}

/**
 * Task T5's deny list — the highest-priority verdict. An entry ending in a
 * separator is a directory prefix (containment), anything else is a glob over
 * the full path (`*`/`?`, case-insensitive). Both sides home-expand first.
 * Returns the first hit rule, or `undefined`.
 */
function denyMatch(value, denyList) {
	if (typeof value !== "string" || value === "") return void 0;
	const resolved = expandHomeSpelling(value) ?? value;
	for (const entry of Array.isArray(denyList) ? denyList : []) {
		if (typeof entry !== "string" || entry === "") continue;
		if (entry.endsWith("/") || entry.endsWith("\\")) {
			if (lexicallyWithin(resolved, expandHomeSpelling(entry) ?? entry)) return entry;
		} else if (globToRegExp(entry).test(resolved)) {
			return entry;
		}
	}
	return void 0;
}

/** File tools whose single path argument names a target (value = arg name). */
const PATH_TOOLS = { read: "file_path", write: "file_path", edit: "file_path", read_image: "file_path" };
/** Search tools whose optional `path` arg (and absolute `pattern`) must stay inside. */
const SEARCH_TOOLS = new Set(["glob", "grep"]);
/** Shell tools whose command text is scanned for escaping paths. */
const SHELL_TOOLS = new Set(["bash", "pwsh"]);

/**
 * Access kind of one tool for the session-scope gate (仅工作区内 / 工作区外只读 /
 * 完全放开): pure readers pass at `outside-read`, anything that can CHANGE the
 * target still asks. `read`/`read_image`/`glob`/`grep` are reads;
 * `write`/`edit` are writes; `bash`/`pwsh` count as WRITES even though a
 * command may only read — a shell cannot be told apart lexically, so the gate
 * stays conservative. Unknown tools (e.g. the `scanAllTools` conservative
 * surface) are writes for the same reason.
 */
/** Tools judged READ-only by {@link toolAccessKind}. */
const READ_KIND_TOOLS = new Set(["read", "read_image", "glob", "grep"]);

function toolAccessKind(name) {
	return READ_KIND_TOOLS.has(name) ? "read" : "write";
}

export { INTERIOR_PATH, PATH_TOOLS, SEARCH_TOOLS, SHELL_TOOLS, builtinAlwaysDirs, denyMatch, directoryOf, expandHomeSpelling, genericTargets, globToRegExp, isAbsoluteOrEscapingPattern, isPlatformTempTarget, isPreciselyScanned, isRegexOrCommentSlash, lexicallyWithin, sameLocation, scanTargets, sensitiveMatch, shellEntries, shellTokens, toolAccessKind };
