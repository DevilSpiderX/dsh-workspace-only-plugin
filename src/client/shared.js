import { jsx } from "react/jsx-runtime";
import { PermissionIconFullAccessRegular, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular } from "@deepseek-ai/dsh-client-ui-primitives";

/** The three session-scope options (id = the Host's `SCOPE` value). */
export const SCOPE_OPTIONS = [
	{ id: "workspace", labelKey: "scope.workspace" },
	{ id: "outside-read", labelKey: "scope.outsideRead" },
	{ id: "outside-write", labelKey: "scope.outsideWrite" }
];
/**
* Glyph per scope level — the platform permission menu's own icons
* (PermissionSelect's `permissionGlyphs`), reused so the picker reads as
* a sibling of 仅可查看 / 工作区内修改 / 完全权限: strictest first, in the
* same progression the official menu shows. The trigger always shows
* the glyph of the SELECTED level, matching its checked menu item.
*/
export function scopeGlyph(scope) {
	if (scope === "outside-write") return jsx(PermissionIconFullAccessRegular, {});
	if (scope === "outside-read") return jsx(PermissionIconWorkspaceWriteRegular, {});
	return jsx(PermissionIconReadOnlyRegular, {});
}
/** Global whitelist entries are plain strings; session-scoped ones are `{ root, dir }`. */
export function globalEntries(always) {
	return always.filter((entry) => typeof entry === "string");
}
/** Session-scoped entries granted under `root` (loose match; the Host judges authoritatively). */
export function scopedEntries(always, root) {
	const needle = typeof root === "string" ? root.replace(/[\\/]+$/, "").toLocaleLowerCase() : "";
	if (needle === "") return [];
	return always.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.dir === "string" && typeof entry.root === "string" && entry.root.replace(/[\\/]+$/, "").toLocaleLowerCase() === needle);
}
