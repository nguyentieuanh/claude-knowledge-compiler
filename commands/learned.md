---
name: learned
description: Summary of what you've learned and built across sessions
---

Generate a summary of the developer's learning journey and knowledge accumulation.

Read from the knowledge base at $CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH (or .knowledge/):
1. index.md — current knowledge state
2. sessions/ — recent session debriefs (last 10)
3. concepts/ — all concept pages
4. delegation/map.md — AI vs human code ownership

Present a concise summary:
- **What you've mastered**: Concepts with 3+ sessions, human-reviewed code
- **What's growing**: Recently created concepts, active areas of learning
- **Knowledge gaps**: High-priority items from gaps.md
- **Delegation health**: % of AI-written code that's been reviewed
- **Recent momentum**: Last 3 sessions summary

Keep the tone encouraging and forward-looking.
