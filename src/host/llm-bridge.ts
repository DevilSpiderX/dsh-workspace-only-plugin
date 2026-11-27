/**
 * LLM 整理服务的宿主接线（任务 T42）。纯函数面、无 cordis 依赖 —— 可取可测。
 *
 * 为什么单独一层：`llm` 与 `agentDefaultModel` 在宿主里是 **cordis Service**，
 * 而本插件的 `inject` 只有 `permissionPresets`/`tools`/`settings`/`systemPrompt`/
 * `commands`。cordis 的 proxy get trap 对**未 inject** 的属性直接抛
 * `cannot get property "X" without inject`（不是 `undefined`，可选链挡不住），
 * 这正是「学习与自动整理」面板红字的根因。
 *
 * 两条都不动的理由：
 * - 不能把这些服务加进 `inject`：cordis 没有「可选 inject」语法，缺服务的
 *   composition 上整个插件不会激活 —— 门禁失效是 fail-open，与本插件的
 *   fail-closed 方向冲突。
 * - 不能继续直访问：headless / 精简 composition 里 `llm` 可能缺席。
 *
 * 正确取法是 `ctx.get(name)`（`ReflectService._getImpl`，不经 get trap，服务未
 * 就绪时返回 `undefined`）—— 与 `sandboxPolicy`/`typert`/`userQuestions` 同范式。
 * 本模块把 `ctx` 收窄成最小的 `{get}` 面，方便直接用假对象测。
 */
import type {AskModelFn, ModelRef} from "./llm-tidy.ts";

/**
 * 视为「正常终止」的 finish kind（`@deepseek-ai/dsh-llm` 的 `FinishReasonMap`
 * 值域是 stop / tool-calls / max-tokens / aborted / error）。`max-tokens` 截断
 * 交给 JSON 解析自然判废；`tool-calls` 对一次性整理请求属异常（模型没按格式
 * 回文本），一并按失败上报。
 */
const LLM_FINISH_OK: readonly string[] = Object.freeze(["stop", "max-tokens"]);

/** 可选服务面：`ctx` 的 `get` 方法（`ReflectService.get`，不要求 inject）。 */
export interface OptionalServices {
    get(name: string): unknown;
}

/** 宿主 `llm.stream()` 所需的最小形状（字面复刻 `@deepseek-ai/dsh-llm`）。 */
interface LlmStreamOptions {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: unknown;
    readonly system?: string;
    readonly messages: ReadonlyArray<{readonly role: "user"; readonly content: ReadonlyArray<{readonly type: "text"; readonly text: string}>}>;
    readonly signal?: AbortSignal;
}

interface LlmChunk {
    readonly type?: unknown;
    readonly text?: unknown;
    readonly reason?: {readonly kind?: unknown} | undefined;
}

interface LlmRuntimeLike {
    stream(options: LlmStreamOptions): AsyncIterable<LlmChunk>;
}

interface AgentDefaultModelLike {
    currentSelection(): {readonly provider?: unknown; readonly model?: unknown; readonly reasoningEffort?: unknown} | undefined;
}

/** 整理服务的宿主适配面（装配层直接喂给 `createLlmTidyService`）。 */
export interface TidyBridge {
    /** 一轮模型调用：把流式 chunk 收成一段文本。 */
    readonly askModel: AskModelFn;
    /** 配置为 `"auto"` 时的模型回退（宿主当前默认模型）。 */
    readonly resolveDefaultModel: () => ModelRef | undefined;
}

/** 按最小接口收窄一个未知服务值；形态不符返回 `undefined`。 */
function asLlm(value: unknown): LlmRuntimeLike | undefined {
    if (value === null || typeof value !== "object") return void 0;
    const candidate = value as {stream?: unknown};
    return typeof candidate.stream === "function" ? value as LlmRuntimeLike : void 0;
}

function asAgentDefaultModel(value: unknown): AgentDefaultModelLike | undefined {
    if (value === null || typeof value !== "object") return void 0;
    const candidate = value as {currentSelection?: unknown};
    return typeof candidate.currentSelection === "function" ? value as AgentDefaultModelLike : void 0;
}

/**
 * 创建宿主适配。`services` 缺席（无 `ctx.get` 的极简 composition）或服务未就绪
 * 时全部 fail-safe：`askModel` 抛可读错误（由 `llm-tidy.ts` 记审计并返回 failed，
 * 绝不中断门禁），`resolveDefaultModel` 返回 `undefined`（走既有的 `no model`
 * 失败分支）。
 */
export function createTidyBridge(services: OptionalServices | undefined): TidyBridge {
    const lookup = (name: string): unknown => {
        try {
            return services?.get(name);
        } catch {
            // get 失败按「服务缺席」处理，绝不让可选能力影响门禁。
            return void 0;
        }
    };
    return {
        askModel: async (model, system, user, signal) => {
            const llm = asLlm(lookup("llm"));
            if (llm === void 0) throw new Error("llm service unavailable (the host did not provide it)");
            const text: string[] = [];
            for await (const chunk of llm.stream({
                provider: model.provider,
                model: model.model,
                // effort id 在宿主侧是 branded `ReasoningEffortId`（brand.ts 的字符串
                // 品牌包装）；这里不引入 dsh-llm 依赖，按最小面原样透传。
                ...model.reasoningEffortId === void 0 ? {} : {reasoningEffort: model.reasoningEffortId},
                system,
                messages: [{role: "user", content: [{type: "text", text: user}]}],
                signal
            })) {
                if (chunk.type === "text-delta") text.push(typeof chunk.text === "string" ? chunk.text : "");
                else if (chunk.type === "finish" && typeof chunk.reason?.kind === "string" && !LLM_FINISH_OK.includes(chunk.reason.kind)) {
                    // error/aborted 规范化为 terminal finish（不抛）—— 这里转成失败交给
                    // 上层记审计；max-tokens 截断交给 JSON 解析自然判废。
                    throw new Error(`llm finish: ${chunk.reason.kind}`);
                }
            }
            return text.join("");
        },
        resolveDefaultModel: () => {
            const service = asAgentDefaultModel(lookup("agentDefaultModel"));
            if (service === void 0) return void 0;
            let selection: {readonly provider?: unknown; readonly model?: unknown; readonly reasoningEffort?: unknown} | undefined;
            try {
                selection = service.currentSelection();
            } catch {
                return void 0;
            }
            if (selection === undefined || typeof selection.model !== "string" || selection.model === "") return void 0;
            return {
                provider: typeof selection.provider === "string" ? selection.provider : "",
                model: selection.model,
                reasoningEffortId: typeof selection.reasoningEffort === "string" ? selection.reasoningEffort : void 0
            };
        }
    };
}
