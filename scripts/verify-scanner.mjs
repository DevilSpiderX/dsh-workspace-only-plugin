/**
 * Scanner verification (task A). Runs the pure lexical gate in `lib/scanner.js`
 * against synthetic paths — POSIX and Windows spellings alike — including
 * false-positive controls. No deployment or DSH runtime required:
 *
 *   node scripts/verify-scanner.mjs
 */
import { denyMatch, expandHomeSpelling, genericTargets, isPlatformTempTarget, lexicallyWithin, pathReason, sameLocation, sensitiveMatch, shellReason } from "../lib/scanner.js";

const posixRoot = "/Volumes/CBR DATA/项目/dsh-workspace-only-plugin";
const winRoot = "C:\\work\\project";

/**
 * [command, expected, root?] — expected "FLAG" (gate fires) or "OK" (passes).
 * Windows cases use synthetic paths only.
 */
const cases = [
	// --- existing POSIX regression ---
	["cat /etc/passwd", "FLAG", posixRoot],
	["node -e \"console.log(require('fs').readFileSync('/etc/passwd','utf8'))\"", "FLAG", posixRoot],
	["python3 -c \"print(open('/etc/passwd').read())\"", "FLAG", posixRoot],
	["node -e \"console.log(require('fs').existsSync('/etc/hosts'))\"", "FLAG", posixRoot],
	["cd \"/Volumes/CBR DATA/项目/dsh-workspace-only-plugin\" && ls", "OK", posixRoot],
	["mkdir -p src/x && echo ok", "OK", posixRoot],
	// --- Windows: drive-letter tokens ---
	["type C:\\tmp\\example.txt", "FLAG", winRoot],
	["type c:\\tmp\\example.txt", "FLAG", winRoot],
	["type C:/tmp/example.txt", "FLAG", winRoot],
	["cd C:\\work\\project && dir", "OK", winRoot],
	["cd c:\\work\\PROJECT\\src && dir", "OK", winRoot],
	// --- Windows: embedded drive paths inside interpreter strings ---
	["node -e \"console.log(require('fs').existsSync('C:\\tmp\\example'))\"", "FLAG", winRoot],
	["python -c \"print(open('C:\\\\tmp\\\\example').read())\"", "FLAG", winRoot],
	["node -e \"console.log(require('fs').existsSync('C:\\work\\project\\src'))\"", "OK", winRoot],
	// --- Windows: `..\` / `../` / mixed-separator escapes ---
	["type ..\\secrets.txt", "FLAG", winRoot],
	["type ..\\..\\secrets.txt", "FLAG", winRoot],
	["type ../secrets.txt", "FLAG", winRoot],
	["type a\\..\\..\\secrets.txt", "FLAG", winRoot],
	["type ..", "FLAG", winRoot],
	["move src\\a.txt dist\\b.txt", "OK", winRoot],
	// --- Windows: UNC ---
	["type \\\\server\\share\\x", "FLAG", winRoot],
	["type \"\\\\server\\share\\x\"", "FLAG", winRoot],
	// --- Windows: redirection prefixes ---
	["echo hi > C:\\tmp\\example.txt", "FLAG", winRoot],
	["echo hi 2> C:\\tmp\\example.txt", "FLAG", winRoot],
	["echo hi &>> C:\\tmp\\example.txt", "FLAG", winRoot],
	["echo hi > out.log", "OK", winRoot],
	// --- Windows: quoting ---
	["type \"C:\\tmp\\example.txt\"", "FLAG", winRoot],
	["type 'C:\\tmp\\example.txt'", "FLAG", winRoot],
	["type \"src\\x\"", "OK", winRoot],
	// --- false-positive controls: plain words and relative segments never fire ---
	["type src\\x", "OK", winRoot],
	["type src/x", "OK", winRoot],
	["echo hello world", "OK", winRoot],
	["findstr main src\\index.js", "OK", winRoot],
	["git status", "OK", winRoot],
	["node -e \"console.log('abc/x')\"", "OK", winRoot],
	// T3: home spellings expand per token; single-quoted words are literals.
	["echo '$HOME'", "OK", winRoot],
	["cat $HOME/secret", "FLAG", winRoot],
	["type $env:USERPROFILE\\x", "FLAG", winRoot],
	// T7: assignment/option-value `=` forms were completely missed before.
	["FOO=/etc/secret node app.js", "FLAG", winRoot],
	["tool --out=C:\\x", "FLAG", winRoot],
	["tool --out=/etc/x", "FLAG", winRoot],
	// T7 false-positive guards: plain values and URL shapes stay quiet.
	["awk '{print $1}'", "OK", winRoot],
	["echo a=b", "OK", winRoot],
	["curl -d a=b https://x/y", "OK", winRoot],
	// --- home and $HOME still fire ---
	["type %USERPROFILE%\\x", "FLAG", winRoot],
	["type ~\\x", "FLAG", winRoot],
	["type ~", "FLAG", winRoot],
	["echo $HOME", "FLAG", winRoot]
];

/**
 * [target, root, expectedInside] — containment verdicts for path arguments,
 * including Windows case-insensitivity.
 */
const containment = [
	["C:\\work\\project\\src", winRoot, true],
	["c:\\work\\PROJECT\\src\\a.txt", winRoot, true],
	["src\\a.txt", winRoot, true],
	["C:\\tmp\\example.txt", winRoot, false],
	["..\\secrets.txt", winRoot, false],
	["C:\\work", winRoot, false],
	["/etc/passwd", posixRoot, false],
	["src/x", posixRoot, true],
	["../x", posixRoot, false],
	["~/x", posixRoot, false]
];

/**
 * Platform-temp exemptions (DSH-generated scratch under `os.tmpdir()`) —
 * [value, tempRoot, expectedExempt]. Only first-level `dsh-*` / `.dsh-*`
 * children of the temp root and their subtrees are exempt.
 */
const tempRootWin = "C:\\Users\\me\\AppData\\Local\\Temp";
const tempExempt = [
	// The runtime's own spill/work directories (subtree included).
	["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-subprocess-h4mBP1", tempRootWin, true],
	["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-subprocess-h4mBP1\\dsh-subprocess-1-2-abcdef-stdout.log", tempRootWin, true],
	["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-spill-A1b2C3\\sess\\x.json", tempRootWin, true],
	["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-k3D9xQ", tempRootWin, true],
	["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-shell-Ab12Cd\\work", tempRootWin, true],
	["c:\\users\\me\\appdata\\local\\temp\\DSH-Subprocess-X\\a.log", tempRootWin, true],
	["/tmp/dsh-shell-Ab12Cd/out.txt", "/tmp", true],
	["/tmp/.dsh-mkdir-staging/x", "/tmp", true],
	// Not exempt: plain files and the root itself stay gated.
	["C:\\Users\\me\\AppData\\Local\\Temp\\notes.txt", tempRootWin, false],
	["C:\\Users\\me\\AppData\\Local\\Temp", tempRootWin, false],
	// Not exempt: a `dsh-*` name deeper down, or anywhere else.
	["C:\\Users\\me\\AppData\\Local\\Temp\\other-dir\\dsh-subprocess-x", tempRootWin, false],
	["C:\\tmp\\dsh-subprocess-x\\a.log", tempRootWin, false],
	["/etc/dsh-subprocess-x/a.log", "/tmp", false],
	["/tmp/plain/file.txt", "/tmp", false],
	// Not exempt: non-absolute spellings are judged by the workspace gate.
	["~/dsh-subprocess-x/a.log", "/tmp", false],
	["dsh-subprocess-x/a.log", tempRootWin, false]
];
/**
 * Home-spelling expansion (task T3) — [value, env, expectedExpansion].
 * `undefined` means not home-shaped or unresolvable: the gate then judges it
 * as-is and keeps home spellings fail-safe outside.
 */
const homeExpand = [
	["~/x", { HOME: "/home/me" }, "/home/me/x"],
	["~", { HOME: "/home/me" }, "/home/me"],
	["~\\x", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me\\x"],
	["$HOME/secret", { HOME: "/home/me" }, "/home/me/secret"],
	["${HOME}/secret", { HOME: "/home/me" }, "/home/me/secret"],
	["%USERPROFILE%\\secret", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me\\secret"],
	["%userprofile%/x", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me/x"],
	["$env:USERPROFILE\\x", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me\\x"],
	["$env:HOMEPATH\\x", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me\\x"],
	["%HOMEPATH%\\x", { HOME: "/home/me" }, "/home/me\\x"],
	// Not home-shaped at all.
	["src/x", { HOME: "/home/me" }, void 0],
	["/etc/passwd", { HOME: "/home/me" }, void 0],
	// `~user` is somebody else's home — not this spelling set.
	["~user/x", { HOME: "/home/me" }, void 0],
	// Unresolvable home (explicit env without HOME/USERPROFILE): fail-safe.
	["~/x", {}, void 0]
];
/**
 * Sensitive-file matching (task T4) — [value, config, expectedMatchedPattern].
 * Matching is basename-based; `allowPatterns` and `alwaysPatterns` exempt.
 */
const sensitiveCases = [
	[".env", { patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.example"] }, "*.env"],
	["app.env.local", { patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.example"] }, "*.env.*"],
	[".env.example", { patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.example"] }, void 0],
	["prod.env.sample", { patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.sample"] }, void 0],
	[".env", { patterns: ["*.env"], allowPatterns: [], alwaysPatterns: ["*.env"] }, void 0],
	["server.pem", { patterns: ["*.pem"] }, "*.pem"],
	["id_rsa", { patterns: ["id_rsa*"] }, "id_rsa*"],
	["notes.txt", { patterns: ["*.env", "*.pem"] }, void 0],
	["C:\\work\\project\\.env", { patterns: ["*.env"] }, "*.env"],
	["/home/me/secrets/id_ed25519.pub", { patterns: ["id_ed25519*"] }, "id_ed25519*"]
];
/**
 * Deny rules (task T5) — [value, denyList, expectedHitRule]. A trailing
 * separator means directory-prefix containment, otherwise a full-path glob.
 */
const denyCases = [
	["C:\\secret\\a.txt", ["C:\\secret\\"], "C:\\secret\\"],
	["C:\\other\\a.txt", ["C:\\secret\\"], void 0],
	["/etc/passwd", ["/etc/"], "/etc/"],
	["/etc/passwd", ["*.pem"], void 0],
	["C:\\work\\project\\x.pem", ["*.pem"], "*.pem"],
	["/home/me/secrets/id_rsa", ["*/secrets/*"], "*/secrets/*"],
	["~/secret/a.txt", ["~/secret/"], "~/secret/"],
	["C:\\work\\project\\a.txt", [], void 0],
	["C:\\work\\project\\a.txt", [""], void 0]
];
/**
 * Generic argument scan (task T8) — [args, expectedCollectedPaths]. Only
 * path-shaped leaves are collected; plain text and over-long values skip.
 */
const genericCases = [
	[{ file_path: "C:\\outside\\x" }, ["C:\\outside\\x"]],
	[{ note: "just some text" }, []],
	[{ nested: { deep: { path: "/etc/passwd" } } }, ["/etc/passwd"]],
	[{ list: ["a", "C:\\outside\\y"] }, ["C:\\outside\\y"]],
	[{ big: "C:\\outside\\z" + "x".repeat(5000) }, []],
	[{ rel: "src/x" }, []],
	[{ note: "echo a=b and 42" }, []],
	[{ a: "C:\\outside\\p", b: "C:\\outside\\p" }, ["C:\\outside\\p"]]
];
/**
 * Workspace-scoped root matching (task T9) — [a, b, expectedSame].
 */
const sameCases = [
	["C:\\work\\project", "C:\\work\\project", true],
	["C:\\work\\project", "c:\\work\\PROJECT\\", true],
	["/home/me/project", "/home/me/project", true],
	["C:\\work\\projectA", "C:\\work\\projectB", false],
	["", "C:\\work", false]
];
let pass = 0;
let total = 0;
for (const [cmd, expect, root] of cases) {
	total += 1;
	const got = shellReason(cmd, root) === undefined ? "OK" : "FLAG";
	const ok = got === expect;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  [${expect}] ${cmd}  => ${got}`);
}
for (const [target, root, expectInside] of containment) {
	total += 1;
	const inside = lexicallyWithin(target, root);
	const ok = inside === expectInside;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  containment ${JSON.stringify(target)} in ${JSON.stringify(root)} => ${inside ? "inside" : "outside"}`);
}
for (const [a, b, expected] of sameCases) {
	total += 1;
	const got = sameLocation(a, b);
	const ok = got === expected;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  same-location ${JSON.stringify(a)} ~ ${JSON.stringify(b)} => ${got}`);
}
for (const [args, expectedPaths] of genericCases) {
	total += 1;
	const got = genericTargets({ name: "mcp__unknown__tool", arguments: args }, winRoot).map((entry) => entry.path);
	const ok = JSON.stringify(got) === JSON.stringify(expectedPaths);
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  generic ${JSON.stringify(Object.keys(args))} => ${JSON.stringify(got)}`);
}
for (const [value, denyList, expected] of denyCases) {
	total += 1;
	const got = denyMatch(value, denyList);
	const ok = got === expected;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  deny ${JSON.stringify(value)} vs ${JSON.stringify(denyList)} => ${JSON.stringify(got)}`);
}
for (const [value, config, expected] of sensitiveCases) {
	total += 1;
	const got = sensitiveMatch(value, config)?.pattern;
	const ok = got === expected;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  sensitive ${JSON.stringify(value)} => ${JSON.stringify(got)}`);
}
for (const [value, env, expected] of homeExpand) {
	total += 1;
	const got = expandHomeSpelling(value, env);
	const ok = got === expected;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  home-expand ${JSON.stringify(value)} => ${JSON.stringify(got)}`);
}
for (const [value, tempRoot, expectExempt] of tempExempt) {
	total += 1;
	const exempt = isPlatformTempTarget(value, tempRoot);
	const ok = exempt === expectExempt;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  temp-exempt ${JSON.stringify(value)} in ${JSON.stringify(tempRoot)} => ${exempt ? "exempt" : "gated"}`);
}
{
	// pathReason keeps the workspace-safe path silent and flags home/escapes.
	total += 1;
	const ok = pathReason("src\\a.txt", winRoot, "write target") === undefined && pathReason("~\\x", winRoot, "write target") !== void 0 && pathReason("C:\\tmp\\x", winRoot, "write target") !== void 0;
	if (ok) pass += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  pathReason mixed verdicts`);
}
console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
