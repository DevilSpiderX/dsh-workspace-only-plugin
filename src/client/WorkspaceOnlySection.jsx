import {useEffect, useState} from "react";
import {Button, Input} from "@deepseek-ai/dsh-client-ui-primitives";
import {globalEntries, SCOPE_OPTIONS} from "./shared.js";
import css from "./WorkspaceOnlySection.module.css";
import entryRowCss from "./entryRow.module.css";

/**
 * 设置分区页（独立导航项，`settings.section`）：全局开关、全局总是
 * 允许白名单（会话级条目在会话页的白名单视图里）、deny 规则、最近
 * 询问（一键加白），以及当前以更宽档位运行的会话。
 */
export function WorkspaceOnlySection(
    {
        load,
        select,
        addGlobalAlways,
        removeAlways,
        addDeny,
        removeDeny,
        clearRecent,
        setScope,
        useWorkspaceOnly,
        t
    }
) {
    const state = useWorkspaceOnly((snapshot) => snapshot);
    const [denyDraft, setDenyDraft] = useState("");
    const [allowDraft, setAllowDraft] = useState("");
    useEffect(() => {
        load();
    }, [load]);
    if (state.status === "unavailable") return null;
    const busy = state.status === "loading" || state.status === "saving";
    const enabled = state.enabled === true;
    const label = busy ? t("loading") : (enabled ? t("on") : t("off"));
    const description = state.error ?? t("description");
    const always = state.always ?? [];
    const globals = globalEntries(always);
    const builtin = Array.isArray(state.builtinAlways) ? state.builtinAlways : [];
    const deny = state.deny ?? [];
    const recent = state.recent ?? [];
    const sessions = state.sessions ?? [];
    const widened = sessions.filter((session) => session.scope !== void 0 && session.scope !== "workspace");
    const scopeLabel = (scope) => {
        const option = SCOPE_OPTIONS.find((item) => item.id === scope);
        return option === void 0 ? String(scope) : t(option.labelKey);
    };
    return (
        <div className={css.page}>
            <div className={css.pageHead}>
                <div className={css.pageTitle}>{t("title")}</div>
                <button
                    type="button"
                    className={css.toggle}
                    aria-pressed={enabled}
                    disabled={busy || !state.writable}
                    onClick={() => {
                        select(!enabled);
                    }}
                >
                    {label}
                </button>
            </div>
            <div className={css.desc} role={state.error === null ? void 0 : "alert"}>{description}</div>
            <div className={css.panel}>
                <div className={entryRowCss.list}>
                    <div className={css.title}>{t("always.builtinTitle")}</div>
                    {builtin.map((entry) => (
                        <div className={entryRowCss.item} key={`builtin:${entry}`}>
                            <span className={entryRowCss.path} title={entry}>{entry}</span>
                        </div>
                    ))}
                    <div className={css.desc}>{t("always.builtinHint")}</div>
                </div>
                <div className={entryRowCss.list}>
                    <div className={css.title}>{t("always.title")}</div>
                    {globals.length === 0 ? (
                        <div className={entryRowCss.item}>{t("always.empty")}</div>
                    ) : globals.map((entry) => (
                        <div className={entryRowCss.item} key={entry}>
                            <span className={entryRowCss.path} title={entry}>{entry}</span>
                            <button
                                type="button"
                                className={entryRowCss.mini}
                                disabled={busy}
                                onClick={() => {
                                    removeAlways(entry);
                                }}
                            >
                                {t("always.remove")}
                            </button>
                        </div>
                    ))}
                    <div className={entryRowCss.fieldRow}>
                        <Input
                            className={entryRowCss.grow}
                            value={allowDraft}
                            placeholder={t("always.placeholder")}
                            disabled={busy}
                            onChange={(event) => {
                                setAllowDraft(event.target.value);
                            }}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
                                const entry = allowDraft.trim();
                                if (entry !== "") {
                                    addGlobalAlways(entry);
                                    setAllowDraft("");
                                }
                            }}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || allowDraft.trim() === ""}
                            onClick={() => {
                                const entry = allowDraft.trim();
                                if (entry !== "") {
                                    addGlobalAlways(entry);
                                    setAllowDraft("");
                                }
                            }}
                        >
                            {t("always.add")}
                        </Button>
                    </div>
                </div>
                <div className={entryRowCss.list}>
                    <div className={css.title}>{t("deny.title")}</div>
                    {deny.length === 0 ? (
                        <div className={entryRowCss.item}>{t("deny.empty")}</div>
                    ) : deny.map((entry) => (
                        <div className={entryRowCss.item} key={entry}>
                            <span className={entryRowCss.path} title={entry}>{entry}</span>
                            <button
                                type="button"
                                className={entryRowCss.mini}
                                disabled={busy}
                                onClick={() => {
                                    removeDeny(entry);
                                }}
                            >
                                {t("deny.remove")}
                            </button>
                        </div>
                    ))}
                    <div className={entryRowCss.fieldRow}>
                        <Input
                            className={entryRowCss.grow}
                            value={denyDraft}
                            placeholder={t("deny.placeholder")}
                            disabled={busy}
                            onChange={(event) => {
                                setDenyDraft(event.target.value);
                            }}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
                                const entry = denyDraft.trim();
                                if (entry !== "") {
                                    addDeny(entry);
                                    setDenyDraft("");
                                }
                            }}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || denyDraft.trim() === ""}
                            onClick={() => {
                                const entry = denyDraft.trim();
                                if (entry !== "") {
                                    addDeny(entry);
                                    setDenyDraft("");
                                }
                            }}
                        >
                            {t("deny.add")}
                        </Button>
                    </div>
                </div>
                {recent.length === 0 ? null : (
                    <div className={entryRowCss.list}>
                        <div className={css.title}>
                            {t("recent.title")}{" "}
                            <button
                                type="button"
                                className={entryRowCss.mini}
                                onClick={() => {
                                    clearRecent();
                                }}
                            >
                                {t("recent.clear")}
                            </button>
                        </div>
                        {recent.slice(0, 20).map((entry) => (
                            <div className={entryRowCss.item} key={`${entry.dir}|${entry.at}`}>
                                <span className={entryRowCss.path} title={entry.dir}>{entry.dir}</span>
                                <button
                                    type="button"
                                    className={entryRowCss.mini}
                                    disabled={busy}
                                    onClick={() => {
                                        addGlobalAlways(entry.dir);
                                    }}
                                >
                                    {t("always.addGlobal")}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {widened.length === 0 ? null : (
                    <div className={entryRowCss.list}>
                        <div className={css.title}>{t("session.title")}</div>
                        {widened.map((session) => (
                            <div className={entryRowCss.item} key={session.id}>
                                <span className={entryRowCss.path} title={session.id}>{session.cwd || session.id}</span>
                                <span className={css.badge}>{scopeLabel(session.scope)}</span>
                                <button
                                    type="button"
                                    className={entryRowCss.mini}
                                    disabled={busy}
                                    onClick={() => {
                                        setScope(session.id, "workspace");
                                    }}
                                >
                                    {t("session.cancel")}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
