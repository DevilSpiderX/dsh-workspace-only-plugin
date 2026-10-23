import path from "node:path";
import {defineConfig} from "vite";

/**
 * DSH 加载器只吃单文件 JS，样式不能落盘成 .css 产物：把 vite 从
 * `*.module.css` 提取出来的 css asset 拼接注入 styles.js 的占位符
 *（`__WORKSPACE_ONLY_CSS__`），再把 asset 从产物里删除。generateBundle
 * 跑在 minify 之后——注入的 CSS 文本不再经过 oxc 重打，字面量原样保留。
 * @type {{name: string, generateBundle(*, *): void}}
 */
const inlineCssAsset = {
    name: "inline-css-asset",
    // order: "post"：vite 的 css-post 插件在普通 generateBundle 之后才把
    // css asset 放进 bundle（实测普通时机只见 chunk），必须后置才看得到。
    generateBundle: {
        order: "post",
        handler(_options, bundle) {
            const sheets = [];
            for (const [fileName, output] of Object.entries(bundle)) {
                if (output.type !== "asset" || !fileName.endsWith(".css")) continue;
                sheets.push(typeof output.source === "string" ? output.source : Buffer.from(output.source).toString("utf8"));
                delete bundle[fileName];
            }
            if (sheets.length === 0) return;
            // `/*$vite$:N*/` 是 vite css-post 的 hash 更新标记（dev 用），构建产物
            // 不带它；它的清洗 hook 跑在我们之后，这里顺手剥掉。
            const css = sheets.join("\n").replace(/\/\*\$vite\$:\d+\*\/\r?\n?/g, "");
            for (const output of Object.values(bundle)) {
                if (output.type !== "chunk") continue;
                let replaced = false;
                // 用函数替换：CSS 文本里的 `$&` 之类序列不能进字符串替换模式。
                output.code = output.code.replace(/(["'`])__WORKSPACE_ONLY_CSS__\1/, () => {
                    replaced = true;
                    return JSON.stringify(css);
                });
                if (!replaced) throw new Error(`inline-css-asset: placeholder __WORKSPACE_ONLY_CSS__ not found in ${output.fileName}`);
            }
        }
    }
};

export default defineConfig({
    esbuild: {jsx: "automatic", jsxImportSource: "react", target: "esnext"},
    // 类名 = `文件名__类名`：跨文件不撞、产物可读。不能用 `[name]` 模板——
    // vite 的 css-modules 管线里它恒解析成 "module"（实测），所有文件互相撞。
    css: {modules: {generateScopedName: (name, filename) => `${path.basename(String(filename)).replace(/\.module\.css.*$/, "")}__${name}`}},
    // 与官方 tsdown 产物同形态：全压缩、不为任何看守保留字面形态
    //（`factory: (require) =>` 会被 mangle、字符串引号由 codegen 自选）。
    plugins: [inlineCssAsset],
    build: {
        outDir: "lib",
        emptyOutDir: false, // 保留 host 产物。
        minify: "oxc", // 全量压缩（compress + mangle + 压空白），默认档即所需形态。
        cssMinify: true, // CSS 也剥注释压空白。
        target: "esnext",
        lib: {
            entry: "src/client/index.jsx",
            formats: ["cjs"], // 主体是 require(...)/exports.xxx = ...，匹配 factory 签名。
            fileName: () => "client.js" // "type": "module" 的包会默认产出 .cjs；这里锁死 .js。
        },
        rollupOptions: {
            external: ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"],
            output: {
                codeSplitting: false, // 单文件、单 chunk（旧名 inlineDynamicImports，vite 8 弃用）。
                // 不输出 __esModule 标记；bundler 追加的 Symbol.toStringTag 标记
                // 任其存在（官方产物同样带着，无害）。
                esModule: false,
                // DSH 官方 tsdown 配方（packages/client/tsdown.client.ts 的
                // outputOptions）：intro 只有 module/exports 两行，不带任何
                // toStringTag 标记。
                banner: 'window.__ModuleLoader__.load({ id: "dsh-workspace-only-plugin", factory: (require) => {',
                intro: 'var module = { exports: {} }; var exports = module.exports;',
                footer: 'return module.exports; } });'
            }
        }
    }
});
