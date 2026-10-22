import {defineConfig, transformWithEsbuild} from "vite";

/**
 * 后处理：让产出的 chunk 严格符合 factory 外壳契约（迁移计划 §2.3）：
 * - Rollup 对 CJS external 可能发出单引号的 `require('x')`，而 check-compat
 *   探测 7 用 `require\("([^"]+)"\)`（只匹配双引号）提取 `require()` 集合——
 *   这里统一成双引号。
 * - Rollup 4 会给 CJS 输出追加自己的
 *   `Object.defineProperty(exports, Symbol.toStringTag, ...)` 标记；外壳已在
 *   `intro` 中提供，所以去掉重复（`output.esModule: false` 压制不了它）。
 * @type {{name: string, generateBundle(*, *): void}}
 */
const normalizeRequireQuotes = {
    name: "normalize-require-quotes",
    generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
            if (output.type === "chunk") {
                output.code = output.code
                    .replace(/require\('([^']+)'\)/g, 'require("$1")')
                    .replace(/Object\.defineProperty\(exports, Symbol\.toStringTag, \{ value: 'Module' \}\);\r?\n?/g, "");
            }
        }
    }
};

/**
 * 产物剥注释（同 host 侧）：只压空白与剥注释，不动标识符/语法，
 * factory 外壳的 id/require 契约与 check-compat 的双引号探测保持成立。
 * @type {{name: string, generateBundle(*, *): Promise<void>}}
 */
const stripComments = {
    name: "strip-comments",
    async generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
            if (output.type !== "chunk") continue;
            const result = await transformWithEsbuild(output.code, output.fileName, {
                minifyWhitespace: true,
                minifyIdentifiers: false,
                minifySyntax: false,
                treeShaking: false,
                legalComments: "none"
            });
            output.code = result.code;
        }
    }
};

export default defineConfig({
    esbuild: {jsx: "automatic", jsxImportSource: "react", target: "esnext"},
    // 顺序不能反：先把引号归一化 + 去掉重复 toStringTag，再剥注释
    //（esbuild 会把剩余字符串统一成双引号，先剥会毁掉去重用的单引号模式）。
    plugins: [normalizeRequireQuotes, stripComments],
    build: {
        outDir: "lib",
        emptyOutDir: false, // 保留 host 产物。
        minify: false,
        target: "esnext",
        lib: {
            entry: "src/client/index.jsx",
            formats: ["cjs"], // 主体是 require(...)/exports.xxx = ...，匹配 factory 签名。
            fileName: () => "client.js" // "type": "module" 的包会默认产出 .cjs；这里锁死 .js。
        },
        rollupOptions: {
            external: ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"],
            output: {
                inlineDynamicImports: true, // 单文件、单 chunk。
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
