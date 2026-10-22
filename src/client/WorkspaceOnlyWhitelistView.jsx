import { useEffect, useState } from "react";
import { Button, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import { scopedEntries } from "./shared.js";

/**
* Session page view (conversation.view tab "白名单目录"): the SESSION-SCOPED
* whitelist entries of this session's workspace root — what an ask card's
* "总是允许该目录" wrote. Global entries stay in Settings → Workspace Only.
*/
export function WorkspaceOnlyWhitelistView({ useWorkspaceOnly, sessionId, addEntry, removeEntry, load, t }) {
	const state = useWorkspaceOnly((snapshot) => snapshot);
	const [draft, setDraft] = useState("");
	useEffect(() => {
		load();
	}, [load]);
	const busy = state.status === "loading" || state.status === "saving";
	// The root rides the management snapshot (sessions[].cwd) and is
	// re-read on every store publication, so the list stays correct
	// once the first snapshot lands.
	const root = (state.sessions ?? []).find((entry) => entry.id === sessionId)?.cwd ?? "";
	const entries = scopedEntries(state.always ?? [], root);
	return (
		<div data-workspace-only-view>
			<div data-workspace-only-viewTitle>{t("panel.title")}</div>
			<div data-workspace-only-viewDesc>{typeof root === "string" && root !== "" ? t("panel.desc", { root }) : t("panel.descNoRoot")}</div>
			{state.error === null ? null : (
				// A failed add/remove used to die silently here ("the add
				// button does nothing"); surface the remote error instead.
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
