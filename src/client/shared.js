import {jsx} from "react/jsx-runtime";
import {
    PermissionIconFullAccessRegular,
    PermissionIconReadOnlyRegular,
    PermissionIconWorkspaceWriteRegular
} from "@deepseek-ai/dsh-client-ui-primitives";

/** 三个会话档位选项（id = Host 侧的 `SCOPE` 值）。 */
export const SCOPE_OPTIONS = [
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
export function scopeGlyph(scope) {
    if (scope === "outside-write") return jsx(PermissionIconFullAccessRegular, {});
    if (scope === "outside-read") return jsx(PermissionIconWorkspaceWriteRegular, {});
    return jsx(PermissionIconReadOnlyRegular, {});
}

/** 全局白名单条目是纯字符串；会话级条目是 `{ session, dir }`（T20）。 */
export function globalEntries(always) {
    return always.filter((entry) => typeof entry === "string");
}

/**
 * 归属主会话 `sessionKey`（血缘根）的会话级条目（宽松匹配；权威判定在 Host）。
 * 子代理会话传其主会话的 rootId，与主会话共享同一批条目；旧 `{root, dir}`
 * 项目级条目（T9）软忽略——不显示、不匹配。
 */
export function scopedEntries(always, sessionKey) {
    const needle = typeof sessionKey === "string" && sessionKey !== "" ? sessionKey : "";
    if (needle === "") return [];
    return always.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.dir === "string" && typeof entry.session === "string" && entry.session === needle);
}
