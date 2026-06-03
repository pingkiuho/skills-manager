import assert from "node:assert/strict";
import { test } from "node:test";
import { updateInstalledSkills } from "../src/updater.js";

test("updates installed repository skills while leaving local and missing skills untouched", async () => {
  const pulled = [];
  const refreshed = [];

  const result = await updateInstalledSkills({
    listSkillsCommand: async () => [
      {
        name: "daily-plan",
        agents: ["codex", "claude-code"],
        source: "team-skills",
      },
      {
        name: "local-helper",
        agents: ["codex"],
      },
      {
        name: "removed-upstream",
        agents: ["hermes"],
        source: "team-skills",
      },
      {
        name: "old-source-skill",
        agents: ["codex"],
        source: "removed-source",
      },
      {
        name: "not-installed",
        agents: [],
        source: "team-skills",
      },
    ],
    listSourcesCommand: async () => [{ name: "team-skills" }],
    updateSourceCommand: async (source) => {
      pulled.push(source);
    },
    discoverSourceSkillsCommand: async () => [
      {
        name: "daily-plan",
        path: "/tmp/team-skills/daily-plan",
      },
    ],
    addSkillsCommand: async (sources, options) => {
      refreshed.push({ sources, options });
    },
  });

  assert.deepEqual(pulled, ["team-skills"]);
  assert.deepEqual(refreshed, [
    {
      sources: ["/tmp/team-skills/daily-plan"],
      options: {
        agents: ["codex", "claude-code"],
        force: true,
        source: "team-skills",
      },
    },
  ]);
  assert.deepEqual(result, {
    updatedSources: ["team-skills"],
    updatedSkills: [
      {
        skill: "daily-plan",
        source: "team-skills",
      },
    ],
    skippedSkills: [
      {
        skill: "local-helper",
        source: "-",
        reason: "local skill",
      },
      {
        skill: "removed-upstream",
        source: "team-skills",
        reason: "skill is no longer present in source",
      },
      {
        skill: "old-source-skill",
        source: "removed-source",
        reason: "source is not configured",
      },
    ],
  });
});
