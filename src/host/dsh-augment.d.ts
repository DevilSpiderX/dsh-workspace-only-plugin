/**
 * 宿主平台契约的类型补充（T28）。
 *
 * 这里的事件与服务声明住在未钉进 devDeps 的 dsh 包（`dsh-api-remotes` 的转发
 * 事件白名单、`dsh-tools` 的 pre-execute、`dsh-system-prompt`、
 * `dsh-user-approval` 的 permissionPresets）里，官方 `@deepseek-ai/cordis` 的
 * `Events`/`Context` 里没有它们 —— 按字面复刻补一份最小声明，让 strict 下可
 * 编译。载荷的精确语义由消费点（`index.ts` 的门禁 handler）自己保证；未来
 * 安装的 dsh 包若也声明同名成员，interface 合并为重载/交集，不冲突。
 */
import "@deepseek-ai/cordis";
import type {Session} from "@deepseek-ai/dsh-session";
import type {ApprovalRequestEvent} from "@deepseek-ai/dsh-user-approval/types";

/** `tools/pre-execute` 的工具调用形状（字面复刻 `dsh-tools` 的执行面）。 */
export interface PreExecuteCall {
    readonly name: string;
    readonly arguments?: Record<string, unknown> | undefined;
    readonly agent?: ApprovalRequestEvent["agent"] | undefined;
    readonly callId?: ApprovalRequestEvent["callId"] | undefined;
    readonly signal?: AbortSignal | undefined;
}

/** deny 的结构化错误身份（字面复刻 `dsh-tools` 的 `ToolErrorInfo` 最小形状）：`code` 是 agent 可感知的稳定错误码。 */
export interface PreExecuteErrorInfo {
    readonly code: string;
    readonly [key: string]: unknown;
}

/** pre-execute 的裁决：放行（`next()` 的延续值）或携带原因拒绝。 */
export type PreExecuteVerdict =
    | {readonly kind: "allow"}
    | {readonly kind: "deny"; readonly reason?: string | undefined; readonly info?: PreExecuteErrorInfo | undefined};

/** 命令 handler 的入参（字面复刻 `dsh-commands` 的 `CommandInvocation`，只声明用到的面）。 */
export interface CommandInvocation {
    readonly agent: {readonly session: Session};
    readonly rawInput: string;
}

/** 命令 handler 的结果（字面复刻 `dsh-commands` 的 `CommandResult`）。 */
export type CommandResult =
    | {readonly kind: "success"; readonly text?: string}
    | {readonly kind: "error"; readonly text: string};

/** LLM 生成选项（字面复刻 `dsh-llm` 的 `GenerateOptions` 最小形状，T39 整理服务用）。 */
export interface LlmGenerateOptions {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string | undefined;
    readonly system?: string | undefined;
    readonly messages: ReadonlyArray<{
        readonly role: string;
        readonly content: ReadonlyArray<Record<string, unknown>>;
    }>;
    readonly signal?: AbortSignal | undefined;
}

/** LLM 流式块（字面复刻 `dsh-llm` 的 `StreamChunk`，只声明消费到的变体，T39）。 */
export type LlmStreamChunk =
    | {readonly type: "text-delta"; readonly index: number; readonly text: string}
    | {readonly type: "finish"; readonly reason: {readonly kind: string; readonly failure?: unknown}};

/** 默认模型选择（字面复刻 `dsh-agent-default-model` 的 `ModelSelection` 最小形状，T39）。 */
export interface LlmModelSelection {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string | undefined;
}

declare module "@deepseek-ai/cordis" {
    interface Events {
        /** 转发事件白名单上的 `settings/document-updated`（携带 ask 载荷 / askDone 撤卡）。 */
        "settings/document-updated"(source: string, payload: unknown): void;
        /** 工具执行前的门禁 waterfall（`next()` 放行到下一环）。 */
        "tools/pre-execute"(exec: PreExecuteCall, next: () => PreExecuteVerdict | Promise<PreExecuteVerdict>): PreExecuteVerdict | Promise<PreExecuteVerdict>;
    }
    interface Context {
        /** 运行时上下文叙述注册（`dsh-system-prompt` 的注入服务）。 */
        systemPrompt: {
            context(entry: {
                name: string;
                order: number;
                text: (context: {readonly agent?: {readonly session?: Session | undefined} | undefined}) => string;
            }): unknown;
        };
        /** 权限预设表（`dsh-user-approval` 的注入服务）：key = 预设模式名。 */
        permissionPresets: {
            presets: Record<string, {name: string} | undefined>;
        };
        /** 输入框命令注册（`dsh-commands` 的注入服务，T30）。 */
        commands: {
            register(definition: {
                readonly name: string;
                readonly description: string;
                readonly input?: {readonly hint: string} | undefined;
                readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
            }): () => void;
        };
        /** LLM 运行时（`dsh-llm` 的注入服务，T39 整理服务用；缺包的 composition 可为空）。 */
        llm?: {
            stream(options: LlmGenerateOptions): AsyncIterable<LlmStreamChunk>;
        } | undefined;
        /** 默认模型选择（`dsh-agent-default-model` 的注入服务，T39 模型路由）。 */
        agentDefaultModel?: {
            currentSelection(): LlmModelSelection | undefined;
        } | undefined;
    }
}
