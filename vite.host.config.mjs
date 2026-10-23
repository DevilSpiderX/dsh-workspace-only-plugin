import {defineConfig, minifySync} from "vite";

/**
 * 产物剥注释：源码注释写中文仅供阅读，构建产物不携带注释。
 * 只压空白与剥注释（codegen.removeWhitespace），不动标识符/语法
 * （compress/mangle 均关闭）——host 产物是 preserveModules 的 ESM，
 * 导出名与 require 契约必须原样保留。
 * @type {{name: string, generateBundle(*, *): void}}
 */
const stripComments = {
    name: "strip-comments",
    generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
            if (output.type !== "chunk") continue;
            const result = minifySync(output.fileName, output.code, {
                module: true, // 产物是 ESM（preserveModules）。
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

export default defineConfig({
    plugins: [stripComments],
    esbuild: {target: "esnext"}, // 零降级，零 helper 注入。
    build: {
        outDir: "lib",
        emptyOutDir: true, // host 先构建并清空 lib/，client 后追加。
        // Node 目标（计划 §5.2 假设的是默认 client 环境）：Vite 的浏览器 define
        // 处理会把 `process.env` 替换成空对象，破坏扫描器的 home 解析和
        // WORKSPACE_ONLY_PRESENCE_WAIT_MS。
        ssr: true,
        minify: false,
        target: "esnext",
        rollupOptions: {
            input: "src/host/index.js",
            // Vite 的 lib 模式默认把它设为 false，Rollup 对 preserveModules 会
            // 拒绝该值；"exports-only" 保留每个模块的导出面。
            preserveEntrySignatures: "exports-only",
            external: [/^node:/, /^@deepseek-ai\//], // 运行时依赖来自 dsh 宿主，绝不打进 bundle。
            output: {
                format: "es",
                preserveModules: true, // 每个源文件对应一个产物文件。
                preserveModulesRoot: "src/host", // src/host/index.js -> lib/index.js（扁平、同名）。
                entryFileNames: "[name].js"
            }
        }
    }
});
