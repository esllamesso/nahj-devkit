# NAHJ DevKit

A Claude Code plugin for everyday engineering work: building UIs, reviewing code, writing tests and docs, and auditing projects. It also includes a safety hook that stops clearly destructive shell commands before they run.

| Component | Type | Invoke | What it does |
| --- | --- | --- | --- |
| `ui-builder` | Skill | `/nahj-devkit:ui-builder <request>` | Detects your framework and design system, then builds responsive, accessible UI with loading, empty, and error states. |
| `code-review` | Skill | `/nahj-devkit:code-review [range\|PR\|paths]` | Reviews a diff for bugs, security issues, and maintainability problems, and returns ranked, verified findings with fixes. |
| `code-reviewer` | Agent | `@agent-nahj-devkit:code-reviewer` | Read-only reviewer subagent. The `code-review` skill hands large diffs to it. |
| `test-docs` | Skill | `/nahj-devkit:test-docs [tests\|docs\|both] [path]` | Writes behavior-focused tests in your existing framework, plus accurate developer docs. |
| `project-audit` | Skill | `/nahj-devkit:project-audit [focus]` | Read-only audit of architecture, dependencies, quality, tests, and security, ending in a P0–P3 improvement plan. |
| Safety guard | `PreToolUse` hook | Automatic | Blocks catastrophic commands (`rm -rf /`, `mkfs`, `format C:`, ...) and asks before risky ones (`git push --force`, `git reset --hard`, `curl \| sh`, ...). |

Claude also picks the skills up automatically when your request matches their description. You don't have to type the slash command.

## Prerequisites

- **Claude Code** with plugin support. Developed and tested on **v2.1.296**. Check with `claude --version`.
- **Node.js 18+** on your `PATH` for the safety hook. Check with `node --version`. The hook has no npm dependencies.
  - If Node isn't available, Claude Code reports a non-blocking hook error and carries on. The skills and agent still work, but you lose the guard.
- **Git** (recommended). `code-review` and `project-audit` use git history and diffs.
- Optional: the **GitHub CLI** (`gh`) for reviewing pull requests by number.

## Installation

### From GitHub

```bash
claude plugin marketplace add esllamesso/nahj-devkit
claude plugin install nahj-devkit@nahj-devkit
```

Or from inside a Claude Code session:

```
/plugin marketplace add esllamesso/nahj-devkit
/plugin install nahj-devkit@nahj-devkit
```

Restart Claude Code (or run `/reload-plugins`) so the plugin loads.

### From a local clone

```bash
git clone https://github.com/esllamesso/nahj-devkit.git
claude plugin marketplace add ./nahj-devkit
claude plugin install nahj-devkit@nahj-devkit
```

A marketplace added from a local path reads the plugin in place, so your edits take effect at the next session start or after `/reload-plugins`.

## Local testing (for contributors)

Load the plugin for a single session without installing it:

```bash
claude --plugin-dir ./nahj-devkit
```

Validate the manifests and components:

```bash
claude plugin validate ./nahj-devkit --strict
claude plugin validate ./nahj-devkit/.claude-plugin/plugin.json --strict
claude plugin validate ./nahj-devkit/skills --strict
claude plugin validate ./nahj-devkit/agents --strict
```

> When the repository root contains `marketplace.json`, `claude plugin validate <dir>` validates the marketplace. The extra commands above validate the plugin manifest and components directly.

Run the safety-hook test suite (Node built-in test runner, no dependencies):

```bash
node --test "tests/*.test.js"
```

Feed a single payload to the hook by hand. It prints a JSON decision, or nothing if the command is allowed:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | node hooks/scripts/safety-guard.js
```

Inspect what the installed plugin provides:

```bash
claude plugin details nahj-devkit
```

## Usage examples

```
/nahj-devkit:ui-builder pricing page with three tiers and a monthly/yearly toggle
/nahj-devkit:ui-builder make the dashboard sidebar collapsible and mobile friendly

/nahj-devkit:code-review                  # uncommitted changes
/nahj-devkit:code-review main...HEAD      # current branch vs main
/nahj-devkit:code-review 42               # PR #42 (requires gh)
/nahj-devkit:code-review src/auth/        # specific paths

/nahj-devkit:test-docs tests src/billing  # tests for one module
/nahj-devkit:test-docs docs               # README / CONTRIBUTING / architecture
/nahj-devkit:test-docs both

/nahj-devkit:project-audit                # full health check
/nahj-devkit:project-audit security       # focused audit

@agent-nahj-devkit:code-reviewer review the last 3 commits
```

## Safety guard

The hook runs before every `Bash` and `PowerShell` tool call and looks only at the command text. It splits the command into its separate commands while respecting quotes, so `echo "rm -rf /"` and `git commit -m "never rm -rf /"` are **not** flagged. It also checks commands nested inside `bash -c "..."`, `pwsh -Command "..."`, and `cmd /c "..."`.

**Blocked (deny):**
- Recursive delete of `/`, `~`, `$HOME`, a drive root (`C:\`, `/c/`), or a system directory (`/etc`, `/usr`, `C:\Windows`, ...), including `--no-preserve-root`
- `Remove-Item -Recurse`, `rd /s`, or `del /s` on those same targets
- `mkfs*`, `wipefs`, `format C:`, `Format-Volume`, `Clear-Disk`, `dd of=/dev/sdX`, redirecting output to a raw disk
- Fork bombs, recursive `chmod`/`chown` on `/`, `find / -delete`

**Confirmation required (ask):**
- `git push --force` (not `--force-with-lease`), `git reset --hard`, `git clean -f`
- `rm -rf .`, `rm -rf *`
- `curl`/`wget`/`irm` piped into a shell or `iex`
- `DROP DATABASE`, `DROP TABLE`, `TRUNCATE TABLE`, `diskpart`

**Everything else** goes through Claude Code's normal permission flow. Day-to-day commands such as `rm -rf node_modules`, `rm -rf ./dist`, and `git push` are untouched.

**Modes.** Set `NAHJ_GUARD_MODE` in the environment you launch Claude Code from:

| Value | Behavior |
| --- | --- |
| `block` (default) | Deny catastrophic commands, ask for risky ones |
| `warn` | Downgrade every deny to an ask, so you can approve case by case |
| `off` | Disable the guard |

The guard **fails open**: malformed input or an internal error lets the command through to the normal permission flow rather than blocking your work. It's a safety net for obvious mistakes, not a security boundary. A determined or obfuscated command (variables, `eval`, encoded payloads) can get past it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/nahj-devkit:...` commands don't appear | Run `claude plugin list` and check that the plugin shows `✔ enabled`. Restart Claude Code or run `/reload-plugins`. |
| `Plugin "nahj-devkit" not found in marketplace` | Run `claude plugin marketplace update nahj-devkit`, then install again using the full id `nahj-devkit@nahj-devkit`. |
| Hook error mentioning `node` | Node.js isn't on the `PATH` Claude Code sees. Install Node 18+ and restart your terminal. |
| A legitimate command was blocked | Run it yourself in a terminal, or start Claude Code with `NAHJ_GUARD_MODE=warn`. Please open an issue with the command so the rule can be refined. |
| The hook never seems to fire | Run `claude --debug` and look for `PreToolUse` lines. Check that `hooks/hooks.json` is unchanged and `claude plugin validate` passes. |
| Skills appear without descriptions in a busy setup | Claude Code shortens the skill listing when many skills are installed. Invoking them by name still works. |
| Frontmatter "not found" warning after editing a `SKILL.md` | The file must start with `---` on the very first line, with no blank line or BOM before it. |

## Repository layout

```
nahj-devkit/
├── .claude-plugin/
│   ├── plugin.json          # plugin manifest
│   └── marketplace.json     # marketplace catalog (this repo is both)
├── agents/
│   └── code-reviewer.md
├── hooks/
│   ├── hooks.json           # PreToolUse registration
│   └── scripts/
│       └── safety-guard.js
├── skills/
│   ├── code-review/SKILL.md
│   ├── project-audit/SKILL.md
│   ├── test-docs/SKILL.md
│   └── ui-builder/SKILL.md
├── tests/
│   └── safety-guard.test.js
├── .github/workflows/ci.yml
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE)
