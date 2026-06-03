# personal-skills-manager

A small, local-first CLI for managing the agent skills you use yourself.

It is inspired by [`vercel-labs/skills`](https://github.com/vercel-labs/skills), but intentionally keeps a narrower scope:

- local skill folders plus reusable repository or local-directory sources
- one canonical personal library at `~/.skills-manager/skills`
- symlink installs so every agent sees the same copy
- a small manifest so broken links can be repaired with `sync`
- no public registry, telemetry, or update checker

## Requirements

- Node.js 20 or newer

## Try It

```sh
npm link

# Open the main home page
skillman

# Create a starter skill folder in the current directory
skillman init my-workflow

# Add it to your personal library and choose install targets interactively
skillman add ./my-workflow

# Open the interactive source manager
skillman source

# Add a local directory as a reusable source
skillman source add team-skills ./path/to/skills --no-interactive

# Choose skills from a cloned repository source, then choose install targets
skillman add --source team-skills

# Install the same skill to more agents
skillman install my-workflow --agent claude-code --agent hermes

# See your library and installed agents
skillman list

# Repair symlinks from the saved manifest
skillman sync

# Pull repository sources and refresh every installed source skill
skillman update

# Choose which recorded agent installs to remove
skillman remove my-workflow

# Uninstall and delete the library copy
skillman remove my-workflow --purge
```

## Commands

```text
skillman init <name> [--dir <path>]
skillman
skillman add <local-skill-folder...> [-a, --agent <agent...>] [--force] [--no-interactive]
skillman add --source <source-name>
skillman install <skill...> [-a, --agent <agent...>] [--force]
skillman list
skillman remove <skill...> [-a, --agent <agent...>] [--purge] [--no-interactive]
skillman remove --source <source-name> [--purge]
skillman update
skillman sync [--force]
skillman agents
skillman version
skillman version update
skillman account add <name> <domain> <token>
skillman account list
skillman account remove <name>
skillman source
skillman source add [name] [https-url|local-directory] [--account <name>] [--no-interactive]
skillman source list
skillman source update <name>
skillman source remove <name>
```

When you run `skillman`, `add`, `remove`, or `source` in a terminal, the full-screen TUI supports Up and Down to move, Space to toggle the `○` and `●` selection markers, `a` to toggle all when multi-select is available, Enter to confirm, and Esc to go back when a previous step exists. On top-level screens, Esc exits the flow.

Running `skillman` with no arguments opens the home page, which links to the main skills and source management flows. Outside an interactive terminal, `skillman` prints the normal help text instead.

For scripts and CI, pass `--agent` or `--no-interactive`. In a terminal, the interactive agent selector only shows detected agents. Non-interactive `add` defaults to the detected Codex agent when available, otherwise the first detected supported agent, and falls back to `codex` if no supported agent is detected yet. Non-interactive `remove` uninstalls from every recorded agent. Use `--agent all` to target every supported agent explicitly.

Running `add` again for a skill already in your personal library reuses the saved copy and installs any missing agent links. Pass `--force` when you want to replace the saved library copy with the local folder contents.

## Sources

Add a GitHub, GitLab.com, self-hosted GitLab repository, or a local directory as a reusable source:

```sh
skillman source
```

The interactive source manager lets you:

- add repository sources
- add local directory sources
- update or remove existing sources
- add or remove saved repository accounts

When adding an account, enter a reusable account name such as `work-gitlab`, the repository domain, and an access token. For GitHub, use an HTTPS personal access token with repository read access. For GitLab, use an HTTPS access token with `read_repository` permission. Tokens are treated as passwords: they are masked in the TUI, passed to Git through `GIT_ASKPASS`, and never added to the clone URL or repository config.

For scripts and CI, you can add an account without the TUI:

```sh
skillman account add work-gitlab gitlab.example.com glpat-xxxx
```

When adding a repository source, the TUI first asks which account to use:

- an existing saved account
- `Add a new account`
- `Public repository` when no access token is needed

After choosing an account, enter the local source name and HTTPS repository URL. Each repository source records which account it uses, so another source can reuse the same account without asking for its token again.

Accounts are stored in:

```text
~/.skills-manager/.credentials.json
```

The file is hidden and written with mode `0600`. Named accounts support separate credentials for `github.com`, `gitlab.com`, and self-hosted domains such as `gitlab.example.com`, including multiple accounts on the same domain. Repository sources are cloned under `~/.skills-manager/sources`.

To add a local directory source without cloning anything:

```sh
skillman source add team-skills ./path/to/skills --no-interactive
```

Local directory sources store the resolved directory path, scan it the same way as repository sources, and never delete the original folder when you remove the source from `skillman`.

To install from a configured source:

```sh
skillman add --source team-skills
```

`skillman` recursively scans the source directory and ignores directory layout. A folder containing `SKILL.md` or `SKILLS.md`, with any letter casing, becomes an available skill. Its parent directory name is used as the skill name. Invalid skill folders are reported and skipped, so valid skills from the same source can still be installed. The TUI first asks which discovered skills to install, then asks which agents should receive them.

To uninstall skills from a configured source:

```sh
skillman remove --source team-skills
```

The TUI only lists skills from that source which currently have recorded agent installs. Choose one or more skills, then choose which agent installs to remove. Add `--purge` to delete their personal library copies after uninstalling.

Useful source commands:

```sh
skillman update
skillman source
skillman account add work-gitlab gitlab.example.com glpat-xxxx
skillman source list
skillman source update team-skills
skillman source remove team-skills
skillman account list
skillman account remove work-gitlab
```

To inspect or update this `skillman` checkout itself:

```sh
skillman version
skillman version update
```

`skillman version update` runs `git pull --ff-only` in the local `skillman` checkout. It refuses to run when the checkout has uncommitted changes, and it only works when `skillman` is running from a Git clone rather than a packaged install.

Run `skillman update` to refresh every configured source used by your currently installed skills. Repository sources are pulled, local directory sources are rescanned in place, and the personal library copies are refreshed. Existing agent installs stay linked to the refreshed copies. Direct local adds that are not tied to a source are left untouched and reported as skipped.

## Supported Agents

| Agent | `--agent` value | Global skills directory |
| --- | --- | --- |
| Codex | `codex` | `~/.codex/skills` |
| Claude Code | `claude-code` | `~/.claude/skills` |
| GitHub Copilot | `github-copilot` | `~/.copilot/skills` |
| Hermes | `hermes` | `~/.hermes/skills` |

## Environment

Set `SKILLS_MANAGER_HOME` to override the library and manifest location. This is useful for testing or keeping the personal library somewhere other than `~/.skills-manager`.
