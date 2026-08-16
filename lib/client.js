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
[data-workspace-only-quick][data-active="true"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}`;
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
			"quick.off": "仅工作区：关"
		};
		const en = {
			"title": "Workspace Only",
			"description": "When on, agent file access in every mode is confined to the current workspace",
			"loading": "Loading",
			"unavailable": "Unavailable",
			"on": "On",
			"off": "Off",
			"quick.on": "Workspace Only: On",
			"quick.off": "Workspace Only: Off"
		};
		//#endregion
		//#region lib/types/client/settings-store.js
		/** Workspace Only default-settings controller over the host settings wire. */
		var WorkspaceOnlySettingsController = class {
			api;
			store = runtime_client.createSnapshotStore({
				status: "idle",
				error: null,
				writable: false,
				enabled: false,
				revision: 0
			});
			generation = 0;
			view;
			constructor(api) {
				this.api = api;
			}
			async load() {
				const generation = ++this.generation;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				try {
					const response = await this.api.settings.describe({});
					if (!response.result.ok) throw new Error(response.result.error.message);
					if (generation !== this.generation) return;
					const view = response.result.value.namespaces.find((entry) => entry.ns === "workspace-only");
					if (view === void 0) {
						this.view = void 0;
						this.store.update((state) => {
							state.status = "unavailable";
							state.writable = false;
							state.enabled = false;
						});
						return;
					}
					this.accept(view, response.result.value.writable);
				} catch (error) {
					if (generation !== this.generation) return;
					this.fail(error);
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
					const response = await this.api.settings.mutate({
						ns: "workspace-only",
						ops: [{
							op: "set",
							path: ["enabled"],
							value: enabled
						}],
						expectedRevision: view.revision
					});
					if (generation !== this.generation) return;
					if (!response.result.ok) throw new Error(response.result.error.message);
					this.accept(response.result.value, true);
				} catch (error) {
					if (generation !== this.generation) return;
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
		* Settings row: the global Workspace Only switch, mirroring the
		* permission row's presentation.
		*/
		function WorkspaceOnlyRow({ load, select, useWorkspaceOnly, t }) {
			const state = useWorkspaceOnly((snapshot) => snapshot);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			if (state.status === "unavailable") return null;
			const busy = state.status === "loading" || state.status === "saving";
			const enabled = state.enabled === true;
			const label = busy ? t("loading") : (enabled ? t("on") : t("off"));
			const description = state.error ?? t("description");
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
		* uses). The button is inserted into the composer's `.tools` row right
		* after the `.modes` group, so the row's own 16px gap spaces it exactly
		* like the gap between the mode switch and the "+" button. A
		* MutationObserver re-applies when the composer remounts (session
		* switch, layout change).
		*/
		const TRIGGER_LABEL = /(?:访问模式|Access mode)/i;
		function installComposerToggle(document, controller, t) {
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
				button.setAttribute("aria-pressed", "false");
				const render = () => {
					const state = controller.store.getSnapshot();
					const on = state.enabled === true;
					button.setAttribute("aria-pressed", String(on));
					button.setAttribute("data-active", String(on));
					button.textContent = on ? t("quick.on") : t("quick.off");
				};
				button.addEventListener("click", () => {
					const state = controller.store.getSnapshot();
					if (!state.writable) return;
					controller.select(state.enabled !== true);
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
		//#region lib/types/client/index.js
		const inject = ["connection", "slots", "locale", "remote"];
		function apply(ctx) {
			installStyles(document);
			const controller = new WorkspaceOnlySettingsController(ctx.get("connection").api);
			const load = () => controller.load();
			const select = (enabled) => controller.select(enabled);
			const injected = () => ({
				hooks: { workspaceOnly: controller.store },
				load,
				select
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
