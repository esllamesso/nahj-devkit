---
name: test-docs
description: Generate meaningful automated tests and developer documentation for an existing project, using the project's own test framework and conventions. Use when asked to add or improve tests, raise coverage, write a README, CONTRIBUTING guide, API or architecture docs, or document a module.
argument-hint: "[tests|docs|both] [optional: path or module to focus on]"
---

# Tests & Developer Docs

Request: **$ARGUMENTS**

Interpret the request:
- Starts with `tests`: do only Part A.
- Starts with `docs`: do only Part B.
- `both`, or anything else: do Part A, then Part B.
- If a path or module is named, limit the work to it. Otherwise, focus on the code that matters most and is least covered.

Always start with **Discovery**.

## Discovery (required)

1. Read the manifest(s): `package.json`, `pyproject.toml`/`setup.cfg`/`requirements*.txt`, `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle*`, `*.csproj`, `composer.json`, `Gemfile`, `pubspec.yaml`.
2. Identify the **existing** test setup. Never introduce a second framework.
   - JS/TS: `vitest`, `jest`, `mocha`, `node:test`, `@playwright/test`, `cypress`, `@testing-library/*`
   - Python: `pytest` (`conftest.py`, `[tool.pytest]`), `unittest`
   - Go: `testing` (`*_test.go`). Rust: `#[cfg(test)]` and `tests/`. Java/Kotlin: JUnit. .NET: xUnit/NUnit/MSTest. Ruby: RSpec/Minitest. PHP: PHPUnit/Pest. Dart: `flutter_test`.
3. Find the test command (the `scripts.test` entry, `Makefile`, CI workflow in `.github/workflows/`), where tests live, how they're named, and how fixtures/mocks are done.
4. Run the existing suite once **before** changing anything and record the baseline (pass/fail counts). If it can't run (missing env vars, services, or dependencies), report that and continue carefully.

If the project has no test framework at all, recommend the standard choice for the stack (for example Vitest for Vite projects, pytest for Python, `node:test` for small Node projects) and **ask before adding it**.

## Part A: Tests

### Choose what to test
Rank candidates and start at the top:
1. Core business logic and pure functions: high value, easy to test.
2. Code with complex branching, parsing, money/date math, or permission checks.
3. Recently changed or bug-prone files (`git log --format= --name-only -n 200 | sort | uniq -c | sort -rn | head`).
4. Public API surfaces: exported functions, HTTP handlers, CLI commands, components.
5. Skip trivial getters, framework boilerplate, and generated code.

### Write meaningful tests
- **Test behavior, not implementation.** Assert on outputs, returned values, rendered text, HTTP responses, and state changes. Don't assert on private internals or call counts unless the call itself is the behavior.
- Cover, for each unit: the main path, boundary values, invalid input and error paths, and any branch a bug report would likely hit.
- Use the **Arrange / Act / Assert** structure and descriptive names: `returns 404 when the order belongs to another user`.
- Mock only at real boundaries: network, clock, randomness, filesystem, third-party services. Prefer the project's existing helpers, fixtures, and factories.
- Keep tests deterministic: fix seeds and clocks, don't depend on test order, don't call the real network.
- UI components: use Testing Library-style queries by role/label/text, and test user interactions and the loading/empty/error states.
- Never weaken an assertion, add `.skip`, or delete a test to make the suite pass.

### When a test reveals a bug
Don't change the test to match broken behavior. Leave the failing test in place (or mark it as an expected failure using the framework's mechanism, with a comment), and report the bug with the file and line, the input, the expected result, and the actual result. Ask before fixing production code.

### Run and report
Run the new tests and the full suite. Report the actual command output summary: tests added, pass/fail counts compared with the baseline, and coverage change if the project already measures coverage (`--coverage`, `pytest --cov`). Never report results you didn't observe.

## Part B: Developer Documentation

### Decide what's missing
Check what exists: `README*`, `CONTRIBUTING*`, `docs/`, `ARCHITECTURE*`, `CHANGELOG*`, API specs (OpenAPI), and inline doc comments. Improve existing docs rather than creating parallel ones.

### Write accurate docs
Every statement must be verified against the code or config. Don't document features that don't exist.

- **README**: one-sentence purpose, features, prerequisites (with versions taken from `engines`, `.nvmrc`, `python_requires`, and similar), installation, configuration (every env var: name, required?, default, description; take these from `.env.example` and code that reads `process.env`/`os.environ`), how to run it locally, how to test it, the project structure, and deployment notes if present.
- **CONTRIBUTING**: setup, branch/commit conventions (inferred from `git log`), how to run lint/tests, and the PR checklist.
- **ARCHITECTURE** (for non-trivial projects): the main modules and their responsibilities, how data flows through a typical request, external services, and key design decisions. Use a Mermaid diagram when it makes things clearer.
- **API reference**: for libraries, the public functions with signatures, parameters, return values, errors, and a runnable example. For services, endpoints with method, path, auth, request/response shapes, and status codes.
- **Inline docs**: add doc comments (JSDoc/TSDoc, docstrings, GoDoc, `///`) only to public or non-obvious code, matching the project's existing style. Explain *why*, not *what*.

### Check
- Copy every command in the docs from a real script, or run it to confirm it works.
- Check that relative links and referenced file paths exist.
- Keep the tone concise and practical, using the project's terminology.

## Final summary
List the files created or changed, the test results (real numbers), any bugs found, and the remaining gaps worth addressing next.
