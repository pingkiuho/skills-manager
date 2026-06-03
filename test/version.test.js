import assert from "node:assert/strict";
import { test } from "node:test";
import { getCliVersion, updateCli } from "../src/version.js";

test("reads the current let-skills version from package metadata", async () => {
  const version = await getCliVersion({
    root: "/tmp/let-skills",
    readPackageMetadataCommand: async () => ({ version: "1.2.3" }),
    runGitCommand: async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main";
      throw new Error("unexpected git command");
    },
  });

  assert.deepEqual(version, {
    version: "1.2.3",
    branch: "main",
    source: "git",
    path: "/tmp/let-skills",
  });
});

test("falls back to package mode when no git checkout is available", async () => {
  const version = await getCliVersion({
    root: "/tmp/let-skills",
    readPackageMetadataCommand: async () => ({ version: "1.2.3" }),
    runGitCommand: async () => {
      throw new Error("not a git checkout");
    },
  });

  assert.deepEqual(version, {
    version: "1.2.3",
    branch: "-",
    source: "package",
    path: "/tmp/let-skills",
  });
});

test("refuses to update let-skills when the checkout is dirty", async () => {
  await assert.rejects(
    updateCli({
      root: "/tmp/let-skills",
      readPackageMetadataCommand: async () => ({ version: "1.2.3" }),
      runGitCommand: async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return "/tmp/let-skills";
        if (args[0] === "status") return " M src/cli.js";
        throw new Error(`unexpected git command: ${args.join(" ")}`);
      },
    }),
    /has uncommitted changes/,
  );
});

test("updates let-skills with a fast-forward pull", async () => {
  const calls = [];
  const versions = [{ version: "1.2.3" }, { version: "1.2.4" }];

  const result = await updateCli({
    root: "/tmp/let-skills",
    readPackageMetadataCommand: async () => versions.shift(),
    runGitCommand: async (args, options) => {
      calls.push({ args, options });
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return "/tmp/let-skills";
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main";
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return calls.filter(({ args: seen }) => seen[0] === "rev-parse" && seen[1] === "HEAD").length === 1
          ? "old-commit"
          : "new-commit";
      }
      if (args[0] === "pull") return "Already up to date.";
      throw new Error(`unexpected git command: ${args.join(" ")}`);
    },
  });

  assert.deepEqual(result, {
    previousVersion: "1.2.3",
    version: "1.2.4",
    branch: "main",
    source: "git",
    updated: true,
    path: "/tmp/let-skills",
  });
  assert.deepEqual(calls.map(({ args }) => args), [
    ["rev-parse", "--show-toplevel"],
    ["status", "--porcelain"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["rev-parse", "HEAD"],
    ["pull", "--ff-only"],
    ["rev-parse", "HEAD"],
  ]);
});
