window.__ModuleLoader__.load({
	id: "dsh-workspace-only-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
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
[data-workspace-only-menuTitle]{padding:4px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}`;
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
			"quick.bypass": "本会话放飞",
			"menu.title": "Workspace Only 会话",
			"menu.bypassOn": "放飞本会话（不限制文件访问）",
			"menu.bypassOff": "恢复本会话的门禁",
			"menu.sessions": "会话：",
			"menu.refresh": "刷新",
			"always.title": "总是允许的目录",
			"always.empty": "暂无",
			"always.remove": "移除",
			"always.add": "加白",
			"recent.title": "最近询问的目录",
			"recent.clear": "清空",
			"bypass.title": "放飞中的会话",
			"bypass.cancel": "恢复门禁",
			"error.remote": "Workspace Only 管理通道不可用"
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
			"quick.bypass": "This session bypassed",
			"menu.title": "Workspace Only sessions",
			"menu.bypassOn": "Bypass this session (no file gate)",
			"menu.bypassOff": "Re-engage the gate for this session",
			"menu.sessions": "Sessions:",
			"menu.refresh": "Refresh",
			"always.title": "Always-allowed directories",
			"always.empty": "None",
			"always.remove": "Remove",
			"always.add": "Allow",
			"recent.title": "Recently asked directories",
			"recent.clear": "Clear",
			"bypass.title": "Bypassed sessions",
			"bypass.cancel": "Re-engage",
			"error.remote": "Workspace Only management channel unavailable"
		};
		//#endregion
		//#region lib/types/client/settings-store.js
		/**
		* Workspace Only state controller over the DSH 0.2 channels:
		* `ctx.remote.settings` (Config forms of the plugin's profile entry,
		* ns = "workspace-only") for the persisted switch/whitelist, and
		* `ctx.remote.workspaceOnly` (the plugin's source-mode Remote service)
		* for session bypass and whitelist management. The store interface is
		* unchanged so the row and quick button stay presentation-only.
		*/
		var WorkspaceOnlySettingsController = class {
			remote;
			store = runtime_client.createSnapshotStore({
				status: "idle",
				error: null,
				writable: false,
				enabled: false,
				revision: 0,
				always: [],
				recent: [],
				sessions: []
			});
			generation = 0;
			view;
			constructor(remote) {
				this.remote = remote;
			}
			unwrap(result) {
				if (result === null || result === void 0 || result.ok !== true) throw new Error(result?.error?.message ?? "remote call failed");
				return result.value;
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
					const snapshot = this.unwrap(await this.remote.workspaceOnly.snapshot());
					this.store.update((state) => {
						state.always = Array.isArray(snapshot.always) ? snapshot.always : [];
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
					this.unwrap(await this.remote.workspaceOnly.addAlways(dir));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			async removeAlways(dir) {
				try {
					this.unwrap(await this.remote.workspaceOnly.removeAlways(dir));
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			async clearRecent() {
				try {
					this.unwrap(await this.remote.workspaceOnly.clearRecent());
					await this.refreshRemote();
				} catch (error) {
					this.fail(error);
				}
			}
			/** Task D: flip one session's bypass switch. */
			async setBypass(sessionId, enabled) {
				try {
					this.unwrap(await this.remote.workspaceOnly.setBypass(sessionId, enabled));
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
		function WorkspaceOnlyRow({ load, select, allowAlways, removeAlways, clearRecent, setBypass, useWorkspaceOnly, t }) {
			const state = useWorkspaceOnly((snapshot) => snapshot);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			if (state.status === "unavailable") return null;
			const busy = state.status === "loading" || state.status === "saving";
			const enabled = state.enabled === true;
			const label = busy ? t("loading") : (enabled ? t("on") : t("off"));
			const description = state.error ?? t("description");
			const always = state.always ?? [];
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
								children: t("always.title")
							}), always.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
								"data-workspace-only-item": true,
								children: t("always.empty")
							}) : always.map((dir) => (0, react_jsx_runtime.jsxs)("div", {
								"data-workspace-only-item": true,
								children: [(0, react_jsx_runtime.jsx)("span", {
									"data-workspace-only-path": true,
									title: dir,
									children: dir
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-workspace-only-mini": true,
									disabled: busy,
									onClick: () => {
										removeAlways(dir);
									},
									children: t("always.remove")
								})]
							}, dir))]
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
		* Quick switch next to the composer's permission selector. The trigger is
		* found by its localized aria-label (same heuristic the auto-mode plugin
		* uses). Left click toggles the global switch; right click (or a long
		* press) opens the session menu — task D's per-session bypass entry. A
		* MutationObserver re-applies when the composer remounts (session switch,
		* layout change).
		*/
		const TRIGGER_LABEL = /(?:访问模式|Access mode)/i;
		function installComposerToggle(document, controller, t) {
			installStyles(document);
			let menu = null;
			const closeMenu = () => {
				if (menu !== null) {
					menu.remove();
					menu = null;
				}
			};
			const observer = new MutationObserver(() => {
				if (document.querySelector("[data-workspace-only-quick]") !== null) return;
				applyOnce();
			});
			const openMenu = (anchor) => {
				closeMenu();
				const rect = anchor.getBoundingClientRect();
				const panel = document.createElement("div");
				panel.setAttribute("data-workspace-only-menu", "true");
				panel.style.left = `${Math.max(8, rect.left)}px`;
				panel.style.top = `${Math.max(8, rect.top - 8)}px`;
				panel.style.transform = "translateY(-100%)";
				const state = controller.store.getSnapshot();
				const sessions = state.sessions ?? [];
				const title = document.createElement("div");
				title.setAttribute("data-workspace-only-menuTitle", "true");
				title.textContent = t("menu.title");
				panel.appendChild(title);
				const item = (label, onClick) => {
					const button = document.createElement("button");
					button.type = "button";
					button.setAttribute("data-workspace-only-menuItem", "true");
					button.textContent = label;
					button.addEventListener("click", () => {
						closeMenu();
						onClick();
					});
					panel.appendChild(button);
				};
				if (sessions.length <= 1) {
					const only = sessions[0];
					if (only === void 0) {
						item(t("menu.refresh"), () => {
							controller.refreshRemote();
						});
					} else if (only.bypass === true) {
						item(t("menu.bypassOff"), () => {
							controller.setBypass(only.id, false);
						});
					} else {
						item(t("menu.bypassOn"), () => {
							controller.setBypass(only.id, true);
						});
					}
				} else {
					const heading = document.createElement("div");
					heading.setAttribute("data-workspace-only-menuTitle", "true");
					heading.textContent = t("menu.sessions");
					panel.appendChild(heading);
					for (const session of sessions) {
						const name = session.cwd || session.id;
						item(session.bypass === true ? `${t("menu.bypassOff")} — ${name}` : `${t("menu.bypassOn")} — ${name}`, () => {
							controller.setBypass(session.id, session.bypass !== true);
						});
					}
				}
				document.body.appendChild(panel);
				menu = panel;
			};
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
				button.setAttribute("aria-pressed", "false");
				const render = () => {
					const state = controller.store.getSnapshot();
					const on = state.enabled === true;
					const bypassed = (state.sessions ?? []).some((session) => session.bypass === true);
					button.setAttribute("aria-pressed", String(on));
					button.setAttribute("data-active", String(on));
					button.setAttribute("data-bypass", String(bypassed));
					button.textContent = bypassed ? t("quick.bypass") : (on ? t("quick.on") : t("quick.off"));
				};
				let pressTimer = null;
				button.addEventListener("click", () => {
					const state = controller.store.getSnapshot();
					if (!state.writable) return;
					controller.select(state.enabled !== true);
				});
				button.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					controller.refreshRemote().then(() => openMenu(button));
				});
				button.addEventListener("pointerdown", () => {
					pressTimer = setTimeout(() => {
						pressTimer = null;
						controller.refreshRemote().then(() => openMenu(button));
					}, 550);
				});
				const cancelPress = () => {
					if (pressTimer !== null) {
						clearTimeout(pressTimer);
						pressTimer = null;
					}
				};
				button.addEventListener("pointerup", cancelPress);
				button.addEventListener("pointerleave", cancelPress);
				button.__workspaceOnlyUnsubscribe = controller.store.subscribe(render);
				controller.load();
				tools.insertBefore(button, modes.nextSibling);
				render();
			};
			observer.observe(document.body, { childList: true, subtree: true });
			applyOnce();
			const dismiss = (event) => {
				if (menu === null) return;
				if (menu.contains(event.target)) return;
				closeMenu();
			};
			document.addEventListener("click", dismiss, true);
			return () => {
				observer.disconnect();
				document.removeEventListener("click", dismiss, true);
				closeMenu();
				for (const el of document.querySelectorAll("[data-workspace-only-quick]")) {
					el.__workspaceOnlyUnsubscribe?.();
					el.remove();
				}
			};
		}
		//#endregion
		//#region lib/types/client/index.js
		const inject = ["connection", "slots", "locale", "remote"];
		function apply(ctx) {
			installStyles(document);
			const controller = new WorkspaceOnlySettingsController(ctx.remote);
			const load = () => controller.load();
			const select = (enabled) => controller.select(enabled);
			const injected = () => ({
				hooks: { workspaceOnly: controller.store },
				load,
				select,
				allowAlways: (dir) => controller.allowAlways(dir),
				removeAlways: (dir) => controller.removeAlways(dir),
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
			ctx.effect(() => {
				const refresh = () => {
					controller.load();
				};
				const disposers = [ctx.remote.$on("settings/document-updated", (ns) => {
					if (ns !== "workspace-only") return;
					refresh();
				})];
				return () => {
					controller.dispose();
					for (const dispose of disposers) dispose();
				};
			}, "workspace-only: settings invalidations");
			ctx.effect(() => installComposerToggle(document, controller, ctx.locale.bind("settings.workspaceOnly")), "workspace-only: composer toggle");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
