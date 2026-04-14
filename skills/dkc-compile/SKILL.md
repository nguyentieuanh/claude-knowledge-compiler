---
name: dkc-compile
description: Compile the current coding session into the developer knowledge base
when_to_use: When SessionEnd hook triggers or developer runs /reflect command
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
user-invocable: false
context: fork
model: sonnet
effort: high
---

# DKC Compile Skill

You are running the DKC Compiler. Your job is to compile the current coding session into the developer's knowledge base.

## Step 1: Load Pending Data

Read `$CLAUDE_PLUGIN_DATA/pending-compile.json` to get session data. If it doesn't exist, read the knowledge base index instead.

The pending-compile.json contains:
```json
{
  "sessionId": "...",
  "transcriptPath": "~/.claude/projects/.../session.jsonl",
  "projectRoot": "/path/to/project",
  "knowledgeBasePath": ".knowledge",
  "delegationBuffer": [...],
  "messageCount": 12
}
```

## Step 2: Run CLI Compiler

Execute the DKC CLI to handle all compilation:
```bash
node ${CLAUDE_PLUGIN_ROOT:-$HOME/.dkc}/dist/cli/index.js reflect \
  --from-pending \
  --project-root <projectRoot from pending data> \
  --quiet
```

If the CLI is not available or fails, proceed to Step 2b (manual compile).

## Step 2b: Manual Compile (Fallback)

If the CLI fails, compile manually by reading the session transcript and writing outputs directly.

### Session Debrief — write to `<knowledgeBasePath>/sessions/<sessionId>.md`

```yaml
---
session_id: YYYY-MM-DD-HH
date: "YYYY-MM-DD"
duration_minutes: N
files_changed: N
concepts: ["slug1", "slug2"]
status: auto-generated
lines_added: N
lines_removed: N
---
```

Required sections (in order):
1. `## Summary` — 3-5 sentences, past tense, project-specific
2. `## Decisions Made` — Decision | Why | Alternatives considered
3. `## Patterns Applied` — pattern name, file, how applied
4. `## Trade-offs Accepted` — what was chosen over what, and why
5. `## Unknowns & Learning Gaps` — concepts the developer asked about or seemed uncertain of
6. `## Auto-extracted Explanations` — long AI explanations condensed into project-specific summaries
7. `## Delegation Summary` — table: File | AI/Human | Notes

### Concept Page — write to `<knowledgeBasePath>/concepts/<slug>.md`

```yaml
---
name: Display Name
slug: kebab-slug
first_seen: "YYYY-MM-DD"
last_updated: "YYYY-MM-DD"
session_count: N
status: auto-generated
related_concepts: ["slug1"]
related_files: ["path/to/file.ts"]
---
```

Required sections (in order):
1. `## What It Is (in this project)` — 1-3 sentences, project-specific (NOT generic definition)
2. `## Where It's Used` — file:line references with context
3. `## History` — table: Date | Session | What happened
4. `## Bugs & Lessons` — date-stamped entries
5. `## Related Concepts` — `[[slug]]` cross-references
6. `## Human Notes` — **NEVER modify this section if it exists**

### Index — update `<knowledgeBasePath>/index.md`

```markdown
# Knowledge Index — <project>
> Last updated: YYYY-MM-DD | N concepts | N sessions compiled

## Active Concepts (updated in last 30 days)
### <Domain Name>
- [Concept Name](concepts/slug.md) — N sessions | last: YYYY-MM-DD | related: slug1, slug2

## Knowledge Gaps (high priority)
- **gap-type**: description → suggested action

## Recent Sessions
- [session-id](sessions/session-id.md) — YYYY-MM-DD | N files, N concepts touched

## Quick Stats
- Total concepts: N
- Total sessions: N
```

### Log — append one line to `<knowledgeBasePath>/log.md`

```
- YYYY-MM-DD HH:MM | compile | <session-id> | N concepts, N new, N files tracked
```

## Rules

1. **NEVER overwrite `## Human Notes`** in any concept page (P4: additive only)
2. Content must be **project-specific**, not generic definitions (P2)
3. Maximum 5 new concepts per session
4. `related_files` must be relative paths from project root
5. Session debriefs are append-only — never modify existing sessions
6. Use `[[concept-slug]]` syntax for cross-references

## Step 3: Verify Output

After compilation, confirm that:
- `<knowledgeBasePath>/sessions/<sessionId>.md` was created
- `<knowledgeBasePath>/index.md` was updated
- `<knowledgeBasePath>/log.md` has a new entry

## Step 4: Clean Up

Delete `$CLAUDE_PLUGIN_DATA/pending-compile.json` to prevent duplicate compilation.

## Step 5: Report

Report to the user (briefly):
- Session compiled: ✓
- New concepts: N
- Updated concepts: N
- Gaps detected: N

Keep the report to 2-3 lines. P1: Do not interrupt the developer's flow.
