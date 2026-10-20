/**
 * Workspace Only passthrough runner (task C).
 *
 * `dsh-sandbox-local` accepts an operator-supplied `runnerCommand` in place of
 * its built-in runner chain (on win32 that chain is the ACL restricted-token
 * runner). Configuring this script asserts full enforcement and drops the ACL
 * backend entirely: profile arguments are discarded and the caller's command
 * runs directly with stdio inherited. The remaining defences are unchanged:
 * the `dsh-fs-sandbox` in-process write fence for file tools, the
 * `sandbox_permissions` escalation flow, and this plugin's lexical gate.
 *
 * argv contract (verified against `dsh-sandbox-local` and the built-in
 * `dsh-sandbox-windows-acl` runner):
 *
 *   node passthrough-runner.mjs [bwrap-compatible profile args...] -- <cmd> [args...]
 *
 * Everything before the first `--` is a bwrap-style profile hint
 * (`--ro-bind`, `--bind`, ...) and is discarded; after it comes the real
 * command. Runner-side failures print `workspace-only-passthrough: <detail>`
 * to stderr and exit 127 — the same failure shape as the built-in runner —
 * so `runnerFailureSignatures` classifies them as runner faults rather than
 * command failures.
 */
import { spawn } from "node:child_process";

const FAILURE_PREFIX = "workspace-only-passthrough: ";

function fail(detail) {
	process.stderr.write(`${FAILURE_PREFIX}${detail}\n`);
	process.exit(127);
}

function main() {
	const argv = process.argv.slice(2);
	const separator = argv.indexOf("--");
	if (separator < 0) fail("missing \"--\" separator between profile arguments and command");
	const command = argv[separator + 1];
	if (command === void 0 || command === "") fail("missing command after \"--\"");
	const args = argv.slice(separator + 2);

	const child = spawn(command, args, {
		stdio: "inherit",
		windowsHide: true
	});

	child.on("error", (error) => {
		fail(`cannot start ${JSON.stringify(command)}: ${error.message}`);
	});

	// Mirror the child's exit code; a signal death re-raises the same signal so
	// the caller observes the same termination it would without this wrapper.
	child.on("exit", (code, signal) => {
		for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(name, forward);
		if (signal !== null && signal !== void 0) {
			try {
				process.kill(process.pid, signal);
				return;
			} catch {
				process.exit(128 + 15);
			}
		}
		process.exit(code ?? 0);
	});

	const forward = (name) => {
		if (child.pid === void 0) return;
		try {
			child.kill(name);
		} catch {
			// The child is already gone; its exit handler settles the wrapper.
		}
	};
	for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(name, () => forward(name));
}

try {
	main();
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
