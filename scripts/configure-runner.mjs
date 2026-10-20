/**
 * Write (or remove) the sandbox runner override for task C in the target
 * profile's `cordis.patch.yml`.
 *
 * The Loader patch dialect treats a mapping with an `id` and no `insert` as an
 * override of that row; `config` replaces the row's config wholesale, so this
 * block restates the two runner fields the override is about and nothing else
 * (the shipped `sandbox` row has no config of its own). A marker comment makes
 * the block idempotent and easy to find; `--remove` restores the built-in
 * runner chain by deleting it again.
 *
 *   node scripts/configure-runner.mjs [--profile <name>] [--remove]
 *
 * Env: DSH_HOME (default ~/.dsh), DSH_PROFILE (default web).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "# workspace-only-passthrough-runner (managed by dsh-workspace-only-plugin)";

const argv = process.argv.slice(2);
const remove = argv.includes("--remove");
const profileIndex = argv.indexOf("--profile");
const profile = profileIndex >= 0 ? argv[profileIndex + 1] : (process.env.DSH_PROFILE ?? "web");
const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const runnerPath = join(pluginDir, "scripts", "passthrough-runner.mjs");
const target = join(dshHome, "profiles", profile, "cordis.patch.yml");

function stripBlock(lines) {
	const start = lines.findIndex((line) => line.trim() === MARKER);
	if (start < 0) return lines;
	// The block is the marker comments plus one top-level patch mapping
	// (`- id: sandbox ...`), which ends at the NEXT top-level `- ` row or EOF.
	let end = start + 1;
	let seenMapping = false;
	while (end < lines.length) {
		if (/^- /.test(lines[end])) {
			if (seenMapping) break;
			seenMapping = true;
		}
		end += 1;
	}
	// Also drop a blank line directly before the block.
	const from = start > 0 && lines[start - 1].trim() === "" ? start - 1 : start;
	return [...lines.slice(0, from), ...lines.slice(end)];
}

function main() {
	if (!existsSync(target)) {
		if (remove) {
			console.log(`no profile patch at ${target} — nothing to remove`);
			return;
		}
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, "", "utf8");
	}
	const original = readFileSync(target, "utf8");
	const lines = stripBlock(original.split("\n"));
	if (remove) {
		writeFileSync(target, lines.join("\n"), "utf8");
		console.log(`removed the passthrough-runner override from ${target}`);
		return;
	}
	const block = [
		MARKER,
		"# Delete this block to restore the built-in sandbox runner chain (win32 ACL).",
		"- id: sandbox",
		"  config:",
		"    runnerCommand:",
		`      - ${JSON.stringify(process.execPath)}`,
		`      - ${JSON.stringify(runnerPath)}`,
		"    runnerFailureSignatures:",
		'      - "workspace-only-passthrough: "',
		""
	];
	const trailing = lines.length > 0 && lines[lines.length - 1].trim() === "" ? lines.slice(0, -1) : lines;
	writeFileSync(target, [...trailing, ...block].join("\n"), "utf8");
	console.log(`wrote the passthrough-runner override to ${target}`);
	console.log(`  runnerCommand: ${JSON.stringify(process.execPath)} ${JSON.stringify(runnerPath)}`);
}

main();
