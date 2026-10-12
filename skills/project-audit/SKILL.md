---
name: project-audit
description: Audit an existing project's architecture, dependencies, code quality, testing, security posture, and developer tooling, then produce a prioritized, actionable improvement plan. Use when onboarding to an unfamiliar codebase, preparing for a refactor or release, assessing technical debt, or when asked for a project health check.
argument-hint: "[optional: focus area such as security, dependencies, performance, or a subdirectory]"
---

# Project Audit

Audit focus: **$ARGUMENTS** (if empty, audit the whole project at a balanced depth).

This is a **read-only** investigation. Don't modify, install, or upgrade anything during the audit. Only run commands that inspect. Base every finding on evidence (a file, a command output, a line). Label anything you infer.

## Phase 1: Map the project

1. **Identity**: read the README and the manifest(s) to learn the project's purpose, language(s), framework(s), and runtime versions.
2. **Size and shape**: list the top-level layout and count source files by type, for example `git ls-files | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15`. Find entry points (main, server bootstrap, app router, CLI).
3. **Architecture**: work out the layering (UI → API → services → data), module boundaries, and how a typical request or flow moves through the code. Note the state management, data access layer, and external integrations (databases, queues, third-party APIs).
4. **History**: `git log --oneline | head -20`, the number of contributors, and churn hotspots: `git log --format= --name-only --since="6 months ago" | sort | uniq -c | sort -rn | head -15`.

## Phase 2: Evaluate

For each area, record specific findings with evidence.

### Architecture & design
- Clear separation of concerns, or business logic mixed into UI/controllers?
- Circular dependencies, god files/classes. List the largest source files: `git ls-files | xargs wc -l 2>/dev/null | sort -rn | head -15`.
- Consistency: do similar features follow the same pattern?
- Configuration handling: kept in env vars and validated at startup, or hard-coded?

### Dependencies
- Inventory direct dependencies. Flag unused ones (declared but never imported, checked with Grep), duplicates that do the same job, and heavy dependencies used for something trivial.
- Lockfile present and committed? Multiple lockfiles that conflict?
- Outdated or vulnerable packages: run the ecosystem's **read-only** audit command if the tool is already installed (`npm audit --omit=dev`/`npm outdated`, `pnpm audit`, `pip list --outdated`, `pip-audit`, `cargo audit`, `go list -m -u all`, `dotnet list package --vulnerable`, `bundle outdated`). Never install new tools to do this. If no tool is available, say so.
- Runtime versions: EOL Node/Python/etc. according to `engines`, `.nvmrc`, `.python-version`, Dockerfiles, and CI configs.

### Code quality
- Is lint/format configured (`eslint`, `prettier`, `biome`, `ruff`, `black`, `golangci-lint`, `clippy`, `rubocop`)? Does it run in CI? If a lint/type-check script exists, run it and summarize the counts.
- TypeScript strictness (`strict`, `noImplicitAny`), and use of `any`/`@ts-ignore`/`# type: ignore`. Count them with Grep.
- Error handling patterns, logging approach, dead code, TODO/FIXME/HACK count and age.
- Duplication: look for repeated blocks in hotspot files.

### Testing
- Framework, test file count compared with source file count, and what kinds of tests exist (unit, integration, e2e).
- Run the test suite if it's safe and quick, and report the real pass/fail. Note untested critical paths (auth, payments, data mutation).
- Do tests run in CI?

### Security posture
- Search for committed secrets: `.env` files tracked by git, private keys, high-entropy strings, and patterns such as `AKIA[0-9A-Z]{16}`, `-----BEGIN .* PRIVATE KEY-----`, `sk_live_`, `ghp_`, `xox[bp]-`. Report the location only. **Never print the secret value.**
- `.gitignore` coverage for env files, build output, and IDE files.
- Authentication/authorization approach, input validation at boundaries, CORS/CSP/security headers, and SQL built with string concatenation.
- Dockerfiles: running as root, `latest` tags, secrets in build args.

### Developer experience & operations
- Can a newcomer run it from the README alone? Is there a `.env.example`?
- CI/CD: workflows present, which checks gate merges, caching.
- Containerization, IaC, migrations, observability (structured logs, health checks, error tracking).
- Documentation freshness compared with the actual scripts and structure.

### Performance (only where the evidence shows a problem)
- N+1 data access, missing pagination, large frontend bundles (heavy imports), missing caching on hot paths.

## Phase 3: Report

Use this structure:

```
# Project Audit: <project name>
Date: <today> · Scope: <whole project | focus> · Commit: <short sha>

## Executive summary
3–5 sentences: what the project is, its overall health, and the top 3 risks.

## Scorecard
| Area | Rating (Good / Fair / Needs work / Critical) | Key evidence |
| Architecture | ... | ... |
| Dependencies | ... | ... |
| Code quality | ... | ... |
| Testing | ... | ... |
| Security | ... | ... |
| Developer experience | ... | ... |

## Findings
Grouped by area. Each finding: title, evidence (path:line or command output), impact, recommendation.

## Prioritized improvement plan
### P0: Do now (security exposures, data-loss risks, broken builds)
### P1: Next sprint (high-impact, moderate effort)
### P2: Planned (structural improvements, debt paydown)
### P3: Nice to have
Each item: action · why it matters · effort (S/M/L) · files/areas affected.

## Quick wins
Up to 5 changes that each take under an hour and deliver visible value.

## What's working well
Strengths to preserve.
```

Rank by **impact ÷ effort**, with risk overriding everything else. Keep the plan realistic: around 3 P0 items, 5 P1 items, and the rest in later tiers.

At the end, ask whether the user wants the report saved to a file (for example `docs/AUDIT.md`) and whether to start on any P0/P1 item. Don't write the file without that confirmation.
