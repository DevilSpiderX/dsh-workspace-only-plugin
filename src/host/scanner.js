import {homedir, tmpdir} from "node:os";
import {join, posix, win32} from "node:path";

/**
 * Workspace Only 词法路径扫描器 —— 门禁的纯、零依赖核心。这里的一切都是对工具
 * 参数的静态分析：哪些调用引用了会话工作区根之外的路径。
 *
 * Windows 是一等公民（任务 A）：盘符与 UNC 绝对路径、反斜杠分隔符、`..\` 逃逸
 * 与 POSIX 写法被完全同等地识别，只要任意一侧看起来像 Windows 路径，包含判定
 * 就采用 `path.win32` 语义（大小写不敏感），因此在任何宿主平台上裁决都正确。
 */

/** `C:\` / `C:/` 盘符绝对路径，任意大小写字母。 */
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
/** `\\server\share` UNC 绝对路径。 */
const UNC_ABSOLUTE = /^\\\\/;
/** `~`、`~\user`、`~/x` 家目录展开（任意写法）。 */
const HOME_PREFIX = /^~/;
/** 任意 `..\` / `../` 片段，无论出现在 token 的哪个位置。 */
const DOTDOT_SEGMENT = /\.\.[\\/]/;
/** Windows 形态：盘符、UNC，或任意反斜杠。 */
const WINDOWS_SHAPE = (value) => DRIVE_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || value.includes("\\");

/**
 * 扫描器在判定前会展开的家目录写法（任务 T3）：POSIX 的 `~` 与
 * `$HOME`/`${HOME}`，cmd 的 `%USERPROFILE%`/`%HOMEPATH%`，以及 PowerShell 的
 * `$env:USERPROFILE`/`$env:HOMEPATH`。写法必须到此结束或后接分隔符，
 * 这样 `~user` 或 `$HOMEDIR` 不会被误读。
 */
const HOME_SPELLINGS = [
    {re: /^~(?=$|[\\/])/i, envKey: void 0},
    {re: /^\$\{?HOME\}?(?=$|[\\/])/i, envKey: void 0},
    {re: /^%USERPROFILE%(?=$|[\\/])/i, envKey: "USERPROFILE"},
    {re: /^%HOMEPATH%(?=$|[\\/])/i, envKey: void 0},
    {re: /^\$env:USERPROFILE(?=$|[\\/])/i, envKey: "USERPROFILE"},
    {re: /^\$env:HOMEPATH(?=$|[\\/])/i, envKey: void 0}
];

/**
 * 把一种家目录写法展开为真实用户家目录路径；若值不是家目录形态或家目录无法
 * 解析则返回 `undefined`（任务 T3）。所有写法统一到同一个根：`env.HOME`，
 * 其次 `env.USERPROFILE`，再其次真实环境的 `os.homedir()`。`%HOMEPATH%` 是盘符
 * 相对片段，映射到同一个完整家目录。显式传入的 `env` 若缺 HOME/USERPROFILE
 * 则返回 `undefined` —— 这是门禁保持按外部判定的 fail-safe（决策 D3）。
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

/**
 * 相对 OS 家目录展开 `~`、`~/x`、`~\x` —— 即宿主 `@deepseek-ai/dsh-home-paths`
 * 中的 `expandHomePath`，此处内联（本插件不依赖该包；scripts/check-compat.mjs
 * 探测 12 会对照真实安装重新核实该形状）。
 */
function expandTildePath(value) {
    if (value === "~") return homedir();
    if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
    return value;
}

/**
 * harness home（DSH_HOME）解析：设置了且非空白的 `$DSH_HOME` 优先（空白覆盖
 * 绝不能解析成当前工作目录），否则 `~/.dsh`；波浪号写法会展开，结果按 home
 * 自身形态的语义解析为绝对路径。沿用宿主 `resolveDshHome()`
 * （`@deepseek-ai/dsh-home-paths`）的语义，此处内联（本插件不依赖该包；
 * scripts/check-compat.mjs 探测 12 会对照真实安装重新核实该形状）。每次调用
 * 都重新解析、绝不持久化：harness home 因机器和用户而异。内置默认白名单
 * （{@link builtinAlwaysDirs}）与会话白名单文件（`session-whitelist.js`）
 * 共用这一个解析，避免两处漂移。
 */
export function resolveDshHome(env = process.env) {
    const fromEnv = env?.DSH_HOME;
    const selected = typeof fromEnv === "string" && fromEnv.trim() !== "" ? fromEnv : join(homedir(), ".dsh");
    const home = expandTildePath(selected);
    // 按 home 自身形态的语义解析，而不是按宿主的，这样 Windows 形态的 home 在任何
    // 宿主上都保持 `\` 分隔符（反之亦然）。
    const mod = WINDOWS_SHAPE(home) ? win32 : posix;
    return mod.resolve(home);
}

/**
 * 内置默认白名单（总是放行的根）：harness home 下的 DSH 运行时目录 ——
 * `<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`，即 Desktop host 安装随附
 * Python/Node/pnpm 载荷的确切根（`desktop-host` 的 `root`）。每次调用都重新
 * 解析、绝不持久化：烘焙的默认值（或持久化的绝对路径）在任何其他机器上都是
 * 错的。返回的条目是普通写法，判定与全局 `always` 条目完全一致 ——
 * 没有会话 root，在哪里都生效（见门禁的 `alwaysAllows`）。
 */
export function builtinAlwaysDirs(env = process.env) {
    const home = resolveDshHome(env);
    const mod = WINDOWS_SHAPE(home) ? win32 : posix;
    return [mod.join(home, "dsh-runtimes", "dsh-primary-runtime")];
}

/** 为一对 target/root 选择路径语义：Windows 形态用 win32，其余用 POSIX。 */
function pathModuleFor(target, root) {
    return WINDOWS_SHAPE(target) || (root !== void 0 && WINDOWS_SHAPE(root)) ? win32 : posix;
}

/**
 * 词法包含：`target` 相对 `root` 解析后不得逃逸出去。
 * Windows 形态的输入在 `path.win32` 下大小写不敏感比较；POSIX 输入无论宿主平台
 * 如何都保持 `path.posix` 语义。
 */
export function lexicallyWithin(target, root) {
    if (typeof target !== "string" || target === "") return true;
    // 家目录展开永远解析不到工作区 root 内部。
    if (HOME_PREFIX.test(target)) return false;
    const mod = pathModuleFor(target, root);
    const fold = (value) => (mod === win32 ? value.toLowerCase() : value);
    const abs = mod.isAbsolute(target) ? target : mod.join(root, target);
    const rel = mod.relative(fold(mod.normalize(root)), fold(mod.normalize(abs)));
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${mod.sep}`) && !mod.isAbsolute(rel));
}

/** 把 shell 命令行切成空白分隔的 token，保留带引号（含空格）的片段。 */
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

/** `//server/share` UNC 斜杠写法（share 段必填）。 */
const UNC_SLASH_RUN = /^\/\/[A-Za-z0-9.~_-]+[\\/]/;

/**
 * 当开头的 `/` 其实是正则或注释片段而非路径时返回 true（任务 T15）。Shell 命令
 * 文本里满是 `-Pattern '^\s*(//|/\*|\*)'` 这类模式，把它们的斜杠按绝对路径词法
 * 处理会让每条搜索/计数命令都误触审批。
 *
 * - `/\*`、`/\d` —— 斜杠后的正则转义：绝不是路径。
 * - `//` —— 正则定界符对（`awk //`、`//x`）或注释开始：绝不是路径，除非这串是
 *   UNC 斜杠写法 —— 它总是携带 share 段（`//server/share`；裸 `//server` 没有
 *   share，仍是模式文本）。
 * - `/*` —— 注释开始（`/* TODO */`），除非读起来像 glob：裸 `/*`（token 结束）
 *   保持门禁（`echo /*` 会碰到根目录），`/*glob` 则继续按路径处理。
 */
export function isRegexOrCommentSlash(value) {
    if (typeof value !== "string" || value[0] !== "/") return false;
    const second = value[1];
    if (second === "\\") return true;
    if (second === "/") return !UNC_SLASH_RUN.test(value);
    if (second === "*") {
        // 裸 `/*` 保留其根 glob 含义（`echo /*`）；紧随其后就断掉的
        // （`/* comment */`、`/*|...`）则是注释或正则片段。
        const third = value[2];
        if (third === void 0) return false;
        return !/[A-Za-z0-9.~_]/.test(third);
    }
    return false;
}


/**
 * 匹配嵌在 token 内部的绝对路径子串（解释器字符串字面量，如
 * `node -e "...'/etc/passwd'..."`、`node -e "...'C:\tmp\file'..."`），此时路径不是
 * token 自己的起始段。路径必须紧跟在引号、反引号、空格、括号、`=`（任务 T7：
 * `FOO=/etc/x`、`--out=C:\x` —— 赋值/选项值形式）或 token 起始之后，这样普通词
 * 里的相对段（如 `src/x`）绝不会被误读为绝对路径。覆盖 POSIX 的 `/`、家目录的
 * `~/` / `~\`、盘符，以及 UNC 的 `\\`。`/` 形式会跳过正则/注释片段（任务 T15，
 * 见 {@link isRegexOrCommentSlash}；内联形式把任何 `/*` 风格的片段一律当片段 ——
 * 嵌入的根 glob 罕见到可以留给它自己的 token 继续走门禁）。接受的误报方向：
 * `cmd -d a=/etc/x`（独立 token 的 `=` 之后的值）也会触发 —— 宁可保守，绝不静默漏掉。
 */
export const INTERIOR_PATH = /(?:^|['"`\s(=])((?:~[\\/]|[A-Za-z]:[\\/]|\\\\|\/(?!(?:\\|\/(?![A-Za-z0-9.~_-]+[\\/])|[*](?![A-Za-z0-9.~_]))))[^'"`;|&<>()]*)/g;

/** 当 shell token 以任意受支持语法拼出绝对路径时返回 true。 */
function isAbsoluteToken(token) {
    return token.startsWith("/") || DRIVE_ABSOLUTE.test(token) || UNC_ABSOLUTE.test(token);
}

/** 当 shell token 以任意分隔符写法通过 `..` 逃逸工作区时返回 true。 */
function isEscapeToken(token) {
    return token === ".." || token.startsWith("../") || token.startsWith("..\\") || DOTDOT_SEGMENT.test(token);
}

/** 单个路径参数指向工作区外时返回原因，否则 undefined。 */
export function pathReason(value, root, what) {
    const target = pathEntry(value, root, what);
    return target === void 0 || !target.outside ? void 0 : target.reason;
}

/**
 * 单个参数所引用的一条路径，在工作区内还是外：路径（已做家目录展开）、它的
 * 参数标签，以及逃逸时的原因。任务 T4 对所有条目都判定敏感文件名，因此
 * `outside` 是标记而非过滤器。
 */
function pathEntry(value, root, what) {
    if (typeof value !== "string" || value === "") return void 0;
    // 任务 T3：家目录写法展开为真实家目录并在那里判定，因此覆盖家目录的白名单
    // 也覆盖 `~/x`。原因保留原始写法 —— 那是用户认得出来的东西。
    const expanded = expandHomeSpelling(value);
    if (expanded !== void 0) {
        const outside = !lexicallyWithin(expanded, root);
        return {
            path: expanded,
            what,
            outside, ...outside ? {reason: `${what} references the user home: \`${value}\``} : {}
        };
    }
    // 无法解析的家目录写法（或 `~user`）：fail-safe，按外部判定。
    if (HOME_PREFIX.test(value)) return {
        path: value,
        what,
        outside: true,
        reason: `${what} references the user home: \`${value}\``
    };
    const outside = !lexicallyWithin(value, root);
    return {path: value, what, outside, ...outside ? {reason: `${what} is outside the workspace: \`${value}\``} : {}};
}

/**
 * 一个 shell token 的候选写法：去引号形式（保留反斜杠，Windows 路径完好）与
 * 反斜杠反转义形式（POSIX `\"` 风格转义）。两者都要判定，因为反转义会把
 * `C:\tmp` 变成 `C:tmp` —— 丢掉 Windows 路径 —— 而保留反斜杠又会漏掉
 * `\/etc\/passwd`。过近似是安全方向。
 */
function tokenCandidates(token) {
    const quoteStripped = token.replace(/^["']+|["']+$/g, "");
    const unescaped = quoteStripped.replace(/\\(.)/g, "$1");
    return quoteStripped === unescaped ? [quoteStripped] : [quoteStripped, unescaped];
}

/**
 * 一条 bash/pwsh 命令行引用的全部路径，工作区内与外，按发现顺序（任务 T4 对
 * 全部判定敏感文件名）。
 */
export function shellEntries(command, root) {
    const found = [];
    if (typeof command !== "string" || command === "") return found;
    // 任务 T3：不做整条命令的 `$HOME` 拒绝 —— 家目录写法按 token 展开并按真实
    // 路径判定。单引号 token 是字面字符串（`echo '$HOME'` 打印文本，不引用路径）。
    for (const token of shellTokens(command)) {
        const literal = /^'.*'$/s.test(token);
        for (const candidate of tokenCandidates(token)) {
            // 反转义之后剥掉重定向前缀（"2>"、"&>>"、">"、"<"）。
            const t = candidate.replace(/^(?:\d+[<>]|&>>?|[<>]+)/, "");
            if (t === "") continue;
            if (t === "/dev/null" || t.startsWith("/dev/null")) continue;
            if (!literal) {
                const expanded = expandHomeSpelling(t);
                if (expanded !== void 0) {
                    const outside = !lexicallyWithin(expanded, root);
                    found.push({
                        path: expanded,
                        what: "command",
                        outside, ...outside ? {reason: `command references the user home: \`${token}\``} : {}
                    });
                    if (outside) return found;
                    continue;
                }
            }
            if (HOME_PREFIX.test(t)) {
                // 无法解析的家目录写法（或 `~user`），或字面 `~` 词：
                // fail-safe，标为外部（决策 D3）。
                found.push({
                    path: t,
                    what: "command",
                    outside: true,
                    reason: `command references the user home: \`${token}\``
                });
                return found;
            }
            // 任务 T15：以正则/注释斜杠片段开头的 token（`//`、`/* comment`、`/\*`）
            // 是模式文本、不携带路径 —— 整个跳过（否则它的反转义孪生会把片段复活成
            // UNC 形态的串）。
            if (isRegexOrCommentSlash(t)) continue;
            if (isAbsoluteToken(t)) {
                const outside = !lexicallyWithin(t, root);
                found.push({
                    path: t,
                    what: "command",
                    outside, ...outside ? {reason: `command references a path outside the workspace: \`${token}\``} : {}
                });
                continue;
            }
            if (isEscapeToken(t)) {
                const outside = !lexicallyWithin(t, root);
                found.push({
                    path: t,
                    what: "command",
                    outside, ...outside ? {reason: `command escapes the workspace: \`${token}\``} : {}
                });
            }
            for (const match of t.matchAll(INTERIOR_PATH)) {
                const path = match[1];
                if (path === "/dev/null" || path.startsWith("/dev/null")) continue;
                // 内部的家目录写法同样展开；无法解析的保持 fail-safe。
                const expandedPath = expandHomeSpelling(path);
                if (expandedPath !== void 0) {
                    const outside = !lexicallyWithin(expandedPath, root);
                    found.push({
                        path: expandedPath,
                        what: "command",
                        outside, ...outside ? {reason: `command references the user home: \`${path}\``} : {}
                    });
                    continue;
                }
                if (HOME_PREFIX.test(path)) {
                    found.push({
                        path,
                        what: "command",
                        outside: true,
                        reason: `command references the user home: \`${path}\``
                    });
                    return found;
                }
                const outside = !lexicallyWithin(path, root);
                found.push({
                    path,
                    what: "command",
                    outside, ...outside ? {reason: `command references a path outside the workspace: \`${path}\``} : {}
                });
            }
        }
    }
    return found;
}

/** bash/pwsh 命令行的工作区外引用，按发现顺序。 */
export function shellTargets(command, root) {
    return shellEntries(command, root).filter((entry) => entry.outside);
}

/** bash/pwsh 命令行引用工作区外路径时返回原因，否则 undefined。 */
export function shellReason(command, root) {
    return shellTargets(command, root)[0]?.reason;
}

/** 当搜索 pattern 以任意受支持写法是绝对路径或逃逸时返回 true。正则/注释斜杠片段（任务 T15）是模式文本，不是路径。 */
export function isAbsoluteOrEscapingPattern(pattern) {
    if (isRegexOrCommentSlash(pattern)) return false;
    return pattern.startsWith("/") || HOME_PREFIX.test(pattern) || isAbsoluteToken(pattern) || isEscapeToken(pattern) || DOTDOT_SEGMENT.test(pattern);
}

/**
 * 一次工具调用引用的全部路径，工作区内与外，按发现顺序（任务 T4：敏感文件名
 * 对全部条目判定）。
 */
export function scanTargets(exec, root) {
    const args = exec.arguments ?? {};
    const pathArg = Object.hasOwn(PATH_TOOLS, exec.name) ? PATH_TOOLS[exec.name] : void 0;
    if (pathArg !== void 0) {
        const target = pathEntry(args[pathArg], root, `\`${exec.name}\` target`);
        return target === void 0 ? [] : [target];
    }
    if (SEARCH_TOOLS.has(exec.name)) {
        const found = [];
        if (args.path !== void 0) {
            const target = pathEntry(args.path, root, `\`${exec.name}\` search path`);
            if (target !== void 0) found.push(target);
        }
        if (typeof args.pattern === "string" && isAbsoluteOrEscapingPattern(args.pattern)) {
            found.push({
                path: args.pattern,
                what: `\`${exec.name}\` pattern`,
                outside: true,
                reason: `\`${exec.name}\` pattern is absolute or escapes the workspace: \`${args.pattern}\``
            });
        }
        return found;
    }
    if (SHELL_TOOLS.has(exec.name)) {
        const workdir = args.workdir !== void 0 ? pathEntry(args.workdir, root, `\`${exec.name}\` working directory`) : void 0;
        const commandTargets = shellEntries(args.command, root);
        return workdir === void 0 ? commandTargets : [workdir, ...commandTargets];
    }
    return [];
}

/**
 * 一次工具调用的全部工作区外引用，按发现顺序。
 * 门禁用它来决定 `always` 白名单还覆盖哪些目标。
 */
export function outsideTargets(exec, root) {
    return scanTargets(exec, root).filter((entry) => entry.outside);
}

/** 当上面的精确逐工具扫描器已覆盖该工具时返回 true。 */
export function isPreciselyScanned(name) {
    return Object.hasOwn(PATH_TOOLS, name) || SEARCH_TOOLS.has(name) || SHELL_TOOLS.has(name);
}

/** 任务 T8：以路径形态泛化判定的一个参数叶子节点。 */
function genericEntry(value, root, what) {
    const expanded = expandHomeSpelling(value);
    // 任务 T15：正则/注释斜杠片段是模式文本，不是路径。
    const shaped = !isRegexOrCommentSlash(value) && (expanded !== void 0 || isAbsoluteToken(value) || isEscapeToken(value) || HOME_PREFIX.test(value));
    // 只判定路径形态的值；普通文本永远不是目标。
    if (!shaped) return void 0;
    if (expanded !== void 0) {
        const outside = !lexicallyWithin(expanded, root);
        return {
            path: expanded,
            what,
            outside, ...outside ? {reason: `${what} references the user home: \`${value}\``} : {}
        };
    }
    const outside = HOME_PREFIX.test(value) ? true : !lexicallyWithin(value, root);
    return {path: value, what, outside, ...outside ? {reason: `${what} is outside the workspace: \`${value}\``} : {}};
}

/**
 * 任务 T8（可选启用，`Config.scanAllTools`）：对精确扫描器未覆盖的工具做保守扫描 ——
 * `arguments` 里每个看起来像路径的字符串叶子（绝对路径、`..` 逃逸、家目录写法；
 * 先做展开）都被判定并作为目标返回。普通文本与超过 4096 字符的值会被跳过，
 * 这样叙述性参数绝不会误报。
 */
export function genericTargets(exec, root) {
    const found = [];
    const seen = new Set();
    const visit = (value, key) => {
        if (typeof value === "string") {
            if (value.length === 0 || value.length > 4096 || seen.has(value)) return;
            seen.add(value);
            const entry = genericEntry(value, root, key === "" ? `\`${exec.name}\` argument` : `\`${exec.name}\` ${key}`);
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

/** 工具调用触碰工作区外任何东西时返回原因，否则 undefined。 */
export function outsideReason(exec, root) {
    return outsideTargets(exec, root)[0]?.reason;
}

/**
 * 白名单条目应对一次违规路径覆盖的目录：类文件目标取其父目录，本身读起来已是
 * 目录的（以 `/` 或 `\` 结尾）取路径本身。
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
 * DSH 自己生成的平台临时目标：平台临时根（`os.tmpdir()` —— Windows 上是 `%TEMP%`）
 * 下 basename 以 `dsh-` / `.dsh-` 开头的一级子目录，含整棵子树。这些是运行时自己的
 * 工作/溢出目录 —— `dsh-subprocess-*`（进程输出溢出文件）、`dsh-spill-*`（工具结果
 * 溢出）、`dsh-*`（沙箱运行器的私有 TEMP，它会把 `TMP`/`TEMP` 重写到这里）、
 * `dsh-shell-*`、`dsh-subprocess-launch-*`、`dsh-office-to-pdf-*`、`dsh-open-in-app-*`、
 * `dsh-native-command-*`、`dsh-workspace-changes-*`、`dsh-hmr-clock-*`、
 * `dsh-acl-skill-*` —— 这样跟随 `spillPath` 或展开 `%TEMP%` 的工具调用永远不需要
 * 弹窗。只有这类子目录内部的绝对写法才匹配：临时根本身、它的普通文件，以及别处
 * 同名目录都保持门禁。
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

/** 已编译 glob 缓存（pattern 实际上都是配置常量）。 */
const globCache = new Map();

/** 把一个 glob（`*` 任意串，`?` 单字符）编译为锚定的大小写不敏感 RegExp。 */
export function globToRegExp(pattern) {
    let compiled = globCache.get(pattern);
    if (compiled === void 0) {
        const source = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
        compiled = new RegExp(`^${source}$`, "i");
        globCache.set(pattern, compiled);
    }
    return compiled;
}

/** 任意分隔符写法下的路径 basename（没有则为 ""）。 */
function basenameOf(value) {
    const parts = String(value).split(/[\\/]/);
    return parts[parts.length - 1] ?? "";
}

/**
 * 任务 T4 的敏感文件维度：把路径的 basename 与 `patterns` 匹配，`allowPatterns`
 * （如 `*.env.example`）和已持久化的 `alwaysPatterns` 先行豁免。返回命中的 pattern
 * 与原因，文件不敏感时返回 `undefined`。判定独立于工作区边界 —— 敏感文件在
 * 工作区内也要询问。
 */
export function sensitiveMatch(value, config = {}) {
    if (typeof value !== "string" || value === "") return void 0;
    const name = basenameOf(value);
    if (name === "") return void 0;
    const matches = (list) => (Array.isArray(list) ? list : []).some((pattern) => globToRegExp(pattern).test(name));
    if (matches(config.allowPatterns)) return void 0;
    if (matches(config.alwaysPatterns)) return void 0;
    const hit = (Array.isArray(config.patterns) ? config.patterns : []).find((pattern) => globToRegExp(pattern).test(name));
    return hit === void 0 ? void 0 : {pattern: hit, reason: `sensitive file (matches \`${hit}\`): \`${value}\``};
}

/** 路径指向敏感文件时返回原因，否则 undefined（任务 T4）。 */
export function sensitiveReason(value, config = {}) {
    return sensitiveMatch(value, config)?.reason;
}

/**
 * 两种写法在词法上指向同一位置时返回 true（任务 T9 用它把工作区级白名单条目
 * 的 root 与会话 root 对比）。
 */
export function sameLocation(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a === "" || b === "") return false;
    return lexicallyWithin(a, b) && lexicallyWithin(b, a);
}

/**
 * 任务 T5 的 deny 列表 —— 优先级最高的裁决。以分隔符结尾的条目是目录前缀
 * （包含判定），其余是对完整路径的 glob（`*`/`?`，大小写不敏感）。两侧都先做
 * 家目录展开。返回第一条命中规则，或 `undefined`。
 */
export function denyMatch(value, denyList) {
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

/** 单路径参数命名目标的文件类工具（值 = 参数名）。 */
export const PATH_TOOLS = {read: "file_path", write: "file_path", edit: "file_path", read_image: "file_path"};
/** 可选 `path` 参数（以及绝对 `pattern`）必须留在内部的搜索类工具。 */
export const SEARCH_TOOLS = new Set(["glob", "grep"]);
/** 命令文本要扫逃逸路径的 shell 类工具。 */
export const SHELL_TOOLS = new Set(["bash", "pwsh"]);

/**
 * 一次工具调用在会话档位门禁（仅工作区内 / 工作区外只读 / 完全放开）下的访问类型：
 * 纯读取工具在 `outside-read` 放行，任何能改动目标的仍要询问。`read`/`read_image`/
 * `glob`/`grep` 是读；`write`/`edit` 是写；`bash`/`pwsh` 算写，尽管命令可能只是
 * 读 —— shell 命令无法靠词法区分，门禁保持保守。未知工具（如 `scanAllTools`
 * 的保守表面）同理按写处理。
 */
/** 被 {@link toolAccessKind} 判定为只读的工具。 */
const READ_KIND_TOOLS = new Set(["read", "read_image", "glob", "grep"]);

export function toolAccessKind(name) {
    return READ_KIND_TOOLS.has(name) ? "read" : "write";
}
