# Minimal Workflow

This project uses a five-step workflow:

1. Plan and clarify
2. Plan approval
3. Implement
4. Verify result
5. Documentation

The goal is to keep changes small, intentional, and easy to review.

## 1. Plan and clarify

Start by reading the relevant files and restating the requested result. Call out unclear scope or decisions that affect implementation.

Output: a short plan with the files or areas likely to change.

## 2. Plan approval

Wait for approval before editing. If the scope changes, update the plan and get approval again.

Output: an approved implementation scope.

## 3. Implement

Make the approved change with minimal churn. Follow the existing style of the CLI, tests, and documentation.

Output: code or documentation changes limited to the approved scope.

## 4. Verify result

Run the smallest useful verification. Use `npm test` for behavior changes. For documentation-only changes, manually check that commands, links, and examples are coherent.

Output: verification command or manual check result.

## 5. Documentation

Update README or other docs when user-facing behavior changes. If docs do not need changes, note that in the handoff.

Output: updated docs or a clear reason no docs update was needed.

