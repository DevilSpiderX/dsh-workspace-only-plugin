/**
 * `/wo-allow` 输入框命令的目录解析（T30）。纯函数、无 dsh 依赖 —— 与
 * `scanner.ts` 一样由 `scripts/verify-allow-command.ts` 独立直测。
 *
 * 语义：只接受绝对路径（POSIX / 盘符 / UNC 三形态）；家目录写法（`~`、
 * `%USERPROFILE%`、`$env:USERPROFILE` 等，同 `scanner.ts` 的
 * `expandHomeSpelling`）先展开再判定，展开不了的保持原值、随后被绝对路径
 * 判定拒绝；归一化（折叠 `..`/重复分隔符、去尾分隔符但保留文件系统根）后
 * 交给白名单写入（`allowAlways`，与卡片「总是允许该目录」同一条路径）。
 */
import {posix, win32} from "node:path";
import {expandHomeSpelling} from "./scanner.ts";
import type {EnvVars} from "./scanner.ts";

/** 解析结果：成功给出可写入白名单的目录；失败给出原因（供命令文案映射）。 */
export type AllowDirParse =
    | {readonly ok: true; readonly dir: string}
    | {readonly ok: false; readonly reason: "empty" | "not-absolute"};

/** Windows 形态：盘符、UNC，或任意反斜杠（同 `scanner.ts` 的判口径）。 */
function windowsShape(value: string): boolean {
    return /^[A-Za-z]:/.test(value) || value.startsWith("\\\\") || value.includes("\\");
}

/**
 * 去掉尾部分隔符，但保留文件系统根（`/`、`\`、`C:\`）——`C:\` 去尾会变成
 * 盘符相对的 `C:`，绝不能放行。
 */
function stripTrailingSeparators(value: string): string {
    const trimmed = value.replace(/[\\/]+$/, "");
    if (trimmed === "" || /^[A-Za-z]:$/.test(trimmed)) return value;
    return trimmed;
}

/**
 * 解析 `/wo-allow` 的目录参数。`env` 可注入替身（看守/测试），缺省用真实
 * `process.env`；显式 env 缺 HOME/USERPROFILE 时家目录写法无法展开，按
 * fail-closed 拒绝（同 `scanner.ts` 的决策 D3）。
 */
export function parseAllowDirInput(raw: string, env: EnvVars = process.env): AllowDirParse {
    const value = raw.trim();
    if (value === "") return {ok: false, reason: "empty"};
    const expanded = expandHomeSpelling(value, env) ?? value;
    const mod = windowsShape(expanded) ? win32 : posix;
    if (!mod.isAbsolute(expanded)) return {ok: false, reason: "not-absolute"};
    // 归一化折叠 `..`/重复分隔符，但 `posix.normalize` 会把 UNC 斜杠写法
    //（`//server/share`）开头的双斜杠折叠掉——丢失 UNC 语义，白名单条目
    // 永远匹配不上真实 UNC 目标。normalize 后把开头双斜杠补回。
    const normalized = mod.normalize(expanded);
    const unc = expanded.startsWith("//") && !normalized.startsWith("//") ? `/${normalized}` : normalized;
    return {ok: true, dir: stripTrailingSeparators(unc)};
}
