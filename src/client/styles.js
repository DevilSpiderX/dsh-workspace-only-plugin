export const PLUGIN_ID = "dsh-workspace-only-plugin";

/**
 * 设置页、列表和 composer 触发器沿用平台组件 CSS
 * （@deepseek-ai/dsh-client-ui-primitives 里的 PermissionRow.module.css /
 * PermissionSelect.module.css / Input.module.css），使用同一套 --dsw-*
 * 设计令牌；Menu/Input/Button 本体来自 ui-primitives，自带官方样式。
 * @type {string}
 */
export const CSS = `
[data-workspace-only-page]{box-sizing:border-box;width:100%;max-width:720px;margin:0 auto;flex-direction:column;gap:12px;padding:0 0 24px;display:flex}
[data-workspace-only-pageHead]{align-items:center;justify-content:space-between;gap:12px;display:flex}
[data-workspace-only-pageTitle]{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}
[data-workspace-only-title]{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
[data-workspace-only-desc]{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
[data-workspace-only-toggle]{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}
[data-workspace-only-toggle]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-toggle]:disabled{cursor:default}
[data-workspace-only-panel]{flex-direction:column;gap:10px;padding:8px 0 8px 12px;display:flex}
[data-workspace-only-list]{flex-direction:column;gap:4px;display:flex}
[data-workspace-only-item]{align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:flex}
[data-workspace-only-path]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr}
[data-workspace-only-mini]{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);height:22px;padding:0 8px;font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;white-space:nowrap}
[data-workspace-only-mini]:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-mini]:disabled{cursor:default;opacity:.5}
[data-workspace-only-badge]{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:1px 6px;white-space:nowrap;display:inline-flex}
[data-workspace-only-fieldRow]{display:flex;align-items:center;gap:8px;min-width:0}
.workspaceOnlyGrow{flex:1;min-width:0}
[data-workspace-only-scope]{border-radius:var(--dsw-radius-sm);min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
[data-workspace-only-scope]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-scope]:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
[data-workspace-only-scope]:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
[data-workspace-only-scopeIcon]{flex:none;display:inline-flex}
[data-workspace-only-scopeIcon] svg{width:14px;height:14px}
[data-workspace-only-scopeLabel]{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
[data-workspace-only-scopeChevron]{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s;display:inline-flex}
[data-workspace-only-scopeChevron][data-open="true"]{transform:rotate(180deg)}
[data-workspace-only-view]{box-sizing:border-box;width:100%;max-width:720px;margin:0 auto;flex-direction:column;gap:12px;padding:24px 16px 48px;display:flex}
[data-workspace-only-viewTitle]{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}
[data-workspace-only-viewDesc]{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
[data-workspace-only-viewEmpty]{color:var(--dsw-alias-label-dimmed);font-size:12px;line-height:18px;padding:8px 0}
[data-workspace-only-askRoot]{padding:8px calc(var(--dsh-composer-side-clearance) + 16px) 12px;flex-direction:column;align-items:center;display:flex}
[data-workspace-only-askCard]{width:100%;max-width:var(--dsh-chat-content-width);border:1px solid var(--dsw-alias-state-warn-secondary);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);overflow:hidden}
[data-workspace-only-askStrip]{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);align-items:center;gap:8px;padding:10px 16px;font-size:13px;line-height:18px;display:flex}
[data-workspace-only-askDot]{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
[data-workspace-only-askBody]{box-sizing:border-box;max-height:var(--dsh-composer-text-max-height);flex-direction:column;gap:6px;padding:12px 16px 0;display:flex;overflow-y:auto}
[data-workspace-only-askHeadline]{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}
[data-workspace-only-askPath]{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);word-break:break-all;font-size:13px;line-height:20px}
[data-workspace-only-askReason]{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
[data-workspace-only-askActions]{justify-content:flex-end;gap:8px;padding:14px 16px;display:flex}
[data-workspace-only-askButton]{height:32px;padding:0 14px;font-size:13px;line-height:30px;border-radius:var(--dsw-radius-md);cursor:pointer;display:inline-flex;align-items:center;white-space:nowrap}
[data-workspace-only-askButton]:disabled{cursor:default;opacity:.6}
[data-workspace-only-askButton][data-variant="outline"]{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
[data-workspace-only-askButton][data-variant="outline"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-askButton][data-variant="danger"]{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
[data-workspace-only-askButton][data-variant="danger"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-color:transparent}
[data-workspace-only-askButton][data-variant="primary"]{background:var(--dsw-alias-state-business-primary);border:1px solid transparent;color:#fff}
[data-workspace-only-askButton][data-variant="primary"]:hover:not(:disabled){filter:brightness(1.08)}
[data-workspace-only-pending]{border-radius:var(--dsw-radius-sm);height:28px;padding:0 8px;gap:6px;background:transparent;border:none;cursor:pointer;align-items:center;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary);display:inline-flex;white-space:nowrap}
[data-workspace-only-pending]:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-pendingDot]{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}`;

export function installStyles(document) {
    if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`) !== null) return;
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
}
