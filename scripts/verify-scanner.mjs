import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const deployed = readFileSync(join(homedir(), ".dsh", "profiles", "web", "node_modules", "dsh-workspace-only-plugin", "lib", "index.js"), "utf8");

const grab = (name) => {
	const i = deployed.indexOf(`function ${name}`);
	if (i < 0) throw new Error(`function ${name} not found`);
	const j = deployed.indexOf("\n}", i);
	return deployed.slice(i, j + 2);
};
const interiorStart = deployed.indexOf("const INTERIOR_PATH");
const lineEnd = deployed.indexOf("\n", interiorStart);
const interiorDecl = deployed.slice(interiorStart, lineEnd);

const code = [
	"const { isAbsolute, join, normalize, relative, sep } = require('node:path');",
	grab("lexicallyWithin"),
	grab("shellTokens"),
	interiorDecl,
	grab("shellReason")
].join("\n");
const load = new Function("exports", "require", "module", `${code}\n;exports.shellReason = shellReason;`);
const m = { exports: {} };
load(m.exports, require, m);

const root = "/Volumes/CBR DATA/项目/dsh-workspace-only-plugin";
const cases = [
	["cat /etc/passwd", "FLAG"],
	["node -e \"console.log(require('fs').readFileSync('/etc/passwd','utf8'))\"", "FLAG"],
	["python3 -c \"print(open('/etc/passwd').read())\"", "FLAG"],
	["node -e \"console.log(require('fs').existsSync('/etc/hosts'))\"", "FLAG"],
	["cd \"/Volumes/CBR DATA/项目/dsh-workspace-only-plugin\" && ls", "OK"],
	["node -e \"console.log(require('fs').existsSync('/etc/hosts'))\"", "FLAG"]
];
let pass = 0;
for (const [cmd, expect] of cases) {
	const got = m.exports.shellReason(cmd, root) === undefined ? "OK" : "FLAG";
	console.log(`${got === expect ? "PASS" : "FAIL"}  ${cmd}  => ${got}`);
	if (got === expect) pass += 1;
}
console.log(`${pass}/${cases.length} passed`);
