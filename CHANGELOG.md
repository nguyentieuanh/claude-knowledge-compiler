# Changelog

All notable changes to DKC will be documented in this file.

## [1.0.0] - 2026-04-08

### Features

- **Session Debrief Compiler** — Auto-generates structured session debriefs with summary, decisions, patterns, trade-offs, unknowns, bugs & lessons, delegation table
- **Concept Wiki Compiler** — Extracts and maintains concept pages from coding sessions, with fuzzy matching, backlink weaving, and same-directory relation detection
- **Delegation Map** — Tracks AI-generated vs human-written code ownership across sessions
- **Gaps Analyzer** — Detects 8 types of knowledge gaps: unreviewed code, concept-no-page, orphan concepts, repeated patterns, persistent unknowns, stale knowledge, missing cross-references
- **Index Generator** — Rich `index.md` navigation hub with grouped concepts, gap summaries, session history, and quick stats
- **Log Audit Trail** — Append-only `log.md` tracking every compile, lint, and query event
- **LLM Client** — Supports Anthropic, OpenAI, and any OpenAI-compatible provider (OpenRouter, Groq, Ollama, etc.). Falls back to deterministic mode without API key.
- **Bilingual Support** — English and Vietnamese output via `language` config
- **Claude Code Plugin Integration** — Full plugin with hooks, slash commands, skills, and agent definitions
  - `SessionStart` hook: injects knowledge context
  - `PostToolUse[Write|Edit]` hook: tracks file changes
  - `PreCompact/PostCompact` hooks: preserves context across compact
  - `SessionEnd` hybrid hook: command (data prep) + agent (LLM compile)
  - Slash commands: `/reflect`, `/gaps`, `/concept`, `/learned`
  - Skills: `dkc-compile`, `dkc-reflect`, `dkc-gaps`
  - Agent: `dkc-compiler`
- **CLI** — `dkc init`, `dkc reflect`, `dkc gaps`, `dkc status`
- **Human Notes Protection** — Compiler never overwrites `## Human Notes` sections (P4: additive only)
- **Auto-extracted Explanations** — Long AI explanations (>300 words) auto-extracted into concept pages (P7: silent file-back)

### Security

- Path traversal prevention in knowledge base path config
- Sensitive command filtering before LLM prompt injection (API keys, tokens, passwords redacted)
- All hooks validate stdin input before processing
- No real API keys stored in repository (`.env` is gitignored)
- Atomic file writes (temp + rename) for data integrity

### Architecture

- TypeScript strict mode, ESM-only
- 119 tests across 12 test files (unit + integration)
- Zero runtime config — works out of the box with `dkc init`
- Deterministic fallback when no LLM API key is available

### Known Limitations

- Qwen 3.5 (via OpenAI-compatible) may fail JSON parsing on very large transcripts (700+ messages); falls back to deterministic mode
- Local plugins require `--plugin-dir` flag (no marketplace listing yet)
- `dkc reflect` requires a session transcript file to exist at the expected path
- Maximum 5 new concepts per session (configurable)
