/**
 * LLM 自动整理学习数据（T39）：把审批事件/学习统计交给大语言模型归并成语义
 * 等价组（`llm_group_rules`），让"同一意图的命令变体"共享真实样本、加速
 * L2 自动通过的收敛。
 *
 * 安全边界（LLM **只整理、不裁决**）：
 * - LLM 输出只信 **matcher**（tool/命令名/目录三段 glob 字符串）；一切
 *   计数（组的 sample/allow/deny）由服务端从 `learned_policies` 的 K1
 *   精确样本**实算**——LLM 虚报数字无法抬高置信（防"LLM 说 allow=100"
 *   式的自我强化）；
 * - 输出严格校验（glob 字符集/长度/组数上限），任何失败整体弃用、记审计
 *   （fail-safe）；组 matcher 不触碰 L1 形态层与方向锁；
 * - 组 `deny_count>0` 一票否决整组（deny 传染——被拒过的命令变体不能被
 *   归并救回来）；
 * - 隐私面：发往模型的内容只有**工具/命令名/目录/判决**四类标签值，不含
 *   命令参数与命中 token；
 * - LLM 失败/超时/无模型一律不阻塞门禁（门禁 fail-closed 从不依赖它）。
 *
 * 触发：防抖检查（`tick`，距上次≥24h 且有新审批事件、或新事件≥20 条）+
 * 设置页手动（Remote `runLlmTidy`）；均尊重 `llmAssist` 开关。
 */
import {createHash} from "node:crypto";
import {uuidv7} from "./uuid.ts";
import type {GroupMatcher, LearnDb, LearnedPolicy, LlmGroupRule} from "./learn-db.ts";
import {matchesGroupRule} from "./learn.ts";

/** 模型引用（`agentDefaultModel.currentSelection()` 的最小形状）。 */
export interface ModelRef {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffortId?: string;
}

/**
 * LLM 调用面（index 装配时注入；host 侧由 `ctx.llm.prepareCall`/`stream`
 * 适配成 Promise<string>）。返回模型文本输出；抛错/超时由调用方兜。
 */
export type AskModelFn = (model: ModelRef, system: string, user: string, signal: AbortSignal) => Promise<string>;

/** 整理服务的配置读取面（`Config` 字段，index 装配时注入）。 */
export interface TidyOptions {
    /** `Config.llmAssist`：LLM 整理总开关（自动与手动都尊重）。 */
    readonly assist: () => boolean;
    /** `Config.llmModel`：`"auto"`（跟随当前模型）或 `"provider::model"`。 */
    readonly model: () => string;
    /** `Config.llmReasoningEffort`：`"default"` 或 effort id。 */
    readonly reasoningEffort: () => string;
}

/** 整理服务的依赖（存储、LLM、默认模型解析、产物落库回调）。 */
export interface TidyDeps {
    /**
     * 学习库的**取值函数**（不是库对象本身）。`learnService.db` 在
     * `openLearnDb` resolve 之前一直是 `UNAVAILABLE` 快照——装配时把对象拷进来
     * 会让整理服务永远看到 `available: false`（「立即整理」恒定
     * `failed — db unavailable` 的根因）。每次用时取当前值。
     */
    readonly db: () => LearnDb;
    /** 学习库首次打开完成的信号（等待后就绪，失败也是 resolve）。 */
    readonly ready?: Promise<void>;
    /** 等就绪的上限（毫秒；缺省 {@link TIDY_READY_WAIT_MS}）。测试用来缩短等待。 */
    readonly readyWaitMs?: number;
    readonly askModel: AskModelFn;
    /** `ctx.agentDefaultModel.currentSelection()` 适配（`"auto"` 路由）。 */
    readonly resolveDefaultModel: () => ModelRef | undefined;
    /** 产物落库后回调（学习服务 `reload()` 刷新缓存）。 */
    readonly onApplied?: () => void;
}

/** 一轮整理的结果（Remote `runLlmTidy` 返回值）。 */
export interface TidyRunSummary {
    /** `ok`（产物落库）/ `failed`（模型/输出/落库失败）/ `skipped`（开关关）。 */
    readonly status: "ok" | "failed" | "skipped";
    readonly model: string;
    readonly appliedCount: number;
    readonly detail: string;
}

/** 整理服务（index 装配；定时器由装配层持有）。 */
export interface LlmTidyService {
    /** 防抖检查：达到触发条件才跑一轮（定时器每 tick 调；幂等、防重入）。 */
    tick(): void;
    /** 手动跑一轮（设置页按钮；同样尊重开关）。 */
    run(): Promise<TidyRunSummary>;
}

/** 触发阈值（T39 计划定值）：新审批事件 ≥20 条，或距上次 ≥24h 且有新事件。 */
const TIDY_MIN_NEW_EVENTS = 20;
const TIDY_INTERVAL_MS = 86_400_000;
/** 一次整理发给模型的事件上限（隐私面与上下文双控）。 */
const TIDY_EVENT_LIMIT = 200;
/** LLM 调用超时（fail-safe：超时弃用，绝不拖住门禁/定时器）。 */
const TIDY_CALL_TIMEOUT_MS = 60_000;
/** 等学习库首次打开的上限（迁移 + 建连接的正常耗时远小于此）。 */
const TIDY_READY_WAIT_MS = 10_000;
/** 校验上限：组数与各段 glob 长度（LLM 输出是不可信输入）。 */
const TIDY_MAX_GROUPS = 50;
const TIDY_MAX_PATTERN = 256;

/** glob 段合法性：只允许可见字符与 `*`/`?` 通配（防控制字符/换行注入）。 */
function isSafePattern(value: string): boolean {
    return value.length <= TIDY_MAX_PATTERN && /^[\x20-\x7E]*$/.test(value);
}

/** 纯通配段（含空串）：该维度不设任何约束，等于放弃维度。 */
function isPureWildcard(value: string): boolean {
    return /^[\s*?]*$/.test(value);
}

/**
 * 解析并严格校验 LLM 输出。只提取 `groups[].{tool,command,dir}` 三段
 * glob；数字/计数字段**一律无视**（服务端实算）。
 *
 * 两级处理（T45）——旧实现只管字符集，于是「19 组 dir 全是 `*`」照样落库：
 * - **整轮弃用**（返回 undefined）：JSON 非法 / 非对象 / `groups` 非数组 /
 *   空数组 / 超过 {@link TIDY_MAX_GROUPS}——结构性错误视为模型没按格式答。
 * - **逐组丢弃**（计入 `dropped`）：单条非对象、段超长或含不可见字符、
 *   `tool`/`dir` 为空或纯通配（跨工具/跨目录的规则等于放弃维度，且会把
 *   互不相关的 deny 传染到一起）、`command` 为纯通配。
 *
 * `dir` 是安全关键维度：**必须有具体值**。非 shell 工具的 `command` 允许为空
 * （那是「该工具没有命令名」的合法维度缺失）。
 */
export interface TidyParseResult {
    readonly matchers: GroupMatcher[];
    /** 被逐组丢弃的条数（审计用：模型输出质量的可观测面）。 */
    readonly dropped: number;
}

export function parseTidyOutput(text: string): TidyParseResult | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return void 0;
    }
    if (typeof parsed !== "object" || parsed === null) return void 0;
    const groups = (parsed as {groups?: unknown}).groups;
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > TIDY_MAX_GROUPS) return void 0;
    const matchers: GroupMatcher[] = [];
    let dropped = 0;
    for (const entry of groups) {
        if (typeof entry !== "object" || entry === null) {
            dropped += 1;
            continue;
        }
        const raw = entry as Record<string, unknown>;
        const tool = (typeof raw.tool === "string" ? raw.tool : "").trim();
        const command = (typeof raw.command === "string" ? raw.command : "").trim();
        const dir = (typeof raw.dir === "string" ? raw.dir : "").trim();
        if (!isSafePattern(tool) || !isSafePattern(command) || !isSafePattern(dir)) {
            dropped += 1;
            continue;
        }
        // 三段全空=匹配一切，是废规则（而且会把所有 deny 传染到一起）。
        if (tool === "" && command === "" && dir === "") {
            dropped += 1;
            continue;
        }
        // tool 与 dir 必须具体：纯通配的组会把不相关的工具/目录并成一类。
        if (tool === "" || isPureWildcard(tool)) {
            dropped += 1;
            continue;
        }
        if (dir === "" || isPureWildcard(dir)) {
            dropped += 1;
            continue;
        }
        if (isPureWildcard(command)) {
            dropped += 1;
            continue;
        }
        matchers.push({tool, command, dir});
    }
    return {matchers, dropped};
}

/** 审批事件的隐私最小化投影：只保留工具/命令名/目录/判决四类标签值。 */
export interface TidySample {
    readonly tool: string;
    readonly commandName: string;
    readonly dir: string;
    readonly verdict: string;
}

/** pwsh 语句关键字：脚本首词命中这些说明首词不是命令名。 */
const SCRIPT_KEYWORDS: ReadonlySet<string> = new Set([
    "if", "elseif", "else", "foreach", "for", "while", "do", "switch", "try", "catch",
    "finally", "function", "filter", "param", "return", "throw", "begin", "process",
    "end", "trap", "class", "enum", "using", "break", "continue"
]);

/**
 * 命令名近似（**仅历史数据的回落**）：T45 起 `approval_events.command_name`
 * 落库时就用 K1 同源值（五段形态签名第 2 段），只有迁移前的历史行为 NULL
 * 才需要这里推断。
 *
 * 旧实现直接取命令全文首词，pwsh 脚本于是被截成 `$javap`、`&`、`[xml]$s`、
 * `$env:MYSQL_PWD='hello123!';` 这类碎片，模型据此归纳出的组规则与真实特征键
 * 永远对不上。现在遇到碎片**返回空串**（不可知）——空命令名在 matcher 里
 * 是合法的维度缺失，比一个错的命令名安全得多。
 */
export function commandNameOf(command: string): string {
    const trimmed = command.trim();
    if (trimmed === "") return "";
    const space = trimmed.search(/\s/);
    const head = space < 0 ? trimmed : trimmed.slice(0, space);
    // 变量/子表达式/调用运算符/类型转换/脚本块：首词不是命令名。
    if (/^[$&\[({@#]/.test(head)) return "";
    // 赋值语句（`$env:X='v';`、`FOO=bar`）。
    if (head.includes("=")) return "";
    // 只允许可执行文件名/相对路径的字符集（含 `\` `/` `:` `.` `-` `_`）。
    if (!/^[A-Za-z0-9_./\\:-]+$/.test(head)) return "";
    if (SCRIPT_KEYWORDS.has(head.toLowerCase())) return "";
    return head.toLowerCase();
}

/**
 * 目录合法性（T45）：`approval_events.dir` 由**扫描器**的命中目标算出，而
 * 扫描器为了 fail-closed 会把模式串/正则片段也当路径候选（`\\target\\`、
 * `/fire/|"/law/|fire/api/v1|law/api/v1`）。这些值一旦进了 prompt，模型就会
 * 拿它当"目录"归纳，组规则从源头就被污染。这里按形态判定：必须是绝对路径
 * （盘符 / UNC / POSIX 绝对 / 家目录），且不含通配符与引号竖线等模式串特征。
 */
export function looksLikeDir(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.length > TIDY_MAX_PATTERN) return false;
    // 模式串/命令片段特征：通配符、引号、竖线、管道、换行（`dir` 是单一路径）。
    if (/[*?"'|&<>\r\n\t]/.test(trimmed)) return false;
    // 盘符绝对路径：`C:\` / `C:/`
    if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
    // UNC：`\\server\share`（结尾的双反斜杠是转义残留、不是真 UNC）。
    if (/^\\\\/.test(trimmed)) return !/\\$/.test(trimmed);
    // POSIX 绝对路径（含 MSYS 风格 `/c/Users/...`）与家目录写法。
    if (trimmed.startsWith("/")) return true;
    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return true;
    return false;
}

/** 构建整理 prompt（system + user 两段；样本只含四类标签值）。 */
export function buildTidyPrompt(samples: readonly TidySample[]): {system: string; user: string} {
    const system = [
        "你是学习数据整理器。下面是文件访问审批的样本（工具|命令名|目录|判决）。",
        "请把'语义上属于同一类访问意图'的样本归并成分组规则，供统计聚合。",
        "每组给出 glob 匹配条件：* 匹配任意串、? 匹配单字符；`-` 表示该维度没有值。",
        "硬约束（违反的组会被整条丢弃，宁可不建组也不要乱建）：",
        "1. dir 必填，只能写样本里出现过的一个真实目录，或它的一段前缀再跟 *（如 C:\\Code\\work\\*）；禁止写 * 或 ?、禁止留空。",
        "2. tool 必填，只能写样本里出现过的工具名；禁止写 *。",
        "3. command 只能写样本里出现过的命令名，或它的一段前缀再跟 *；禁止写 *；样本里命令名是 `-` 时该组不要限制命令维度就只能整组不建。",
        "4. 只出现在 1 条样本里的类别不要单独建组（噪声）。",
        "5. 一个组不要跨工具、不要跨互不相关的目录。",
        "只输出 JSON，不要解释。格式：{\"groups\":[{\"tool\":\"...\",\"command\":\"...\",\"dir\":\"...\",\"note\":\"...\"}]}",
        "不要输出任何计数字段；数字一律不要。"
    ].join("\n");
    const lines = samples.map((s) => `${s.tool}|${s.commandName === "" ? "-" : s.commandName}|${s.dir}|${s.verdict}`);
    const user = `样本（共 ${samples.length} 条）：\n${lines.join("\n")}`;
    return {system, user};
}

/**
 * 组计数实算：Σ 匹配 matcher 的 **K1 精确样本行**（`learned_policies`
 * 的 layer=1）的计数。组行的数字永远来自真实用户表态，LLM 无法虚报。
 */
export function computeGroupCounts(matcher: GroupMatcher, policies: readonly LearnedPolicy[]): {
    sampleCount: number;
    allowCount: number;
    denyCount: number;
} {
    let sampleCount = 0;
    let allowCount = 0;
    let denyCount = 0;
    for (const row of policies) {
        if (row.layer !== 1) continue;
        if (!matchesGroupRule(matcher, {tool: row.tool, commandName: row.commandName, dir: row.dir})) continue;
        sampleCount += row.sampleCount;
        allowCount += row.allowCount;
        denyCount += row.denyCount;
    }
    return {sampleCount, allowCount, denyCount};
}

/** 模型字符串解析：`"auto"` 交给 {@link TidyDeps.resolveDefaultModel}。 */
export function resolveTidyModel(configured: string, reasoningEffort: string, fallback: ModelRef | undefined): ModelRef | undefined {
    if (configured === "auto") return fallback;
    const sep = configured.indexOf("::");
    if (sep <= 0 || sep === configured.length - 2) return void 0;
    const provider = configured.slice(0, sep);
    const model = configured.slice(sep + 2);
    const effort = reasoningEffort === "default" ? void 0 : reasoningEffort;
    return effort === void 0 ? {provider, model} : {provider, model, reasoningEffortId: effort};
}

/**
 * 创建整理服务。`tick` 由装配层定时调用；`run` 是一轮整理的完整流程
 * （模型路由 → 事件投影 → LLM → 严格校验 → 组计数实算 → 落库 → 审计）。
 * 一切失败都记 `llm_tidy_runs` 审计并返回 failed/skipped，绝不抛出。
 */
export function createLlmTidyService(deps: TidyDeps, options: TidyOptions): LlmTidyService {
    let running: Promise<TidyRunSummary> | undefined;
    /**
     * 上次整理时刻。**不能只放内存**（T45）：旧实现从 0 起算，进程重启后
     * `Date.now() - lastRunAt` 立刻 ≥ 24h，每次启动都会白跑一轮、把噪声
     * 样本重新归纳一遍。首次 tick/run 时从 `llm_tidy_runs` 审计表恢复。
     */
    let lastRunAt = 0;
    let restored = false;

    /** 从审计表恢复上次整理时刻（只做一次；库不可用就保持 0，下轮再试）。 */
    const restoreLastRunAt = (db: LearnDb): void => {
        if (restored || !db.available) return;
        restored = true;
        try {
            const last = db.tidyRuns(1)[0];
            if (last !== void 0) lastRunAt = Math.max(lastRunAt, last.createdAt);
        } catch {
            // 恢复失败按「没有历史」处理：最多多跑一轮，不影响安全。
        }
    };

    /**
     * 等学习库首次打开完成。`openLearnDb` 是异步的（迁移 + 建立连接），而整理
     * 服务在装配时就被创建——不等就绪会看到 `UNAVAILABLE` 快照，把「还没打开」
     * 误报成「库不可用」。等待有上限：就绪信号异常时按不可用处理，绝不挂住。
     */
    const waitReady = async (): Promise<void> => {
        const ready = deps.ready;
        if (ready === void 0) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                ready,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, deps.readyWaitMs ?? TIDY_READY_WAIT_MS);
                    timer.unref?.();
                })
            ]);
        } catch {
            // 就绪信号自身失败：按不可用处理（下游会读 db.detail 说明原因）。
        } finally {
            if (timer !== void 0) clearTimeout(timer);
        }
    };

    /** 当前库 + 可用性判定（不可用时把具体原因带进结果文案，便于定位）。 */
    const resolveDb = async (): Promise<{db: LearnDb; detail: string}> => {
        if (!deps.db().available) await waitReady();
        const db = deps.db();
        if (db.available) return {db, detail: ""};
        return {db, detail: db.detail === "" ? "db unavailable" : `db unavailable: ${db.detail}`};
    };

    const audit = (db: LearnDb, model: string, promptDigest: string, outputJson: string, status: string, appliedCount: number): void => {
        try {
            db.recordTidyRun({createdAt: Date.now(), model, promptDigest, outputJson, status, appliedCount});
        } catch {
            // 审计失败不阻塞。
        }
    };

    const run = (): Promise<TidyRunSummary> => {
        // 防重入：进行中的轮次直接共享。
        if (running !== void 0) return running;
        running = (async (): Promise<TidyRunSummary> => {
            const modelRef = resolveTidyModel(options.model(), options.reasoningEffort(), deps.resolveDefaultModel());
            const modelLabel = modelRef === void 0 ? "" : `${modelRef.provider}::${modelRef.model}`;
            let db: LearnDb | undefined;
            try {
                if (options.assist() !== true) return {status: "skipped", model: modelLabel, appliedCount: 0, detail: "llmAssist off"};
                const opened = await resolveDb();
                db = opened.db;
                if (!opened.db.available) return {status: "failed", model: modelLabel, appliedCount: 0, detail: opened.detail};
                if (modelRef === void 0) {
                    audit(opened.db, "", "", "", "failed", 0);
                    return {status: "failed", model: "", appliedCount: 0, detail: "no model"};
                }
                // 事件投影（隐私面：工具/命令名/目录/判决；auto-approved 非用户表态，剔除）。
                // 命令名取落库时算好的 K1 同源值，历史 NULL 行才回落到收紧后的首词推断；
                // 目录先过形态判定，把扫描器误报的模式串挡在 prompt 之外。
                const samples: TidySample[] = [];
                let droppedSamples = 0;
                for (const event of opened.db.searchApprovals("", TIDY_EVENT_LIMIT)) {
                    if (event.verdict === "auto-approved") continue;
                    if (!looksLikeDir(event.dir)) {
                        droppedSamples += 1;
                        continue;
                    }
                    const commandName = event.commandName === "" ? commandNameOf(event.command) : event.commandName;
                    samples.push({tool: event.tool, commandName, dir: event.dir, verdict: event.verdict});
                }
                if (samples.length === 0) {
                    lastRunAt = Date.now();
                    return {status: "ok", model: modelLabel, appliedCount: 0, detail: "no samples"};
                }
                const prompt = buildTidyPrompt(samples);
                const promptDigest = createHash("sha256").update(`${prompt.system}\n${prompt.user}`).digest("hex").slice(0, 32);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), TIDY_CALL_TIMEOUT_MS);
                let output: string;
                try {
                    output = await deps.askModel(modelRef, prompt.system, prompt.user, controller.signal);
                } finally {
                    clearTimeout(timer);
                }
                const parsed = parseTidyOutput(output);
                if (parsed === void 0) {
                    audit(opened.db, modelLabel, promptDigest, output, "failed", 0);
                    return {status: "failed", model: modelLabel, appliedCount: 0, detail: "invalid output"};
                }
                // 组计数实算 + 按 matcher 文本去重落库（同文本复用 id upsert）。
                const existing = new Map<string, LlmGroupRule>();
                for (const rule of opened.db.groupRules()) existing.set(JSON.stringify(rule.matcher), rule);
                const policies = opened.db.policies();
                let applied = 0;
                let zeroSample = 0;
                const kept = new Set<string>();
                const at = Date.now();
                for (const matcher of parsed.matchers) {
                    const counts = computeGroupCounts(matcher, policies);
                    // 零样本组=模型凭空造的规则：既不贡献先验，又会把 deny 传染到
                    // 不相干的调用上（T45 前的现网 19 组里 12 组如此），一律不落库。
                    if (counts.sampleCount === 0) {
                        zeroSample += 1;
                        continue;
                    }
                    const prior = existing.get(JSON.stringify(matcher));
                    const id = prior?.id ?? uuidv7();
                    opened.db.writeGroupRule({
                        id,
                        matcher,
                        sampleCount: counts.sampleCount,
                        allowCount: counts.allowCount,
                        denyCount: counts.denyCount,
                        // 新组默认 active；旧组保留 active（deny 传染由 counts 表达）。
                        active: prior?.active ?? true,
                        updatedAt: at
                    });
                    kept.add(id);
                    applied += 1;
                }
                const dropped = parsed.dropped + zeroSample;
                if (applied === 0) {
                    audit(opened.db, modelLabel, promptDigest, output, "failed", 0);
                    return {status: "failed", model: modelLabel, appliedCount: 0, detail: droppedSamples === 0 ? "no valid group" : `no valid group (dropped ${droppedSamples} samples)`};
                }
                // 本轮没再产出的旧组=僵尸规则：留着只会给不成立的意图供先验，清掉。
                for (const rule of existing.values()) {
                    if (kept.has(rule.id)) continue;
                    opened.db.removeGroupRule(rule.id);
                }
                lastRunAt = at;
                deps.onApplied?.();
                audit(opened.db, modelLabel, promptDigest, output, "ok", applied);
                const note = dropped === 0 && droppedSamples === 0 ? "" : `dropped ${dropped} groups / ${droppedSamples} samples`;
                return {status: "ok", model: modelLabel, appliedCount: applied, detail: note};
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                audit(db ?? deps.db(), modelLabel, "", "", "failed", 0);
                return {status: "failed", model: modelLabel, appliedCount: 0, detail};
            } finally {
                running = void 0;
            }
        })();
        return running;
    };

    return {
        tick() {
            try {
                if (options.assist() !== true || running !== void 0) return;
                const db = deps.db();
                if (!db.available) return;
                restoreLastRunAt(db);
                const events = db.searchApprovals("", TIDY_EVENT_LIMIT);
                const newest = events[0]?.at ?? 0;
                if (newest <= lastRunAt) return;
                const fresh = events.filter((event) => event.at > lastRunAt).length;
                if (fresh >= TIDY_MIN_NEW_EVENTS || Date.now() - lastRunAt >= TIDY_INTERVAL_MS) {
                    void run();
                }
            } catch {
                // tick 失败下轮再来（fail-safe）。
            }
        },
        run
    };
}
