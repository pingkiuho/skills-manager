# Project Guide

`letskills` is a local-first CLI for managing personal agent skills. Direct local skills can be copied into a managed personal library, while source-backed skills install by linking supported agents directly to the skill folder inside the configured source.

The docs in this directory are the source of truth for how the project is expected to behave. The README is the quick-start entry point; this guide explains the project model in enough detail to support implementation and review work.

## Product Shape

The primary command is `letskills`. The package also exposes `let-skills` as a compatibility alias, but user-facing docs and new code should prefer `letskills`.

The project intentionally stays small:

- local skill folders can be added directly
- reusable sources can point at HTTPS repositories or local directories
- direct local skills are copied into one personal library before agent install
- source-backed skills use the source folder as the installed source of truth
- agent installs are symlinks into either the managed library copy or the source skill folder
- source-backed installs are writable by default, with optional read-only protection for the source skill folder
- manifests record installs, source provenance, source paths, and read-only policy so links can be repaired and repository source changes can be pushed
- there is no public registry, telemetry, background update checker, or hosted service

## Runtime Requirements

`letskills` is a zero-dependency Node.js CLI. It requires Node.js 20 or newer and uses built-in modules plus `node --test` for the test suite.

The package entry points are:

- `bin/let-skills.js`: executable wrapper
- `src/cli.js`: command parser and flow coordinator
- `src/branding.js`: canonical CLI command and display strings

## Storage Model

By default, user data lives under:

```text
~/.let-skills
```

The storage root can be overridden with `SKILLS_MANAGER_HOME`. Existing installs under the older `~/.skills-manager` directory are still detected automatically when `~/.let-skills` does not exist.

Important files and directories:

| Path | Purpose |
| --- | --- |
| `~/.let-skills/skills` | Managed personal skill library for direct local adds |
| `~/.let-skills/installs.json` | Manifest of installed skills, target agents, source provenance, source paths, and read-only policy |
| `~/.let-skills/sources.json` | Configured repository and local-directory sources |
| `~/.let-skills/sources/<name>` | Local clone for repository sources |
| `~/.let-skills/.credentials.json` | Saved repository accounts and tokens |
| `~/.let-skills/.git-askpass.sh` | Generated helper for Git HTTPS authentication |

Private registry files are written with mode `0600`. The generated Git askpass helper is written with mode `0700`.

## Skill Model

A valid skill is a directory containing `SKILL.md` or `SKILLS.md`, with any letter casing. The file must contain YAML frontmatter with `name` and `description`.

Skill names must use lowercase letters, numbers, and hyphens:

```text
my-skill
```

When a direct local skill is added, `letskills` copies it into the personal library. If the source file was named `SKILLS.md`, the library copy also gets a normalized `SKILL.md`.

Adding a direct local skill that is already in the library reuses the saved copy by default. Passing `--force` replaces the library copy with the provided local folder. Managed library copies are set read-only after add operations. Management commands temporarily make a library copy writable when they need to replace it.

When a source-backed skill is installed with `letskills add --source <source-name>`, `letskills` does not copy it into the personal library. It records the configured source, source-relative path, absolute source path, and edit policy, then links agent skill directories directly to that source skill folder. Source-backed skills are writable by default. Passing `--read-only` or choosing `Read-only` in the TUI removes write bits from the shared source skill folder. Passing `--writable` or choosing `Writable` keeps the source skill folder editable. Because all installed agents point at the same source folder, the policy is global for that skill path rather than per agent.

## Agent Install Model

Agent installs are symlinks from an agent's global skills directory back to the resolved installed skill folder. Direct local skills resolve to `~/.let-skills/skills/<skill-name>`. Source-backed skills resolve to the discovered skill folder inside the configured source.

Supported agents:

| Agent | `--agent` value | Global skills directory |
| --- | --- | --- |
| Codex | `codex` | `~/.codex/skills` |
| Claude Code | `claude-code` | `~/.claude/skills` |
| GitHub Copilot | `github-copilot` | `~/.copilot/skills` |
| Hermes | `hermes` | `~/.hermes/skills` |
| Hermes profile | `hermes:<profile>` | `~/.hermes/profiles/<profile>/skills` |

Agent detection checks for each agent's home directory or skills directory. Hermes profile skills directories under `~/.hermes/profiles/<profile>/skills` are detected as independent destinations named `hermes:<profile>`.

Non-interactive add defaults to Codex when Codex is detected. If Codex is not detected, it uses the first detected supported agent, then falls back to `codex` when no supported agent has been detected yet.

Use `--agent all` to target every supported agent explicitly.

## Manifest Model

The install manifest is stored at `installs.json` under the storage root.

It records:

- which skills are installed
- which agents each skill is installed into
- which configured source a skill came from, when applicable
- which source-relative and absolute skill path a source-backed skill uses
- whether a source-backed skill was installed writable or read-only

The manifest is the repair and update source of truth. `letskills sync` recreates symlinks recorded in the manifest. `letskills update` only pulls or rescans configured sources used by installed source-backed skills, then repairs links to the current source skill folders.

`letskills remove` removes recorded agent installs. When no agents are passed, it removes every recorded install for the named skill. Removal refuses to delete an existing target that is not a symlink to the recorded installed skill folder.

## Source Model

A source is a reusable place to discover skills. Sources can be:

- an HTTPS repository on GitHub, GitLab.com, or a self-hosted GitLab domain
- a local directory

Repository sources are cloned under `~/.let-skills/sources/<name>`. Local directory sources store the resolved directory path and never clone or delete the original folder.

Source names use the same lowercase letters, numbers, and hyphens format as skill names.

Source discovery recursively scans for `SKILL.md` or `SKILLS.md` and ignores `.git` directories. The parent directory name is the discovered skill name. If frontmatter includes a `name`, it must match the directory name. Duplicate skill names and invalid skill directories are reported as invalid while valid skills from the same source remain installable.

## Account And Authentication Model

Repository accounts are reusable named credentials stored in:

```text
~/.let-skills/.credentials.json
```

Account names use lowercase letters, numbers, and hyphens. Each account stores a normalized domain, provider, username, token, and update timestamp. Multiple accounts can exist for the same domain.

When a repository source uses an account, `letskills` records the account name on that source. Later source updates reuse that account without asking for the token again.

Tokens are treated as passwords:

- they are stored only in the credentials file
- they are passed to Git through `GIT_ASKPASS`
- they are not added to clone URLs
- clone and pull errors redact the token when possible

Repository sources can also be explicitly public. A public source is cloned and updated without a saved token.

Accounts cannot be removed while any configured source still depends on them.

## Command Flows

`letskills init <name> [--dir <path>]` creates a starter skill folder containing `SKILL.md`.

`letskills add <local-skill-folder...>` copies local skills into the library and installs them into selected agents. In an interactive terminal, it prompts for agents when `--agent` is not provided. In scripts, use `--agent` or `--no-interactive`.

`letskills add --source <source-name>` opens an interactive source browser. The user first selects discovered skills, then selects target agents, then chooses whether the shared source skill folder should be writable or read-only. Writable is the default.

`letskills install <skill...>` installs existing managed or source-backed skills into agents without copying new source folders.

`letskills list` shows skills, installed agents, source provenance, edit policy, paths, and descriptions.

`letskills remove <skill...>` removes recorded agent installs. In an interactive terminal, the user can choose target agents. In non-interactive mode with no agents, every recorded install for the skill is removed.

`letskills remove --source <source-name>` opens an interactive source-scoped removal flow for installed skills from that source.

`letskills sync [--force]` recreates symlinks from the manifest. `--force` can replace existing targets.

`letskills update` refreshes installed source-backed skills. Repository sources are pulled with `git pull --ff-only`; local directory sources are rescanned in place; saved symlinks are repaired. Local-only installed skills and missing source skills are skipped and reported.

`letskills push <skill...> [-m <message>]` commits and pushes changes for installed git-backed source skills. Only the selected skill folder paths are staged. When `-m` is omitted, the commit message is `push updated skills via letskills`. Skills from local directory sources can be pushed when the source folder is a Git repository.

`letskills push --source <source-name> [-m <message>]` commits and pushes changes for all installed git-backed source skills from that source.

`letskills source` opens the interactive source manager.

`letskills source add [name] [https-url|local-directory] [--account <name>] [--no-interactive]` adds a repository or directory source.

`letskills source update <name>` updates one configured source.

`letskills source remove <name>` removes a configured source. Repository clones are deleted; local directory sources only remove the registry entry.

`letskills account add <name> <domain> <token>` saves a reusable repository account.

`letskills account list` lists saved accounts without tokens.

`letskills account remove <name>` removes an unused account.

`letskills agents` lists supported agent targets.

`letskills version` reports the package version, root path, and Git branch when running from a checkout.

`letskills version update` runs `git pull --ff-only` in the `let-skills` checkout. It refuses to run outside a Git checkout and refuses to run when the checkout has uncommitted changes.

## Interactive UI Model

When run in a TTY, `letskills`, `add`, `remove`, and `source` can open a full-screen terminal UI.

Common controls:

- Up and Down move the cursor
- Space toggles the current selection
- `a` toggles all items when multi-select is available
- Enter confirms
- Esc cancels or exits
- nested screens include a visible `Back` item

Nested exit flows arm Esc on first press and show `Click Esc again to exit.`. A second Esc exits.

When a command is not running in an interactive terminal, it prints normal help or table output instead of opening the TUI.

## Implementation Map

| File | Responsibility |
| --- | --- |
| `src/cli.js` | Parses arguments, routes commands, coordinates interactive and non-interactive flows |
| `src/manager.js` | Creates skills, copies direct local library content, manages source-backed symlink installs, reads and writes install manifest |
| `src/sources.js` | Manages repository/local sources, account credentials, Git clone/pull/push, source discovery |
| `src/updater.js` | Pulls or rescans installed source-backed skills from configured sources and repairs links |
| `src/agents.js` | Defines supported agents, skill directories, and detection |
| `src/storage.js` | Resolves storage root and legacy storage compatibility |
| `src/prompt.js` | Implements the full-screen terminal UI |
| `src/version.js` | Reads package version and updates the checkout with Git |
| `src/branding.js` | Defines canonical command and display names |

Keep business rules in these modules rather than duplicating them in the CLI surface. Tests should prefer direct module calls for narrow behavior and CLI tests for command routing.

## Invariants

Preserve these expectations when changing the project:

- `letskills` is the canonical command name for new user-facing behavior
- `let-skills` remains a compatibility alias
- skill, source, and account names use lowercase letters, numbers, and hyphens
- direct local library copies remain managed installed content
- source-backed skill folders are the canonical installed content for source installs
- agent installs are symlinks to the resolved installed skill folder
- unmanaged agent targets are not removed silently
- managed local library copies become read-only after add
- source provenance and source paths control `letskills update`, `sync`, and `push`
- local-only skills are not refreshed by `letskills update`
- source pushes stage only selected source skill folder paths
- repository tokens never appear in clone URLs, command arguments, tables, or normal logs
- `letskills version update` refuses dirty checkouts
- docs should describe current behavior from a reader's perspective, not as reverse-engineering notes

## Test Strategy

Run the full suite with:

```sh
npm test
```

The test suite uses `node --test` and temporary homes. Most tests set `SKILLS_MANAGER_HOME` so storage behavior stays isolated from the user's real machine.

Current coverage is organized by module:

- `test/cli.test.js`: command routing and non-interactive behavior
- `test/manager.test.js`: skill add, install, remove, sync, manifest, permissions
- `test/sources.test.js`: source registry, accounts, credentials, Git command behavior, discovery
- `test/updater.test.js`: update selection and skip behavior
- `test/prompt.test.js`: terminal UI state and formatting helpers
- `test/storage.test.js`: storage root and legacy fallback
- `test/version.test.js`: package version and checkout update behavior

For docs-only changes, manually verify links, command names, storage paths, and examples. For changes that affect CLI behavior, storage, source handling, update logic, or prompts, run `npm test`.
