---
name: code-review
description: Review code changes for bugs, security vulnerabilities, maintainability problems, and missing tests, and return prioritized findings with concrete fixes. Use when asked to review a diff, branch, pull request, commit, or specific files, or before committing or merging.
argument-hint: "[optional: base branch, commit range, PR number, or file paths]"
---

# Code Review

Review the changes identified by: **$ARGUMENTS**

## 1. Determine the scope

Pick the review target in this order:

1. **Explicit argument**:
   - A branch name or range (`main`, `main...HEAD`, `abc123..def456`): `git diff <range>`
   - A PR number, when `gh` is installed and authenticated: `gh pr diff <n>`
   - File or directory paths: review those files in full, with focus on recent changes (`git log -p -n 5 -- <path>`)
2. **No argument**: review uncommitted work: `git diff HEAD` plus untracked files from `git status --porcelain`.
3. **Clean working tree**: review the current branch against its base: `git diff $(git merge-base HEAD origin/HEAD 2>/dev/null || git merge-base HEAD main)...HEAD`.
4. **Not a git repository**: ask the user which files to review.

State the scope you chose and the number of files and lines changed before you start.

## 2. Delegate large reviews

If the diff touches more than about 15 files or 800 changed lines, use the **`nahj-devkit:code-reviewer`** subagent so the main context stays small. Split the work by area (for example backend / frontend / infra) and run one agent per area. Give each agent the exact diff command and the list of files. Combine their reports, remove duplicates, and re-rank the results.

For smaller diffs, review directly using the checklist below.

## 3. Understand before judging

- Read each changed file **in full**, not only the hunks. Many bugs live in the code around a change.
- Find callers of changed functions (Grep for the symbol) to check for broken contracts.
- Read the related tests and the project's conventions (linters, `CONTRIBUTING.md`, `CLAUDE.md`, and the patterns in nearby code).
- Work out what the change is trying to do. Judge it against that goal.

## 4. Checklist

**Correctness**
- Logic errors, inverted conditions, off-by-one errors, wrong operator precedence
- `null`/`undefined`/empty-collection handling. Unchecked array indexing
- Async mistakes: missing `await`, unhandled promise rejections, race conditions, shared mutable state
- Error handling: swallowed exceptions, errors that leak internals, missing cleanup (`finally`, disposing resources)
- Boundary conditions: time zones, locale, integer overflow, float comparison, unicode
- API/contract changes that break callers, serialized formats, or database schemas without a migration

**Security**
- Injection: SQL/NoSQL built with string concatenation, shell commands built from input, `eval`, template injection
- XSS: unescaped output, `dangerouslySetInnerHTML`, `v-html`, `innerHTML` with user data
- Authentication/authorization: missing ownership checks (IDOR), privilege checks only on the client side, insecure session or JWT handling
- Secrets: committed credentials, keys in client bundles, secrets in logs
- Unsafe deserialization, path traversal (`../` in file paths), SSRF via URLs from users, open redirects
- Weak crypto: home-made crypto, MD5/SHA1 for passwords, `Math.random()` for tokens
- New dependencies: is the package needed, maintained, and correctly named (watch for typosquats)?

**Maintainability**
- Names that mislead. Functions that do several unrelated things
- Duplicated logic that already exists elsewhere in the codebase (search before you flag it)
- Dead code, leftover debug logging, commented-out blocks, stale TODOs
- Abstractions that are too complex or too thin for what they do
- Inconsistency with the surrounding code's conventions

**Performance** (flag only where it matters)
- N+1 queries, work inside loops that could be hoisted or batched
- Unbounded memory growth, missing pagination, quadratic algorithms on user-sized input
- Frontend: unnecessary re-renders, large imports where a smaller one would do, layout thrashing

**Tests**
- Is the new behavior covered? Are edge cases and failure paths tested?
- Do the tests check real behavior, or do they only check mocks?

## 5. Verify findings

Before reporting a finding, confirm it:
- Re-read the code path and make sure the issue isn't already handled elsewhere (by a guard, middleware, validation layer, or type).
- When it's cheap and safe, prove it: run the existing tests, a type check, or a linter. Never run destructive or networked commands for this.
- Drop anything you can't back up with a specific line and a concrete failure scenario. Fewer, real findings beat a long speculative list.

## 6. Report format

Start with a one-paragraph summary: the scope reviewed, overall risk (**Low / Medium / High**), and a merge recommendation (**Approve / Approve with fixes / Request changes**).

Then list findings grouped by severity:

- 🔴 **Critical**: exploitable security flaw, data loss, or crash on a main path. Must fix before merging.
- 🟠 **High**: a bug that will hit real users, or a significant security weakness.
- 🟡 **Medium**: an edge-case bug, maintainability problem, or missing important test.
- 🔵 **Low / Nit**: style, naming, or a small improvement. Keep these brief.

For each finding:

```
### [Severity] Short title
**Where:** path/to/file.ts:42
**Problem:** What is wrong, and the concrete scenario where it fails.
**Fix:** The specific change, with a short code snippet when helpful.
```

End with **What's good**: one to three things the change does well, if there are any. Give real credit, not filler.

## Rules

- Do **not** modify files during a review unless the user asks you to apply fixes. If they do, apply them one finding at a time and re-run the relevant checks.
- Cite exact `file:line` locations. Never invent line numbers.
- Don't nitpick formatting that an auto-formatter in the project would handle.
