import {jsx} from "react/jsx-runtime";
import type {JSX} from "react";
import {
    PermissionIconFullAccessRegular,
    PermissionIconReadOnlyRegular,
    PermissionIconWorkspaceWriteRegular
} from "@deepseek-ai/dsh-client-ui-primitives";

/** 会话档位 id（与 Host 侧的 `SCOPE` 值一致）。 */
export type ScopeId = "workspace" | "outside-read" | "outside-write";

/** 一个会话档位选项（id = Host 侧的 `SCOPE` 值）。 */
export interface ScopeOption {
    readonly id: ScopeId;
    readonly labelKey: string;
}

/** 三个会话档位选项（id = Host 侧的 `SCOPE` 值）。 */
export const SCOPE_OPTIONS: readonly ScopeOption[] = [
    {id: "workspace", labelKey: "scope.workspace"},
    {id: "outside-read", labelKey: "scope.outsideRead"},
    {id: "outside-write", labelKey: "scope.outsideWrite"}
];

/**
 * 各档位的图标——复用平台权限菜单自己的图标
 *（PermissionSelect 的 `permissionGlyphs`），让这个选择器看起来像
 * 「仅可查看 / 工作区内修改 / 完全权限」的兄弟：最严格的在前，
 * 与官方菜单展示的顺序一致。触发按钮始终显示已选档位的图标，
 * 与其勾选的菜单项对应。
 */
export function scopeGlyph(scope: string): JSX.Element {
    if (scope === "outside-write") return jsx(PermissionIconFullAccessRegular, {});
    if (scope === "outside-read") return jsx(PermissionIconWorkspaceWriteRegular, {});
    return jsx(PermissionIconReadOnlyRegular, {});
}

/** 全局白名单条目是纯字符串；会话级条目是 `{ session, dir }`（T20）。 */
export function globalEntries(always: readonly unknown[]): string[] {
    return always.filter((entry): entry is string => typeof entry === "string");
}

/** 一条会话级白名单条目（`{ session, dir }`，session = 血缘根 id）。 */
export interface SessionAlwaysEntry {
    readonly session: string;
    readonly dir: string;
}

/** ask 的 pending 视图条目（`index.tsx` 的 pendingStore 状态形状）。 */
export interface PendingAskView {
    readonly requestId: string;
    readonly sessionId: string | undefined;
    readonly parentSessionId: string | null;
    readonly toolName: string;
    readonly dir: string;
}

/** 平台 `useSessions` 列表行的最小形状（仅子代理过滤/导航用到的字段）。 */
export interface SessionSummaryLike {
    readonly parentId?: string | null | undefined;
    readonly title?: string | undefined;
}

/** 跳子代理的地址形状（`SubagentAddress`：裸 SessionId 会报 `subagent/not-found`）。 */
export interface SubagentAddressLike {
    readonly parentSessionId: string;
    readonly childSessionId: string;
    readonly mode: string;
}

/** 文案函数形状（平台 `locale.bind` 产物）。 */
export type TranslateFn = (key: string, params?: Readonly<Record<string, number | string>>) => string;

/**
 * 归属主会话 `sessionKey`（血缘根）的会话级条目（宽松匹配；权威判定在 Host）。
 * 子代理会话传其主会话的 rootId，与主会话共享同一批条目；旧 `{root, dir}`
 * 项目级条目（T9）软忽略——不显示、不匹配。
 */
export function scopedEntries(always: readonly unknown[], sessionKey: string | undefined): SessionAlwaysEntry[] {
    const needle = typeof sessionKey === "string" && sessionKey !== "" ? sessionKey : "";
    if (needle === "") return [];
    return always.filter((entry): entry is SessionAlwaysEntry => {
        if (entry === null || typeof entry !== "object") return false;
        const record = entry as {dir?: unknown; session?: unknown};
        return typeof record.dir === "string" && typeof record.session === "string" && record.session === needle;
    });
}
