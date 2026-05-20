# Changelog

## [Unreleased]

### Bug Fixes

- Fixed double auto-continue firing in headless mode due to missing `clearTimeout` on existing timer
- Fixed `pendingPhasePrompt` not being cleared in session history, causing stale phase prompts on session restore

### Changed

- Consolidated all `cloneBoard()` usage to a single helper, eliminating scattered deep-clone patterns
- Moved `getStatusCounts` from `engine.ts` to `validation.ts` to colocate with other status-related logic
- Replaced all magic status-string literals with the `TERMINAL_STATUSES` constant for consistency
- Renamed `detectPhaseCompletion` → `checkAndSetPhaseCompletion` to better reflect its side-effect nature

### Removed

- Removed dead code: `isValidTaskRecord`, `getActivePhase`, `getReadyTasks` (unexported), `resetAutoContinue`, and several internal helpers that were never called externally
- Removed duplicate and low-value test cases

### Refactored

- Extracted all TypeBox schemas from `engine.ts` into dedicated `schemas.ts` module
- Split monolithic engine.test.ts into 4 focused engine test files (engine-compile.test.ts, engine-edits.test.ts, engine-queries.test.ts, engine-write.test.ts). Added new test files for renderers.ts, index.ts, and config.ts coverage

### CI

- Updated CI pipeline to enforce coverage thresholds (statement and branch)

### Stats

- **Tests:** 278 (was 289 — net reduction from dead-code removal, offset by new coverage tests)
- **Statement coverage:** 95.69% (was 92.1%)
- **Branch coverage:** 93.14%

## 0.1.0 (2025-05-20)

### Added

- Initial release of pi-tasks extension
- 5 tools: `write_tasks`, `edit_tasks`, `compile_tasks`, `clear_tasks`, `get_ready_tasks`
- Strict task status gating with 7 statuses: `draft`, `configured`, `ready`, `implementing`, `reviewing`, `done`, `abandoned`
- Phase-based workflow with hard gating between phases
- Dependency tracking between tasks
- Auto-continue with circuit breaker (max 20 iterations)
- 3-second countdown with interrupt capability
- Session persistence via custom entries (event + snapshot)
- State reconstruction from snapshots on `session_start` and `session_tree`
- Hidden context injection via `before_agent_start`
- Deadlock detection with repair instructions
- Phase completion prompt template via `.pi/phased-tasks.json`
- 289 tests with 92% code coverage
