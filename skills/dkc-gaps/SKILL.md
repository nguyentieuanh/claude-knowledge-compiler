---
name: dkc-gaps
description: Analyze the knowledge base for gaps and blind spots
when_to_use: When developer runs /gaps command or periodically for knowledge health check
allowed-tools: [Read, Glob, Grep]
user-invocable: true
context: inline
model: inherit
effort: low
---

# DKC Gaps Skill

Read and present the current knowledge gaps from the knowledge base.

## Instructions

1. Read `$CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH/gaps.md` (default: `.knowledge/gaps.md`)
2. If the file doesn't exist, run the full compile first:
   ```bash
   node $CLAUDE_PLUGIN_ROOT/dist/cli/index.js reflect --project-root $CLAUDE_PROJECT_DIR --quiet
   ```
3. Present the gaps in priority order (high → medium → low)
4. For each gap, clearly state:
   - The problem
   - Why it matters for this developer
   - A specific next action

## Format

```
## Knowledge Gaps — <date>

**High Priority**
1. [gap title]: [description]
   → Action: [specific action]

**Medium Priority**
...
```

Keep responses concise and actionable. P3: Every gap must have a concrete next step.
