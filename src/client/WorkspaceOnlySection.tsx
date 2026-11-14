import {useEffect, useState} from "react";
import type {ChangeEvent, JSX, KeyboardEvent} from "react";
import {Button, Input} from "@deepseek-ai/dsh-client-ui-primitives";
import {globalEntries, SCOPE_OPTIONS} from "./shared.ts";
import type {TranslateFn} from "./shared.ts";
import type {SettingsState} from "./settings-store.ts";
import css from "./WorkspaceOnlySection.module.css";
import entryRowCss from "./entryRow.module.css";

export interface SectionProps {
    load: () => unknown;
    select: (enabled: boolean) => unknown;
    addGlobalAlways: (dir: string) => unknown;
    removeAlways: (entry: string) => unknown;
    addDeny: (entry: string) => unknown;
    removeDeny: (entry: string) => unknown;
    clearRecent: () => unknown;
    setScope: (sessionId: string, scope: string) => unknown;
    /** 任务 T39：学习层 Config 字段写回（LLM 整理开关/模型/推理等级）。 */
    setLearnConfig: (fields: Record<string, unknown>) => unknown;
    /** 任务 T39：重置学习数据。 */
    resetLearnData: () => unknown;
    /** 任务 T39：立即执行一轮 LLM 整理。 */
    runLlmTidy: () => Promise<unknown>;
    /** 任务 T39：模型目录（`remote.session.modelCatalog()`），供模型下拉。 */
    modelCatalog: () => Promise<unknown>;
    useWorkspaceOnly: (selector: (snapshot: SettingsState) => SettingsState) => SettingsState;
    t: TranslateFn;
}

/** 任务 T39：`remote.session.modelCatalog()` 响应里模型条目的宽松形状。 */
interface CatalogModelLike {
    id: string;
    name: string;
    reasoning?: {efforts?: string[]; defaultEffort?: string | undefined};
}

/** 任务 T39：模型目录分组（分组名即 provider 名，与输入框模型下拉一致）。 */
interface CatalogGroupLike {
    id: string;
    name: string;
    models: CatalogModelLike[];
}

/** 任务 T39：模型目录的宽松解析（wire 形状，字段缺失/畸形条目直接跳过）。 */
function parseCatalogGroups(raw: unknown): CatalogGroupLike[] {
    const groups = (raw as {groups?: unknown} | null | undefined)?.groups;
    if (!Array.isArray(groups)) return [];
    const out: CatalogGroupLike[] = [];
    for (const group of groups as Array<Record<string, unknown>>) {
        if (typeof group.id !== "string" || typeof group.name !== "string") continue;
        const models = Array.isArray(group.models) ? (group.models as Array<Record<string, unknown>>) : [];
        const parsed: CatalogModelLike[] = [];
        for (const model of models) {
            if (typeof model.id !== "string" || typeof model.name !== "string") continue;
            const reasoning = (model.reasoning ?? {}) as {efforts?: unknown; defaultEffort?: unknown};
            parsed.push({
                id: model.id,
                name: model.name,
                reasoning: {
                    efforts: Array.isArray(reasoning.efforts) ? (reasoning.efforts as unknown[]).filter((effort): effort is string => typeof effort === "string") : [],
                    defaultEffort: typeof reasoning.defaultEffort === "string" ? reasoning.defaultEffort : void 0
                }
            });
        }
        if (parsed.length === 0) continue;
        out.push({id: group.id, name: group.name, models: parsed});
    }
    return out;
}

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
        setLearnConfig,
        resetLearnData,
        runLlmTidy,
        modelCatalog,
        useWorkspaceOnly,
        t
    }: SectionProps
): JSX.Element | null {
    const state = useWorkspaceOnly((snapshot) => snapshot);
    const [denyDraft, setDenyDraft] = useState("");
    const [allowDraft, setAllowDraft] = useState("");
    // 任务 T39：学习与自动整理面板的状态。
    const [confirmReset, setConfirmReset] = useState(false);
    const [tidyBusy, setTidyBusy] = useState(false);
    const [tidyInfo, setTidyInfo] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<unknown>(null);
    useEffect(() => {
        load();
    }, [load]);
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const raw = await modelCatalog();
                if (alive) setCatalog(raw);
            } catch {
                // 模型目录不可用：下拉只剩「跟随当前模型」。
            }
        })();
        return () => {
            alive = false;
        };
    }, [modelCatalog]);
    const tidyNow = async (): Promise<void> => {
        setTidyBusy(true);
        setTidyInfo(t("learn.tidyRunning"));
        try {
            const raw = await runLlmTidy() as {status?: unknown; appliedCount?: unknown; detail?: unknown} | null | undefined;
            if (raw == null || typeof raw !== "object") {
                setTidyInfo(t("error.remote"));
            } else {
                const detail = typeof raw.detail === "string" && raw.detail !== "" ? ` — ${raw.detail}` : "";
                setTidyInfo(`${String(raw.status ?? "")}${detail}`);
            }
        } finally {
            setTidyBusy(false);
        }
    };
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
    const widened = sessions.filter((session) => session.scope !== "workspace");
    const scopeLabel = (scope: string): string => {
        const option = SCOPE_OPTIONS.find((item) => item.id === scope);
        return option === void 0 ? String(scope) : t(option.labelKey);
    };
    // 任务 T39：学习层配置的展示值（旧宿主缺字段时取默认）。
    const learn = state.learnConfig ?? {llmAssist: true, llmModel: "auto", llmReasoningEffort: "default"};
    const catalogGroups = parseCatalogGroups(catalog);
    const selectedModel = ((): CatalogModelLike | undefined => {
        if (learn.llmModel === "auto") return void 0;
        const splitAt = learn.llmModel.lastIndexOf("::");
        if (splitAt <= 0) return void 0;
        const groupId = learn.llmModel.slice(0, splitAt);
        const modelId = learn.llmModel.slice(splitAt + 2);
        return catalogGroups.find((group) => group.id === groupId)?.models.find((model) => model.id === modelId);
    })();
    const efforts = selectedModel?.reasoning?.efforts ?? [];
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
                            onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                setAllowDraft(event.target.value);
                            }}
                            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
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
                            onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                setDenyDraft(event.target.value);
                            }}
                            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
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
            <div className={css.panel}>
                <div className={css.title}>{t("learn.title")}</div>
                <div className={entryRowCss.list}>
                    <div className={css.desc}>{t("learn.desc")}</div>
                    <div className={entryRowCss.item}>
                        <span className={entryRowCss.path}>{t("learn.assist")}</span>
                        <button
                            type="button"
                            className={entryRowCss.mini}
                            disabled={busy || !state.writable}
                            onClick={() => {
                                setLearnConfig({llmAssist: !learn.llmAssist});
                            }}
                        >
                            {learn.llmAssist ? t("on") : t("off")}
                        </button>
                    </div>
                    <div className={entryRowCss.item}>
                        <span className={entryRowCss.path}>{t("learn.model")}</span>
                        <select
                            className={entryRowCss.grow}
                            disabled={busy || !state.writable}
                            value={learn.llmModel}
                            onChange={(event) => {
                                setLearnConfig({llmModel: event.target.value, llmReasoningEffort: "default"});
                            }}
                        >
                            <option value="auto">{t("learn.modelAuto")}</option>
                            {catalogGroups.map((group) => (
                                <optgroup key={group.id} label={group.name}>
                                    {group.models.map((model) => (
                                        <option key={`${group.id}::${model.id}`} value={`${group.id}::${model.id}`}>{model.name}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    {efforts.length === 0 ? (
                        <div className={entryRowCss.item}>
                            <span className={entryRowCss.path}>{t("learn.effort")}</span>
                            <span>{t("learn.effortDefault")}</span>
                        </div>
                    ) : (
                        <div className={entryRowCss.item}>
                            <span className={entryRowCss.path}>{t("learn.effort")}</span>
                            <select
                                className={entryRowCss.grow}
                                disabled={busy || !state.writable}
                                value={learn.llmReasoningEffort}
                                onChange={(event) => {
                                    setLearnConfig({llmReasoningEffort: event.target.value});
                                }}
                            >
                                <option value="default">{t("learn.effortDefault")}</option>
                                {efforts.map((effort) => (
                                    <option key={effort} value={effort}>{effort}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className={entryRowCss.item}>
                        <span className={entryRowCss.path}>{tidyInfo === null ? "" : tidyInfo}</span>
                        <button
                            type="button"
                            className={entryRowCss.mini}
                            disabled={busy || tidyBusy}
                            onClick={() => {
                                void tidyNow();
                            }}
                        >
                            {tidyBusy ? t("learn.tidyRunning") : t("learn.tidy")}
                        </button>
                    </div>
                    <div className={entryRowCss.item}>
                        <span className={entryRowCss.path}>{confirmReset ? t("learn.resetConfirm") : ""}</span>
                        <button
                            type="button"
                            className={entryRowCss.mini}
                            disabled={busy}
                            onClick={() => {
                                if (!confirmReset) {
                                    setConfirmReset(true);
                                    return;
                                }
                                setConfirmReset(false);
                                void resetLearnData();
                            }}
                        >
                            {t("learn.reset")}
                        </button>
                    </div>
                    <div className={css.desc}>{t("learn.privacy")}</div>
                </div>
            </div>
        </div>
    );
}
