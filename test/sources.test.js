import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  addSource,
  credentialsPath,
  discoverSourceSkills,
  getAccount,
  getCredential,
  listAccounts,
  listSources,
  parseRepositoryUrl,
  saveAccount,
  sourceRepoDir,
  updateSource,
} from "../src/sources.js";

let sandbox;
let previousManagerHome;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "skillman-source-"));
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
