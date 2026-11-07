/**
 * Shell 语法分析层：把 bash / pwsh 命令文本切成带**角色标注**的词
 * （浅层结构，不是完整 AST）。这是门禁误判治理的地基：正则字面量
 * （`/^\//`）、注释碎片、模式参数位不再靠词法启发式硬猜，而是由
 * 引号/注释/重定向/命令边界的语法事实直接给出。
 *
 * 数据源（T35）：**web-tree-sitter 真语法树**为主 —— grammar 是
 * `@lumis-sh/wasm-bash` / `@lumis-sh/wasm-powershell` 的预编译 wasm，
 * 随包分发在 `vendor/`（插件安装不跑 install，wasm 必须随仓库走）。
 * 解析器未就绪、加载失败、解析抛错时**回落内置词法切词**（下方
 * `WordScanner`）——失败方向永远保守（fail-closed）：任何无法识别的
 * 结构都退化成普通 `arg` 词，由 `scanner.ts` 的既有词法判定继续按
 * 路径候选处理。本层只提供"确定的豁免"（正则/注释/模式位）与
 * "确定的角色"（重定向目标/赋值值），绝不引入新的放行方向。
 *
 * 纯函数面（classifyShape/isRegexShapedText/shapeSignature）与数据源
 * 解耦，`verify-scanner.ts`/`tests/` 的用例对两条数据源一视同仁。
 */
import {existsSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Language, Parser} from "web-tree-sitter";

/** 方言：DSH 的两个 shell 工具。 */
export type ShellDialect = "bash" | "pwsh";

/** 词在命令结构中的角色。 */
export type WordRole =
    /** 命令名（每段第一个词）。 */
    | "command"
    /** 普通参数（默认，最保守）。 */
    | "arg"
    /** 重定向目标（`> x`、`2>> y`）——必然是路径。 */
    | "redirect-target"
    /** 赋值值（`FOO=/etc/x` 的整词形态，T7）。 */
    | "assign-value"
    /** 模式参数位（grep 的 PATTERN、sed 脚本、`-Pattern` 值……）——正则/模式文本。 */
    | "pattern-arg"
    /** 注释（`# ...`、`<# ... #>`）——不携带路径。 */
    | "comment";

/** 词自身的形态分类（豁免判据）。 */
export type WordShape =
    /** 正则字面量：`/` 定界 + 锚点/转义/空格特征（`/^\//`、`/^\d+$/`）。 */
    | "regex-literal"
    /** 松正则形态：`/foo/`——与目录写法词法不可分，默认不豁免、可学习开启。 */
    | "regex-literal-loose"
    /** 正则/注释斜杠碎片（T15 的 `//`、`/\*`、`/*` 语义）。 */
    | "comment-slash";

/** 一个词：原始切片、去引号/反转义后的字面值、引号形态、角色与形态。 */
export interface ShellWord {
    /** 命令文本里的原始切片（含引号与重定向前缀）。 */
    readonly raw: string;
    /** 去引号、反转义后的字面内容（判定的主要输入）。 */
    readonly value: string;
    /** 主引号形态：单引号是字面量（不展开 `$HOME`）。 */
    readonly quote: "none" | "single" | "double";
    /** 命令结构角色。 */
    readonly role: WordRole;
    /** 形态分类（正则/注释碎片豁免的判据）。 */
    readonly shape?: WordShape | undefined;
}

/**
 * 硬路径特征：无论角色/形态如何都**永不豁免**的安全底线——
 * 盘符、UNC、`//server/share` 斜杠写法、家目录写法、`..` 逃逸。
 */
export function hasHardPathShape(value: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(value)
        || value.startsWith("\\\\")
        || /^\/\/[A-Za-z0-9.~_-]+[\\/]/.test(value)
        || value.startsWith("~")
        || /\.\.[\\/]/.test(value)
        || value === ".."
        || value.includes(":\\");
}

/**
 * 正则/模式形态的文本：以 `/` 开头 + 判别特征（锚点、转义、量词、空格、
 * 花括号）——正则字面量与其片段（`/^\//`、`/^\s+,`、`awk '/^\// {print}'`
 * 的程序体）都是模式文本，不是文件访问面。硬路径特征永不归入。
 * 例外：空白分段里出现**裸绝对路径**（`/etc/y`，无判别特征、多段、非
 * `/…/` 定界）说明模式体里嵌着真实路径形态 —— 不豁免，保守上报。
 */
export function isRegexShapedText(value: string): boolean {
    if (!value.startsWith("/") || hasHardPathShape(value)) return false;
    for (const segment of value.split(/\s+/)) {
        if (!segment.startsWith("/")) continue;
        if (/[\^$\\{}\s]/.test(segment)) continue;
        if (segment.endsWith("/")) continue;
        if (segment.slice(1).includes("/")) return false;
    }
    return /[\^$\\{}\s]/.test(value);
}

/**
 * 形态分类：正则定界形态与 T15 的正则/注释碎片。判定词自身形态，
 * 不看命令上下文（那是 `pattern-arg` 的事）。硬路径特征永不归入豁免形态。
 */
export function classifyShape(value: string): WordShape | undefined {
    if (value === "" || hasHardPathShape(value)) return void 0;
    // T15 语义：`/\*`、`//`（非 UNC）、`/*`（非根 glob）是模式/注释碎片。
    if (value[0] === "/") {
        const second = value[1];
        if (second === "\\") return "comment-slash";
        if (second === "/") return "comment-slash";
        if (second === "*" && value.length >= 3 && !/[A-Za-z0-9.~_]/.test(value[2])) return "comment-slash";
    }
    // 正则字面量：`/` 开头 + `/` 或 `/[a-z]+`（flag）结尾，且含锚点/
    // 转义/空格之一（判别特征）。内容是模式文本，不是文件访问面。
    // loose 只认**以 `/` 结尾**的形态（`/foo/`）——带 flag 的无特征形态
    // 不收（`/etc/x` 的末段会被误当 flag，那是多段路径）。
    if (value.length >= 3 && value[0] === "/") {
        const close = value.lastIndexOf("/");
        if (close > 0) {
            const body = value.slice(1, close);
            const flags = value.slice(close + 1);
            // body 里的 `\/` 是转义斜杠，不是路径分段。
            const unescapedBody = body.replace(/\\\//g, "");
            if (/^[a-z]{0,3}$/i.test(flags) && body !== "" && !unescapedBody.includes("/")) {
                if (/[\^$\\]|\s/.test(body)) return "regex-literal";
                if (flags === "") return "regex-literal-loose";
            }
        }
    }
    return void 0;
}

/** pwsh 的模式参数名（其后的词是模式文本）。 */
const PWSH_PATTERN_PARAMS: ReadonlySet<string> = new Set([
    "pattern", "match", "notmatch", "include", "exclude", "filter", "scriptblock", "searchstring"
]);

/** bash 侧"第一个裸词是模式"的命令（grep/sed/awk 族）。 */
const BASH_PATTERN_COMMANDS: ReadonlySet<string> = new Set([
    "grep", "egrep", "fgrep", "rg", "ag", "ack", "sed", "awk", "findstr", "perl", "look", "sngrep"
]);

/** 命令名归一化：`/usr/bin/grep` —— 只取 basename（保守）。 */
function commandBasename(name: string): string {
    const parts = name.split(/[\\/]/);
    return parts[parts.length - 1] ?? name;
}

/**
 * 形态签名（学习层的归纳键，`learn.ts` 消费）：`工具|角色|形态|引号` ——
 * 判别维度全部保留、绝不泛化到裸 token。签名级豁免只压掉误报形态的
 * outside 询问，deny/敏感/硬路径照常。
 */
export function shapeSignature(input: {tool: string; role: string; shape: string | null | undefined; quote: string}): string {
    return `${input.tool}|${input.role}|${input.shape ?? "plain"}|${input.quote}`;
}

// ============================ tree-sitter 数据源 ============================

/** `web-tree-sitter` 语法树节点的最小形状（按用到的面收窄）。 */
interface TreeNode {
    readonly type: string;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly namedChildren: readonly TreeNode[];
    readonly children: readonly TreeNode[];
    childForFieldName(name: string): TreeNode | null;
    fieldNameForChild(index: number): string | null;
}

interface ParserInstance {
    setLanguage(language: unknown): void;
    parse(source: string): {rootNode: TreeNode};
}

interface LoadedParsers {
    bash: ParserInstance;
    pwsh: ParserInstance;
}

let parserPromise: Promise<LoadedParsers | undefined> | undefined;
let parsers: LoadedParsers | undefined;

/**
 * 定位 `vendor/`（wasm 随包分发）：源码直跑（`src/host/`）与产物
 * （`lib/`）两种布局都找，向上最多四级。
 */
function vendoredWasmDir(): string | undefined {
    let dir = fileURLToPath(new URL(".", import.meta.url));
    for (let depth = 0; depth < 4; depth += 1) {
        if (existsSync(join(dir, "vendor", "tree-sitter-bash.wasm"))) return join(dir, "vendor");
        const parent = join(dir, "..");
        if (parent === dir) break;
        dir = parent;
    }
    return void 0;
}

/**
 * 初始化解析器（幂等；失败返回 undefined = 走词法回落）。`index.ts`
 * 在插件装配时预热，扫描热路径同步读 {@link parsers}。
 */
export function initSyntaxParsers(): Promise<LoadedParsers | undefined> {
    if (parserPromise === void 0) {
        parserPromise = (async () => {
            try {
                const vendor = vendoredWasmDir();
                if (vendor === void 0) return void 0;
                await Parser.init({locateFile: () => join(vendor, "web-tree-sitter.wasm")});
                const [bashLang, pwshLang] = await Promise.all([
                    Language.load(join(vendor, "tree-sitter-bash.wasm")),
                    Language.load(join(vendor, "tree-sitter-powershell.wasm"))
                ]);
                const bash = new Parser() as unknown as ParserInstance;
                bash.setLanguage(bashLang);
                const pwsh = new Parser() as unknown as ParserInstance;
                pwsh.setLanguage(pwshLang);
                parsers = {bash, pwsh};
                return parsers;
            } catch {
                // 加载失败 = 永久走词法回落（保守方向）。
                return void 0;
            }
        })();
    }
    return parserPromise;
}

/** 去引号 + 反转义（与词法回落的 value 语义对齐）。 */
function unquoteValue(raw: string, dialect: ShellDialect): string {
    const stripped = raw.replace(/^["']+|["']+$/g, "");
    if (dialect === "pwsh") {
        return stripped.replace(/""/g, "\"").replace(/`(.)/g, "$1");
    }
    return stripped.replace(/\\(.)/g, "$1");
}

/** 引号形态：单引号字面量优先。 */
function quoteOf(raw: string): ShellWord["quote"] {
    if (raw.startsWith("'")) return "single";
    if (raw.startsWith("\"")) return "double";
    return "none";
}

/** 按树节点组装一个词（raw=源切片，value=去引号反转义）。 */
function wordFrom(source: string, node: TreeNode, role: WordRole, dialect: ShellDialect): ShellWord {
    const raw = source.slice(node.startIndex, node.endIndex);
    const value = unquoteValue(raw, dialect);
    const shape = role === "comment" ? void 0 : classifyShape(value) ?? classifyShape(raw);
    return {raw, value, quote: quoteOf(raw), role, ...shape !== void 0 ? {shape} : {}};
}

/** bash 的 argument 角色状态（模式位/选项值吞掉）。 */
interface BashArgState {
    commandName: string;
    bareIndex: number;
    pendingOptionValue: boolean;
}

function bashArgumentRole(text: string, state: BashArgState): WordRole {
    if (text.startsWith("-")) {
        if (/^--?[A-Za-z0-9][-A-Za-z0-9]*$/.test(text)) state.pendingOptionValue = true;
        return "arg";
    }
    if (state.pendingOptionValue) {
        state.pendingOptionValue = false;
        return "arg";
    }
    if (state.bareIndex === 0 && state.commandName !== "" && BASH_PATTERN_COMMANDS.has(commandBasename(state.commandName))) {
        state.bareIndex += 1;
        return "pattern-arg";
    }
    state.bareIndex += 1;
    return "arg";
}

/** 从 bash 语法树提取词（字段驱动：name/argument/destination/整词赋值）。 */
function bashWords(root: TreeNode, source: string): ShellWord[] {
    const out: ShellWord[] = [];
    const state: BashArgState = {commandName: "", bareIndex: 0, pendingOptionValue: false};
    const visit = (node: TreeNode): void => {
        if (node.type === "comment") {
            out.push(wordFrom(source, node, "comment", "bash"));
            return;
        }
        if (node.type === "file_redirect") {
            const destination = node.childForFieldName("destination");
            if (destination !== null) out.push(wordFrom(source, destination, "redirect-target", "bash"));
            return;
        }
        if (node.type === "variable_assignment") {
            // 整词（`FOO=/etc/x`）与词法回落同形；INTERIOR 仍扫 `=` 值侧。
            out.push(wordFrom(source, node, "assign-value", "bash"));
            return;
        }
        if (node.type === "command") {
            state.commandName = "";
            state.bareIndex = 0;
            state.pendingOptionValue = false;
            const children = node.children;
            for (let index = 0; index < children.length; index += 1) {
                const child = children[index];
                const field = node.fieldNameForChild(index);
                if (field === "name") {
                    const word = wordFrom(source, child, "command", "bash");
                    state.commandName = word.value;
                    out.push(word);
                } else if (field === "argument") {
                    const role = bashArgumentRole(source.slice(child.startIndex, child.endIndex), state);
                    out.push(wordFrom(source, child, role, "bash"));
                }
            }
            // command 内部的赋值前缀等仍递归（变量赋值在 children 里）。
            for (const child of node.namedChildren) {
                if (child.type === "variable_assignment") visit(child);
            }
            return;
        }
        for (const child of node.namedChildren) visit(child);
    };
    visit(root);
    out.sort((a, b) => a.raw.length - b.raw.length || 0);
    // 按源位置稳定排序（visit 顺序已近似有序，这里按 raw 首次出现位兜底）。
    return out.sort((a, b) => source.indexOf(a.raw) - source.indexOf(b.raw));
}

/** 从 pwsh 语法树提取词（command_name/command_parameter/command_elements）。 */
function pwshWords(root: TreeNode, source: string): ShellWord[] {
    const out: ShellWord[] = [];
    const visit = (node: TreeNode): void => {
        if (node.type === "comment") {
            out.push(wordFrom(source, node, "comment", "pwsh"));
            return;
        }
        if (node.type === "command") {
            const name = node.childForFieldName("command_name");
            if (name !== null) out.push(wordFrom(source, name, "command", "pwsh"));
            const elements = node.childForFieldName("command_elements");
            if (elements !== null) {
                let lastParam = "";
                for (const child of elements.namedChildren) {
                    if (child.type === "command_parameter") {
                        const match = /^[-/]([A-Za-z][A-Za-z0-9]*)/.exec(source.slice(child.startIndex, child.endIndex));
                        lastParam = match === null ? "" : match[1].toLowerCase();
                        out.push(wordFrom(source, child, "arg", "pwsh"));
                        continue;
                    }
                    if (child.type === "command_argument_sep") continue;
                    const role = PWSH_PATTERN_PARAMS.has(lastParam) ? "pattern-arg" : "arg";
                    lastParam = "";
                    out.push(wordFrom(source, child, role, "pwsh"));
                }
            }
            return;
        }
        for (const child of node.namedChildren) visit(child);
    };
    visit(root);
    return out.sort((a, b) => source.indexOf(a.raw) - source.indexOf(b.raw));
}

/** tree-sitter 路径：解析失败抛错，由 {@link parseShellWords} 回落词法。 */
function astWords(command: string, dialect: ShellDialect): ShellWord[] {
    const ready = parsers;
    if (ready === void 0) throw new Error("tree-sitter parsers are not ready");
    const tree = (dialect === "pwsh" ? ready.pwsh : ready.bash).parse(command);
    return dialect === "pwsh" ? pwshWords(tree.rootNode, command) : bashWords(tree.rootNode, command);
}

// ============================ 词法回落数据源 ============================

/** bash 的控制操作符（命令边界）。 */
const BASH_CONTROL = ["||", "&&", ";;", "|", ";", "&", "(", ")"];

/**
 * 词法切分的游标状态机（tree-sitter 未就绪/失败时的回落）。引号/转义/
 * 注释/操作符在此一次性处理，角色按"命令边界 → 重定向 → 赋值 →
 * 模式位 → arg"的顺序判定。
 */
class WordScanner {
    private readonly source: string;
    private readonly dialect: ShellDialect;
    private index = 0;
    private expectCommand = true;
    private expectRedirect = false;
    private lastParam = "";
    private bareIndex = 0;
    /** 当前命令段的命令名（模式位判定用）。 */
    private commandName = "";
    /** bash：上一个词是不带值选项时的空值吞掉位（保守：其后一词按 arg）。 */
    private pendingOptionValue = false;

    constructor(source: string, dialect: ShellDialect) {
        this.source = source;
        this.dialect = dialect;
    }

    /** 扫描全部词（注释也作为词输出，由调用方丢弃）。 */
    scan(): ShellWord[] {
        const words: ShellWord[] = [];
        for (let guard = 0; guard < 100_000; guard += 1) {
            this.skipSpace();
            if (this.index >= this.source.length) break;
            const word = this.next();
            if (word === void 0) break;
            words.push(word);
        }
        return words;
    }

    private skipSpace(): void {
        while (this.index < this.source.length && /\s/.test(this.source[this.index])) this.index += 1;
    }

    private next(): ShellWord | undefined {
        const start = this.index;
        const char = this.source[this.index];
        // 注释：词首的 `#`（bash/pwsh 行注释）与 pwsh 块注释。
        if (char === "#") {
            while (this.index < this.source.length && this.source[this.index] !== "\n") this.index += 1;
            return this.finish(this.source.slice(start, this.index), this.source.slice(start, this.index), "none", "comment");
        }
        if (char === "<" && this.dialect === "pwsh" && this.source[this.index + 1] === "#") {
            this.index += 2;
            const close = this.source.indexOf("#>", this.index);
            this.index = close < 0 ? this.source.length : close + 2;
            return this.finish(this.source.slice(start, this.index), this.source.slice(start, this.index), "none", "comment");
        }
        // pwsh here-string：`@'` / `@"` 行尾开始，到行首 `'@` / `"@`。
        if (char === "@" && this.dialect === "pwsh" && (this.source[this.index + 1] === "'" || this.source[this.index + 1] === "\"")) {
            const quote = this.source[this.index + 1];
            this.index += 2;
            if (this.source[this.index] === "\r") this.index += 1;
            if (this.source[this.index] === "\n") this.index += 1;
            const closer = `\n${quote}@`;
            const close = this.source.indexOf(closer, this.index);
            const end = close < 0 ? this.source.length : close + closer.length;
            const raw = this.source.slice(start, end);
            this.index = end;
            return this.finish(raw, raw.slice(raw.indexOf("\n") + 1, close < 0 ? raw.length : close), quote === "'" ? "single" : "double", "arg");
        }
        // 重定向操作符（可带数字前缀、`&` 前缀）：其后的词是路径。
        const redirect = this.matchRedirect();
        if (redirect !== void 0) {
            this.expectRedirect = true;
            this.expectCommand = true;
            return this.finish(redirect, redirect, "none", "arg");
        }
        // 控制操作符：命令边界。
        for (const op of this.dialect === "bash" ? BASH_CONTROL : ["|", ";", "&"]) {
            if (this.source.startsWith(op, this.index)) {
                this.index += op.length;
                this.expectCommand = true;
                this.bareIndex = 0;
                return this.finish(op, op, "none", "arg");
            }
        }
        return this.readWord();
    }

    /** 匹配 `2>`、`&>>`、`>>`、`>`、`<`、`<<` 等重定向形态。 */
    private matchRedirect(): string | undefined {
        const rest = this.source.slice(this.index);
        const match = /^(?:\d+[<>]|&>>?|[<>]{1,2}|<<-?)/.exec(rest);
        if (match === null) return void 0;
        this.index += match[0].length;
        return match[0];
    }

    /** 读一个词：处理引号与转义，产出 raw/value 双面。 */
    private readWord(): ShellWord | undefined {
        const start = this.index;
        let value = "";
        let quote: ShellWord["quote"] = "none";
        while (this.index < this.source.length) {
            const char = this.source[this.index];
            if (/\s/.test(char)) break;
            if (char === "'" && this.dialect === "bash") {
                quote = "single";
                this.index += 1;
                const close = this.source.indexOf("'", this.index);
                const end = close < 0 ? this.source.length : close;
                value += this.source.slice(this.index, end);
                this.index = close < 0 ? this.source.length : close + 1;
                continue;
            }
            if (char === "'" && this.dialect === "pwsh") {
                quote = "single";
                this.index += 1;
                for (; this.index < this.source.length; this.index += 1) {
                    if (this.source[this.index] === "'") {
                        if (this.source[this.index + 1] === "'") {
                            value += "'";
                            this.index += 1;
                            continue;
                        }
                        this.index += 1;
                        break;
                    }
                    value += this.source[this.index];
                }
                continue;
            }
            if (char === "\"") {
                quote = quote === "single" ? quote : "double";
                this.index += 1;
                for (; this.index < this.source.length; this.index += 1) {
                    const inner = this.source[this.index];
                    if (inner === "\"" && this.dialect === "pwsh" && this.source[this.index + 1] === "\"") {
                        value += "\"";
                        this.index += 1;
                        continue;
                    }
                    if (inner === "\"") {
                        this.index += 1;
                        break;
                    }
                    if (inner === "\\" && this.dialect === "bash" && this.index + 1 < this.source.length) {
                        // bash 双引号内仅 `\$`、`` ` ``、`\"`、`\\`、换行是转义；
                        // 其余反斜杠保留（Windows 路径完好）。
                        const escaped = this.source[this.index + 1];
                        if (escaped === "$" || escaped === "`" || escaped === "\"" || escaped === "\\") {
                            value += escaped;
                            this.index += 2;
                            continue;
                        }
                        if (escaped === "\n") {
                            this.index += 2;
                            continue;
                        }
                    }
                    if (inner === "`" && this.dialect === "pwsh" && this.index + 1 < this.source.length) {
                        value += this.source[this.index + 1];
                        this.index += 2;
                        continue;
                    }
                    value += inner;
                }
                continue;
            }
            if (char === "\\" && this.index + 1 < this.source.length) {
                value += this.source[this.index + 1];
                this.index += 2;
                continue;
            }
            if (char === "`" && this.dialect === "pwsh" && this.index + 1 < this.source.length) {
                value += this.source[this.index + 1];
                this.index += 2;
                continue;
            }
            // 操作符字符结束当前词（`$(cmd)`、`a;b` 的边界）。
            if (this.dialect === "bash" && (char === "(" || char === ")")) break;
            if (this.dialect === "bash" && (char === "|" || char === ";" || char === "&")) break;
            if (this.dialect === "pwsh" && (char === "|" || char === ";")) break;
            value += char;
            this.index += 1;
        }
        const raw = this.source.slice(start, this.index);
        return this.finish(raw, value, quote, this.classifyRole(raw, value));
    }

    /** 角色判定：命令边界 → 重定向 → 赋值 → 模式位 → arg。 */
    private classifyRole(raw: string, value: string): WordRole {
        if (this.expectRedirect) {
            this.expectRedirect = false;
            this.expectCommand = true;
            return "redirect-target";
        }
        // T7：赋值形态（`FOO=/etc/x` 的值侧由 INTERIOR 扫，整词仍按保守路径
        // 候选处理）。bash 的赋值前缀不消费命令位（`FOO=x cmd` 命令是 `cmd`）。
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) return "assign-value";
        const isCommand = this.expectCommand;
        this.expectCommand = false;
        if (isCommand) {
            this.bareIndex = 0;
            this.lastParam = "";
            return "command";
        }
        // pwsh：`-Pattern` 等参数名之后的词是模式文本。
        if (this.dialect === "pwsh") {
            const param = /^[-/]([A-Za-z][A-Za-z0-9]*)(?::|$)/.exec(value);
            if (param !== null) {
                this.lastParam = param[1].toLowerCase();
                return "arg";
            }
            if (this.lastParam !== "" && PWSH_PATTERN_PARAMS.has(this.lastParam)) {
                this.lastParam = "";
                return "pattern-arg";
            }
            this.lastParam = "";
        }
        // bash：已知模式命令的第一个裸词（跳过 `-x`、`--opt` 与其值）。
        if (this.dialect === "bash") {
            if (value.startsWith("-")) {
                if (/^--?[A-Za-z0-9][-A-Za-z0-9]*$/.test(value)) {
                    this.pendingOptionValue = true;
                }
                return "arg";
            }
            if (this.pendingOptionValue) {
                this.pendingOptionValue = false;
                return "arg";
            }
            const command = this.commandName;
            if (this.bareIndex === 0 && command !== "" && BASH_PATTERN_COMMANDS.has(commandBasename(command))) {
                this.bareIndex += 1;
                return "pattern-arg";
            }
            this.bareIndex += 1;
        }
        return "arg";
    }

    /** 包装成词并维护命令名游标。 */
    private finish(raw: string, value: string, quote: ShellWord["quote"], role: WordRole): ShellWord {
        if (role === "command") {
            this.commandName = value;
            this.pendingOptionValue = false;
        }
        const shape = role === "comment" ? void 0 : classifyShape(value);
        return {
            raw,
            value,
            quote,
            role,
            ...shape !== void 0 ? {shape} : {}
        };
    }
}

/**
 * 把一条 bash/pwsh 命令切成带角色标注的词。**tree-sitter 语法树优先**，
 * 词法回落兜底；两条数据源都永不抛错、永不返回不完整信息 ——
 * 无法识别的结构按普通词输出（保守方向）。
 */
export function parseShellWords(command: string, dialect: ShellDialect = "bash"): ShellWord[] {
    if (typeof command !== "string" || command === "") return [];
    try {
        return astWords(command, dialect);
    } catch {
        return new WordScanner(command, dialect).scan();
    }
}
