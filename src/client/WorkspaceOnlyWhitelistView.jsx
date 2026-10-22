import {useEffect, useState} from "react";
import {Button, Input} from "@deepseek-ai/dsh-client-ui-primitives";
import {scopedEntries} from "./shared.js";

/**
 * 会话页视图（conversation.view 标签页「白名单目录」）：本会话工作区
 * 根目录的会话级白名单条目——即询问卡片「总是允许该目录」写入的内容。
 * 全局条目在 设置 → Workspace Only 中管理。
 */
export function WorkspaceOnlyWhitelistView({useWorkspaceOnly, sessionId, addEntry, removeEntry, load, t}) {
    const state = useWorkspaceOnly((snapshot) => snapshot);
    const [draft, setDraft] = useState("");
    useEffect(() => {
        load();
    }, [load]);
    const busy = state.status === "loading" || state.status === "saving";
    // root 取自管理快照（sessions[].cwd），每次 store 发布都重新读取，
    // 首份快照到位后列表就保持正确。
    const root = (state.sessions ?? []).find((entry) => entry.id === sessionId)?.cwd ?? "";
    const entries = scopedEntries(state.always ?? [], root);
    return (
        <div data-workspace-only-view>
            <div data-workspace-only-viewTitle>{t("panel.title")}</div>
            <div
                data-workspace-only-viewDesc>{typeof root === "string" && root !== "" ? t("panel.desc", {root}) : t("panel.descNoRoot")}</div>
            {state.error === null ? null : (
                // 失败的添加/移除过去在这里静默死掉（「添加按钮没反应」）；
                // 现在把 remote 错误显示出来。
                <div data-workspace-only-viewDesc role="alert">{state.error}</div>
            )}
            <div data-workspace-only-fieldRow>
                <Input
                    className="workspaceOnlyGrow"
                    value={draft}
                    placeholder={t("panel.placeholder")}
                    disabled={busy}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
                        const entry = draft.trim();
                        if (entry !== "") {
                            addEntry(entry);
                            setDraft("");
                        }
                    }}
                />
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || draft.trim() === ""}
                    onClick={() => {
                        const entry = draft.trim();
                        if (entry !== "") {
                            addEntry(entry);
                            setDraft("");
                        }
                    }}
                >
                    {t("panel.add")}
                </Button>
            </div>
            {entries.length === 0 ? (
                <div data-workspace-only-viewEmpty>{t("panel.empty")}</div>
            ) : (
                <div data-workspace-only-list>
                    {entries.map((entry) => (
                        <div data-workspace-only-item key={`${entry.root}|${entry.dir}`}>
                            <span data-workspace-only-path title={entry.dir}>{entry.dir}</span>
                            <button
                                type="button"
                                data-workspace-only-mini
                                disabled={busy}
                                onClick={() => {
                                    removeEntry(entry);
                                }}
                            >
                                {t("panel.remove")}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
