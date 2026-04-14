# Agent Workflow — How Agents Collaborate

## Sprint Cycle

```
┌─────────────────────────────────────────────────────────┐
│                    SPRINT START                          │
│                                                         │
│  PM reads SRS → picks next Step → creates backlog       │
│  Output: Sprint Backlog + Acceptance Criteria            │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  ARCHITECTURE                            │
│                                                         │
│  Tech Lead reads backlog → breaks into modules          │
│  Output: Module Specs + Interface Contracts              │
│                                                         │
│  Doc Agent creates/updates templates (parallel)          │
│  Output: Template files, prompt templates                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 IMPLEMENTATION                           │
│                                                         │
│  Dev Agent(s) implement modules (parallel if independent)│
│  Each Dev: code + tests → self-check → report done      │
│                                                         │
│  Parallel lanes:                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │ Module A │ │ Module B │ │ Module C │                │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                │
└───────┼────────────┼────────────┼───────────────────────┘
        │            │            │
        ▼            ▼            ▼
┌─────────────────────────────────────────────────────────┐
│                   QA REVIEW                              │
│                                                         │
│  QA reviews each module:                                 │
│  - Run tests, check coverage                             │
│  - Verify output format vs templates                     │
│  - Edge case testing                                     │
│  - Bug reports → back to Dev                             │
│                                                         │
│  Loop until: all modules pass QA                         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 INTEGRATION                              │
│                                                         │
│  Integration Agent:                                      │
│  - Wire modules into CLI/plugin pipeline                 │
│  - Run E2E tests                                         │
│  - Verify data flow: Trigger → Collect → Compile → KB    │
│                                                         │
│  QA runs integration tests                               │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 SPRINT REVIEW                            │
│                                                         │
│  PM reviews deliverable vs acceptance criteria           │
│  - Definition of Done check (SRS §12)                    │
│  - Design principles compliance (P1-P7)                  │
│  - Ready to commit? → Commit & move to next Step         │
│  - Not ready? → Bug fixes → re-QA                        │
└─────────────────────────────────────────────────────────┘
```

## Execution Order Mapping

```
Sprint 1 → Step 1: Skeleton & Init (P0)
  PM:           Define init acceptance criteria
  Tech Lead:    Module breakdown for core/, utils/, cli/init, templates/
  Dev Core:     schema.ts, config.ts, knowledge-base.ts, utils/*
  Dev CLI:      cli/index.ts, commands/init.ts
  Doc:          All .md.tpl template files
  QA:           Unit tests + init flow integration test
  Integration:  Wire init command, verify .knowledge/ creation

Sprint 2 → Step 2: Collectors (P0)
  PM:           Define collector acceptance criteria
  Tech Lead:    JSONL reader spec (CORRECTED from SRS), git-diff spec
  Dev Collectors: conversation.ts, git-diff.ts, file-context.ts
  QA:           Fixture-based tests (.jsonl samples, diff samples)

Sprint 3 → Step 3: Session Debrief Compiler (P0)
  PM:           Debrief quality criteria
  Tech Lead:    Prompt composition spec, output parser spec
  Dev Compilers: session-debrief.ts + auto-extract (P7)
  Dev Core:     index-generator.ts, log.md append
  Doc:          Prompt template: session-debrief.md
  QA:           Output format validation, prompt quality

Sprint 4 → Step 4: Concept Wiki Compiler (P1)
  PM:           Concept extraction criteria
  Tech Lead:    Fuzzy matching spec, backlink weaving spec
  Dev Compilers: concept-wiki.ts
  Doc:          Prompt templates: concept-extract.md, concept-page.md
  QA:           "Human Notes" preservation, cross-references

Sprint 5 → Step 5: Delegation Map Compiler (P1)
  PM:           Delegation state criteria
  Tech Lead:    Similarity scoring spec
  Dev Compilers: delegation-map.ts
  Doc:          Prompt template: delegation-classify.md
  QA:           Similarity scoring accuracy

Sprint 6 → Step 6: Gaps Analyzer (P1)
  PM:           Gap types coverage
  Tech Lead:    All 8 gap types spec (CLAUDE.md §7)
  Dev Analyzers: gaps.ts, patterns.ts, learning-summary.ts
  Doc:          Prompt template: gaps-analysis.md
  QA:           Each gap type detectable, no false positives

Sprint 7 → Step 7: Plugin Integration (P1) — CORRECTED
  PM:           Plugin acceptance criteria (all 5 hooks, skills, agent, userConfig)
  Tech Lead:    Plugin spec (.claude-plugin/plugin.json, nested hooks format,
                SKILL.md directory format, agent definitions, hybrid compile)
  Dev Plugin:   .claude-plugin/plugin.json (with userConfig)
                hooks/hooks.json (nested matcher+hooks format)
                src/hooks/*.ts → dist/hooks/*.js (6 hook scripts)
                commands/*.md (5 slash commands)
                skills/*/SKILL.md (3 skills, context: fork)
                agents/dkc-compiler/agent.md
  Doc:          Skill SKILL.md content, agent definition, command prompts
  Integration:  Full pipeline wiring, hybrid SessionEnd (command+agent), E2E tests
  QA:           Plugin loads in Claude Code, hooks fire correctly,
                Hooks stdin/stdout JSON format validates,
                Skills use directory format, agent definition loads,
                PreCompact/PostCompact preserve context

Sprint 8 → Step 8: Automation & Polish (P2)
  PM:           Polish priorities, user-facing quality
  Tech Lead:    Performance optimization specs
  Integration:  Full system test, edge cases
  QA:           Comprehensive regression testing
```

## Conflict Resolution Matrix

```
┌─────────────────────┬─────────────────┬──────────────────┐
│ Conflict Type       │ Who Decides     │ Escalation       │
├─────────────────────┼─────────────────┼──────────────────┤
│ Scope question      │ PM              │ User/Stakeholder │
│ Technical choice    │ Tech Lead       │ PM               │
│ Bug vs Feature      │ PM              │ —                │
│ Test coverage bar   │ QA recommends,  │ PM               │
│                     │ TL approves     │                  │
│ Template format     │ Doc (check MD)  │ PM               │
│ Interface mismatch  │ Tech Lead       │ —                │
│ SRS vs CLAUDE.md    │ CLAUDE.md wins  │ PM confirms      │
│ Performance concern │ Tech Lead       │ PM (if scope)    │
└─────────────────────┴─────────────────┴──────────────────┘
```

## Change Request Protocol

```
1. User/PM identifies new requirement or change
2. PM evaluates:
   - In SRS scope? → Add to current/next sprint backlog
   - Out of scope? → Discuss with user, update SRS if approved
   - Breaking change? → Impact analysis by Tech Lead first

3. Tech Lead impact analysis:
   - Which modules affected?
   - Interface changes needed?
   - Regression risk?

4. Implementation:
   - Dev Agent(s) implement changes
   - QA regression tests
   - Integration re-verify

5. PM approves → merge
```

## Agent Invocation Patterns

### Pattern 1: Sequential Sprint (default)
```
User: "Bắt đầu Step 1"
→ [PM] Define sprint backlog
→ [Tech Lead] Module breakdown
→ [Dev] Implement (announce each module)
→ [QA] Test
→ [Integration] Wire
→ [PM] Review & approve
```

### Pattern 2: Parallel Dev
```
User: "Implement Step 1 modules song song"
→ [PM + Tech Lead] Plan (sequential)
→ Spawn agents:
    Agent 1: Dev Core (schema, config, KB, utils)
    Agent 2: Dev CLI (cli entry, init command)
    Agent 3: Doc (templates)
→ [QA] Test all (after agents complete)
→ [Integration] Wire
```

### Pattern 3: Focused Fix
```
User: "Bug trong conversation collector"
→ [QA] Reproduce & document bug
→ [Dev] Fix in assigned module
→ [QA] Verify fix + regression
→ [Integration] Re-verify pipeline (if needed)
```

### Pattern 4: Requirement Change
```
User: "Thêm gap type mới: stale-session"
→ [PM] Evaluate scope, approve/reject
→ [Tech Lead] Impact analysis, update schema.ts
→ [Dev] Implement in gaps.ts
→ [QA] Test new gap type
→ [Integration] Verify gaps pipeline
```
