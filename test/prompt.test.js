import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BANNER,
  createChecklistState,
  formatChecklistRows,
  formatAccountSetupLines,
  formatResultRows,
  formatSkillRows,
  formatSourceSetupLines,
  selectedAgentIds,
  updateChecklistState,
} from "../src/prompt.js";

const choices = [
  { id: "codex", name: "Codex", path: "/home/test/.codex/skills" },
  { id: "claude-code", name: "Claude Code", path: "/home/test/.claude/skills" },
  { id: "cursor", name: "Cursor", path: "/home/test/.cursor/skills" },
];

test("starts with the requested default agents selected", () => {
  const state = createChecklistState(choices, ["codex"]);

  assert.deepEqual(selectedAgentIds(state, choices), ["codex"]);
});

test("moves the checklist cursor and wraps at both ends", () => {
  let state = createChecklistState(choices);

  state = updateChecklistState(state, "up", choices);
  assert.equal(state.cursor, 2);

  state = updateChecklistState(state, "down", choices);
  assert.equal(state.cursor, 0);
});

test("toggles the selected agent at the cursor", () => {
  let state = createChecklistState(choices, ["codex"]);

  state = updateChecklistState(state, "down", choices);
  state = updateChecklistState(state, "toggle", choices);

  assert.deepEqual(selectedAgentIds(state, choices), ["codex", "claude-code"]);
});

test("toggles all available agents", () => {
  let state = createChecklistState(choices, ["codex"]);

  state = updateChecklistState(state, "toggle-all", choices);
  assert.deepEqual(selectedAgentIds(state, choices), [
    "codex",
    "claude-code",
    "cursor",
  ]);

  state = updateChecklistState(state, "toggle-all", choices);
  assert.deepEqual(selectedAgentIds(state, choices), []);
});

test("keeps only one choice selected in single-selection mode", () => {
  let state = createChecklistState(choices);

  state = updateChecklistState(state, "toggle", choices, { singleSelection: true });
  state = updateChecklistState(state, "down", choices, { singleSelection: true });
  state = updateChecklistState(state, "toggle", choices, { singleSelection: true });

  assert.deepEqual(selectedAgentIds(state, choices), ["claude-code"]);
});

test("formats aligned radio-style rows with agent skill paths", () => {
  const state = createChecklistState(choices, ["codex"]);

  assert.deepEqual(formatChecklistRows(choices, state), [
    "> ● Codex        /home/test/.codex/skills",
    "  ○ Claude Code  /home/test/.claude/skills",
    "  ○ Cursor       /home/test/.cursor/skills",
  ]);
});

test("shows a Skills Manager welcome banner", () => {
  assert.match(BANNER.join("\n"), /____/);
  assert.match(BANNER.join("\n"), /__  __/);
});

test("formats aligned result rows with agent skill targets", () => {
  assert.deepEqual(
    formatResultRows(
      [
        { agent: "codex", target: "/home/test/.codex/skills/demo" },
        { agent: "claude-code", target: "/home/test/.claude/skills/demo" },
      ],
      choices,
    ),
    [
      "  ✓ Codex        /home/test/.codex/skills/demo",
      "  ✓ Claude Code  /home/test/.claude/skills/demo",
    ],
  );
});

test("formats a batch skill list", () => {
  assert.deepEqual(formatSkillRows(["demo", "release-notes"]), [
    "  • demo",
    "  • release-notes",
  ]);
});

test("shows the selected account on repository source setup", () => {
  const lines = formatSourceSetupLines({
    values: {
      name: "team-skills",
      url: "https://gitlab.example.com/team/skills.git",
    },
    cursor: 1,
    account: {
      name: "work-gitlab",
      domain: "gitlab.example.com",
    },
    repository: {
      provider: "gitlab",
      domain: "gitlab.example.com",
    },
  });

  assert.match(lines.join("\n"), /Account: work-gitlab \(gitlab\.example\.com\)/);
  assert.match(lines.join("\n"), /Detected: gitlab on gitlab\.example\.com/);
});

test("shows account token guidance and masks the token", () => {
  const lines = formatAccountSetupLines({
    values: {
      name: "work-gitlab",
      domain: "gitlab.example.com",
      token: "secret-token",
    },
    cursor: 2,
    credentialFile: "/home/test/.skills-manager/.credentials.json",
  });

  assert.match(lines.join("\n"), /read_repository/);
  assert.match(lines.join("\n"), /\.credentials\.json/);
  assert.equal(lines.join("\n").includes("secret-token"), false);
});
