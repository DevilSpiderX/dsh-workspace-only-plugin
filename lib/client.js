window.__ModuleLoader__.load({
	id: "dsh-workspace-only-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// Self-contained snapshot store: the 0.1 `@deepseek-ai/dsh-client-runtime`
		// module no longer exists in the DSH 0.2 module table (it is not a seed
		// word), and the replacement `@deepseek-ai/dsh-client-store` keeps
		// evolving its update semantics, so this plugin carries the ~15 lines it
		// needs. `update` accepts either a replacement value or a mutator that
		// edits a draft (returning undefined keeps the mutated draft).
		const createSnapshotStore = (initial) => {
			let state = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => state,
				update(next) {
					if (typeof next === "function") {
						const draft = { ...state };
						const result = next(draft);
						state = result === void 0 ? draft : result;
					} else {
						state = next;
					}
					for (const listener of [...listeners]) listener(state);
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
		};
		//#region lib/types/client/styles.js
		const PLUGIN_ID = "dsh-workspace-only-plugin";
		const CSS = `
[data-workspace-only-row]{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}
[data-workspace-only-rowText]{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}
[data-workspace-only-title]{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
[data-workspace-only-desc]{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
[data-workspace-only-toggle]{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}
[data-workspace-only-toggle]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-toggle]:disabled{cursor:default}
[data-workspace-only-quick]{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;height:28px;padding:0 10px;font-size:12px;line-height:26px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
[data-workspace-only-quick]:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-quick][data-active="true"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
[data-workspace-only-quick][data-bypass="true"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
[data-workspace-only-panel]{flex-direction:column;gap:8px;padding:8px 0 8px 12px;display:flex}
[data-workspace-only-list]{flex-direction:column;gap:4px;display:flex}
[data-workspace-only-item]{align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:flex}
[data-workspace-only-path]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr}
[data-workspace-only-mini]{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;height:22px;padding:0 8px;font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;white-space:nowrap}
[data-workspace-only-mini]:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-menu]{position:fixed;z-index:1000;min-width:220px;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);display:flex}
[data-workspace-only-menuItem]{background:transparent;border:none;border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;display:block;width:100%}
[data-workspace-only-menuItem]:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-menuTitle]{padding:4px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
[data-workspace-only-askRoot]{padding:8px calc(var(--dsh-composer-side-clearance) + 16px) 12px;flex-direction:column;align-items:center;display:flex}
[data-workspace-only-askCard]{width:100%;max-width:var(--dsh-chat-content-width);border:1px solid var(--dsw-alias-state-warn-secondary);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);overflow:hidden}
[data-workspace-only-askStrip]{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);align-items:center;gap:8px;padding:10px 16px;font-size:13px;line-height:18px;display:flex}
[data-workspace-only-askDot]{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
[data-workspace-only-askBody]{box-sizing:border-box;max-height:var(--dsh-composer-text-max-height);flex-direction:column;gap:6px;padding:12px 16px 0;display:flex;overflow-y:auto}
[data-workspace-only-askHeadline]{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}
[data-workspace-only-askPath]{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);word-break:break-all;font-size:13px;line-height:20px}
[data-workspace-only-askReason]{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
[data-workspace-only-askActions]{justify-content:flex-end;gap:8px;padding:14px 16px;display:flex}
[data-workspace-only-askButton]{height:32px;padding:0 14px;font-size:13px;line-height:30px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;white-space:nowrap}
[data-workspace-only-askButton]:disabled{cursor:default;opacity:.6}
[data-workspace-only-askButton][data-variant="outline"]{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
[data-workspace-only-askButton][data-variant="outline"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-workspace-only-askButton][data-variant="danger"]{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
[data-workspace-only-askButton][data-variant="danger"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-color:transparent}
[data-workspace-only-askButton][data-variant="primary"]{background:var(--dsw-alias-state-business-primary);border:1px solid transparent;color:#fff}
[data-workspace-only-askButton][data-variant="primary"]:hover:not(:disabled){filter:brightness(1.08)}`;
		function installStyles(document) {
			if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region lib/types/client/locales.js
		const zh = {
			"title": "Workspace Only",
			"description": "开启后，任何模式下代理的文件访问都仅限当前工作目录",
			"loading": "加载中",
			"unavailable": "不可用",
			"on": "已开启",
			"off": "已关闭",
			"quick.on": "仅工作区：开",
			"quick.off": "仅工作区：关",
			"quick.tooltip": "仅对当前会话生效：单击放飞本会话（不再询问越界访问），再点恢复。总开关在 设置 → 通用设置 → Workspace Only；总开关关闭时此按钮隐藏。",
			"always.title": "总是允许的目录",
			"always.empty": "暂无",
			"always.remove": "移除",
			"always.add": "加白",
			"always.scoped": "工作区限定",
			"always.scopeRoot": "仅在 {root} 的会话内有效",
			"always.scopeGlobal": "作用域：全局",
			"always.scopeWorkspace": "作用域：工作区",
			"deny.title": "永不放行（deny）",
			"deny.empty": "暂无",
			"deny.remove": "移除",
			"deny.add": "添加",
			"deny.placeholder": "目录（以 / 或 \\ 结尾）或 glob，如 C:\\secret\\ 或 *.pem",
			"recent.title": "最近询问的目录",
			"recent.clear": "清空",
			"bypass.title": "放飞中的会话",
			"bypass.cancel": "恢复门禁",
			"error.remote": "Workspace Only 管理通道不可用",
			"ask.strip": "Workspace Only：等待确认",
			"ask.headline": "{toolName} 请求访问工作区外的路径",
			"ask.once": "仅此一次",
			"ask.always": "总是允许本目录",
			"alwaysSensitive": "总是允许此类文件",
			"ask.deny": "拒绝"
		};
		const en = {
			"title": "Workspace Only",
			"description": "When on, agent file access in every mode is confined to the current workspace",
			"loading": "Loading",
			"unavailable": "Unavailable",
			"on": "On",
			"off": "Off",
			"quick.on": "Workspace Only: On",
			"quick.off": "Workspace Only: Off",
			"quick.tooltip": "Applies to this session only: click to bypass outside-workspace prompts for this session, click again to restore. The global switch lives in Settings → General → Workspace Only; this button hides while it is off.",
			"always.title": "Always-allowed directories",
			"always.empty": "None",
			"always.remove": "Remove",
			"always.add": "Allow",
			"always.scoped": "workspace-scoped",
			"always.scopeRoot": "applies only in sessions under {root}",
			"always.scopeGlobal": "Scope: global",
			"always.scopeWorkspace": "Scope: workspace",
			"deny.title": "Never allow (deny)",
			"deny.empty": "None",
			"deny.remove": "Remove",
			"deny.add": "Add",
			"deny.placeholder": "Directory (trailing / or \\) or glob, e.g. C:\\secret\\ or *.pem",
			"recent.title": "Recently asked directories",
			"recent.clear": "Clear",
			"bypass.title": "Bypassed sessions",
			"bypass.cancel": "Re-engage",
			"error.remote": "Workspace Only management channel unavailable",
			"ask.strip": "Workspace Only: waiting for approval",
			"ask.headline": "{toolName} requests access outside the workspace",
			"ask.once": "Allow once",
			"ask.always": "Always allow this directory",
			"alwaysSensitive": "Always allow files like this",
			"ask.deny": "Deny"
		};
		//#endregion
		//#region lib/types/client/settings-store.js
		/**
		* Workspace Only state controller over the DSH 0.2 channels:
		* `ctx.remote.settings` (Config forms of the plugin's profile entry,
		* ns = "workspace-only") for the persisted switch/whitelist, and the
		* plugin's own `workspaceOnly/*` Remote endpoints for session bypass and
		* whitelist management. The management calls ride the Gateway's public
		* unary RPC (`connection.rpc.call("/api", endpoint, { args })`): a
		* third-party namespace gets no `remote.<ns>` accessor unless it ships a
		* generated client contribution. The store interface is unchanged so the
		* row and quick button stay presentation-only.
		*/
		var WorkspaceOnlySettingsController = class {
			remote;
			connection;
			store = createSnapshotStore({
				status: "idle",
				error: null,
				writable: false,
				enabled: false,
				revision: 0,
				always: [],
				alwaysScope: "global",
				deny: [],
				recent: [],
				sessions: []
			});
			generation = 0;
			view;
			constructor(remote, connection) {
				this.remote = remote;
				this.connection = connection;
			}
			unwrap(result) {
				if (result === null || result === void 0 || result.ok !== true) throw new Error(result?.error?.message ?? "remote call failed");
				return result.value;
			}
			/** Call one `workspaceOnly/<method>` endpoint through the Gateway RPC. */
			call(method, args) {
				return this.connection.rpc.call("/api", `workspaceOnly/${method}`, { args: args ?? {} });
			}
			async load() {
				const generation = ++this.generation;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				try {
					const response = this.unwrap(await this.remote.settings.describe());
					if (generation !== this.generation) return;
					const view = (response.namespaces ?? []).find((entry) => entry.ns === "workspace-only");
					if (view === void 0) {
						this.view = void 0;
						this.store.update((state) => {
							state.status = "unavailable";
							state.writable = false;
							state.enabled = false;
						});
						return;
					}
					this.accept(view, response.writable === true);
					await this.refreshRemote();
				} catch (error) {
					if (generation !== this.generation) return;
					this.fail(error);
				}
			}
			/** Pull management state (whitelist, recent asks, session bypass) from the plugin's Remote service. */
			async refreshRemote() {
				try {
					const snapshot = this.unwrap(await this.call("snapshot", {}));
					this.store.update((state) => {
						state.always = Array.isArray(snapshot.always) ? snapshot.always : [];
					state.alwaysScope = snapshot.alwaysScope === "workspace" ? "workspace" : "global";
					state.deny = Array.isArray(snapshot.deny) ? snapshot.deny : [];
						state.recent = Array.isArray(snapshot.recent) ? snapshot.recent : [];
						state.sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
					});
				} catch {
					// Older hosts without the management service keep the settings-only UI.
				}
			}
			async select(enabled) {
				const view = this.view;
				const state = this.store.getSnapshot();
				if (view === void 0 || !state.writable) return;
				const generation = ++this.generation;
				this.store.update((draft) => {
					draft.status = "saving";
					draft.error = null;
				});
				try {
					const next = this.unwrap(await this.remote.settings.mutate("workspace-only", [{
						op: "set",
						path: ["enabled"],
						value: enabled
					}], view.revision));
					if (generation !== this.generation) return;
					// `settings/mutate` returns the refreshed namespace view.
					this.accept(next?.ns === "workspace-only" ? next : view, true);
				} catch (error) {
					if (generation !== this.generation) return;
					this.fail(error);
				}
			}
			/** Persist a whitelist change through the plugin service (writes Config.always). */
			async allowAlways(dir) {
				try {
					this.unwrap(await this.call("addAlways", { dir }));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			async removeAlways(entry) {
				try {
					this.unwrap(await this.call("removeAlways", { entry }));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			/** Task T5: persist a never-allow rule through the plugin service (writes Config.deny). */
			async addDeny(entry) {
				try {
					this.unwrap(await this.call("addDeny", { entry }));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			async removeDeny(entry) {
				try {
					this.unwrap(await this.call("removeDeny", { entry }));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			async clearRecent() {
				try {
					this.unwrap(await this.call("clearRecent", {}));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			/** Task D: flip one session's bypass switch. */
			async setBypass(sessionId, enabled) {
				try {
					this.unwrap(await this.call("setBypass", { sessionId, enabled }));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			dispose() {
				this.generation += 1;
				this.view = void 0;
			}
			accept(view, writable) {
				this.view = view;
				this.store.update((state) => {
					state.status = "ready";
					state.error = null;
					state.writable = writable;
					state.enabled = view.value?.enabled === true;
					state.revision = view.revision;
				});
			}
			fail(error) {
				this.store.update((state) => {
					state.status = "error";
					state.error = error instanceof Error ? error.message : String(error);
				});
			}
		};
		//#endregion
		//#region lib/types/client/WorkspaceOnlyRow.js
		/**
		* Settings row: the global switch, the always-whitelist, recent asks
		* (one-click allow), and the sessions currently flying without the gate.
		*/
		function WorkspaceOnlyRow({ load, select, allowAlways, removeAlways, addDeny, removeDeny, clearRecent, setBypass, useWorkspaceOnly, t }) {
			const state = useWorkspaceOnly((snapshot) => snapshot);
			const [denyDraft, setDenyDraft] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			if (state.status === "unavailable") return null;
			const busy = state.status === "loading" || state.status === "saving";
			const enabled = state.enabled === true;
			const label = busy ? t("loading") : (enabled ? t("on") : t("off"));
			const description = state.error ?? t("description");
			const always = state.always ?? [];
			const deny = state.deny ?? [];
			const recent = state.recent ?? [];
			const sessions = state.sessions ?? [];
			const bypassed = sessions.filter((session) => session.bypass === true);
			return (0, react_jsx_runtime.jsxs)("div", {
				"data-workspace-only-row": true,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					"data-workspace-only-rowText": true,
					children: [(0, react_jsx_runtime.jsx)("div", {
						"data-workspace-only-title": true,
						children: t("title")
					}), (0, react_jsx_runtime.jsx)("div", {
						"data-workspace-only-desc": true,
						role: state.error === null ? void 0 : "alert",
						children: description
					}), (0, react_jsx_runtime.jsxs)("div", {
						"data-workspace-only-panel": true,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							"data-workspace-only-list": true,
							children: [(0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-title": true,
								children: [t("always.title"), " ", (0, react_jsx_runtime.jsx)("span", { "data-workspace-only-mini": true, children: state.alwaysScope === "workspace" ? t("always.scopeWorkspace") : t("always.scopeGlobal") })]
							}), always.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-item": true,
								children: t("always.empty")
							}) : always.map((entry) => { const dir = typeof entry === "string" ? entry : entry?.dir ?? ""; const root = typeof entry === "string" ? null : entry?.root ?? null; return (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: root === null ? dir : t("always.scopeRoot", { root }),
									children: root === null ? dir : `${dir} (${t("always.scoped")})`
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy,
									onClick: () => {
										removeAlways(entry);
									},
									children: t("always.remove")
								})]
							}, typeof entry === "string" ? entry : `${entry.root}|${entry.dir}`); })]
						}), (0, react_jsx_runtime.jsxs)("div", {
							"data-workspace-only-list": true,
							children: [(0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-title": true,
								children: t("deny.title")
							}), deny.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-item": true,
								children: t("deny.empty")
							}) : deny.map((entry) => (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: entry,
									children: entry
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy,
									onClick: () => {
										removeDeny(entry);
									},
									children: t("deny.remove")
								})]
							}, entry)), (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("input", {
									"data-workspace-only-path": true,
									value: denyDraft,
									placeholder: t("deny.placeholder"),
									onChange: (event) => {
										setDenyDraft(event.target.value);
									}
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy || denyDraft.trim() === "",
									onClick: () => {
										const entry = denyDraft.trim();
										if (entry !== "") {
											addDeny(entry);
											setDenyDraft("");
										}
									},
									children: t("deny.add")
								})]
							})]
						}), recent.length === 0 ? null : (0, react_jsx_runtime.jsxs)("div", {
							"data-workspace-only-list": true,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-title": true,
								children: [t("recent.title"), " ", (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									onClick: () => {
										clearRecent();
									},
									children: t("recent.clear")
								})]
							}), recent.slice(0, 20).map((entry) => (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: entry.dir,
									children: entry.dir
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy,
									onClick: () => {
										allowAlways(entry.dir);
									},
									children: t("always.add")
								})]
							}, `${entry.dir}|${entry.at}`))]
						}), bypassed.length === 0 ? null : (0, react_jsx_runtime.jsxs)("div", {
							"data-workspace-only-list": true,
							children: [(0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-title": true,
								children: t("bypass.title")
							}), bypassed.map((session) => (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: session.id,
									children: session.cwd || session.id
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy,
									onClick: () => {
										setBypass(session.id, false);
									},
									children: t("bypass.cancel")
								})]
							}, session.id))]
						})]
					})]
				}), (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"data-workspace-only-toggle": true,
					"aria-pressed": enabled,
					disabled: busy || !state.writable,
					onClick: () => {
						select(!enabled);
					},
					children: label
				})]
			});
		}
		//#endregion
		//#region lib/types/client/composer-toggle.js
		/**
		* Session-level quick switch next to the composer's permission selector
		* (task D). The trigger is found by its localized aria-label (same
		* heuristic the auto-mode plugin uses). Click toggles THIS session's
		* bypass; the button hides entirely while the global switch is off or no
		* session is open. A MutationObserver re-applies when the composer
		* remounts (session switch, layout change).
		*/
		const TRIGGER_LABEL = /(?:访问模式|Access mode)/i;
		/** Where the web shell persists the open session (`{ "sessionId": ... }`). */
		const CURRENT_SESSION_KEY = "dsh.sessions.current";
		/** Current session id: the shell's localStorage first, the composer election as hint. */
		function readCurrentSessionId(hint) {
			try {
				const raw = globalThis.localStorage?.getItem(CURRENT_SESSION_KEY);
				if (typeof raw === "string") {
					const parsed = JSON.parse(raw);
					if (typeof parsed?.sessionId === "string" && parsed.sessionId !== "") return parsed.sessionId;
				}
			} catch {
				// No localStorage (or bad JSON): fall through to the election hint.
			}
			return typeof hint?.id === "string" && hint.id !== "" ? hint.id : void 0;
		}
		function installComposerToggle(document, controller, t, sessionHint) {
			installStyles(document);
			const observer = new MutationObserver(() => {
				if (document.querySelector("[data-workspace-only-quick]") !== null) return;
				applyOnce();
			});
			const applyOnce = () => {
				const trigger = Array.from(document.querySelectorAll("button[aria-label]")).find((button) => TRIGGER_LABEL.test(button.getAttribute("aria-label") ?? ""));
				if (trigger === void 0) return;
				const modes = trigger.parentElement;
				const tools = modes?.parentElement;
				if (modes === null || modes === void 0 || tools === null || tools === void 0) return;
				if (tools.querySelector("[data-workspace-only-quick]") !== null) return;
				const button = document.createElement("button");
				button.type = "button";
				button.setAttribute("data-workspace-only-quick", "true");
				button.title = t("quick.tooltip");
				const render = () => {
					const state = controller.store.getSnapshot();
					const sessionId = readCurrentSessionId(sessionHint);
					// Hidden while the global switch is off or no session is open:
					// without a gate there is nothing for a session switch to do.
					const visible = state.enabled === true && sessionId !== void 0;
					button.style.display = visible ? "" : "none";
					if (!visible) return;
					const session = (state.sessions ?? []).find((entry) => entry.id === sessionId);
					const bypassed = session?.bypass === true;
					button.setAttribute("aria-pressed", String(!bypassed));
					button.setAttribute("data-active", String(!bypassed));
					button.setAttribute("data-bypass", String(bypassed));
					button.textContent = bypassed ? t("quick.off") : t("quick.on");
				};
				button.addEventListener("click", () => {
					const state = controller.store.getSnapshot();
					if (!state.writable) return;
					const sessionId = readCurrentSessionId(sessionHint);
					if (sessionId === void 0) return;
					const session = (state.sessions ?? []).find((entry) => entry.id === sessionId);
					controller.setBypass(sessionId, session?.bypass !== true);
				});
				button.__workspaceOnlyUnsubscribe = controller.store.subscribe(render);
				controller.load();
				tools.insertBefore(button, modes.nextSibling);
				render();
			};
			observer.observe(document.body, { childList: true, subtree: true });
			applyOnce();
			return () => {
				observer.disconnect();
				for (const el of document.querySelectorAll("[data-workspace-only-quick]")) {
					el.__workspaceOnlyUnsubscribe?.();
					el.remove();
				}
			};
		}
		//#endregion
		//#region lib/types/client/WorkspaceOnlyAskCard.js
		/**
		* Composer takeover for one pending gate ask — the same surface and
		* behavior as the platform's permission-escalation panel
		* (@deepseek-ai/dsh-client-ui-approval): a warning strip, the offending
		* tool/path/reason, and an action row. Enter = allow once, Esc = deny.
		* The pending request rides `uiSession.registerPendingInteraction`, so
		* the composer seats and unseats it exactly like an approval.
		*/
		function WorkspaceOnlyAskCard(props) {
			const ask = props.matched;
			const t = props.t;
			const [answered, setAnswered] = (0, react.useState)(false);
			const waiting = (0, react.useRef)(false);
			const active = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				active.current = true;
				// Presence handshake: only a card that actually mounted tells the
				// Host to wait for a decision. The id rides the pending projection
				// (`requestId`, mirrored from `key`) back to the Host.
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
			return (0, react_jsx_runtime.jsx)("div", {
				"data-workspace-only-askRoot": true,
				"aria-busy": answered,
				onKeyDown: keydown,
				children: (0, react_jsx_runtime.jsxs)("div", {
					"data-workspace-only-askCard": true,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						"data-workspace-only-askStrip": true,
						children: [(0, react_jsx_runtime.jsx)("span", {
							"data-workspace-only-askDot": true
						}), t("ask.strip")]
					}), (0, react_jsx_runtime.jsxs)("div", {
						"data-workspace-only-askBody": true,
						tabIndex: 0,
						role: "group",
						children: [(0, react_jsx_runtime.jsx)("div", {
							"data-workspace-only-askHeadline": true,
							children: t("ask.headline", { toolName: ask.toolName })
						}), (0, react_jsx_runtime.jsx)("div", {
							"data-workspace-only-askPath": true,
							children: ask.dir
						}), (0, react_jsx_runtime.jsx)("div", {
							"data-workspace-only-askReason": true,
							children: ask.reason
						})]
					}), (0, react_jsx_runtime.jsxs)("div", {
						"data-workspace-only-askActions": true,
						children: [(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"data-workspace-only-askButton": true,
							"data-variant": "danger",
							disabled: answered,
							onClick: () => {
								answer("deny");
							},
							children: t("ask.deny")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"data-workspace-only-askButton": true,
							"data-variant": "outline",
							disabled: answered,
							onClick: () => {
								answer("always");
							},
							children: t(ask.sensitive === true ? "alwaysSensitive" : "ask.always")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"data-workspace-only-askButton": true,
							"data-variant": "primary",
							disabled: answered,
							onClick: () => {
								answer("once");
							},
							children: t("ask.once")
						})]
					})]
				})
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		const inject = ["connection", "slots", "locale", "remote", "remote.settings", "uiSession"];
		function apply(ctx) {
			installStyles(document);
			const controller = new WorkspaceOnlySettingsController(ctx.remote, ctx.connection);
			// Session hint for the composer switch: the composer election keeps
			// it current; localStorage("dsh.sessions.current") is read live on top.
			const sessionHint = { id: void 0 };
			const load = () => controller.load();
			const select = (enabled) => controller.select(enabled);
			const injected = () => ({
				hooks: { workspaceOnly: controller.store },
				load,
				select,
				allowAlways: (dir) => controller.allowAlways(dir),
				removeAlways: (dir) => controller.removeAlways(dir),
				addDeny: (entry) => controller.addDeny(entry),
				removeDeny: (entry) => controller.removeDeny(entry),
				clearRecent: () => controller.clearRecent(),
				setBypass: (sessionId, enabled) => controller.setBypass(sessionId, enabled)
			});
			ctx.effect(() => ctx.locale.register("settings.workspaceOnly", {
				zh,
				en
			}), "workspace-only: settings row dictionaries");
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "workspace-only",
				order: -19,
				locale: "settings.workspaceOnly",
				inject: injected
			}, WorkspaceOnlyRow));
			// Task B's three-button panel: seat one pending ask in the composer,
			// exactly like the platform's permission-escalation takeover.
			const registerPendingInteraction = ctx.uiSession.registerPendingInteraction(() => 0);
			const raisePanel = (ask) => {
				if (ask === null || ask === void 0 || typeof ask.requestId !== "string") return;
				// Shape matches the platform's PendingApproval contract: the
				// composer's pending-interaction projection is per-session and
				// keys rendering off `kind`/`key`/`sessionId`/`result`.
				const completion = Promise.withResolvers();
				let settled = false;
				let remove = () => {};
				const settle = (choice) => {
					if (settled) return Promise.resolve();
					settled = true;
					completion.resolve(choice);
					return controller.call("decide", { requestId: ask.requestId, choice }).catch((error) => {
					console.warn("[workspace-only] decide RPC failed:", error);
					throw error;
				});
				};
				const pending = {
					kind: "workspace-only-ask",
					key: ask.requestId,
					// The card's presence handshake reports this id back to the
					// Host; without it announce() cannot match this ask and the
					// Host falls back to the generic question (double panels).
					requestId: ask.requestId,
					sessionId: ask.sessionId,
					toolName: String(ask.toolName ?? "tool"),
					reason: String(ask.reason ?? ""),
					dir: String(ask.dir ?? ""),
					result: completion.promise,
					get answerable() {
						return !settled;
					},
					answer: (choice) => settle(choice)
				};
				// The platform's answerApproval pattern: registerPendingInteraction
				// returns the seat's remove(), and the seat must be removed once
				// the result settles — otherwise the card never leaves the
				// composer even after a decision.
				completion.promise.then(() => {
					try {
						remove();
					} catch {
						// Already withdrawn by the framework.
					}
				});
				remove = registerPendingInteraction(pending, async () => {
					// Withdrawn (panel replaced or disposed): deny the ask.
					try {
						await settle("deny");
					} catch {
						// The Host-side timeout settles the ask anyway.
					}
				});
				// Presence: this handler running at all proves a Web client is
				// here. Announce now instead of waiting for React to mount the
				// card, so the Host's presence window never loses a race with
				// the render cycle; the card's own announce stays as an
				// idempotent second chance.
				controller.call("announce", { requestId: ask.requestId }).catch((error) => {
					console.warn("[workspace-only] announce RPC failed:", error);
				});
			};
			ctx.slots.inject("conversation.composer", () => ctx.slots.register({
				name: "conversation.composer",
				priority: 1,
				select: ({ sessionId, pendingInteraction }) => {
					// Election hint for the session switch below: the composer's
					// owner props carry the session this projection belongs to.
					if (typeof sessionId === "string" && sessionId !== "") sessionHint.id = sessionId;
					return pendingInteraction?.kind === "workspace-only-ask" ? pendingInteraction : null;
				},
				locale: "settings.workspaceOnly",
				inject: () => ({
					// Presence handshake: the card announces itself once actually
					// mounted, so the Host never waits out a panel that never
					// rendered. Idempotent with the arrival announce in raisePanel.
					announce: (requestId) => {
						controller.call("announce", { requestId }).catch((error) => {
							console.warn("[workspace-only] announce RPC failed:", error);
						});
					}
				})
			}, WorkspaceOnlyAskCard));
			ctx.effect(() => {
				const refresh = () => {
					controller.load();
				};
				const disposers = [ctx.remote.$on("settings/document-updated", (ns, extra) => {
					if (extra?.ask != null) {
						raisePanel(extra.ask);
						return;
					}
					if (ns !== "workspace-only") return;
					refresh();
				})];
				return () => {
					controller.dispose();
					for (const dispose of disposers) dispose();
				};
			}, "workspace-only: settings invalidations");
			ctx.effect(() => installComposerToggle(document, controller, ctx.locale.bind("settings.workspaceOnly"), sessionHint), "workspace-only: composer toggle");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
