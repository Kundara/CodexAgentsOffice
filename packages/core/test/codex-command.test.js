const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCodexCommandCandidates } = require("../dist/codex-command.js");

test("candidate list prefers explicit override before PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "linux",
      codexCliPath: "/custom/codex"
    }),
    [
      { command: "/custom/codex", label: "CODEX_CLI_PATH override" },
      { command: "codex", label: "Codex CLI on PATH" }
    ]
  );
});

test("macOS candidates include the app bundle after PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "darwin",
      macAppBundlePaths: ["/Applications/Codex.app/Contents/Resources/codex"]
    }),
    [
      { command: "codex", label: "Codex CLI on PATH" },
      {
        command: "/Applications/Codex.app/Contents/Resources/codex",
        label: "Codex app bundle"
      }
    ]
  );
});
