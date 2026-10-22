import {useEffect, useState} from "react";
import {Button, Input} from "@deepseek-ai/dsh-client-ui-primitives";
import {globalEntries, SCOPE_OPTIONS} from "./shared.js";

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
        <div data-workspace-only-page>
            <div data-workspace-only-pageHead>
                <div data-workspace-only-pageTitle>{t("title")}</div>
                <button
                    type="button"
                    data-workspace-only-toggle
                    aria-pressed={enabled}
                    disabled={busy || !state.writable}
                    onClick={() => {
                        select(!enabled);
                    }}
                >
                    {label}
                </button>
            </div>
            <div data-workspace-only-desc role={state.error === null ? void 0 : "alert"}>{description}</div>
            <div data-workspace-only-panel>
                <div data-workspace-only-list>
                    <div data-workspace-only-title>{t("always.builtinTitle")}</div>
                    {builtin.map((entry) => (
                        <div data-workspace-only-item key={`builtin:${entry}`}>
                            <span data-workspace-only-path title={entry}>{entry}</span>
                        </div>
                    ))}
                    <div data-workspace-only-desc>{t("always.builtinHint")}</div>
                </div>
                <div data-workspace-only-list>
                    <div data-workspace-only-title>{t("always.title")}</div>
                    {globals.length === 0 ? (
                        <div data-workspace-only-item>{t("always.empty")}</div>
                    ) : globals.map((entry) => (
                        <div data-workspace-only-item key={entry}>
                            <span data-workspace-only-path title={entry}>{entry}</span>
                            <button
                                type="button"
                                data-workspace-only-mini
                                disabled={busy}
                                onClick={() => {
                                    removeAlways(entry);
                                }}
                            >
                                {t("always.remove")}
                            </button>
                        </div>
                    ))}
                    <div data-workspace-only-fieldRow>
                        <Input
                            className="workspaceOnlyGrow"
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
                <div data-workspace-only-list>
                    <div data-workspace-only-title>{t("deny.title")}</div>
                    {deny.length === 0 ? (
                        <div data-workspace-only-item>{t("deny.empty")}</div>
                    ) : deny.map((entry) => (
                        <div data-workspace-only-item key={entry}>
                            <span data-workspace-only-path title={entry}>{entry}</span>
                            <button
                                type="button"
                                data-workspace-only-mini
                                disabled={busy}
                                onClick={() => {
                                    removeDeny(entry);
                                }}
                            >
                                {t("deny.remove")}
                            </button>
                        </div>
                    ))}
                    <div data-workspace-only-fieldRow>
                        <Input
                            className="workspaceOnlyGrow"
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
                    <div data-workspace-only-list>
                        <div data-workspace-only-title>
                            {t("recent.title")}{" "}
                            <button
                                type="button"
                                data-workspace-only-mini
                                onClick={() => {
                                    clearRecent();
                                }}
                            >
                                {t("recent.clear")}
                            </button>
                        </div>
                        {recent.slice(0, 20).map((entry) => (
                            <div data-workspace-only-item key={`${entry.dir}|${entry.at}`}>
                                <span data-workspace-only-path title={entry.dir}>{entry.dir}</span>
                                <button
                                    type="button"
                                    data-workspace-only-mini
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
                    <div data-workspace-only-list>
                        <div data-workspace-only-title>{t("session.title")}</div>
                        {widened.map((session) => (
                            <div data-workspace-only-item key={session.id}>
                                <span data-workspace-only-path title={session.id}>{session.cwd || session.id}</span>
                                <span data-workspace-only-badge>{scopeLabel(session.scope)}</span>
                                <button
                                    type="button"
                                    data-workspace-only-mini
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
