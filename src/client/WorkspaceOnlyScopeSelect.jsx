import {useEffect, useState} from "react";
import {IconChevronDownOutlineRegular, Menu} from "@deepseek-ai/dsh-client-ui-primitives";
import {SCOPE_OPTIONS, scopeGlyph} from "./shared.js";

/**
 * 会话档位选择器，位于 composer 工具行、紧挨平台权限选择器——
 * 与 @deepseek-ai/dsh-client-ui-permission-presets 的 PermissionSelect
 * 同款触发器 + Menu 界面。设置单个会话的门禁档位：
 * 仅工作区内 / 工作区外只读 / 完全放开。全局开关关闭或未打开会话时隐藏。
 */
export function WorkspaceOnlyScopeSelect({useWorkspaceOnly, sessionId, setScope, load, t}) {
    const state = useWorkspaceOnly((snapshot) => snapshot);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        load();
    }, [load]);
    const session = (state.sessions ?? []).find((entry) => entry.id === sessionId);
    const scope = session?.scope ?? "workspace";
    // 全局开关关闭或未打开会话时隐藏：没有门禁，会话档位无事可做。
    if (state.status === "unavailable" || state.enabled !== true || sessionId === void 0) return null;
    const current = SCOPE_OPTIONS.find((option) => option.id === scope) ?? SCOPE_OPTIONS[0];
    const busy = state.status === "loading" || state.status === "saving";
    return (
        <Menu
            open={open}
            onClose={() => {
                setOpen(false);
            }}
            items={SCOPE_OPTIONS.map((option) => ({
                id: option.id,
                label: t(option.labelKey),
                icon: scopeGlyph(option.id)
            }))}
            selectedId={current.id}
            onSelect={(id) => {
                setOpen(false);
                if (id === scope) return;
                setScope(id);
            }}
            side="top"
            portal
            anchor={
                <button
                    type="button"
                    data-workspace-only-scope
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title={t("scope.tooltip")}
                    disabled={busy}
                    onClick={() => {
                        setOpen((value) => !value);
                    }}
                >
                    <span data-workspace-only-scopeIcon aria-hidden>{scopeGlyph(current.id)}</span>
                    <span data-workspace-only-scopeLabel>{t(current.labelKey)}</span>
                    <span data-workspace-only-scopeChevron data-open={String(open)} aria-hidden>
                        <IconChevronDownOutlineRegular/>
                    </span>
                </button>
            }
        />
    );
}
