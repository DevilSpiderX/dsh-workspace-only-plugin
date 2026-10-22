import {useEffect, useRef, useState} from "react";

/**
 * Composer 接管一个待决门禁 ask——与平台的权限升权面板
 *（@deepseek-ai/dsh-client-ui-approval）同款界面与行为：警示条、
 * 触发的工具/路径/原因，以及操作行。Enter = 仅此一次，Esc = 拒绝。
 * 待决请求搭 `uiSession.registerPendingInteraction`，composer 对它
 * 的落座/撤座与 approval 完全一致。它的 `kind: "approval"` 还会点亮
 * 侧边栏的 pending 点（用平台的「待批准」文案）；
 * `source: "workspace-only"` 标记防止 composer 选举（见 raisePanel）
 * 认领官方的 PendingApproval。
 */
export function WorkspaceOnlyAskCard(props) {
    const ask = props.matched;
    const t = props.t;
    const [answered, setAnswered] = useState(false);
    const waiting = useRef(false);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        // Presence 握手：只有实际挂载的卡片才告诉 Host 等待裁决。
        // id 经 pending 投影（`requestId`，自 `key` 镜像）报回 Host。
        props.announce?.(ask.requestId ?? ask.key);
        return () => {
            active.current = false;
        };
    }, []);
    const answer = (choice) => {
        if (waiting.current || ask.answerable !== true) return;
        waiting.current = true;
        setAnswered(true);
        Promise.resolve(ask.answer(choice)).catch(() => {
            if (!active.current || ask.answerable !== true) return;
            waiting.current = false;
            setAnswered(false);
        });
    };
    const keydown = (event) => {
        const element = event.target;
        if (event.defaultPrevented || !event.currentTarget.contains(document.activeElement) || element.closest("input, textarea, select, [contenteditable=\"true\"], [contenteditable=\"\"]") !== null) return;
        if (event.key !== "Enter" && event.key !== "Escape") return;
        if (event.key === "Enter" && element.closest("button, a[href], [role=\"button\"]") !== null) return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return;
        answer(event.key === "Enter" ? "once" : "deny");
    };
    return (
        <div data-workspace-only-askRoot aria-busy={answered} onKeyDown={keydown}>
            <div data-workspace-only-askCard>
                <div data-workspace-only-askStrip>
                    <span data-workspace-only-askDot/>
                    {t("ask.strip")}
                </div>
                <div data-workspace-only-askBody tabIndex={0} role="group">
                    <div data-workspace-only-askHeadline>{t("ask.headline", {toolName: ask.toolName})}</div>
                    <div data-workspace-only-askPath>{ask.dir}</div>
                    <div data-workspace-only-askReason>{ask.reason}</div>
                    {ask.sensitive === true ? null : (
                        <div data-workspace-only-askReason>{t("ask.alwaysHint")}</div>
                    )}
                </div>
                <div data-workspace-only-askActions>
                    <button
                        type="button"
                        data-workspace-only-askButton
                        data-variant="danger"
                        disabled={answered}
                        onClick={() => {
                            answer("deny");
                        }}
                    >
                        {t("ask.deny")}
                    </button>
                    <button
                        type="button"
                        data-workspace-only-askButton
                        data-variant="outline"
                        disabled={answered}
                        onClick={() => {
                            answer("always");
                        }}
                    >
                        {t(ask.sensitive === true ? "alwaysSensitive" : "ask.always")}
                    </button>
                    <button
                        type="button"
                        data-workspace-only-askButton
                        data-variant="primary"
                        disabled={answered}
                        onClick={() => {
                            answer("once");
                        }}
                    >
                        {t("ask.once")}
                    </button>
                </div>
            </div>
        </div>
    );
}
