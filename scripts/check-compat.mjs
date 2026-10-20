/**
 * Upgrade self-check (task E3). Run this ONCE after every dsh upgrade:
 *
 *   node scripts/check-compat.mjs [--asar <path/to/app.asar>]
 *
 * It probes the RUNNING dsh installation for the exact contracts this plugin
 * depends on and prints a human-readable difference report when one drifts —
 * never silently. Probed sources, in order: profile node_modules
 * ($DSH_HOME/profiles/<name>/node_modules), then the Desktop app.asar (embedded
 * reader), then --asar. Exit code 0 means every probe passed.
 *
 * Probes:
 *   1. `dsh-user-approval` outcome vocabulary and audit pair field shapes;
 *   2. `dsh-tools` `tools/pre-execute` decision vocabulary (allow/deny/ask/cancel);
 *   3. `dsh-session` plugin-record channel (`appendPluginRecord`/`pluginRecordOf`);
 *   4. `dsh-user-questions` question seam (`user-questions/request`, NO_PROVIDER);
 *   5. `dsh-api-remotes` forwarded-event allowlist (approval/request, user-questions/request);
 *   6. `dsh-sandbox-local` runner override contract (`runnerCommand` + `--`);
 *   7. `schemastery` `.volatile()` fields (the E1 configuration channel).
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const failures = [];
const passes = [];

function record(ok, title, detail) {
	if (ok) passes.push(title);
	else failures.push({ title, detail });
}

/** Minimal asar reader: returns file text at `path/in/asar`, or undefined. */
function readAsar(asarPath, entry) {
	let handle;
	try {
		handle = openSync(asarPath, "r");
	} catch {
		return void 0;
	}
	try {
		const head = Buffer.alloc(16);
		readSync(handle, head, 0, 16, 0);
		const headerSize = head.readUInt32LE(4);
		const header = Buffer.alloc(headerSize);
		readSync(handle, header, 0, headerSize, 8);
		const stringSize = header.readUInt32LE(4);
		const index = JSON.parse(header.toString("utf8", 8, 8 + stringSize));
		const dataStart = 8 + headerSize;
		let node = index;
		for (const part of entry.split("/")) {
			node = (node.files ?? {})[part];
			if (node === void 0) return void 0;
		}
		if (node.files !== void 0) return void 0;
		const offset = dataStart + Number(node.offset);
		const size = Number(node.size);
		const body = Buffer.alloc(size);
		readSync(handle, body, 0, size, offset);
		return body.toString("utf8");
	} catch {
		return void 0;
	} finally {
		closeSync(handle);
	}
}

/** Candidate roots that can resolve `@deepseek-ai/<pkg>` sources. */
function candidateRoots() {
	const roots = [];
	const asarArg = process.argv.indexOf("--asar");
	const explicit = asarArg >= 0 ? process.argv[asarArg + 1] : void 0;
	const asars = [
		explicit,
		process.env.DSH_ASAR,
		join(homedir(), "AppData", "Local", "Programs", "DeepSeek Harness", "resources", "app.asar"),
		"C:\\Program Files\\DeepSeek Harness\\resources\\app.asar",
		"D:\\Programs\\DeepSeek Harness\\resources\\app.asar",
		"/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
	].filter((value) => typeof value === "string" && value !== "");
	for (const asar of asars) if (existsSync(asar)) roots.push({ kind: "asar", base: asar });
	const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const profiles = join(dshHome, "profiles");
	if (existsSync(profiles)) {
		for (const name of readdirSync(profiles)) {
			const modules = join(profiles, name, "node_modules", "@deepseek-ai");
			if (existsSync(modules)) roots.push({ kind: "dir", base: modules });
		}
	}
	return roots;
}

/** Locate one packaged source file across every candidate root. */
function locate(pkg, file, roots) {
	for (const root of roots) {
		const entry = `dsh/node_modules/@deepseek-ai/${pkg}/${file}`;
		if (root.kind === "asar") {
			const text = readAsar(root.base, entry);
			if (text !== void 0) return { text, origin: root.base };
		} else {
			const path = join(root.base, pkg, file);
			if (existsSync(path) && statSync(path).isFile()) return { text: readFileSync(path, "utf8"), origin: path };
		}
	}
	return void 0;
}

function main() {
	const roots = candidateRoots();
	if (roots.length === 0) {
		console.error("check-compat: no dsh installation found — pass --asar <path/to/app.asar> or set DSH_HOME/DSH_ASAR");
		process.exit(1);
	}
	console.log(`check-compat: ${roots.length} source root(s): ${roots.map((root) => root.base).join(", ")}`);

	// 1. dsh-user-approval: closed outcome vocabulary + audit pair shapes.
	{
		const found = locate("dsh-user-approval", "lib/index.js", roots);
		if (found === void 0) {
			record(false, "dsh-user-approval present", "package not found in any source root");
		} else {
			const expected = ["allowed-once", "rejected", "cancelled", "unavailable"];
			const missing = expected.filter((outcome) => !found.text.includes(`"${outcome}"`));
			record(missing.length === 0, "approval outcome vocabulary", missing.length === 0 ? void 0 : `OUTCOMES drifted: ${missing.map((value) => JSON.stringify(value)).join(", ")} no longer appears in ${found.origin}`);
			const shapes = ['session.append("approval/asked"', 'session.append("approval/decided"', "toolName", "outcome"];
			const gone = shapes.filter((needle) => !found.text.includes(needle));
			record(gone.length === 0, "approval audit pair shape", gone.length === 0 ? void 0 : `audit fields drifted: ${gone.join(", ")} missing in ${found.origin}`);
			record(found.text.includes("ApprovalRequestId"), "ApprovalRequestId export", "ApprovalRequestId is gone; update lib/approval-compat.js");
		}
	}

	// 2. dsh-tools: pre-execute decision vocabulary.
	{
		const found = locate("dsh-tools", "lib/index.js", roots);
		if (found === void 0) {
			record(false, "dsh-tools present", "package not found in any source root");
		} else {
			const shapes = ['kind: "allow"', 'kind: "deny"', 'gate.kind === "ask"', 'decision.kind === "cancel"', '"tools/pre-execute"'];
			const gone = shapes.filter((needle) => !found.text.includes(needle));
			record(gone.length === 0, "pre-execute decision vocabulary", gone.length === 0 ? void 0 : `pre-execute contract drifted in ${found.origin}: missing ${gone.join(", ")}`);
		}
	}

	// 3. dsh-session: plugin-record channel and known event types.
	{
		const found = locate("dsh-session", "lib/index.js", roots);
		if (found === void 0) {
			record(false, "dsh-session present", "package not found in any source root");
		} else {
			const shapes = ["function appendPluginRecord", "function pluginRecordOf", "isPluginRecordType", "ignorable: true"];
			const gone = shapes.filter((needle) => !found.text.includes(needle));
			record(gone.length === 0, "plugin-record channel", gone.length === 0 ? void 0 : `plugin-record API drifted in ${found.origin}: missing ${gone.join(", ")} — lib/session-state.js must be revisited`);
			const events = ['"sandbox/mode"', '"approval/asked"', '"approval/decided"'];
			const goneEvents = events.filter((needle) => !found.text.includes(needle));
			record(goneEvents.length === 0, "known session event types", goneEvents.length === 0 ? void 0 : `session event vocabulary drifted in ${found.origin}: missing ${goneEvents.join(", ")}`);
		}
	}

	// 4. dsh-user-questions: the question seam the three-choice gate rides.
	{
		const found = locate("dsh-user-questions", "lib/index.js", roots);
		if (found === void 0) {
			record(false, "dsh-user-questions present", "package not found — the three-choice question degrades to the system dialog fallback");
		} else {
			const shapes = ['"user-questions/request"', '"NO_PROVIDER"', "async ask(request)", "askTimed"];
			const gone = shapes.filter((needle) => !found.text.includes(needle));
			record(gone.length === 0, "user-questions ask seam", gone.length === 0 ? void 0 : `question seam drifted in ${found.origin}: missing ${gone.join(", ")}`);
		}
	}

	// 5. dsh-api-remotes: forwarded-event allowlist used by both directions.
	{
		const found = locate("dsh-api-remotes", "lib/types/remote-events.js", roots) ?? locate("dsh-api-remotes", "lib/index.js", roots);
		if (found === void 0) {
			record(false, "dsh-api-remotes present", "forwarded-event allowlist not found — client question/answer routing cannot be verified");
		} else {
			const has = (names) => names.some((needle) => found.text.includes(needle));
			const ok = has(["'approval/request'", '"approval/request"']) && has(["'user-questions/request'", '"user-questions/request"']);
			record(ok, "forwarded-event allowlist", ok ? void 0 : `approval/request or user-questions/request dropped from the allowlist in ${found.origin}; host→client asking breaks`);
		}
	}

	// 6. dsh-sandbox-local: the runnerCommand override (task C).
	{
		const found = locate("dsh-sandbox-local", "lib/index.js", roots);
		if (found === void 0) {
			record(false, "dsh-sandbox-local present", "package not found in any source root");
		} else {
			const shapes = ["runnerCommand", "runnerFailureSignatures"];
			const gone = shapes.filter((needle) => !found.text.includes(needle));
			record(gone.length === 0, "sandbox runner override", gone.length === 0 ? void 0 : `runnerCommand contract drifted in ${found.origin}: missing ${gone.join(", ")}`);
		}
	}

	// 7. schemastery: volatile configuration fields (task E1).
	{
		const found = locate("schemastery", "lib/index.mjs", roots) ?? locate("schemastery", "lib/index.cjs", roots);
		if (found === void 0) {
			record(false, "schemastery present", "package not found in any source root");
		} else {
			record(found.text.includes("volatile"), "volatile() config fields", "schemastery lost .volatile(); the E1 configuration channel must be revisited");
		}
	}

	for (const title of passes) console.log(`PASS  ${title}`);
	for (const failure of failures) {
		console.log(`FAIL  ${failure.title}`);
		console.log(`      ${failure.detail}`);
	}
	console.log(`${passes.length}/${passes.length + failures.length} probes passed`);
	if (failures.length > 0) {
		console.log("check-compat: dsh drifted from the verified 0.2.1-rc.2 contracts — see the differences above before trusting the gate.");
		process.exitCode = 1;
	}
}

main();
