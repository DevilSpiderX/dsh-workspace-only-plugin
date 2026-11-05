import {useEffect, useRef, useState} from "react";
import type {JSX, KeyboardEvent} from "react";
import css from "./WorkspaceOnlyAskCard.module.css";
import type {TranslateFn} from "./shared.ts";

/** pending interaction 的 ask 载荷（`matched` prop）。 */
export interface AskCardMatch {
    readonly requestId?: string | undefined;
    readonly key: string;
    readonly toolName: string;
    readonly dir: string;
    readonly reason: string;
    /** 命中敏感文件：always 按钮换成 pattern 措辞（任务 T4）。 */
    readonly sensitive?: boolean | undefined;
    readonly answerable?: boolean | undefined;
    /** T29：Host 等待裁决的上限（毫秒），倒计时的初值；缺失或非法则不渲染倒计时。 */
    readonly dialogTimeoutMs?: number | undefined;
    answer(choice: string): unknown;
}

export interface AskCardProps {
    matched: AskCardMatch;
    t: TranslateFn;
    /** presence 握手：把 requestId 报回 Host（`announce` Remote）。 */
    announce?: ((id: string) => void) | undefined;
}

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
export function WorkspaceOnlyAskCard(props: AskCardProps): JSX.Element {
    const ask = props.matched;
    const t = props.t;
    const [answered, setAnswered] = useState(false);
    const waiting = useRef(false);
    const active = useRef(true);
    // T29：倒计时（纯展示，不参与裁决——Host 超时本来就拒）。deadline 只在
    // 挂载时定一次：Host 的裁决计时自 presence 握手起算，卡片挂载即 announce，
    // 两者基本同点。绝对时间基准让休眠/时钟漂移恢复后自动校正；回答后冻结。
    const timeoutMs = typeof ask.dialogTimeoutMs === "number" && Number.isSafeInteger(ask.dialogTimeoutMs) && ask.dialogTimeoutMs >= 1
        ? ask.dialogTimeoutMs
        : void 0;
    const [deadline] = useState<number | undefined>(() => timeoutMs === void 0 ? void 0 : Date.now() + timeoutMs);
    const [remaining, setRemaining] = useState<number | undefined>(() => timeoutMs === void 0 ? void 0 : Math.ceil(timeoutMs / 1000));
    useEffect(() => {
        if (deadline === void 0 || answered) return;
        const timer = setInterval(() => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setRemaining(left);
            if (left <= 0) clearInterval(timer);
        }, 1000);
        return () => clearInterval(timer);
    }, [answered, deadline]);
    useEffect(() => {
        active.current = true;
        // Presence 握手：只有实际挂载的卡片才告诉 Host 等待裁决。
        // id 经 pending 投影（`requestId`，自 `key` 镜像）报回 Host。
        props.announce?.(ask.requestId ?? ask.key);
        return () => {
            active.current = false;
        };
    }, []);
    const answer = (choice: string): void => {
        if (waiting.current || ask.answerable !== true) return;
        waiting.current = true;
        setAnswered(true);
        Promise.resolve(ask.answer(choice)).catch(() => {
            if (!active.current || ask.answerable !== true) return;
            waiting.current = false;
            setAnswered(false);
        });
    };
    const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const element = event.target as Element;
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
        <div className={css.askRoot} aria-busy={answered} onKeyDown={keydown}>
            <div className={css.askCard}>
                <div className={css.askStrip}>
                    <span className={css.askDot}/>
                    {t("ask.strip")}
                    {remaining === void 0 ? null : (
                        <span className={css.askCountdown}>{t("ask.countdown", {seconds: remaining})}</span>
                    )}
                </div>
                <div className={css.askBody} tabIndex={0} role="group">
                    <div className={css.askHeadline}>{t("ask.headline", {toolName: ask.toolName})}</div>
                    <div className={css.askPath}>{ask.dir}</div>
                    <div className={css.askReason}>{ask.reason}</div>
                    {ask.sensitive === true ? null : (
                        <div className={css.askReason}>{t("ask.alwaysHint")}</div>
                    )}
                </div>
                <div className={css.askActions}>
                    <button
                        type="button"
                        className={css.askButton}
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
                        className={css.askButton}
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
                        className={css.askButton}
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
