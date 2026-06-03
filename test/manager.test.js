import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  addSkills,
  defaultAgentSelection,
  findBrokenInstalls,
  initSkill,
  listAvailableAgents,
  listSkills,
  removeSkills,
  syncSkills,
} from "../src/manager.js";

let sandbox;
let previousHome;
let previousManagerHome;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "let-skills-"));
  previousHome = process.env.HOME;
  previousManagerHome = process.env.SKILLS_MANAGER_HOME;
  process.env.HOME = path.join(sandbox, "home");
  process.env.SKILLS_MANAGER_HOME = path.join(sandbox, "manager");
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;

  if (previousManagerHome === undefined) delete process.env.SKILLS_MANAGER_HOME;
  else process.env.SKILLS_MANAGER_HOME = previousManagerHome;

  await rm(sandbox, { recursive: true, force: true });
});

async function makeSkill(name) {
  const skillFile = await initSkill(name, { destination: sandbox });
  await writeFile(
    skillFile,
    `---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\n# ${name}\n`,
  );
  return path.dirname(skillFile);
}

test("adds a skill and links it to Codex by default", async () => {
  const source = await makeSkill("release-notes");

  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/release-notes/SKILL.md");
  assert.match(await readFile(target, "utf8"), /Test skill release-notes/);

  assert.deepEqual(await listSkills(), [
    {
      name: "release-notes",
      description: "Test skill release-notes.",
      agents: ["codex"],
    },
  ]);
});

test("installs one skill to multiple selected agents", async () => {
  const source = await makeSkill("commit-helper");

  await addSkills([source], { agents: ["codex", "claude-code"] });

  assert.match(
    await readFile(path.join(process.env.HOME, ".codex/skills/commit-helper/SKILL.md"), "utf8"),
    /commit-helper/,
  );
  assert.match(
    await readFile(path.join(process.env.HOME, ".claude/skills/commit-helper/SKILL.md"), "utf8"),
    /commit-helper/,
  );
});

test("detects only supported agents that are present in the home directory", async () => {
  await mkdir(path.join(process.env.HOME, ".claude"), { recursive: true });
  await mkdir(path.join(process.env.HOME, ".hermes"), { recursive: true });

  assert.deepEqual(
    listAvailableAgents().map(({ id }) => id),
    ["claude-code", "hermes"],
  );
  assert.deepEqual(defaultAgentSelection(), ["claude-code"]);
});

test("detects Hermes when only a profile skills directory is present", async () => {
  await mkdir(
    path.join(process.env.HOME, ".hermes", "profiles", "work", "skills"),
    { recursive: true },
  );

  assert.deepEqual(
    listAvailableAgents().map(({ id }) => id),
    ["hermes"],
  );
  assert.deepEqual(defaultAgentSelection(), ["hermes"]);
});

test("normalizes a plural SKILLS.md filename when adding a local skill", async () => {
  const source = path.join(sandbox, "plural-file");
  await mkdir(source);
  await writeFile(
    path.join(source, "SKILLS.md"),
    "---\nname: plural-file\ndescription: Uses a plural filename.\n---\n",
  );

  await addSkills([source]);

  assert.match(
    await readFile(path.join(process.env.HOME, ".codex/skills/plural-file/SKILL.md"), "utf8"),
    /Uses a plural filename/,
  );
});

test("adding an existing library skill repairs a missing agent link", async () => {
  const source = await makeSkill("repair-add");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/repair-add");
  await unlink(target);

  const result = await addSkills([source]);

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.reused, ["repair-add"]);
  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /repair-add/);
});

test("tracks repository provenance and clears it when a local force add replaces the copy", async () => {
  const source = await makeSkill("source-backed");
  await addSkills([source], { source: "team-skills" });

  assert.deepEqual(await listSkills(), [
    {
      name: "source-backed",
      description: "Test skill source-backed.",
      agents: ["codex"],
      source: "team-skills",
    },
  ]);

  await addSkills([source], { force: true });

  assert.deepEqual(await listSkills(), [
    {
      name: "source-backed",
      description: "Test skill source-backed.",
      agents: ["codex"],
    },
  ]);
});

test("sync repairs a deleted agent link", async () => {
  const source = await makeSkill("project-guide");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/project-guide");
  await unlink(target);
  assert.deepEqual(await findBrokenInstalls(), [
    {
      skill: "project-guide",
      agent: "codex",
      target,
    },
  ]);
  await syncSkills();

  assert.deepEqual(await findBrokenInstalls(), []);
  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /project-guide/);
});

test("sync with force repairs a stale agent link", async () => {
  const source = await makeSkill("daily-plan");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/daily-plan");
  await unlink(target);
  await symlink(path.join(sandbox, "missing"), target, "dir");
  await syncSkills({ force: true });

  assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /daily-plan/);
});

test("remove unlinks a skill and purge deletes its library copy", async () => {
  const source = await makeSkill("clean-up");
  await addSkills([source]);

  await removeSkills(["clean-up"], { purge: true });

  assert.deepEqual(await listSkills(), []);
});

test("remove clears a broken saved install without deleting the library copy", async () => {
  const source = await makeSkill("repair-later");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/repair-later");
  await unlink(target);

  assert.deepEqual(await findBrokenInstalls(), [
    {
      skill: "repair-later",
      agent: "codex",
      target,
    },
  ]);

  await removeSkills(["repair-later"]);

  assert.deepEqual(await findBrokenInstalls(), []);
  assert.deepEqual(await listSkills(), [
    {
      name: "repair-later",
      description: "Test skill repair-later.",
      agents: [],
    },
  ]);
});

test("remove refuses to delete an unmanaged agent folder", async () => {
  const source = await makeSkill("careful-remove");
  await addSkills([source]);

  const target = path.join(process.env.HOME, ".codex/skills/careful-remove");
  await unlink(target);
  await mkdir(target);
  await writeFile(path.join(target, "notes.txt"), "keep me");

  await assert.rejects(
    removeSkills(["careful-remove"]),
    /Refusing to remove unmanaged target/,
  );
  assert.equal(await readFile(path.join(target, "notes.txt"), "utf8"), "keep me");
});

test("purge refuses to delete a library copy still installed to another agent", async () => {
  const source = await makeSkill("shared-skill");
  await addSkills([source], { agents: ["codex", "claude-code"] });

  await assert.rejects(
    removeSkills(["shared-skill"], { agents: ["codex"], purge: true }),
    /Cannot purge "shared-skill" while it is installed to: claude-code/,
  );
  assert.match(
    await readFile(path.join(process.env.HOME, ".codex/skills/shared-skill/SKILL.md"), "utf8"),
    /shared-skill/,
  );
});
