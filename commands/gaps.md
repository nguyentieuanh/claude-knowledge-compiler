---
name: gaps
description: Show knowledge gaps and blind spots in your understanding of this codebase
---

Analyze the knowledge base and show current knowledge gaps.

Read the file at $CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH/gaps.md (or .knowledge/gaps.md by default) and present the current knowledge gaps in a clear, actionable format.

For each gap, explain:
1. What the gap is
2. Why it matters
3. A specific action to close it

If the gaps file doesn't exist or is stale (>24 hours old), suggest running `/reflect` first to update the analysis.
