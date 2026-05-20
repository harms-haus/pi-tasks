# Changelog

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
