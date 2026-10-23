import {defineConfig} from "vite";

export default defineConfig({
    esbuild: {target: "esnext"}, // 零降级，零 helper 注入。
    build: {
        outDir: "lib",
        emptyOutDir: true, // host 先构建并清空 lib/，client 后追加。
        // Node 目标（计划 §5.2 假设的是默认 client 环境）：Vite 的浏览器 define
        // 处理会把 `process.env` 替换成空对象，破坏扫描器的 home 解析和
        // WORKSPACE_ONLY_PRESENCE_WAIT_MS。
        ssr: true,
        minify: "oxc",
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
