#!/usr/bin/env bash
# dsh-workspace-only-plugin — one-line installer
#
#   curl -fsSL https://raw.githubusercontent.com/CsBpRd/dsh-workspace-only-plugin/main/install.sh | bash
#
# Env:
#   DSH_HOME     dsh home (default ~/.dsh)
#   DSH_PROFILE  target profile (default web)
#   DSH_KEEP_ACL=1   keep the built-in sandbox runner (skip the passthrough override)
#   DSH_NO_RESTART=1 skip restarting a running dsh web server
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGIN_SPEC="github:CsBpRd/dsh-workspace-only-plugin#main"

say() { printf '\033[1;32m[dsh-workspace-only]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dsh-workspace-only]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is required"
command -v pnpm >/dev/null 2>&1 || die "pnpm is required"
command -v dsh >/dev/null 2>&1 || die "dsh CLI not found — install DeepSeek Harness first"

say "installing into profile: $PROFILE"

# 1. Install the bundle into the profile (initializes the profile on first use
#    and appends the plugin to dsh.profile.bundles, since it declares dsh.bundle).
dsh plugin --profile "$PROFILE" add "$PLUGIN_SPEC"

# 2. Swap the sandbox's ACL runner for the passthrough runner (task C). The
#    override lives in the profile's cordis.patch.yml and is idempotent; remove
#    it (or run with DSH_KEEP_ACL=1) to restore the built-in runner chain.
#    No node_modules patch is applied anywhere: the plugin runs unpatched.
if [ "${DSH_KEEP_ACL:-}" = "1" ]; then
  say "keeping the built-in sandbox runner (DSH_KEEP_ACL=1)"
else
  RUNNER_SCRIPT="$PROFILE_DIR/node_modules/dsh-workspace-only-plugin/scripts/configure-runner.mjs"
  if [ -f "$RUNNER_SCRIPT" ]; then
    node "$RUNNER_SCRIPT" --profile "$PROFILE"
  else
    die "installed package is missing scripts/configure-runner.mjs — re-run the installer after the repository updates"
  fi
fi

# 3. Restart a running dsh web server with its own command line (sessions are
#    persisted in the session log, so a restart resumes them).
if [ "${DSH_NO_RESTART:-}" = "1" ]; then
  say "plugin installed — restart dsh web manually to load it"
  exit 0
fi
PID="$(ps aux | awk '/bin\/dsh web/ && !/awk/ {print $2; exit}')"
if [ -n "$PID" ]; then
  CMD="$(ps -o command= -p "$PID" | tr -d '\n')"
  CWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | tail -n1 | cut -c2-)"
  [ -n "$CWD" ] && [ -d "$CWD" ] || CWD="$HOME"
  kill "$PID" 2>/dev/null || true
  sleep 2
  ( cd "$CWD" && nohup $CMD >/tmp/dsh-web.log 2>&1 & ) || true
  sleep 4
  NEWPID="$(ps aux | awk '/bin\/dsh web/ && !/awk/ {print $2; exit}')"
  say "dsh web restarted (pid ${NEWPID:-unknown})"
else
  say "no running dsh web found — start it with: dsh web"
fi

say "done. Open the web UI, refresh, and toggle Workspace Only."
say "after every dsh upgrade run once: node scripts/check-compat.mjs"
