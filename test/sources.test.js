import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  addSource,
  credentialsPath,
  discoverSourceSkills,
  discoverSourceSkillsReport,
  getAccount,
  getCredential,
  listAccounts,
  listSources,
  parseRepositoryUrl,
  parseSourceLocation,
  removeAccount,
  removeSource,
  saveAccount,
  sourceRepoDir,
  updateSource,
} from "../src/sources.js";

let sandbox;
let previousManagerHome;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "let-skills-source-"));
  previousManagerHome = process.env.SKILLS_MANAGER_HOME;
  process.env.SKILLS_MANAGER_HOME = path.join(sandbox, "manager");
});

afterEach(async () => {
  if (previousManagerHome === undefined) delete process.env.SKILLS_MANAGER_HOME;
  else process.env.SKILLS_MANAGER_HOME = previousManagerHome;
  await rm(sandbox, { recursive: true, force: true });
});

test("parses GitHub and self-hosted GitLab HTTPS repository URLs", () => {
  assert.deepEqual(parseRepositoryUrl("https://github.com/team/skills.git"), {
    url: "https://github.com/team/skills.git",
    domain: "github.com",
    provider: "github",
  });
  assert.deepEqual(parseRepositoryUrl("https://gitlab.example.com/team/skills"), {
    url: "https://gitlab.example.com/team/skills",
    domain: "gitlab.example.com",
    provider: "gitlab",
  });
});

test("rejects repository URLs that embed credentials", () => {
  assert.throws(
    () => parseRepositoryUrl("https://token@example.com/team/skills.git"),
    /must not include credentials/,
  );
});

test("parses a local directory source path", async () => {
  const localSource = path.join(sandbox, "team-skills");
  await mkdir(localSource, { recursive: true });

  assert.deepEqual(await parseSourceLocation(localSource), {
    type: "directory",
    location: localSource,
    path: localSource,
  });
});

test("adds a source without placing its token in git arguments", async () => {
  const calls = [];
  await addSource("team-skills", "https://gitlab.example.com/team/skills.git", {
    token: "secret-token",
    runGitCommand: async (args, options) => {
      calls.push({ args, options });
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  assert.deepEqual((await listSources()).map(({ name }) => name), ["team-skills"]);
  assert.equal((await getCredential("gitlab.example.com")).token, "secret-token");
  assert.equal(calls[0].args.join(" ").includes("secret-token"), false);
  assert.equal(calls[0].options.credential.token, "secret-token");
  assert.equal((await stat(credentialsPath())).mode & 0o777, 0o600);
});

test("reuses one named account across two sources on the same domain", async () => {
  await saveAccount("work-gitlab", "gitlab.example.com", "shared-token");
  const calls = [];
  const clone = async (args, options) => {
    calls.push({ args, options });
    await mkdir(args.at(-1), { recursive: true });
  };

  const first = await addSource("first-source", "https://gitlab.example.com/team/one.git", {
    account: "work-gitlab",
    runGitCommand: clone,
  });
  const second = await addSource("second-source", "https://gitlab.example.com/team/two.git", {
    account: "work-gitlab",
    runGitCommand: clone,
  });

  assert.equal(first.account, "work-gitlab");
  assert.equal(second.account, "work-gitlab");
  assert.equal(calls[0].options.credential.token, "shared-token");
  assert.equal(calls[1].options.credential.token, "shared-token");
  assert.deepEqual((await listAccounts()).map(({ name }) => name), ["work-gitlab"]);
  assert.equal((await getAccount("work-gitlab")).token, "shared-token");
});

test("refuses to remove an account while a source still uses it", async () => {
  await saveAccount("work-gitlab", "gitlab.example.com", "shared-token");
  await addSource("team-skills", "https://gitlab.example.com/team/skills.git", {
    account: "work-gitlab",
    runGitCommand: async (args) => {
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  await assert.rejects(
    removeAccount("work-gitlab"),
    /Cannot remove account "work-gitlab" while used by sources: team-skills/,
  );
});

test("removes an unused account", async () => {
  await saveAccount("work-gitlab", "gitlab.example.com", "shared-token");

  const removed = await removeAccount("work-gitlab");

  assert.equal(removed.name, "work-gitlab");
  assert.deepEqual(await listAccounts(), []);
});

test("does not use a saved account when public repository mode is explicit", async () => {
  await saveAccount("work-github", "github.com", "private-token");
  const calls = [];
  await addSource("public-source", "https://github.com/team/public.git", {
    account: undefined,
    runGitCommand: async (args, options) => {
      calls.push({ args, options });
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  assert.equal(calls[0].options.credential, undefined);
});

test("does not use a saved account when updating an explicitly public source", async () => {
  await saveAccount("work-github", "github.com", "private-token");
  await addSource("public-source", "https://github.com/team/public.git", {
    account: undefined,
    runGitCommand: async (args) => {
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  const calls = [];
  await updateSource("public-source", {
    runGitCommand: async (args, options) => {
      calls.push({ args, options });
    },
  });

  assert.equal(calls[0].options.credential, undefined);
});

test("reads legacy domain credentials as reusable accounts", async () => {
  await mkdir(path.dirname(credentialsPath()), { recursive: true });
  await writeFile(
    credentialsPath(),
    JSON.stringify({
      version: 1,
      domains: {
        "gitlab.example.com": {
          provider: "gitlab",
          username: "oauth2",
          token: "legacy-token",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }),
  );

  assert.deepEqual(await listAccounts(), [
    {
      name: "legacy-gitlab-example-com",
      domain: "gitlab.example.com",
      provider: "gitlab",
      username: "oauth2",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

test("discovers nested singular and plural skill files by parent directory name", async () => {
  await addSource("nested-skills", "https://github.com/team/skills.git", {
    runGitCommand: async (args) => {
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  const repo = sourceRepoDir("nested-skills");
  await mkdir(path.join(repo, "one", "release-notes"), { recursive: true });
  await mkdir(path.join(repo, "elsewhere", "daily-plan"), { recursive: true });
  await writeFile(
    path.join(repo, "one", "release-notes", "SKILL.md"),
    "---\nname: release-notes\ndescription: Release notes.\n---\n",
  );
  await writeFile(
    path.join(repo, "elsewhere", "daily-plan", "skills.md"),
    "---\nname: daily-plan\ndescription: Daily plan.\n---\n",
  );

  assert.deepEqual(await discoverSourceSkills("nested-skills"), [
    {
      name: "daily-plan",
      path: path.join(repo, "elsewhere", "daily-plan"),
      relativePath: path.join("elsewhere", "daily-plan"),
    },
    {
      name: "release-notes",
      path: path.join(repo, "one", "release-notes"),
      relativePath: path.join("one", "release-notes"),
    },
  ]);
});

test("reports invalid source skills while still returning valid ones", async () => {
  await addSource("mixed-skills", "https://github.com/team/skills.git", {
    runGitCommand: async (args) => {
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  const repo = sourceRepoDir("mixed-skills");
  await mkdir(path.join(repo, "valid-skill"), { recursive: true });
  await mkdir(path.join(repo, "Bad Skill"), { recursive: true });
  await mkdir(path.join(repo, "wrong-name"), { recursive: true });
  await mkdir(path.join(repo, "dup", "repeat-skill"), { recursive: true });
  await mkdir(path.join(repo, "dup-2", "repeat-skill"), { recursive: true });

  await writeFile(
    path.join(repo, "valid-skill", "SKILL.md"),
    "---\nname: valid-skill\ndescription: Valid skill.\n---\n",
  );
  await writeFile(
    path.join(repo, "Bad Skill", "SKILL.md"),
    "---\nname: bad-skill\ndescription: Invalid directory name.\n---\n",
  );
  await writeFile(
    path.join(repo, "wrong-name", "SKILL.md"),
    "---\nname: another-name\ndescription: Wrong frontmatter.\n---\n",
  );
  await writeFile(
    path.join(repo, "dup", "repeat-skill", "SKILL.md"),
    "---\nname: repeat-skill\ndescription: First duplicate.\n---\n",
  );
  await writeFile(
    path.join(repo, "dup-2", "repeat-skill", "SKILL.md"),
    "---\nname: repeat-skill\ndescription: Second duplicate.\n---\n",
  );

  const report = await discoverSourceSkillsReport("mixed-skills");

  assert.deepEqual(report.skills.map(({ name }) => name), [
    "repeat-skill",
    "valid-skill",
  ]);
  assert.deepEqual(await discoverSourceSkills("mixed-skills"), report.skills);
  assert.equal(report.invalidSkills.length, 3);
  assert.match(
    report.invalidSkills.find(({ relativePath }) => relativePath === "Bad Skill")?.reason || "",
    /Invalid skill directory "Bad Skill"/,
  );
  assert.match(
    report.invalidSkills.find(({ name }) => name === "wrong-name")?.reason || "",
    /does not match frontmatter name "another-name"/,
  );
  assert.match(
    report.invalidSkills.find(({ relativePath }) => relativePath === path.join("dup-2", "repeat-skill"))?.reason || "",
    /contains more than one "repeat-skill" skill directory/,
  );
});

test("reuses a domain credential when updating a cloned source", async () => {
  await addSource("update-me", "https://gitlab.example.com/team/skills.git", {
    token: "saved-token",
    runGitCommand: async (args) => {
      await mkdir(args.at(-1), { recursive: true });
    },
  });

  const calls = [];
  await updateSource("update-me", {
    runGitCommand: async (args, options) => {
      calls.push({ args, options });
    },
  });

  assert.deepEqual(calls[0].args, [
    "-C",
    sourceRepoDir("update-me"),
    "pull",
    "--ff-only",
  ]);
  assert.equal(calls[0].options.credential.token, "saved-token");
});

test("adds and discovers a local directory source", async () => {
  const localSource = path.join(sandbox, "workspace-skills");
  await mkdir(path.join(localSource, "daily-plan"), { recursive: true });
  await writeFile(
    path.join(localSource, "daily-plan", "SKILL.md"),
    "---\nname: daily-plan\ndescription: Daily plan.\n---\n",
  );

  const source = await addSource("workspace-skills", localSource);

  assert.equal(source.type, "directory");
  assert.equal(source.path, localSource);
  assert.deepEqual(await discoverSourceSkills("workspace-skills"), [
    {
      name: "daily-plan",
      path: path.join(localSource, "daily-plan"),
      relativePath: "daily-plan",
    },
  ]);
});

test("updates a local directory source without running git", async () => {
  const localSource = path.join(sandbox, "workspace-skills");
  await mkdir(localSource, { recursive: true });
  await addSource("workspace-skills", localSource);

  const source = await updateSource("workspace-skills", {
    runGitCommand: async () => {
      throw new Error("git should not run for a local directory source");
    },
  });

  assert.equal(source.type, "directory");
});

test("removing a local directory source keeps the original directory", async () => {
  const localSource = path.join(sandbox, "workspace-skills");
  await mkdir(localSource, { recursive: true });
  await addSource("workspace-skills", localSource);

  await removeSource("workspace-skills");

  assert.equal((await stat(localSource)).isDirectory(), true);
  assert.deepEqual(await listSources(), []);
});
