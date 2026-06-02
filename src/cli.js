import {
  addSkills,
  initSkill,
  installSkills,
  listAgents,
  listInstalledAgents,
  listSourceSkillNames,
  listSkills,
  removeSkills,
  syncSkills,
} from "./manager.js";
import { selectAgents } from "./prompt.js";
import { setupRepositoryAccount, setupRepositorySource } from "./prompt.js";
import {
  addSource,
  credentialsPath,
  discoverSourceSkills,
  getAccount,
  listAccounts,
  listSources,
  parseRepositoryUrl,
  removeSource,
  saveAccount,
  updateSource,
} from "./sources.js";
import { updateInstalledSkills } from "./updater.js";

const HELP = `skillman - manage a small personal agent skills library

Usage:
  skillman init <name> [--dir <path>]
  skillman add <local-skill-folder...> [-a, --agent <agent...>] [--force] [--no-interactive]
  skillman add --source <source-name>
  skillman install <skill...> [-a, --agent <agent...>] [--force]
  skillman list
  skillman remove <skill...> [-a, --agent <agent...>] [--purge] [--no-interactive]
  skillman remove --source <source-name> [--purge]
  skillman update
  skillman sync [--force]
  skillman agents
  skillman account list
  skillman source add [name] [https-url] [--account <name>] [--no-interactive]
  skillman source list
  skillman source update <name>
  skillman source remove <name>

Notes:
  In a terminal, add and remove show an interactive agent selector.
  Pass "--no-interactive" to skip prompts. The default add target is codex.
  Pass "--agent all" to target every supported agent.
  Personal copies live in ~/.skills-manager/skills by default.
`;

function parseArguments(args) {
  const positionals = [];
  const options = { agents: [] };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "-a" || argument === "--agent") {
      const agent = args[index + 1];
      if (!agent || agent.startsWith("-")) {
        throw new Error(`${argument} requires an agent name.`);
      }
      options.agents.push(agent);
      index += 1;
    } else if (argument === "--dir") {
      const destination = args[index + 1];
      if (!destination || destination.startsWith("-")) {
        throw new Error("--dir requires a path.");
      }
      options.destination = destination;
      index += 1;
    } else if (argument === "--source") {
      const source = args[index + 1];
      if (!source || source.startsWith("-")) {
        throw new Error("--source requires a source name.");
      }
      options.source = source;
      index += 1;
    } else if (argument === "--account") {
      const account = args[index + 1];
      if (!account || account.startsWith("-")) {
        throw new Error("--account requires an account name.");
      }
      options.account = account;
      index += 1;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--purge") {
      options.purge = true;
    } else if (argument === "--no-interactive") {
      options.interactive = false;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option "${argument}".`);
    } else {
      positionals.push(argument);
    }
  }

  return { positionals, options };
}

function printRows(rows) {
  if (rows.length === 0) {
    console.log("Nothing to show.");
    return;
  }

  console.table(rows);
}

function shouldPrompt(options, input, output) {
  return options.agents.length === 0 &&
    options.interactive !== false &&
    input.isTTY &&
    output.isTTY;
}

async function addInteractively(sources, options, input, output) {
  if (!shouldPrompt(options, input, output)) return false;
  const skillNames = await listSourceSkillNames(sources);

  await selectAgents({
    title: "Install the following skill(s) to which agents?",
    choices: listAgents(),
    skillNames,
    defaultAgents: ["codex"],
    input,
    output,
    onConfirm: async (agents) => {
      const result = await addSkills(sources, { ...options, agents });
      return {
        title: "Installation complete",
        summary: [
          result.added.length > 0 ? `Added: ${result.added.join(", ")}` : undefined,
          result.reused.length > 0 ? `Reused library copy: ${result.reused.join(", ")}` : undefined,
        ].filter(Boolean),
        rows: result.installed,
        value: result,
      };
    },
  });
  return true;
}

async function addFromRepositorySource(sourceName, options, input, output) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Using "--source" requires an interactive terminal.');
  }

  const discovered = await discoverSourceSkills(sourceName);
  if (discovered.length === 0) {
    throw new Error(`Source "${sourceName}" does not contain any SKILL.md files.`);
  }

  const selected = await selectAgents({
    welcome: `Welcome. Choose skills from repository source "${sourceName}".`,
    title: "Install which skill(s) from this source?",
    choices: discovered.map(({ name, relativePath }) => ({
      id: name,
      name,
      path: relativePath,
    })),
    showSkillSection: false,
    selectionNoun: "skill",
    input,
    output,
  });

  const selectedNames = new Set(selected);
  const selectedFolders = discovered
    .filter(({ name }) => selectedNames.has(name))
    .map(({ path }) => path);

  if (await addInteractively(selectedFolders, options, input, output)) return;
  const { added, reused, installed } = await addSkills(selectedFolders, options);
  if (added.length > 0) console.log(`Added ${added.join(", ")}`);
  if (reused.length > 0) console.log(`Reused library copy: ${reused.join(", ")}`);
  printRows(installed);
}

async function removeFromRepositorySource(sourceName, options, input, output) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Using "--source" requires an interactive terminal.');
  }

  const installed = new Set(
    (await listSkills())
      .filter(({ agents }) => agents.length > 0)
      .map(({ name }) => name),
  );
  const discovered = (await discoverSourceSkills(sourceName))
    .filter(({ name }) => installed.has(name));

  if (discovered.length === 0) {
    throw new Error(`Source "${sourceName}" does not contain any installed skills.`);
  }

  const selected = await selectAgents({
    welcome: `Welcome. Choose installed skills from repository source "${sourceName}".`,
    title: "Uninstall which skill(s) from this source?",
    choices: discovered.map(({ name, relativePath }) => ({
      id: name,
      name,
      path: relativePath,
    })),
    showSkillSection: false,
    selectionNoun: "skill",
    input,
    output,
  });

  if (await removeInteractively(selected, options, input, output)) return;
  printRows(await removeSkills(selected, options));
}

async function addRepositoryAccountInteractively(input, output) {
  return setupRepositoryAccount({
    credentialFile: credentialsPath(),
    input,
    output,
    onConfirm: async ({ name, domain, token }) => {
      await saveAccount(name, domain, token);
      const account = await getAccount(name);
      return {
        title: "Account saved",
        lines: [
          `Account: ${account.name}`,
          `Domain: ${account.domain}`,
          `Provider: ${account.provider}`,
        ],
        value: account,
      };
    },
  });
}

async function selectRepositoryAccount(input, output) {
  const accounts = await listAccounts();
  const [selected] = await selectAgents({
    welcome: "Welcome. Choose an account before adding a repository source.",
    title: "Which account should be used to clone this source?",
    choices: [
      {
        id: "__new__",
        name: "Add a new account",
        path: "Store a reusable access token",
      },
      {
        id: "__public__",
        name: "Public repository",
        path: "Clone without an access token",
      },
      ...accounts.map((account) => ({
        id: account.name,
        name: account.name,
        path: `${account.provider}  ${account.domain}`,
      })),
    ],
    showSkillSection: false,
    singleSelection: true,
    selectionNoun: "account",
    input,
    output,
  });

  if (selected === "__new__") return addRepositoryAccountInteractively(input, output);
  if (selected === "__public__") return undefined;
  return getAccount(selected);
}

async function runSourceCommand(positionals, options, input, output) {
  const [action = "list", name, repositoryUrl] = positionals;

  if (action === "list" || action === "ls") {
    printRows(
      (await listSources()).map((source) => ({
        source: source.name,
        provider: source.provider,
        domain: source.domain,
        account: source.account || "public",
        url: source.url,
        path: source.path,
      })),
    );
    return;
  }

  if (action === "add") {
    if (options.interactive === false || !input.isTTY || !output.isTTY) {
      if (!name || !repositoryUrl) {
        throw new Error(
          "Usage: skillman source add <name> <https-url> [--account <name>] --no-interactive",
        );
      }
      const source = await addSource(name, repositoryUrl, { account: options.account });
      printRows([source]);
      return;
    }

    const account = await selectRepositoryAccount(input, output);
    await setupRepositorySource({
      initialName: name,
      initialUrl: repositoryUrl,
      account,
      inspectUrl: parseRepositoryUrl,
      input,
      output,
      onConfirm: async ({ name: sourceName, url }) => {
        const source = await addSource(sourceName, url, { account: account?.name });
        const skills = await discoverSourceSkills(sourceName);
        return {
          title: "Repository source added",
          lines: [
            `Source: ${source.name}`,
            `Repository: ${source.url}`,
            `Account: ${source.account || "public repository"}`,
            `Local clone: ${source.path}`,
            `Discovered skills: ${skills.length}`,
          ],
          value: source,
        };
      },
    });
    return;
  }

  if (!name) throw new Error(`Usage: skillman source ${action} <name>`);
  if (action === "update") {
    printRows([await updateSource(name)]);
  } else if (action === "remove" || action === "rm") {
    printRows([await removeSource(name)]);
  } else {
    throw new Error(`Unknown source command "${action}".`);
  }
}

async function runAccountCommand(positionals) {
  const [action = "list"] = positionals;
  if (action !== "list" && action !== "ls") {
    throw new Error(`Unknown account command "${action}".`);
  }
  printRows(
    (await listAccounts()).map((account) => ({
      account: account.name,
      provider: account.provider,
      domain: account.domain,
      updatedAt: account.updatedAt,
    })),
  );
}

async function removeInteractively(skillNames, options, input, output) {
  if (!shouldPrompt(options, input, output)) return false;

  const installedAgents = await listInstalledAgents(skillNames);
  const choices = listAgents().filter(({ id }) => installedAgents.includes(id));
  if (choices.length === 0) return false;

  await selectAgents({
    title: "Uninstall the following skill(s) from which agents?",
    choices,
    skillNames,
    defaultAgents: installedAgents,
    input,
    output,
    onConfirm: async (agents) => {
      const removed = await removeSkills(skillNames, { ...options, agents });
      return {
        title: "Uninstallation complete",
        summary: [`Removed: ${skillNames.join(", ")}`],
        rows: removed,
        value: removed,
      };
    },
  });
  return true;
}

export async function run(argv, { input = process.stdin, output = process.stdout } = {}) {
  const [command = "help", ...args] = argv;
  const { positionals, options } = parseArguments(args);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
  } else if (command === "init") {
    if (positionals.length !== 1) throw new Error("Usage: skillman init <name>");
    console.log(`Created ${await initSkill(positionals[0], options)}`);
  } else if (command === "add") {
    if (options.source) {
      if (positionals.length > 0) {
        throw new Error('Do not pass local skill folders together with "--source".');
      }
      await addFromRepositorySource(options.source, options, input, output);
      return;
    }
    if (positionals.length > 0 && await addInteractively(positionals, options, input, output)) {
      return;
    }
    const { added, reused, installed } = await addSkills(positionals, options);
    if (added.length > 0) console.log(`Added ${added.join(", ")}`);
    if (reused.length > 0) console.log(`Reused library copy: ${reused.join(", ")}`);
    printRows(installed);
  } else if (command === "install") {
    printRows(await installSkills(positionals, options));
  } else if (command === "list" || command === "ls") {
    const skills = await listSkills();
    printRows(
      skills.map(({ name, description, agents, source }) => ({
        skill: name,
        agents: agents.join(", ") || "-",
        source: source || "-",
        description,
      })),
    );
  } else if (command === "remove" || command === "rm") {
    if (options.source) {
      if (positionals.length > 0) {
        throw new Error('Do not pass skill names together with "--source".');
      }
      await removeFromRepositorySource(options.source, options, input, output);
      return;
    }
    if (
      positionals.length > 0 &&
      await removeInteractively(positionals, options, input, output)
    ) {
      return;
    }
    printRows(await removeSkills(positionals, options));
  } else if (command === "update") {
    const { updatedSources, updatedSkills, skippedSkills } = await updateInstalledSkills();
    if (updatedSources.length > 0) {
      console.log(`Updated sources: ${updatedSources.join(", ")}`);
    }
    printRows([
      ...updatedSkills.map(({ skill, source }) => ({
        skill,
        source,
        status: "updated",
      })),
      ...skippedSkills.map(({ skill, source, reason }) => ({
        skill,
        source,
        status: `skipped: ${reason}`,
      })),
    ]);
  } else if (command === "sync") {
    printRows(await syncSkills(options));
  } else if (command === "agents") {
    printRows(
      listAgents().map(({ id, name, path }) => ({
        agent: id,
        name,
        path,
      })),
    );
  } else if (command === "account" || command === "accounts") {
    await runAccountCommand(positionals);
  } else if (command === "source" || command === "sources") {
    await runSourceCommand(positionals, options, input, output);
  } else {
    throw new Error(`Unknown command "${command}". Run "skillman help".`);
  }
}
