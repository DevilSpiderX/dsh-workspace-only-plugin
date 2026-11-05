/**
 * Approval-compat（任务 E3）：本插件对 `@deepseek-ai/dsh-user-approval` 审计约定
 * 仅存耦合的唯一落点。
 *
 * 三键门禁优先在自有通道上应答（见 `ask.js`）；本模块是回退路径，复用官方的
 * `approval/request` waterfall —— 即 GUI web 答题器渲染的同一通道 —— 供
 * headless/TUI 场景或问答接缝不可用时使用。它写入与官方 `ApprovalService.request()`
 * 完全相同的审计事件对（`approval/asked` + `approval/decided`，id 以导出的
 * `ApprovalRequestId` 打标），但不含 `never` 策略短路：Full access 会话同样会
 * 弹窗，这正是本插件的核心价值。
 */
import {randomUUID} from "node:crypto";
import {ApprovalRequestId} from "@deepseek-ai/dsh-user-approval";
import type {ApprovalOutcome, ApprovalRequestEvent} from "@deepseek-ai/dsh-user-approval/types";
import {scopeTarget} from "@deepseek-ai/dsh-scope";
import type {Scoped} from "@deepseek-ai/dsh-scope";
import type {Context} from "@deepseek-ai/cordis";
import type {Session} from "@deepseek-ai/dsh-session";

/** 闭合的结果词表，从 `dsh-user-approval` 镜像而来。 */
export const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = ["allowed-once", "rejected", "cancelled", "unavailable"];

/** 当值在闭合结果词表内时收窄为 {@link ApprovalOutcome}。 */
function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
    return typeof value === "string" && (APPROVAL_OUTCOMES as readonly string[]).includes(value);
}

/** 将答题方的返回值归一化到闭合结果词表。 */
export function normalizeOutcome(value: unknown): ApprovalOutcome {
    return isApprovalOutcome(value) ? value : "unavailable";
}

/**
 * 在 `approval/request` waterfall 上派发一次审批请求，并写入官方审计事件对。
 * 返回闭合结果。
 *
 * @param ctx - 宿主上下文。
 * @param request - `{ agent, toolName, callId?, reason, signal? }`。
 * @param session - 审计事件对所属的会话。
 */
export async function requestApprovalViaWaterfall(ctx: Context, request: ApprovalRequestEvent, session: Session): Promise<ApprovalOutcome> {
    const {agent, toolName, callId, reason, signal} = request;
    const id = ApprovalRequestId(randomUUID());
    session.append("approval/asked", {
        id,
        toolName,
        ...callId !== void 0 ? {callId} : {},
        ...reason !== void 0 ? {reason} : {}
    });
    const outcome = normalizeOutcome(await ctx.waterfall(
        // `scopeTarget` 的返回品牌（Scoped<Context>）与 waterfall 的 thisArg 品牌
        //（Scoped<Agent>）在 dsh 类型里不互通；运行时这里就是 agent 作用域的路由
        // receiver，断言收窄到事件声明的 this 类型。
        scopeTarget(ctx, agent) as unknown as Scoped<ApprovalRequestEvent["agent"]>,
        "approval/request",
        {
            agent,
            toolName,
            ...callId !== void 0 ? {callId} : {},
            reason,
            ...signal !== void 0 ? {signal} : {}
        },
        (): Promise<ApprovalOutcome> => Promise.resolve("unavailable")
    ));
    session.append("approval/decided", {id, outcome});
    return outcome;
}
