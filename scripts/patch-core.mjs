/**
 * Re-apply the two small node_modules patches this plugin needs, idempotently.
 * dsh core upgrades wipe them; run `node scripts/patch-core.mjs` to restore.
 *
 * 1. dsh-host-apiproxy WEB_SETTINGS_NAMESPACES: expose the "workspace-only"
 *    settings namespace to the Web client (the documented extension seam for
 *    plugin-owned settings sections).
 * 2. @nanmicoder/dsh-auto-mode client REQUIRED_PERMISSION_LABELS: match the
 *    renamed "Write Only" preset label so Auto's menu decoration keeps working.
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const profilePkg = join(homedir(), ".dsh", "profiles", "web", "package.json");
const require = createRequire(existsSync(profilePkg) ? profilePkg : join(homedir(), ".dsh", "package.json"));

function patchFile(file, marker, replacement, label) {
	if (!existsSync(file)) throw new Error(`${label}: file not found: ${file}`);
	const src = readFileSync(file, "utf8");
	if (src.includes(replacement)) {
		console.log(`${label}: already patched (${file})`);
		return;
	}
	if (!src.includes(marker)) throw new Error(`${label}: marker not found in ${file}`);
	writeFileSync(file, src.replace(marker, replacement));
	console.log(`${label}: patched (${file})`);
}

try {
	const apiproxyPkg = require.resolve("@deepseek-ai/dsh-host-apiproxy/package.json");
	patchFile(
		join(dirname(apiproxyPkg), "lib", "index.js"),
		'"web-search-deepseek"',
		'"web-search-deepseek",\n\t"workspace-only"',
		"apiproxy allowlist"
	);
} catch (error) {
	console.warn(`apiproxy patch skipped: ${error.message}`);
}

try {
	const autoPkg = require.resolve("@nanmicoder/dsh-auto-mode/package.json");
	patchFile(
		join(dirname(autoPkg), "lib", "client.js"),
		'"Workspace Write"',
		'"Write Only"',
		"auto-mode labels"
	);
} catch (error) {
	console.warn(`auto-mode patch skipped: ${error.message}`);
}
