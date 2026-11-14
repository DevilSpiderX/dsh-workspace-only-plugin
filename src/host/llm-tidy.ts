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
    readonly db: LearnDb;
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
/** 校验上限：组数与各段 glob 长度（LLM 输出是不可信输入）。 */
const TIDY_MAX_GROUPS = 50;
const TIDY_MAX_PATTERN = 256;

/** glob 段合法性：只允许可见字符与 `*`/`?` 通配（防控制字符/换行注入）。 */
function isSafePattern(value: string): boolean {
    return value.length <= TIDY_MAX_PATTERN && /^[\x20-\x7E]*$/.test(value);
}

/**
 * 解析并严格校验 LLM 输出。只提取 `groups[].{tool,command,dir}` 三段
 * glob（缺省=空串"不限"）；数字/计数字段**一律无视**（服务端实算）。
 * 任何结构问题返回 undefined（整体弃用，fail-safe）。
 */
export function parseTidyOutput(text: string): GroupMatcher[] | undefined {
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
    for (const entry of groups) {
        if (typeof entry !== "object" || entry === null) return void 0;
        const raw = entry as Record<string, unknown>;
        const tool = typeof raw.tool === "string" ? raw.tool : "";
        const command = typeof raw.command === "string" ? raw.command : "";
        const dir = typeof raw.dir === "string" ? raw.dir : "";
        // 三段全空=匹配一切，是废规则（而且会把所有 deny 传染到一起）。
        if (tool === "" && command === "" && dir === "") return void 0;
        if (!isSafePattern(tool) || !isSafePattern(command) || !isSafePattern(dir)) return void 0;
        matchers.push({tool, command, dir});
    }
    return matchers;
}

/** 审批事件的隐私最小化投影：只保留工具/命令名/目录/判决四类标签值。 */
export interface TidySample {
    readonly tool: string;
    readonly commandName: string;
    readonly dir: string;
    readonly verdict: string;
}

/**
 * 命令名近似：取命令文本首词（`approval_events` 只存命令全文；LLM 归并
 * 以命令名为粒度，与 `PolicyInput.commandName` 对齐）。
 */
export function commandNameOf(command: string): string {
    const trimmed = command.trim();
    const space = trimmed.search(/\s/);
    return (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
}

/** 构建整理 prompt（system + user 两段；样本只含四类标签值）。 */
export function buildTidyPrompt(samples: readonly TidySample[]): {system: string; user: string} {
    const system = [
        "你是学习数据整理器。下面是文件访问审批的样本（工具|命令名|目录|判决）。",
        "请把'语义上属于同一类访问意图'的样本归并成分组规则，供统计聚合。",
        "每组给出 glob 匹配条件（* 匹配任意串、? 匹配单字符；空串表示该维度不限）。",
        "只输出 JSON，不要解释。格式：{\"groups\":[{\"tool\":\"...\",\"command\":\"...\",\"dir\":\"...\",\"note\":\"...\"}]}",
        "不要输出任何计数字段；数字一律不要。"
    ].join("\n");
    const lines = samples.map((s) => `${s.tool}|${s.commandName}|${s.dir}|${s.verdict}`);
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
    let lastRunAt = 0;

    const audit = (model: string, promptDigest: string, outputJson: string, status: string, appliedCount: number): void => {
        try {
            deps.db.recordTidyRun({createdAt: Date.now(), model, promptDigest, outputJson, status, appliedCount});
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
            try {
                if (options.assist() !== true) return {status: "skipped", model: modelLabel, appliedCount: 0, detail: "llmAssist off"};
                if (!deps.db.available) return {status: "failed", model: modelLabel, appliedCount: 0, detail: "db unavailable"};
                if (modelRef === void 0) {
                    audit("", "", "", "failed", 0);
                    return {status: "failed", model: "", appliedCount: 0, detail: "no model"};
                }
                // 事件投影（隐私面：工具/命令名/目录/判决；auto-approved 非用户表态，剔除）。
                const samples: TidySample[] = [];
                for (const event of deps.db.searchApprovals("", TIDY_EVENT_LIMIT)) {
                    if (event.verdict === "auto-approved") continue;
                    samples.push({tool: event.tool, commandName: commandNameOf(event.command), dir: event.dir, verdict: event.verdict});
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
                const matchers = parseTidyOutput(output);
                if (matchers === void 0) {
                    audit(modelLabel, promptDigest, output, "failed", 0);
                    return {status: "failed", model: modelLabel, appliedCount: 0, detail: "invalid output"};
                }
                // 组计数实算 + 按 matcher 文本去重落库（同文本复用 id upsert）。
                const existing = new Map<string, LlmGroupRule>();
                for (const rule of deps.db.groupRules()) existing.set(JSON.stringify(rule.matcher), rule);
                const policies = deps.db.policies();
                let applied = 0;
                const at = Date.now();
                for (const matcher of matchers) {
                    const counts = computeGroupCounts(matcher, policies);
                    const prior = existing.get(JSON.stringify(matcher));
                    deps.db.writeGroupRule({
                        id: prior?.id ?? uuidv7(),
                        matcher,
                        sampleCount: counts.sampleCount,
                        allowCount: counts.allowCount,
                        denyCount: counts.denyCount,
                        // 新组默认 active；旧组保留 active（deny 传染由 counts 表达）。
                        active: prior?.active ?? true,
                        updatedAt: at
                    });
                    applied += 1;
                }
                lastRunAt = at;
                deps.onApplied?.();
                audit(modelLabel, promptDigest, output, "ok", applied);
                return {status: "ok", model: modelLabel, appliedCount: applied, detail: ""};
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                audit(modelLabel, "", "", "failed", 0);
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
                if (options.assist() !== true || !deps.db.available || running !== void 0) return;
                const events = deps.db.searchApprovals("", TIDY_EVENT_LIMIT);
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
