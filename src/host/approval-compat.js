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
import {scopeTarget} from "@deepseek-ai/dsh-scope";

/** 闭合的结果词表，从 `dsh-user-approval` 镜像而来。 */
export const APPROVAL_OUTCOMES = ["allowed-once", "rejected", "cancelled", "unavailable"];

/** 将答题方的返回值归一化到闭合结果词表。 */
export function normalizeOutcome(value) {
    return APPROVAL_OUTCOMES.includes(value) ? value : "unavailable";
}

/**
 * 在 `approval/request` waterfall 上派发一次审批请求，并写入官方审计事件对。
 * 返回闭合结果。
 *
 * @param ctx - 宿主上下文。
 * @param request - `{ agent, toolName, callId?, reason, signal? }`。
 * @param session - 审计事件对所属的会话。
 */
export async function requestApprovalViaWaterfall(ctx, request, session) {
    const {agent, toolName, callId, reason, signal} = request;
    const id = ApprovalRequestId(randomUUID());
    session.append("approval/asked", {
        id,
        toolName,
        ...callId !== void 0 ? {callId} : {},
        ...reason !== void 0 ? {reason} : {}
    });
    const outcome = normalizeOutcome(await ctx.waterfall(
        scopeTarget(ctx, agent),
        "approval/request",
        {
            agent,
            toolName,
            ...callId !== void 0 ? {callId} : {},
            reason,
            ...signal !== void 0 ? {signal} : {}
        },
        () => Promise.resolve("unavailable")
    ));
    session.append("approval/decided", {id, outcome});
    return outcome;
}
