export const PLUGIN_ID = "dsh-workspace-only-plugin";

/**
 * 样式源是 `src/client/*.module.css`（CSS Modules，官方 ui-primitives 同款
 * `import css from "./X.module.css"` 惯例）。构建期由 vite.client.config.mjs
 * 的 inline-css-asset 插件把各 module.css 的内容拼接注入这里的占位符、并把
 * css asset 从产物中删除——DSH 加载器只加载单文件 JS，CSS 必须内联；
 * 运行时仍由 installStyles 幂等注入 <style> 标签。
 * @type {string}
 */
const CSS = "__WORKSPACE_ONLY_CSS__";

export function installStyles(document) {
    if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`) !== null) return;
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
}
