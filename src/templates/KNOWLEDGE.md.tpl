# Developer Knowledge Compiler — Knowledge Base

**Schema version**: {{version}}
**Project**: {{projectName}}
**Initialized**: {{date}}

This knowledge base is maintained by DKC. Do not manually edit files in `sessions/` or `concepts/` —
use `dkc reflect` to add sessions and let DKC manage updates.

You can freely edit the `## Human Notes` section in any concept page — DKC will never overwrite it.

## Structure

```
.knowledge/
  KNOWLEDGE.md          # This file — schema definition
  index.md              # Navigation hub — start here
  log.md                # Audit trail (append-only)
  gaps.md               # Current knowledge gaps
  .dkc.config.json      # DKC configuration
  sessions/             # Session debriefs
  concepts/             # Concept wiki pages
  delegation/           # AI vs human code tracking
```

---

## Schema: Concept Page

Every file in `concepts/` must follow this format. DKC enforces these fields — do not remove them.

```yaml
---
name: Display Name           # required, title case
slug: kebab-slug             # required, matches filename
first_seen: "YYYY-MM-DD"    # required, ISO date
last_updated: "YYYY-MM-DD"  # required, updated by DKC on each compile
session_count: N             # required, integer
status: auto-generated       # required: auto-generated | human-reviewed
related_concepts: ["slug1"]  # required, can be empty []
related_files: ["path/to/file.ts"]  # required, relative paths from project root
---
```

**Required sections** (in order):
1. `## What It Is (in this project)` — 1-3 sentences, project-specific (NOT generic definition)
2. `## Where It's Used` — file:line references with context
3. `## History` — table: Date | Session | What happened
4. `## Bugs & Lessons` — date-stamped bug → fix → lesson entries
5. `## Related Concepts` — `[[slug]]` cross-reference links
6. `## Human Notes` — **DKC never modifies this section**

---

## Schema: Session Debrief

Every file in `sessions/` must follow this format.

```yaml
---
session_id: YYYY-MM-DD-HH   # required
date: "YYYY-MM-DD"           # required
duration_minutes: N          # required
files_changed: N             # required
concepts: ["slug1"]          # required, slugs of concepts touched
status: auto-generated       # required: auto-generated | human-reviewed
lines_added: N               # optional
lines_removed: N             # optional
cost_usd: N.NN               # optional
---
```

**Required sections** (in order):
1. `## Summary` — 3-5 sentences, past tense, project-specific
2. `## Decisions Made` — Decision | Why | Alternatives considered
3. `## Patterns Applied` — pattern name, file, how applied
4. `## Trade-offs Accepted` — what was chosen over what, and why
5. `## Unknowns & Learning Gaps` — concepts the developer asked about or seemed uncertain of
6. `## Auto-extracted Explanations` — long AI explanations condensed into project-specific summaries
7. `## Delegation Summary` — table of files: File | AI/Human | Notes

---

## Schema: gaps.md

```markdown
# Knowledge Gaps
> N gaps detected: N high, N medium, N low

## High Priority
### <gap title>
> <description>
**Action:** <specific action with file references>
**Files:** <relative paths, comma-separated>   # only for unreviewed-code gaps
**Concepts:** <slug list>                       # only for concept gaps

## Medium Priority
...

## Low Priority
...
```

---

## Schema: index.md

The index groups active concepts by domain. Claude reads this at session start.

```markdown
# Knowledge Index — <project>
> Last updated: YYYY-MM-DD | N concepts | N sessions compiled

## Active Concepts (updated in last N days)

### <Domain Name>
- [Concept Name](concepts/slug.md) — N sessions | last: YYYY-MM-DD | related: slug1, slug2

## Stale Concepts (not updated in N+ days)
- [Concept Name](concepts/slug.md) — last: YYYY-MM-DD

## Knowledge Gaps (high priority)
- **gap-type**: description → suggested action

## Recent Sessions
- [session-id](sessions/session-id.md) — YYYY-MM-DD | N files, N concepts touched

## Quick Stats
...
```

---

## Design Principles

- **P1**: DKC writes silently, speaks when asked — never interrupt developer flow
- **P2**: Content is project-specific, never generic — write for THIS codebase
- **P3**: Every gap has a suggested action with file references
- **P4**: Additive only — existing content is never overwritten (especially Human Notes)
- **P6**: index.md is your entry point every session — grouped by domain, with 1-line summaries
- **P7**: Long AI explanations (>300 words) auto-extract into concept pages

---

## Compiler Rules

1. Never overwrite `## Human Notes` in any concept page
2. `related_files` must always be relative paths from project root (never absolute)
3. `related_concepts` must only reference slugs of existing concept pages
4. Maximum 5 new concepts per session by default (configurable via `.dkc.config.json`)
5. Session debriefs are append-only — never modify existing sessions
6. `log.md` is append-only — each compile adds exactly one line
