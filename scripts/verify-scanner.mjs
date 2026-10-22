/**
 * 扫描器验证（任务 A）。用合成路径——POSIX 与 Windows 写法都有——对
 * `src/host/scanner.js` 的纯词法门禁做直测，含误报对照组。不需要部署或
 * DSH 运行时：
 *
 *   node scripts/verify-scanner.mjs
 */
import {homedir} from "node:os";
import {join} from "node:path";
import {
    builtinAlwaysDirs,
    denyMatch,
    expandHomeSpelling,
    genericTargets,
    isPlatformTempTarget,
    isRegexOrCommentSlash,
    lexicallyWithin,
    pathReason,
    sameLocation,
    sensitiveMatch,
    shellReason,
    toolAccessKind
} from "../src/host/scanner.js";

const posixRoot = "/Volumes/CBR DATA/项目/dsh-workspace-only-plugin";
const winRoot = "C:\\work\\project";

/**
 * [command, expected, root?] —— expected 为 "FLAG"（门禁触发）或 "OK"（放行）。
 * Windows 用例只使用合成路径。
 */
const cases = [
    // --- 既有 POSIX 回归 ---
    ["cat /etc/passwd", "FLAG", posixRoot],
    ["node -e \"console.log(require('fs').readFileSync('/etc/passwd','utf8'))\"", "FLAG", posixRoot],
    ["python3 -c \"print(open('/etc/passwd').read())\"", "FLAG", posixRoot],
    ["node -e \"console.log(require('fs').existsSync('/etc/hosts'))\"", "FLAG", posixRoot],
    ["cd \"/Volumes/CBR DATA/项目/dsh-workspace-only-plugin\" && ls", "OK", posixRoot],
    ["mkdir -p src/x && echo ok", "OK", posixRoot],
    // --- Windows：盘符 token ---
    ["type C:\\tmp\\example.txt", "FLAG", winRoot],
    ["type c:\\tmp\\example.txt", "FLAG", winRoot],
    ["type C:/tmp/example.txt", "FLAG", winRoot],
    ["cd C:\\work\\project && dir", "OK", winRoot],
    ["cd c:\\work\\PROJECT\\src && dir", "OK", winRoot],
    // --- Windows：解释器字符串内嵌的盘符路径 ---
    ["node -e \"console.log(require('fs').existsSync('C:\\tmp\\example'))\"", "FLAG", winRoot],
    ["python -c \"print(open('C:\\\\tmp\\\\example').read())\"", "FLAG", winRoot],
    ["node -e \"console.log(require('fs').existsSync('C:\\work\\project\\src'))\"", "OK", winRoot],
    // --- Windows：`..\` / `../` / 混合分隔符逃逸 ---
    ["type ..\\secrets.txt", "FLAG", winRoot],
    ["type ..\\..\\secrets.txt", "FLAG", winRoot],
    ["type ../secrets.txt", "FLAG", winRoot],
    ["type a\\..\\..\\secrets.txt", "FLAG", winRoot],
    ["type ..", "FLAG", winRoot],
    ["move src\\a.txt dist\\b.txt", "OK", winRoot],
    // --- Windows：UNC ---
    ["type \\\\server\\share\\x", "FLAG", winRoot],
    ["type \"\\\\server\\share\\x\"", "FLAG", winRoot],
    // --- Windows：重定向前缀 ---
    ["echo hi > C:\\tmp\\example.txt", "FLAG", winRoot],
    ["echo hi 2> C:\\tmp\\example.txt", "FLAG", winRoot],
    ["echo hi &>> C:\\tmp\\example.txt", "FLAG", winRoot],
    ["echo hi > out.log", "OK", winRoot],
    // --- Windows：引号 ---
    ["type \"C:\\tmp\\example.txt\"", "FLAG", winRoot],
    ["type 'C:\\tmp\\example.txt'", "FLAG", winRoot],
    ["type \"src\\x\"", "OK", winRoot],
    // --- 误报对照组：普通单词与相对路径段永不触发 ---
    ["type src\\x", "OK", winRoot],
    ["type src/x", "OK", winRoot],
    ["echo hello world", "OK", winRoot],
    ["findstr main src\\index.js", "OK", winRoot],
    ["git status", "OK", winRoot],
    ["node -e \"console.log('abc/x')\"", "OK", winRoot],
    // T3：home 写法按 token 展开；单引号包住的词是字面量。
    ["echo '$HOME'", "OK", winRoot],
    ["cat $HOME/secret", "FLAG", winRoot],
    ["type $env:USERPROFILE\\x", "FLAG", winRoot],
    // T7：赋值/选项值的 `=` 形式此前被完全漏掉。
    ["FOO=/etc/secret node app.js", "FLAG", winRoot],
    ["tool --out=C:\\x", "FLAG", winRoot],
    ["tool --out=/etc/x", "FLAG", winRoot],
    // T7 误报防护：普通值与 URL 形态保持静默。
    ["awk '{print $1}'", "OK", winRoot],
    ["echo a=b", "OK", winRoot],
    ["curl -d a=b https://x/y", "OK", winRoot],
    // --- home 与 $HOME 仍会触发 ---
    ["type %USERPROFILE%\\x", "FLAG", winRoot],
    ["type ~\\x", "FLAG", winRoot],
    ["type ~", "FLAG", winRoot],
    ["echo $HOME", "FLAG", winRoot],
    // --- T15：正则/注释斜杠串是模式文本，不是路径 ---
    ["Write-Output \"--- src/host/scanner.js head 45 ---\"; (Get-Content src/host/scanner.js -TotalCount 45) -join \"`n\"; Write-Output \"\"; Write-Output \"--- comment counts ---\"; Write-Output \"src comment lines: $((Select-String -Path src/host/scanner.js -Pattern '^\\s*(//|/\\*|\\*)').Count)\"; Write-Output \"lib comment lines: $((Select-String -Path lib/scanner.js -Pattern '^\\s*(//|/\\*|\\*)').Count)\"; Write-Output \"--- lib/index.js comment lines: $((Select-String -Path lib/index.js -Pattern '^\\s*(//|/\\*|\\*)').Count) vs src: $((Select-String -Path src/host/index.js -Pattern '^\\s*(//|/\\*|\\*)').Count)\"", "OK", winRoot],
    ["Write-Output \"src comment lines: $((Select-String -Path src/host/scanner.js -Pattern '^\\s*(//|/\\*|\\*)').Count)\"", "OK", winRoot],
    ["awk '// {print $1}'", "OK", winRoot],
    ["grep // src", "OK", winRoot],
    ["echo '/* comment */'", "OK", winRoot],
    ["node -e \"console.log('//x')\"", "OK", winRoot],
    ["findstr \"^//\" src\\index.js", "OK", winRoot],
    ["sed 's|//|/|g' x.txt", "OK", winRoot],
    // T15 漏报对照组：UNC 斜杠写法与根 glob 仍会触发。
    ["cat //server/share/x", "FLAG", winRoot],
    ["tool --out=//server/share/x", "FLAG", winRoot],
    ["echo /*", "FLAG", winRoot],
    ["grep // /etc/x", "FLAG", winRoot]
];

/**
 * [target, root, expectedInside] —— 路径参数的包含判定，含 Windows 大小写不敏感。
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
 * 平台临时目录豁免（`os.tmpdir()` 下 DSH 生成的草稿目录）——
 * [value, tempRoot, expectedExempt]。只有临时根下第一层 `dsh-*` / `.dsh-*`
 * 子目录及其子树才豁免。
 */
const tempRootWin = "C:\\Users\\me\\AppData\\Local\\Temp";
const tempExempt = [
    // 运行时自身的溢出/工作目录（含子树）。
    ["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-subprocess-h4mBP1", tempRootWin, true],
    ["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-subprocess-h4mBP1\\dsh-subprocess-1-2-abcdef-stdout.log", tempRootWin, true],
    ["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-spill-A1b2C3\\sess\\x.json", tempRootWin, true],
    ["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-k3D9xQ", tempRootWin, true],
    ["C:\\Users\\me\\AppData\\Local\\Temp\\dsh-shell-Ab12Cd\\work", tempRootWin, true],
    ["c:\\users\\me\\appdata\\local\\temp\\DSH-Subprocess-X\\a.log", tempRootWin, true],
    ["/tmp/dsh-shell-Ab12Cd/out.txt", "/tmp", true],
    ["/tmp/.dsh-mkdir-staging/x", "/tmp", true],
    // 不豁免：普通文件与根本身仍受门禁。
    ["C:\\Users\\me\\AppData\\Local\\Temp\\notes.txt", tempRootWin, false],
    ["C:\\Users\\me\\AppData\\Local\\Temp", tempRootWin, false],
    // 不豁免：更深层级的 `dsh-*` 名称，或其他任何位置。
    ["C:\\Users\\me\\AppData\\Local\\Temp\\other-dir\\dsh-subprocess-x", tempRootWin, false],
    ["C:\\tmp\\dsh-subprocess-x\\a.log", tempRootWin, false],
    ["/etc/dsh-subprocess-x/a.log", "/tmp", false],
    ["/tmp/plain/file.txt", "/tmp", false],
    // 不豁免：非绝对路径写法由工作区门禁判定。
    ["~/dsh-subprocess-x/a.log", "/tmp", false],
    ["dsh-subprocess-x/a.log", tempRootWin, false]
];
/**
 * home 写法展开（任务 T3）—— [value, env, expectedExpansion]。
 * `undefined` 表示不是 home 形态或无法解析：门禁按原样判定，使 home 写法
 * 在外部保持 fail-safe。
 */
const homeExpand = [
    ["~/x", {HOME: "/home/me"}, "/home/me/x"],
    ["~", {HOME: "/home/me"}, "/home/me"],
    ["~\\x", {USERPROFILE: "C:\\Users\\me"}, "C:\\Users\\me\\x"],
    ["$HOME/secret", {HOME: "/home/me"}, "/home/me/secret"],
    ["${HOME}/secret", {HOME: "/home/me"}, "/home/me/secret"],
    ["%USERPROFILE%\\secret", {USERPROFILE: "C:\\Users\\me"}, "C:\\Users\\me\\secret"],
    ["%userprofile%/x", {USERPROFILE: "C:\\Users\\me"}, "C:\\Users\\me/x"],
    ["$env:USERPROFILE\\x", {USERPROFILE: "C:\\Users\\me"}, "C:\\Users\\me\\x"],
    ["$env:HOMEPATH\\x", {USERPROFILE: "C:\\Users\\me"}, "C:\\Users\\me\\x"],
    ["%HOMEPATH%\\x", {HOME: "/home/me"}, "/home/me\\x"],
    // 完全不是 home 形态。
    ["src/x", {HOME: "/home/me"}, void 0],
    ["/etc/passwd", {HOME: "/home/me"}, void 0],
    // `~user` 是别人的主目录——不在这套写法之内。
    ["~user/x", {HOME: "/home/me"}, void 0],
    // 无法解析的 home（指定了 env 但没有 HOME/USERPROFILE）：fail-safe。
    ["~/x", {}, void 0]
];
/**
 * 内置默认白名单 —— [env, expectedDirs]。DSH 运行时目录跟随 `DSH_HOME`，
 * 否则用 `~/.dsh`；join 保留 HOME 自身的分隔符语义，与宿主平台无关。
 */
const fallbackBuiltin = [join(homedir(), ".dsh", "dsh-runtimes", "dsh-primary-runtime")];
const builtinCases = [
    [{DSH_HOME: "C:\\Users\\me\\.dsh"}, ["C:\\Users\\me\\.dsh\\dsh-runtimes\\dsh-primary-runtime"]],
    [{DSH_HOME: "C:\\Users\\me\\.dsh\\"}, ["C:\\Users\\me\\.dsh\\dsh-runtimes\\dsh-primary-runtime"]],
    [{DSH_HOME: "/home/me/.dsh"}, ["/home/me/.dsh/dsh-runtimes/dsh-primary-runtime"]],
    // 未设置（或为空）DSH_HOME：回退到宿主自身的 `~/.dsh`。
    [{}, fallbackBuiltin],
    [{DSH_HOME: ""}, fallbackBuiltin],
    // 空白值同样视为未设置（宿主规则：空白覆盖绝不能把 home 解析到工作目录）。
    [{DSH_HOME: "   "}, fallbackBuiltin],
    // 波浪号写法按宿主 `expandHomePath` 的同样方式展开。
    [{DSH_HOME: "~/.dsh"}, fallbackBuiltin],
    [{DSH_HOME: "~"}, [join(homedir(), "dsh-runtimes", "dsh-primary-runtime")]]
];
/**
 * 敏感文件匹配（任务 T4）—— [value, config, expectedMatchedPattern]。
 * 按 basename 匹配；`allowPatterns` 与 `alwaysPatterns` 可豁免。
 */
const sensitiveCases = [
    [".env", {patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.example"]}, "*.env"],
    ["app.env.local", {patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.example"]}, "*.env.*"],
    [".env.example", {patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.example"]}, void 0],
    ["prod.env.sample", {patterns: ["*.env", "*.env.*"], allowPatterns: ["*.env.sample"]}, void 0],
    [".env", {patterns: ["*.env"], allowPatterns: [], alwaysPatterns: ["*.env"]}, void 0],
    ["server.pem", {patterns: ["*.pem"]}, "*.pem"],
    ["id_rsa", {patterns: ["id_rsa*"]}, "id_rsa*"],
    ["notes.txt", {patterns: ["*.env", "*.pem"]}, void 0],
    ["C:\\work\\project\\.env", {patterns: ["*.env"]}, "*.env"],
    ["/home/me/secrets/id_ed25519.pub", {patterns: ["id_ed25519*"]}, "id_ed25519*"]
];
/**
 * 拒绝规则（任务 T5）—— [value, denyList, expectedHitRule]。末尾带分隔符
 * 表示目录前缀包含判定，否则是全路径 glob。
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
 * 通用参数扫描（任务 T8）—— [args, expectedCollectedPaths]。只收集路径形态的
 * 叶子值；纯文本与超长值跳过。
 */
const genericCases = [
    [{file_path: "C:\\outside\\x"}, ["C:\\outside\\x"]],
    [{note: "just some text"}, []],
    [{nested: {deep: {path: "/etc/passwd"}}}, ["/etc/passwd"]],
    [{list: ["a", "C:\\outside\\y"]}, ["C:\\outside\\y"]],
    [{big: "C:\\outside\\z" + "x".repeat(5000)}, []],
    [{rel: "src/x"}, []],
    [{note: "echo a=b and 42"}, []],
    [{pattern: "//"}, []],
    [{a: "C:\\outside\\p", b: "C:\\outside\\p"}, ["C:\\outside\\p"]]
];
/**
 * 工作区范围根匹配（任务 T9）—— [a, b, expectedSame]。
 */
const sameCases = [
    ["C:\\work\\project", "C:\\work\\project", true],
    ["C:\\work\\project", "c:\\work\\PROJECT\\", true],
    ["/home/me/project", "/home/me/project", true],
    ["C:\\work\\projectA", "C:\\work\\projectB", false],
    ["", "C:\\work", false]
];
/**
 * 正则/注释斜杠片段（任务 T15）—— [value, expectedRegexShaped]。
 * 模式文本绝不能触发门禁；UNC 斜杠写法与根 glob 必须触发。
 */
const slashShapes = [
    ["//", true],
    ["//|x", true],
    ["//)", true],
    ["/* comment */", true],
    ["/*|*", true],
    ["/**", true],
    ["/\\*", true],
    ["/\\d+", true],
    ["//server/share/x", false],
    // 裸 `//server` 没有 share 段：是模式文本，不是路径。
    ["//server", true],
    ["//x", true],
    ["/*", false],
    ["/*glob", false],
    ["/etc/passwd", false],
    ["/foo/bar", false],
    ["src/x", false]
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
for (const [value, expected] of slashShapes) {
    total += 1;
    const got = isRegexOrCommentSlash(value);
    const ok = got === expected;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  slash-shape ${JSON.stringify(value)} => ${got}`);
}
for (const [args, expectedPaths] of genericCases) {
    total += 1;
    const got = genericTargets({name: "mcp__unknown__tool", arguments: args}, winRoot).map((entry) => entry.path);
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
for (const [env, expected] of builtinCases) {
    total += 1;
    const got = builtinAlwaysDirs(env);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  builtin ${JSON.stringify(env.DSH_HOME ?? "(unset)")} => ${JSON.stringify(got)}`);
}
{
    // 内置运行时目录覆盖其子树（Windows 上大小写不敏感）且不覆盖旁边任何
    // 位置：$DSH_HOME 下的兄弟目录仍受门禁。
    total += 1;
    const [dir] = builtinAlwaysDirs({DSH_HOME: "C:\\Users\\me\\.dsh"});
    const ok = lexicallyWithin("c:\\users\\me\\.dsh\\DSH-Runtimes\\dsh-primary-runtime\\bin\\x.exe", dir) && lexicallyWithin("C:\\Users\\me\\.dsh\\dsh-runtimes\\dsh-primary-runtime", dir) && !lexicallyWithin("C:\\Users\\me\\.dsh\\profiles\\desktop\\x", dir) && !lexicallyWithin("C:\\Users\\me\\.dsh\\dsh-runtimes\\other\\x", dir);
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  builtin subtree coverage`);
}
for (const [value, tempRoot, expectExempt] of tempExempt) {
    total += 1;
    const exempt = isPlatformTempTarget(value, tempRoot);
    const ok = exempt === expectExempt;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  temp-exempt ${JSON.stringify(value)} in ${JSON.stringify(tempRoot)} => ${exempt ? "exempt" : "gated"}`);
}
{
    // pathReason 对工作区内安全路径保持静默，对 home/逃逸路径报警。
    total += 1;
    const ok = pathReason("src\\a.txt", winRoot, "write target") === undefined && pathReason("~\\x", winRoot, "write target") !== void 0 && pathReason("C:\\tmp\\x", winRoot, "write target") !== void 0;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  pathReason mixed verdicts`);
}
for (const [name, expected] of [["read", "read"], ["read_image", "read"], ["glob", "read"], ["grep", "read"], ["write", "write"], ["edit", "write"], ["bash", "write"], ["pwsh", "write"], ["mcp-fs-write", "write"], ["", "write"]]) {
    // toolAccessKind：纯读取器归为 read，写入器以及 shell/未知工具归为 write。
    total += 1;
    const got = toolAccessKind(name);
    const ok = got === expected;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  access-kind ${JSON.stringify(name)} => ${got}`);
}
console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
