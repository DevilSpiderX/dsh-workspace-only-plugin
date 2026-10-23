import path from "node:path";
import {defineConfig, minifySync} from "vite";

/**
 * 后处理：让产出的 chunk 严格符合 factory 外壳契约（迁移计划 §2.3）：
 * - Rollup/Rolldown 对 CJS external 可能发出单引号的 `require('x')`，而 check-compat
 *   探测 7 用 `require\("([^"]+)"\)`（只匹配双引号）提取 `require()` 集合——
 *   这里统一成双引号。
 * - Rollup 4 / Rolldown 会给 CJS 输出追加自己的
 *   `Object.defineProperty(exports, Symbol.toStringTag, ...)` 标记；外壳已在
 *   `intro` 中提供，所以去掉重复（`output.esModule: false` 压制不了它）。
 *   引号/空白形态随 bundler 而异（Rollup 单引号、Rolldown 双引号），按宽松
 *   形态匹配、按出现次序去重：intro 那条在 banner/ink 拼接顺序里永远最先，
 *   保留第一条、删掉 bundler 追加的后续条目。
 * @type {{name: string, generateBundle(*, *): void}}
 */
const normalizeRequireQuotes = {
    name: "normalize-require-quotes",
    generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
            if (output.type === "chunk") {
                let seenToStringTag = false;
                output.code = output.code
                    .replace(/require\('([^']+)'\)/g, 'require("$1")')
                    .replace(/Object\.defineProperty\(exports,\s*Symbol\.toStringTag,\s*\{\s*value:\s*["']Module["']\s*\}\);?\r?\n?/g, (match) => {
                        if (seenToStringTag) return "";
                        seenToStringTag = true;
                        return match;
                    });
            }
        }
    }
};

/**
 * 产物剥注释（同 host 侧）：只压空白与剥注释（codegen.removeWhitespace），
 * 不动标识符/语法（compress/mangle 均关闭），factory 外壳的 id/require
 * 契约与 check-compat 的双引号探测保持成立。
 * @type {{name: string, generateBundle(*, *): void}}
 */
const stripComments = {
    name: "strip-comments",
    generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
            if (output.type !== "chunk") continue;
            const result = minifySync(output.fileName, output.code, {
                compress: false, // 不动语法，对应 esbuild 的 minifySyntax: false。
                mangle: false, // 不动标识符，对应 minifyIdentifiers: false。
                codegen: {
                    removeWhitespace: true, // 压空白，对应 minifyWhitespace: true。
                    legalComments: "none"
                }
            });
            if (result.errors.length > 0) {
                throw new Error(`strip-comments failed on ${output.fileName}: ${result.errors.map((error) => error.message ?? String(error)).join("; ")}`);
            }
            output.code = result.code;
        }
    }
};

/**
 * DSH 加载器只吃单文件 JS，样式不能落盘成 .css 产物：把 vite 从
 * `*.module.css` 提取出来的 css asset 拼接注入 styles.js 的占位符
 *（`__WORKSPACE_ONLY_CSS__`），再把 asset 从产物里删除。放在
 * stripComments 之后——CSS 文本不再经过 oxc 重打，字面量原样保留。
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
    // 顺序保持：先把引号归一化 + 去掉重复 toStringTag，再剥注释，
    // 最后把 CSS 注入占位符——归一化/去重的正则做在未压形态上匹配最稳，
    // 压空白后形态不可逆；CSS 文本则要避开整段 JS 的重打。
    plugins: [normalizeRequireQuotes, stripComments, inlineCssAsset],
    build: {
        outDir: "lib",
        emptyOutDir: false, // 保留 host 产物。
        minify: false,
        cssMinify: true, // CSS 也剥注释压空白（build.minify: false 不连带它）。
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
                // Rollup 会给 factory 主体追加自己的 `Symbol.toStringTag` 标记；
                // 外壳已在 `intro` 中提供。
                esModule: false,
                // DSH 官方 tsdown 配方（packages/client/tsdown.client.ts）：
                banner: 'window.__ModuleLoader__.load({ id: "dsh-workspace-only-plugin", factory: (require) => {',
                intro: 'var module = { exports: {} }; var exports = module.exports;\n'
                    + 'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
                footer: 'return module.exports; } });'
            }
        }
    }
});
