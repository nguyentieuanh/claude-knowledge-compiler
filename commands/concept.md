---
name: concept
description: Look up a concept in your knowledge base
argument-hint: "[concept name or slug]"
---

Look up the concept "$1" in the knowledge base.

Search for the concept page at $CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH/concepts/ (or .knowledge/concepts/).

1. Find the concept page (try exact slug match first, then fuzzy match)
2. Present the key information: What It Is, Where It's Used, History, Bugs & Lessons
3. Show related concepts for navigation

If no exact match is found, suggest similar concepts from the knowledge base or offer to create a new concept page.

If $1 is empty, list all available concepts grouped by recency.
