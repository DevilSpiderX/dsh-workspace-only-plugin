import { defineConfig } from "vite";

// Post-processing that keeps the emitted chunk faithful to the factory shell
// contract (§2.3 of the migration plan):
// - Rollup may emit single-quoted `require('x')` for CJS externals, while
//   check-compat probe 7 extracts the `require()` set with `require\("([^"]+)"\)`
//   (double quotes only) — normalize the quotes.
// - Rollup 4 appends its own `Object.defineProperty(exports, Symbol.toStringTag, ...)`
//   marker to CJS output; the shell already provides it in `intro`, so drop the
//   duplicate (`output.esModule: false` does not suppress it).
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

export default defineConfig({
	esbuild: { jsx: "automatic", jsxImportSource: "react", target: "esnext" },
	plugins: [normalizeRequireQuotes],
	build: {
		outDir: "lib",
		emptyOutDir: false, // Keep the host artifacts.
		minify: false,
		target: "esnext",
		lib: {
			entry: "src/client/index.jsx",
			formats: ["cjs"], // The body is require(...)/exports.xxx = ..., matching the factory signature.
			fileName: () => "client.js" // A "type": "module" package would default to .cjs; lock .js.
		},
		rollupOptions: {
			external: ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"],
			output: {
				inlineDynamicImports: true, // Single file, single chunk.
				// Rollup would append its own `Symbol.toStringTag` marker to the
				// factory body; the shell provides it in `intro` already.
				esModule: false,
				// The DSH official tsdown recipe (packages/client/tsdown.client.ts):
				banner: 'window.__ModuleLoader__.load({ id: "dsh-workspace-only-plugin", factory: (require) => {',
				intro: 'var module = { exports: {} }; var exports = module.exports;\n'
					+ 'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
				footer: 'return module.exports; } });'
			}
		}
	}
});
