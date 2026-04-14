---
name: dkc-reflect
description: Reflect on the current session and compile knowledge when explicitly requested
when_to_use: When developer runs /reflect command
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
user-invocable: true
context: fork
agent: dkc-compiler
model: sonnet
effort: medium
argument-hint: "[--session-id <id>]"
---

# DKC Reflect Skill

Compile knowledge from the current or specified session.

## Instructions

Run the DKC CLI reflect command:
```bash
node $CLAUDE_PLUGIN_ROOT/dist/cli/index.js reflect \
  --project-root $CLAUDE_PROJECT_DIR \
  ${args}
```

Where `${args}` is the argument passed to this skill (e.g., `--session-id 2026-04-08-14`).

If no session ID is provided, the CLI will use the most recent session.

## After Compilation

Read the generated session debrief and provide a brief summary to the developer:
- What was accomplished
- Key concepts extracted
- Any high-priority gaps identified

Keep the summary to 3-5 sentences. The developer can use `/gaps` and `/learned` for deeper analysis.
