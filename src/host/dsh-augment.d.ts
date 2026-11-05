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

/** pre-execute 的裁决：放行（`next()` 的延续值）或携带原因拒绝。 */
export type PreExecuteVerdict =
    | {readonly kind: "allow"}
    | {readonly kind: "deny"; readonly reason?: string | undefined};

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
    }
}
