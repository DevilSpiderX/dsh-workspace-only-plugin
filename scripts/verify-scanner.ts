/**
 * 扫描器验证（任务 A）。用合成路径——POSIX 与 Windows 写法都有——对
 * `src/host/scanner.ts` 的纯词法门禁做直测，含误报对照组。不需要部署或
 * DSH 运行时：
 *
 *   node scripts/verify-scanner.ts
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
    shellEntries,
    shellReason,
    toolAccessKind
} from "../src/host/scanner.ts";
import type {SensitiveConfig} from "../src/host/scanner.ts";
import {classifyShape, isRegexShapedText, parseShellWords} from "../src/host/shell-syntax.ts";
import type {ShellDialect} from "../src/host/shell-syntax.ts";

const posixRoot = "/Volumes/CBR DATA/项目/dsh-workspace-only-plugin";
const winRoot = "C:\\work\\project";

/**
 * [command, expected, root?] —— expected 为 "FLAG"（门禁触发）或 "OK"（放行）。
 * Windows 用例只使用合成路径。
 */
const cases: [string, string, string, ShellDialect?][] = [
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
    ["grep // /etc/x", "FLAG", winRoot],
    // --- 语法层改善组：正则字面量/模式位不是文件访问面（误报 → OK）---
    ["awk '/^\\// {print}'", "OK", winRoot],
    ["rg '/^\\d+$/'", "OK", winRoot],
    ["grep -E '/^\\/x/' src", "OK", winRoot],
    ["node -e \"s.replace(/^\\s+/, '')\"", "OK", winRoot],
    ["Select-String -Path src -Pattern '/^\\//' ", "OK", winRoot, "pwsh"],
    ["awk '/^\\/etc\\/passwd$/'", "OK", winRoot],
    ["awk '/foo/'", "OK", winRoot],
    ["grep -E '/^\\/x\\/y/' src", "OK", winRoot],
    // --- 语法层回归组：绝不放宽硬路径/逃逸/真实目录/内嵌真实路径 ---
    ["cat /foo/", "FLAG", winRoot],
    ["cat /usr/bin/", "FLAG", winRoot],
    ["awk '/etc/passwd'", "FLAG", winRoot],
    ["bash -c \"cat /etc/x\"", "FLAG", winRoot],
    ["node -e \"cat('/etc/x')\"", "FLAG", winRoot],
    ["awk '/x/ /etc/y'", "FLAG", winRoot],
    ["awk '/^//' /etc/y", "FLAG", winRoot],
    ["grep '//x' /etc/z", "FLAG", winRoot],
    ["echo $((1+2))", "OK", winRoot]
];

/**
 * [target, root, expectedInside] —— 路径参数的包含判定，含 Windows 大小写不敏感。
 */
const containment: [string, string, boolean][] = [
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
const tempExempt: [string, string, boolean][] = [
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
const homeExpand: [string, Record<string, string | undefined>, string | undefined][] = [
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
const builtinCases: [Record<string, string | undefined>, string[]][] = [
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
const sensitiveCases: [string, SensitiveConfig, string | undefined][] = [
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
const denyCases: [string, string[], string | undefined][] = [
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
const genericCases: [Record<string, unknown>, string[]][] = [
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
const sameCases: [string, string, boolean][] = [
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
const slashShapes: [string, boolean][] = [
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
/**
 * 形态分类直测 —— [value, expectedShape]。正则字面量/注释碎片/反斜杠
 * 转义序列是模式文本；真实路径形态（abs-path）与硬路径特征永不归入
 * 豁免形态、不可学；路径样词归 soft-path。
 */
const shapeCases: [string, string | undefined][] = [
    ["/^\\//", "regex-literal"],
    ["/^\\d+$/", "regex-literal"],
    ["/foo/", "regex-literal-loose"],
    ["/etc/x", "abs-path"],
    ["/usr/bin/", "abs-path"],
    ["/foo/bar/", "abs-path"],
    ["//", "comment-slash"],
    ["/*", "abs-path"],
    ["C:\\tmp\\x", "abs-path"],
    ["/etc/passwd", "abs-path"],
    ["\\\\target\\\\", "regex-escape"],
    ["\\d", "regex-escape"],
    ["\\", "regex-escape"],
    ["\\\\server\\share", "abs-path"],
    ["foo\\bar", "soft-path"],
    ["src/x", "soft-path"],
    ["hello", undefined]
];
/**
 * 正则形态文本（内嵌片段）直测 —— [value, expectedRegexShaped]。
 * 模式体里嵌着裸绝对路径的混合形态不豁免。
 */
const regexShapedCases: [string, boolean][] = [
    ["/^\\//", true],
    ["/^\\s+,", true],
    ["/^\\// {print}", true],
    ["/etc/x", false],
    ["/x/ /etc/y", false],
    ["C:\\tmp\\x", false]
];
/**
 * 语法层角色直测 —— [command, dialect, [raw, role] 序列]（过滤操作符词）。
 */
const roleCases: [string, ShellDialect, [string, string][]][] = [
    ["echo hi > out.log", "bash", [["echo", "command"], ["hi", "arg"], ["out.log", "redirect-target"]]],
    ["FOO=/etc/x node a.js", "bash", [["FOO=/etc/x", "assign-value"], ["node", "command"], ["a.js", "arg"]]],
    ["awk '/x/' f", "bash", [["awk", "command"], ["'/x/'", "pattern-arg"], ["f", "arg"]]],
    ["Select-String -Pattern '/x/'", "pwsh", [["Select-String", "command"], ["-Pattern", "arg"], ["'/x/'", "pattern-arg"]]],
    ["grep x y # tail", "bash", [["grep", "command"], ["x", "pattern-arg"], ["y", "arg"], ["# tail", "comment"]]]
];
let pass = 0;
let total = 0;
for (const [cmd, expect, root, dialect] of cases) {
    total += 1;
    const got = shellReason(cmd, root, dialect) === undefined ? "OK" : "FLAG";
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
for (const [value, expected] of shapeCases) {
    total += 1;
    const got = classifyShape(value);
    const ok = got === expected;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  shape ${JSON.stringify(value)} => ${JSON.stringify(got)}`);
}
for (const [value, expected] of regexShapedCases) {
    total += 1;
    const got = isRegexShapedText(value);
    const ok = got === expected;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  regex-shaped ${JSON.stringify(value)} => ${got}`);
}
for (const [command, dialect, expected] of roleCases) {
    total += 1;
    const got = parseShellWords(command, dialect)
        .filter((word) => !/^[|;&()<>]+$/.test(word.raw.trim()) && !/^\d+[<>]$|&>>?$/.test(word.raw.trim()))
        .map((word) => [word.raw, word.role] as [string, string]);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  roles ${JSON.stringify(command)} => ${JSON.stringify(got)}`);
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
for (const [name, expected] of [["read", "read"], ["read_image", "read"], ["glob", "read"], ["grep", "read"], ["write", "write"], ["edit", "write"], ["bash", "write"], ["pwsh", "write"], ["mcp-fs-write", "write"], ["", "write"]] as [string, string][]) {
    // toolAccessKind：纯读取器归为 read，写入器以及 shell/未知工具归为 write。
    total += 1;
    const got = toolAccessKind(name);
    const ok = got === expected;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  access-kind ${JSON.stringify(name)} => ${got}`);
}
{
    // pwsh 逗号数组拆分（一词一路径）：引号外逗号切独立词、引号内逗号
    //（`"a,b"`）与 scriptblock 不拆、bash 的 `","` 是词内字符不拆。
    const wordsOf = (cmd: string, dialect: ShellDialect): string[] =>
        parseShellWords(cmd, dialect).filter((word) => word.role !== "comment" && word.role !== "command").map((word) => word.value);
    total += 1;
    const split = wordsOf("Get-ChildItem \"C:\\a\",\"C:\\b\"", "pwsh");
    const ok1 = JSON.stringify(split) === JSON.stringify(["C:\\a", "C:\\b"]);
    if (ok1) pass += 1;
    console.log(`${ok1 ? "PASS" : "FAIL"}  pwsh comma split => ${JSON.stringify(split)}`);
    total += 1;
    const intact = wordsOf("Get-Content \"a,b\"", "pwsh");
    const ok2 = JSON.stringify(intact) === JSON.stringify(["a,b"]);
    if (ok2) pass += 1;
    console.log(`${ok2 ? "PASS" : "FAIL"}  pwsh quoted comma intact => ${JSON.stringify(intact)}`);
    total += 1;
    const bashIntact = wordsOf("echo a,b", "bash");
    const ok3 = JSON.stringify(bashIntact) === JSON.stringify(["a,b"]);
    if (ok3) pass += 1;
    console.log(`${ok3 ? "PASS" : "FAIL"}  bash comma intact => ${JSON.stringify(bashIntact)}`);
    total += 1;
    const script = wordsOf("Where-Object { $x -notmatch 'a' }", "pwsh");
    const ok4 = script.some((value) => value.includes("-notmatch"));
    if (ok4) pass += 1;
    console.log(`${ok4 ? "PASS" : "FAIL"}  pwsh scriptblock not split => ${JSON.stringify(script)}`);
}
{
    // 命令名归属与归一（basename + pwsh 小写）：词挂所属命令段的归一命令名。
    total += 1;
    const bashNames = parseShellWords("/usr/bin/grep x /etc/y", "bash").filter((word) => word.role !== "comment").map((word) => word.commandName);
    const ok1 = bashNames.every((name) => name === "grep");
    if (ok1) pass += 1;
    console.log(`${ok1 ? "PASS" : "FAIL"}  bash command name => ${JSON.stringify(bashNames)}`);
    total += 1;
    const pwshNames = parseShellWords("Get-ChildItem \"C:\\a\"", "pwsh").filter((word) => word.role !== "comment").map((word) => word.commandName);
    const ok2 = pwshNames.every((name) => name === "get-childitem");
    if (ok2) pass += 1;
    console.log(`${ok2 ? "PASS" : "FAIL"}  pwsh command name => ${JSON.stringify(pwshNames)}`);
    total += 1;
    const pipeNames = parseShellWords("cat a | grep b", "bash")
        .filter((word) => word.role !== "comment" && word.raw !== "|" && word.raw !== ";")
        .map((word) => `${word.value}=>${word.commandName}`);
    const ok3 = pipeNames.join(",") === "cat=>cat,a=>cat,grep=>grep,b=>grep";
    if (ok3) pass += 1;
    console.log(`${ok3 ? "PASS" : "FAIL"}  pipeline command names => ${JSON.stringify(pipeNames)}`);
}
{
    // pwsh 比较运算符（`-match`/`-notmatch`/`-like`/`-notlike`）右侧的字符串
    // 是模式文本（pattern-arg）；反斜杠转义序列与真实路径在签名形态段异键。
    total += 1;
    const entries = shellEntries("Where-Object { $_.FullName -notmatch '\\\\target\\\\' }", winRoot, "pwsh");
    const entry = entries.find((item) => item.path === "\\\\target\\\\");
    const ok = entry !== void 0 && entry.shapeSig === "pwsh|where-object|pattern-arg|regex-escape|single";
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  pwsh operator pattern-arg signature => ${entry?.shapeSig}`);
}
console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
