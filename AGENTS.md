# Repository Workflow

This repository uses a minimal delivery workflow for all non-trivial changes:

1. Plan and clarify
2. Plan approval
3. Implement
4. Verify result
5. Documentation

Use this workflow before changing product code, tests, release behavior, or user-facing docs. For tiny mechanical fixes, still keep the same order, but the plan and approval can be brief.

## 1. Plan and clarify

- Read the relevant files before proposing work.
- Restate the requested outcome in concrete terms.
- Identify any unclear scope, risky assumption, or user decision needed.
- Keep the plan small and tied to observable files or commands.

Do not implement during this step unless the user explicitly asks for immediate execution.

## 2. Plan approval

- Present the plan and wait for approval before editing files.
- If the user changes scope, revise the plan first.
- Treat approval as covering only the stated scope.

## 3. Implement

- Make the smallest change that satisfies the approved plan.
- Follow the existing Node.js, CLI, and test style in this repository.
- Avoid unrelated refactors or formatting churn.
- Do not overwrite user changes. If the worktree changes unexpectedly, inspect before continuing.

## 4. Verify result

- Run the narrowest useful verification for the change.
- Prefer `npm test` when behavior, CLI flow, storage, sources, or update logic changes.
- For docs-only changes, review links, commands, and examples manually.
- Report any verification that could not be run.

## 5. Documentation

- Update documentation when behavior, commands, flags, storage paths, or workflow expectations change.
- Keep docs concise and command-oriented.
- If no documentation change is needed, say why in the final handoff.

## Final Handoff

End each completed task with:

- what changed
- what verification ran
- any follow-up risk or skipped verification

