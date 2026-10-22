window.__ModuleLoader__.load({
	id: "dsh-workspace-only-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
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
		// Settings row, lists and the composer trigger follow the platform's
		// component CSS (PermissionRow.module.css / PermissionSelect.module.css /
		// Input.module.css in @deepseek-ai/dsh-client-ui-primitives) using the
		// same --dsw-* design tokens; Menu/Input/Button themselves come from
		// ui-primitives and carry their own official styles.
		const CSS = `
[data-workspace-only-row]{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}
[data-workspace-only-rowText]{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}
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
			"scope.workspace": "仅工作区内",
			"scope.outsideRead": "工作区外只读",
			"scope.outsideWrite": "完全放开",
			"scope.tooltip": "仅对当前会话生效。仅工作区内：越界读写都询问；工作区外只读：越界读放行、越界写询问；完全放开：越界读写都放行。敏感文件与「永不放行」规则在任何档位都生效。总开关在 设置 → 通用设置 → Workspace Only。",
			"always.title": "总是允许的目录（全局）",
			"always.builtinTitle": "默认白名单（内置）",
			"always.builtinHint": "动态解析自 DSH_HOME（未设置时 ~/.dsh）：dsh-runtimes\\dsh-primary-runtime 目录树内免询问。随机器自动适配、不写入配置，deny 规则与敏感文件检查不受它影响。",
			"always.empty": "暂无",
			"always.remove": "移除",
			"always.add": "添加",
			"always.addGlobal": "加白",
			"always.placeholder": "目录路径，如 C:\\data\\ 或 /var/data/",
			"deny.title": "永不放行（deny）",
			"deny.empty": "暂无",
			"deny.remove": "移除",
			"deny.add": "添加",
			"deny.placeholder": "目录（以 / 或 \\ 结尾）或 glob，如 C:\\secret\\ 或 *.pem",
			"recent.title": "最近询问的目录",
			"recent.clear": "清空",
			"session.title": "放宽中的会话",
			"session.cancel": "恢复默认",
			"view.whitelist": "白名单目录",
			"panel.title": "白名单目录（本会话）",
			"panel.desc": "此处的目录只在当前工作区（{root}）的会话内免询问。全局白名单在 设置 → 通用设置 → Workspace Only 中管理。",
			"panel.descNoRoot": "此处的目录只在当前会话内免询问。全局白名单在 设置 → 通用设置 → Workspace Only 中管理。",
			"panel.empty": "暂无。可在此添加目录，或在询问卡片上选择「总是允许该目录」。",
			"panel.remove": "移除",
			"panel.add": "添加",
			"panel.placeholder": "目录路径，如 C:\\data\\ 或 /var/data/",
			"error.remote": "Workspace Only 管理通道不可用",
			"ask.strip": "Workspace Only：等待确认",
			"ask.headline": "{toolName} 请求访问工作区外的路径",
			"ask.once": "仅此一次",
			"ask.always": "总是允许该目录",
			"ask.alwaysHint": "「总是允许该目录」加入的是本会话白名单：仅当前工作区的会话生效，可在本页「白名单目录」中管理。",
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
			"scope.workspace": "Workspace only",
			"scope.outsideRead": "Outside read",
			"scope.outsideWrite": "Fully released",
			"scope.tooltip": "Applies to this session only. Workspace only: every outside access asks; Outside read: outside reads pass, outside writes ask; Fully released: outside access passes. Sensitive files and never-allow rules fire at every level. The global switch lives in Settings → General → Workspace Only.",
			"always.title": "Always-allowed directories (global)",
			"always.builtinTitle": "Default whitelist (built-in)",
			"always.builtinHint": "Resolved at runtime from DSH_HOME (default ~/.dsh): the dsh-runtimes\\dsh-primary-runtime subtree skips prompts. Adapted per machine, never persisted; deny rules and sensitive-file checks are unaffected.",
			"always.empty": "None",
			"always.remove": "Remove",
			"always.add": "Add",
			"always.addGlobal": "Allow",
			"always.placeholder": "Directory path, e.g. C:\\data\\ or /var/data/",
			"deny.title": "Never allow (deny)",
			"deny.empty": "None",
			"deny.remove": "Remove",
			"deny.add": "Add",
			"deny.placeholder": "Directory (trailing / or \\) or glob, e.g. C:\\secret\\ or *.pem",
			"recent.title": "Recently asked directories",
			"recent.clear": "Clear",
			"session.title": "Sessions with a wider scope",
			"session.cancel": "Restore default",
			"view.whitelist": "Whitelist",
			"panel.title": "Whitelist directories (this session)",
			"panel.desc": "Directories here skip prompts only in sessions under this workspace ({root}). Global entries are managed in Settings → General → Workspace Only.",
			"panel.descNoRoot": "Directories here skip prompts only in this session. Global entries are managed in Settings → General → Workspace Only.",
			"panel.empty": "None yet. Add a directory here, or choose “Always allow this directory” on an ask card.",
			"panel.remove": "Remove",
			"panel.add": "Add",
			"panel.placeholder": "Directory path, e.g. C:\\data\\ or /var/data/",
			"error.remote": "Workspace Only management channel unavailable",
			"ask.strip": "Workspace Only: waiting for approval",
			"ask.headline": "{toolName} requests access outside the workspace",
			"ask.once": "Allow once",
			"ask.always": "Always allow this directory",
			"ask.alwaysHint": "“Always allow this directory” adds a session whitelist entry: it applies only to sessions under this workspace and is managed in the “Whitelist” view of this page.",
			"alwaysSensitive": "Always allow files like this",
			"ask.deny": "Deny"
		};
		//#endregion
		//#region lib/types/client/settings-store.js
		/**
		* Workspace Only state controller over the DSH 0.2 channels:
		* `ctx.remote.settings` (Config forms of the plugin's profile entry,
		* ns = "workspace-only") for the persisted switch/whitelist, and the
		* plugin's own `workspaceOnly/*` Remote endpoints for session scope and
		* whitelist management. The management calls ride the Gateway's public
		* unary RPC (`connection.rpc.call("/api", endpoint, { args })`): a
		* third-party namespace gets no `remote.<ns>` accessor unless it ships a
		* generated client contribution. The store interface is unchanged so the
		* row and the composer selector stay presentation-only.
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
				builtinAlways: [],
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
			/** Pull management state (whitelist, recent asks, session scopes) from the plugin's Remote service. */
			async refreshRemote() {
				try {
					const snapshot = this.unwrap(await this.call("snapshot", {}));
					this.store.update((state) => {
						state.always = Array.isArray(snapshot.always) ? snapshot.always : [];
						state.builtinAlways = Array.isArray(snapshot.builtinAlways) ? snapshot.builtinAlways : [];
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
			/** Persist a SESSION-SCOPED whitelist entry through the plugin service (ask card, session page). */
			async allowAlways(dir, sessionId) {
				try {
					this.unwrap(await this.call("addAlways", { dir, sessionId }));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			/** Persist a GLOBAL whitelist entry through the plugin service (settings page). */
			async addGlobalAlways(dir) {
				try {
					this.unwrap(await this.call("addGlobalAlways", { dir }));
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
			/** Task D: set one session's access scope (workspace / outside-read / outside-write). */
			async setScope(sessionId, scope) {
				try {
					this.unwrap(await this.call("setScope", { sessionId, scope }));
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
		//#region lib/types/client/shared.js
		/** The three session-scope options (id = the Host's `SCOPE` value). */
		const SCOPE_OPTIONS = [
			{ id: "workspace", labelKey: "scope.workspace" },
			{ id: "outside-read", labelKey: "scope.outsideRead" },
			{ id: "outside-write", labelKey: "scope.outsideWrite" }
		];
		/**
		* Glyph per scope level — the platform permission menu's own icons
		* (PermissionSelect's `permissionGlyphs`), reused so the picker reads as
		* a sibling of 仅可查看 / 工作区内修改 / 完全权限: strictest first, in the
		* same progression the official menu shows. The trigger always shows
		* the glyph of the SELECTED level, matching its checked menu item.
		*/
		function scopeGlyph(scope) {
			if (scope === "outside-write") return (0, react_jsx_runtime.jsx)(ui_primitives.PermissionIconFullAccessRegular, {});
			if (scope === "outside-read") return (0, react_jsx_runtime.jsx)(ui_primitives.PermissionIconWorkspaceWriteRegular, {});
			return (0, react_jsx_runtime.jsx)(ui_primitives.PermissionIconReadOnlyRegular, {});
		}
		/** Global whitelist entries are plain strings; session-scoped ones are `{ root, dir }`. */
		function globalEntries(always) {
			return always.filter((entry) => typeof entry === "string");
		}
		/** Session-scoped entries granted under `root` (loose match; the Host judges authoritatively). */
		function scopedEntries(always, root) {
			const needle = typeof root === "string" ? root.replace(/[\\/]+$/, "").toLocaleLowerCase() : "";
			if (needle === "") return [];
			return always.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.dir === "string" && typeof entry.root === "string" && entry.root.replace(/[\\/]+$/, "").toLocaleLowerCase() === needle);
		}
		//#endregion
		//#region lib/types/client/WorkspaceOnlyRow.js
		/**
		* Settings row: the global switch, the GLOBAL always-whitelist (session
		* entries live in the session page's Whitelist view), deny rules, recent
		* asks (one-click allow), and the sessions currently running a wider scope.
		*/
		function WorkspaceOnlyRow({ load, select, addGlobalAlways, removeAlways, addDeny, removeDeny, clearRecent, setScope, useWorkspaceOnly, t }) {
			const state = useWorkspaceOnly((snapshot) => snapshot);
			const [denyDraft, setDenyDraft] = (0, react.useState)("");
			const [allowDraft, setAllowDraft] = (0, react.useState)("");
			(0, react.useEffect)(() => {
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
								children: t("always.builtinTitle")
							}), builtin.map((entry) => (0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-item": true,
								children: (0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: entry,
									children: entry
								})
							}, `builtin:${entry}`)), (0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-desc": true,
								children: t("always.builtinHint")
							})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							"data-workspace-only-list": true,
							children: [(0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-title": true,
								children: t("always.title")
							}), globals.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-item": true,
								children: t("always.empty")
							}) : globals.map((entry) => (0, react_jsx_runtime.jsxs)("div", {
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
										removeAlways(entry);
									},
									children: t("always.remove")
								})]
							}, entry)), (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-fieldRow": true,
								children: [(0, react_jsx_runtime.jsx)(ui_primitives.Input, {
									className: "workspaceOnlyGrow",
									value: allowDraft,
									placeholder: t("always.placeholder"),
									disabled: busy,
									onChange: (event) => {
										setAllowDraft(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
										const entry = allowDraft.trim();
										if (entry !== "") {
											addGlobalAlways(entry);
											setAllowDraft("");
										}
									}
								}), (0, react_jsx_runtime.jsx)(ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: busy || allowDraft.trim() === "",
									onClick: () => {
										const entry = allowDraft.trim();
										if (entry !== "") {
											addGlobalAlways(entry);
											setAllowDraft("");
										}
									},
									children: t("always.add")
								})]
							})]
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
								"data-workspace-only-fieldRow": true,
								children: [(0, react_jsx_runtime.jsx)(ui_primitives.Input, {
									className: "workspaceOnlyGrow",
									value: denyDraft,
									placeholder: t("deny.placeholder"),
									disabled: busy,
									onChange: (event) => {
										setDenyDraft(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
										const entry = denyDraft.trim();
										if (entry !== "") {
											addDeny(entry);
											setDenyDraft("");
										}
									}
								}), (0, react_jsx_runtime.jsx)(ui_primitives.Button, {
									variant: "outline",
									size: "sm",
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
										addGlobalAlways(entry.dir);
									},
									children: t("always.addGlobal")
								})]
							}, `${entry.dir}|${entry.at}`))]
						}), widened.length === 0 ? null : (0, react_jsx_runtime.jsxs)("div", {
							"data-workspace-only-list": true,
							children: [(0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-title": true,
								children: t("session.title")
							}), widened.map((session) => (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: session.id,
									children: session.cwd || session.id
								}), (0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-badge": true,
									children: scopeLabel(session.scope)
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy,
									onClick: () => {
										setScope(session.id, "workspace");
									},
									children: t("session.cancel")
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
		//#region lib/types/client/WorkspaceOnlyScopeSelect.js
		/**
		* Session-scope picker in the composer's tool row, right beside the
		* platform permission selector — the same trigger + Menu surface as
		* @deepseek-ai/dsh-client-ui-permission-presets' PermissionSelect. One
		* session's gate level: 仅工作区内 / 工作区外只读 / 完全放开. Hidden while
		* the global switch is off or no session is open.
		*/
		function WorkspaceOnlyScopeSelect({ useWorkspaceOnly, sessionId, setScope, load, t }) {
			const state = useWorkspaceOnly((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const session = (state.sessions ?? []).find((entry) => entry.id === sessionId);
			const scope = session?.scope ?? "workspace";
			// Hidden while the global switch is off or no session is open:
			// without a gate there is nothing for a session scope to do.
			if (state.status === "unavailable" || state.enabled !== true || sessionId === void 0) return null;
			const current = SCOPE_OPTIONS.find((option) => option.id === scope) ?? SCOPE_OPTIONS[0];
			const busy = state.status === "loading" || state.status === "saving";
			return (0, react_jsx_runtime.jsx)(ui_primitives.Menu, {
				open,
				onClose: () => {
					setOpen(false);
				},
				items: SCOPE_OPTIONS.map((option) => ({
					id: option.id,
					label: t(option.labelKey),
					icon: scopeGlyph(option.id)
				})),
				selectedId: current.id,
				onSelect: (id) => {
					setOpen(false);
					if (id === scope) return;
					setScope(id);
				},
				side: "top",
				portal: true,
				anchor: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"data-workspace-only-scope": true,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					title: t("scope.tooltip"),
					disabled: busy,
					onClick: () => {
						setOpen((value) => !value);
					},
					children: [(0, react_jsx_runtime.jsx)("span", {
						"data-workspace-only-scopeIcon": true,
						"aria-hidden": true,
						children: scopeGlyph(current.id)
					}), (0, react_jsx_runtime.jsx)("span", {
						"data-workspace-only-scopeLabel": true,
						children: t(current.labelKey)
					}), (0, react_jsx_runtime.jsx)("span", {
						"data-workspace-only-scopeChevron": true,
						"data-open": String(open),
						"aria-hidden": true,
						children: (0, react_jsx_runtime.jsx)(ui_primitives.IconChevronDownOutlineRegular, {})
					})]
				})
			});
		}
		//#endregion
		//#region lib/types/client/WorkspaceOnlyWhitelistView.js
		/**
		* Session page view (conversation.view tab "白名单目录"): the SESSION-SCOPED
		* whitelist entries of this session's workspace root — what an ask card's
		* "总是允许该目录" wrote. Global entries stay in Settings → General.
		*/
		function WorkspaceOnlyWhitelistView({ useWorkspaceOnly, sessionId, addEntry, removeEntry, load, t }) {
			const state = useWorkspaceOnly((snapshot) => snapshot);
			const [draft, setDraft] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const busy = state.status === "loading" || state.status === "saving";
			// The root rides the management snapshot (sessions[].cwd) and is
			// re-read on every store publication, so the list stays correct
			// once the first snapshot lands.
			const root = (state.sessions ?? []).find((entry) => entry.id === sessionId)?.cwd ?? "";
			const entries = scopedEntries(state.always ?? [], root);
			return (0, react_jsx_runtime.jsxs)("div", {
				"data-workspace-only-view": true,
				children: [(0, react_jsx_runtime.jsx)("div", {
					"data-workspace-only-viewTitle": true,
					children: t("panel.title")
				}), (0, react_jsx_runtime.jsx)("div", {
					"data-workspace-only-viewDesc": true,
					children: typeof root === "string" && root !== "" ? t("panel.desc", { root }) : t("panel.descNoRoot")
				}), state.error === null ? null : (0, react_jsx_runtime.jsx)("div", {
					// A failed add/remove used to die silently here ("the add
					// button does nothing"); surface the remote error instead.
					"data-workspace-only-viewDesc": true,
					role: "alert",
					children: state.error
				}), (0, react_jsx_runtime.jsx)("div", {
					"data-workspace-only-fieldRow": true,
					children: [(0, react_jsx_runtime.jsx)(ui_primitives.Input, {
						className: "workspaceOnlyGrow",
						value: draft,
						placeholder: t("panel.placeholder"),
						disabled: busy,
						onChange: (event) => {
							setDraft(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
							const entry = draft.trim();
							if (entry !== "") {
								addEntry(entry);
								setDraft("");
							}
						}
					}), (0, react_jsx_runtime.jsx)(ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						disabled: busy || draft.trim() === "",
						onClick: () => {
							const entry = draft.trim();
							if (entry !== "") {
								addEntry(entry);
								setDraft("");
							}
						},
						children: t("panel.add")
					})]
				}), entries.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
					"data-workspace-only-viewEmpty": true,
					children: t("panel.empty")
				}) : (0, react_jsx_runtime.jsx)("div", {
					"data-workspace-only-list": true,
					children: entries.map((entry) => (0, react_jsx_runtime.jsxs)("div", {
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
								removeEntry(entry);
							},
							children: t("panel.remove")
						})]
					}, `${entry.root}|${entry.dir}`))
				})]
			});
		}
		//#endregion
		//#region lib/types/client/WorkspaceOnlyAskCard.js
		/**
		* Composer takeover for one pending gate ask — the same surface and
		* behavior as the platform's permission-escalation panel
		* (@deepseek-ai/dsh-client-ui-approval): a warning strip, the offending
		* tool/path/reason, and an action row. Enter = allow once, Esc = deny.
		* The pending request rides `uiSession.registerPendingInteraction`, so
		* the composer seats and unseats it exactly like an approval. Its
		* `kind: "approval"` additionally lights the sidebar's pending dot
		* (with the platform's "待批准" copy); the `source: "workspace-only"`
		* marker keeps the composer election (see raisePanel) from claiming
		* an official PendingApproval.
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
						}), ask.sensitive === true ? null : (0, react_jsx_runtime.jsx)("div", {
							"data-workspace-only-askReason": true,
							children: t("ask.alwaysHint")
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
			const load = () => controller.load();
			const select = (enabled) => controller.select(enabled);
			const injected = () => ({
				hooks: { workspaceOnly: controller.store },
				load,
				select,
				addGlobalAlways: (dir) => controller.addGlobalAlways(dir),
				removeAlways: (entry) => controller.removeAlways(entry),
				addDeny: (entry) => controller.addDeny(entry),
				removeDeny: (entry) => controller.removeDeny(entry),
				clearRecent: () => controller.clearRecent(),
				setScope: (sessionId, scope) => controller.setScope(sessionId, scope)
			});
			ctx.effect(() => ctx.locale.register("settings.workspaceOnly", {
				zh,
				en
			}), "workspace-only: settings row dictionaries");
			const t = ctx.locale.bind("settings.workspaceOnly");
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "workspace-only",
				order: -19,
				locale: "settings.workspaceOnly",
				inject: injected
			}, WorkspaceOnlyRow));
			// Task D (revised): the session-scope picker sits in the composer's
			// tool row, at the same level as the platform permission selector
			// (`conversation.input.permission` renders right before this slot).
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "workspace-only-scope",
				order: 10,
				locale: "settings.workspaceOnly",
				inject: (sessionId) => ({
					hooks: { workspaceOnly: controller.store },
					sessionId,
					load,
					setScope: (scope) => controller.setScope(sessionId, scope)
				})
			}, WorkspaceOnlyScopeSelect));
			// Session-page view: the SESSION-SCOPED whitelist of this workspace
			// root (conversation.view tab, beside 对话 / 轨迹).
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "whitelist",
				order: 20,
				locale: "settings.workspaceOnly",
				label: () => t("view.whitelist"),
				inject: (sessionId) => ({
					hooks: { workspaceOnly: controller.store },
					sessionId,
					load,
					addEntry: (dir) => controller.allowAlways(dir, sessionId),
					removeEntry: (entry) => controller.removeAlways(entry)
				})
			}, WorkspaceOnlyWhitelistView));
			// Task B's three-button panel: seat one pending ask in the composer,
			// exactly like the platform's permission-escalation takeover.
			const registerPendingInteraction = ctx.uiSession.registerPendingInteraction(() => 0);
			// Task T12: live cards by requestId. A re-delivered ask payload must
			// never seat twice — the platform domain throws on duplicate keys and
			// the stray seat's card can never be closed ("the card won't close").
			const seats = new Map();
			const raisePanel = (ask) => {
				if (ask === null || ask === void 0 || typeof ask.requestId !== "string") return;
				if (seats.has(ask.requestId)) return;
				// Shape matches the platform's PendingApproval contract: the
				// composer's pending-interaction projection is per-session and
				// keys rendering off `kind`/`key`/`sessionId`/`result`.
				// `kind: "approval"` borrows the sidebar's visible-pending
				// whitelist (`visiblePendingKind` accepts only
				// approval/plan-review/question), so the session row lights its
				// warning dot while the ask is pending. Safe against the
				// official panels: the composer chain election matches them by
				// `instanceof PendingApproval`/`PendingQuestion`, never by
				// `kind`, so this borrowed value cannot hand our card to them
				// (verified on DSH 0.2.1-rc.2; if a future release elects by
				// `kind` string this collides and must be revisited). `source`
				// is the flip side: our selector must never claim an official
				// PendingApproval, whose `kind` is also "approval".
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
				// Task T12: unseat WITHOUT a decision — the Host already settled
				// this ask (dialog timeout, batch release, or another client's
				// click), so no decide RPC is owed and the stale card must go.
				const dismiss = () => {
					if (settled) return;
					settled = true;
					completion.resolve("deny");
				};
				const pending = {
					kind: "approval",
					source: "workspace-only",
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
					seats.delete(ask.requestId);
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
				seats.set(ask.requestId, dismiss);
				// Presence: this handler running at all proves a Web client is
				// here. Announce now instead of waiting for React to mount the
				// card, so the Host's presence window never loses a race with
				// the render cycle; the card's own announce stays as an
				// idempotent second chance.
				controller.call("announce", { requestId: ask.requestId }).catch((error) => {
					console.warn("[workspace-only] announce RPC failed:", error);
				});
			};
			// Task T12: the Host broadcasts `askDone` whenever an ask settles
			// without this client's own click (dialog timeout, batch release,
			// another tab's decision) — withdraw the card instead of leaving a
			// stale seat in the composer.
			const closePanel = (done) => {
				if (done === null || done === void 0 || typeof done.requestId !== "string") return;
				seats.get(done.requestId)?.dismiss();
			};
			ctx.slots.inject("conversation.composer", () => ctx.slots.register({
				name: "conversation.composer",
				priority: 1,
				select: ({ sessionId, pendingInteraction }) => pendingInteraction?.source === "workspace-only" ? pendingInteraction : null,
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
					if (extra?.askDone != null) {
						closePanel(extra.askDone);
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
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
