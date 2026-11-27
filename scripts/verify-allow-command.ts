/**
 * `/wo-allow` 命令目录解析验证（任务 T30）。对 `src/host/allow-command.ts`
 * 的纯解析做直测：空输入、相对路径拒绝、家目录展开（含解析失败的
 * fail-closed）、POSIX/盘符/UNC 三形态绝对路径、归一化（折叠 `..`/重复
 * 分隔符、去尾分隔符但保留文件系统根）。不需要部署或 DSH 运行时：
 *
 *   node scripts/verify-allow-command.ts
 *
 * 任务 T41：每条用例显式带宿主平台 —— Windows 上 MSYS 盘符写法
 *（`/c/Code`）要归一成盘符写法，POSIX 主机上 `/c/Code` 是根下的 `c` 目录。
 * 平台作为形参传入，用例不随跑测机器漂移。
 */
import {parseAllowDirInput} from "../src/host/allow-command.ts";
import type {EnvVars} from "../src/host/scanner.ts";

/** 可解析家目录的替身环境。 */
const env: EnvVars = {HOME: "/home/me", USERPROFILE: "C:\\Users\\me"};
/** 显式空环境：家目录写法无法展开时必须 fail-closed 拒绝（决策 D3）。 */
const emptyEnv: EnvVars = {};

/** [raw, env, platform, expected] —— expected 是 `AllowDirParse` 的期望值。 */
const cases: [string, EnvVars, NodeJS.Platform, {ok: true; dir: string} | {ok: false; reason: "empty" | "not-absolute"}][] = [
    // --- 空输入 ---
    ["", env, "linux", {ok: false, reason: "empty"}],
    ["   ", env, "linux", {ok: false, reason: "empty"}],
    // --- 相对路径一律拒绝（含盘符相对的 `C:x`） ---
    ["src/x", env, "linux", {ok: false, reason: "not-absolute"}],
    ["foo\\bar", env, "linux", {ok: false, reason: "not-absolute"}],
    [".", env, "linux", {ok: false, reason: "not-absolute"}],
    ["..", env, "linux", {ok: false, reason: "not-absolute"}],
    ["C:x", env, "linux", {ok: false, reason: "not-absolute"}],
    // --- 家目录写法展开（同 scanner 的 expandHomeSpelling 语义） ---
    ["~/x", env, "linux", {ok: true, dir: "/home/me/x"}],
    ["~", env, "linux", {ok: true, dir: "/home/me"}],
    ["$HOME/secret", env, "linux", {ok: true, dir: "/home/me/secret"}],
    ["${HOME}/secret", env, "linux", {ok: true, dir: "/home/me/secret"}],
    ["%USERPROFILE%\\secret", env, "linux", {ok: true, dir: "C:\\Users\\me\\secret"}],
    ["%userprofile%/x", env, "linux", {ok: true, dir: "C:\\Users\\me\\x"}],
    ["$env:USERPROFILE\\x", env, "linux", {ok: true, dir: "C:\\Users\\me\\x"}],
    ["~user/x", env, "linux", {ok: false, reason: "not-absolute"}],
    // --- 家目录写法无法解析：fail-closed 拒绝，绝不当相对路径放行 ---
    ["~/x", emptyEnv, "linux", {ok: false, reason: "not-absolute"}],
    ["%USERPROFILE%\\x", emptyEnv, "linux", {ok: false, reason: "not-absolute"}],
    // --- POSIX 绝对路径（POSIX 主机语义：单字母段就是根下的普通目录） ---
    ["/etc/share/data", env, "linux", {ok: true, dir: "/etc/share/data"}],
    ["/a/b/../c", env, "linux", {ok: true, dir: "/a/c"}],
    ["/a//b", env, "linux", {ok: true, dir: "/a/b"}],
    ["/a/b///", env, "linux", {ok: true, dir: "/a/b"}],
    ["/", env, "linux", {ok: true, dir: "/"}],
    ["/c/Code", env, "linux", {ok: true, dir: "/c/Code"}],
    // --- UNC 斜杠写法（POSIX 语义保留开头双斜杠）与反斜杠写法 ---
    ["//server/share/x", env, "linux", {ok: true, dir: "//server/share/x"}],
    ["\\\\server\\share\\x", env, "linux", {ok: true, dir: "\\\\server\\share\\x"}],
    ["\\\\server\\share\\x\\", env, "linux", {ok: true, dir: "\\\\server\\share\\x"}],
    // --- Windows 盘符形态（大小写原样保留） ---
    ["C:\\data\\logs", env, "win32", {ok: true, dir: "C:\\data\\logs"}],
    ["c:\\data\\logs\\", env, "win32", {ok: true, dir: "c:\\data\\logs"}],
    ["C:\\foo\\..\\bar", env, "win32", {ok: true, dir: "C:\\bar"}],
    ["C:\\", env, "win32", {ok: true, dir: "C:\\"}],
    ["C:/data/x", env, "win32", {ok: true, dir: "C:\\data\\x"}],
    // --- T41：Windows 宿主上 MSYS 盘符写法归一（与卡片「总是允许该目录」同拼写，
    // 白名单不会出现 `/c/Code` 与 `C:\Code` 两条互不命中的条目） ---
    ["/c/Code", env, "win32", {ok: true, dir: "C:\\Code"}],
    ["/c/Code/internal", env, "win32", {ok: true, dir: "C:\\Code\\internal"}],
    ["/c/Code/internal/", env, "win32", {ok: true, dir: "C:\\Code\\internal"}],
    ["/cygdrive/c/Code/x", env, "win32", {ok: true, dir: "C:\\Code\\x"}],
    ["/c", env, "win32", {ok: true, dir: "C:\\"}],
    // 多字母段保持 POSIX 语义（Git for Windows 的 `/etc` 是 MSYS 自己的根）。
    ["/etc/share/data", env, "win32", {ok: true, dir: "/etc/share/data"}],
    // --- 带空格路径（trim 只去首尾空白，内部原样） ---
    ["  C:\\Program Files\\data  ", env, "win32", {ok: true, dir: "C:\\Program Files\\data"}]
];

let total = 0;
let pass = 0;
for (const [raw, envCase, platform, expected] of cases) {
    total += 1;
    const got = parseAllowDirInput(raw, envCase, platform);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  allow-dir [${platform}] ${JSON.stringify(raw)} => ${JSON.stringify(got)}`);
}
console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
