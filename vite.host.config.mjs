import { defineConfig } from "vite";

export default defineConfig({
	esbuild: { target: "esnext" }, // Zero downleveling, zero helper injection.
	build: {
		outDir: "lib",
		emptyOutDir: true, // Host builds first and clears lib/, client appends after.
		// Node target (plan §5.2 assumed the default client environment): Vite's
		// browser define pass would replace `process.env` with an empty object,
		// breaking the scanner's home resolution and WORKSPACE_ONLY_PRESENCE_WAIT_MS.
		ssr: true,
		minify: false,
		target: "esnext",
		rollupOptions: {
			input: "src/host/index.js",
			// Vite's lib mode defaults this to false, which Rollup rejects for
			// preserveModules; "exports-only" keeps each module's export surface.
			preserveEntrySignatures: "exports-only",
			external: [/^node:/, /^@deepseek-ai\//], // Runtime deps come from the dsh host; never bundle them.
			output: {
				format: "es",
				preserveModules: true, // One artifact per source file.
				preserveModulesRoot: "src/host", // src/host/index.js -> lib/index.js (flat, same names).
				entryFileNames: "[name].js"
			}
		}
	}
});
