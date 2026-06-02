# personal-skills-manager

A small, local-first CLI for managing the agent skills you use yourself.

It is inspired by [`vercel-labs/skills`](https://github.com/vercel-labs/skills), but intentionally keeps a narrower scope:

- local skill folders and reusable Git repository sources
- one canonical personal library at `~/.skills-manager/skills`
- symlink installs so every agent sees the same copy
- a small manifest so broken links can be repaired with `sync`
- no public registry, telemetry, or update checker

## Requirements

- Node.js 20 or newer

## Try It

```sh
npm link

# Create a starter skill folder in the current directory
skillman init my-workflow

# Add it to your personal library and choose install targets interactively
skillman add ./my-workflow

# Add a GitHub or GitLab repository source with guided token setup
skillman source add

# Choose skills from a cloned repository source, then choose install targets
skillman add --source team-skills

# Install the same skill to more agents
skillman install my-workflow --agent claude-code --agent cursor

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
skillman source add [name] [https-url] [--no-interactive]
skillman source list
skillman source update <name>
skillman source remove <name>
```

When you run `add` or `remove` in a terminal without `--agent`, a full-screen welcome screen shows the skills being processed, followed by each agent name and skills path. Use Up and Down to move, Space to toggle the `○` and `●` selection markers, `a` to toggle all, Enter to confirm, or Esc to cancel. The skill list remains visible while the operation runs and on the result screen, which stays open until you press Enter or Esc.

For scripts and CI, pass `--agent` or `--no-interactive`. Non-interactive `add` defaults to `codex`, while non-interactive `remove` uninstalls from every recorded agent. Use `--agent all` to target every supported agent explicitly.

Running `add` again for a skill already in your personal library reuses the saved copy and installs any missing agent links. Pass `--force` when you want to replace the saved library copy with the local folder contents.

## Repository Sources

Add a GitHub, GitLab.com, or self-hosted GitLab repository as a reusable source:

```sh
skillman source add
```

The full-screen setup first asks you to select:

- an existing saved account
- `Add a new account`
- `Public repository` when no access token is needed

When adding an account, enter a reusable account name such as `work-gitlab`, the repository domain, and an access token. For GitHub, use an HTTPS personal access token with repository read access. For GitLab, use an HTTPS access token with `read_repository` permission. Tokens are treated as passwords: they are masked in the TUI, passed to Git through `GIT_ASKPASS`, and never added to the clone URL or repository config.

After choosing an account, enter the local source name and HTTPS repository URL. Each source records which account it uses, so another source can reuse the same account without asking for its token again.

Accounts are stored in:

```text
~/.skills-manager/.credentials.json
```

The file is hidden and written with mode `0600`. Named accounts support separate credentials for `github.com`, `gitlab.com`, and self-hosted domains such as `gitlab.example.com`, including multiple accounts on the same domain. Repositories are cloned under `~/.skills-manager/sources`.

To install from a configured source:

```sh
skillman add --source team-skills
```

`skillman` recursively scans the cloned repository and ignores directory layout. A folder containing `SKILL.md` or `SKILLS.md`, with any letter casing, becomes an available skill. Its parent directory name is used as the skill name. The TUI first asks which discovered skills to install, then asks which agents should receive them.

To uninstall skills from a configured source:

```sh
skillman remove --source team-skills
```

The TUI only lists skills from that source which currently have recorded agent installs. Choose one or more skills, then choose which agent installs to remove. Add `--purge` to delete their personal library copies after uninstalling.

Useful source commands:

```sh
skillman update
skillman source list
skillman source update team-skills
skillman source remove team-skills
skillman account list
```

Run `skillman update` to pull every repository source used by your currently installed skills and refresh their personal library copies. Existing agent installs stay linked to the refreshed copies. Local skills are left untouched and reported as skipped.

## Supported Agents

| Agent | `--agent` value | Global skills directory |
| --- | --- | --- |
| Codex | `codex` | `~/.codex/skills` |
| Claude Code | `claude-code` | `~/.claude/skills` |
| Cursor | `cursor` | `~/.cursor/skills` |
| Gemini CLI | `gemini-cli` | `~/.gemini/skills` |
| OpenCode | `opencode` | `~/.config/opencode/skills` |
| GitHub Copilot | `github-copilot` | `~/.copilot/skills` |

## Environment

Set `SKILLS_MANAGER_HOME` to override the library and manifest location. This is useful for testing or keeping the personal library somewhere other than `~/.skills-manager`.
