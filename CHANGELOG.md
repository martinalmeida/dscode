# Changelog

## 3.1.0

- Added exploration budgets per file and per task to prevent read/pagination loops.
- Added runtime-managed `EditIntent` with SHA-256 snapshots from the last real read.
- Mutation tools now receive an injected `expected_hash` to prevent stale overwrites.
- Added atomic edit conflict detection (`EDIT_CONFLICT`).
- Increased the default tool-result window to 24k chars so medium files can be inspected without unnecessary pagination.
- Tightened the BUILD loop so a task moves toward editing after sufficient inspection instead of continuing to explore indefinitely.
- Verification now accepts intentional file deletion snapshots.
- Added regression coverage for stale-edit conflicts.

## 3.0.0

- Introduced task state, atomic edit transactions, physical change verification, single-tool turns, and automatic post-edit verification/repair.

## 3.2.0 — CLI product UX

- Replaced the large startup ASCII banner with a compact product header.
- Added `/help`, `/status`, `/clear`, `/plan`, `/build`, and `/exit` commands.
- Added command history with Up/Down arrows.
- Added Ctrl+L terminal clearing.
- Reduced tool output noise and highlighted mutation/verification success and errors.
- Added a compact BUILD/PLAN prompt with project identity.
- Kept the filesystem/orchestrator behavior from 3.1.0 unchanged.
