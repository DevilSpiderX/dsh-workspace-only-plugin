/**
 * Scanner verification (task A). Runs the pure lexical gate in `lib/scanner.js`
 * against synthetic paths — POSIX and Windows spellings alike — including
 * false-positive controls. No deployment or DSH runtime required:
 *
 *   node scripts/verify-scanner.mjs
 */
import { isPlatformTempTarget, lexicallyWithin, pathReason, shellReason } from "../lib/scanner.js";

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
	// --- home and $HOME still fire ---
	["type %USERPROFILE%\\x", "OK", winRoot],
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
