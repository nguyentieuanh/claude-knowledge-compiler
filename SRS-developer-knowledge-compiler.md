# Software Requirements Specification (SRS)
# Developer Knowledge Compiler (DKC) — Toolkit for Claude Code
**Version:** 1.1 (Karpathy-aligned revision)  
**Date:** 2026-04-08  
**Status:** Ready for Implementation

---

## Table of Contents
1. [Philosophy & Vision](#1-philosophy--vision)
2. [Core Concepts & Definitions](#2-core-concepts--definitions)
3. [Tech Stack](#3-tech-stack)
4. [System Architecture](#4-system-architecture)
5. [Module Specifications](#5-module-specifications)
6. [Input / Output Contracts](#6-input--output-contracts)
7. [Slash Commands & CLI Interface](#7-slash-commands--cli-interface)
8. [Technical Constraints & Ràng Buộc](#8-technical-constraints--ràng-buộc)
9. [Pros & Cons Analysis](#9-pros--cons-analysis)
10. [Execution Roadmap](#10-execution-roadmap)
11. [Testing Strategy](#11-testing-strategy)
12. [Definition of Done](#12-definition-of-done)

---

## 1. Philosophy & Vision

### 1.1 Problem Statement

AI coding tools (Claude Code, Copilot, Cursor) tạo ra một loại nợ mới gọi là **Knowledge Debt** — developer ship code nhanh hơn nhưng hiểu code mình đang chạy ít hơn. Khi production incident xảy ra lúc 2 giờ sáng, developer không debug được code mà AI đã viết cho họ.

### 1.2 Solution

DKC là một **toolkit độc lập** gắn vào Claude Code qua plugin system, tự động tích lũy tri thức của developer sau mỗi coding session. Nó không dạy developer trong lúc code (Anthropic đã có Explanatory/Learning mode cho việc này), mà **compile kiến thức xuyên session** thành một knowledge base persistent, searchable, và actionable.

### 1.3 Design Principles

```
P1: "Ghi trong im lặng, nói khi được hỏi"
    → Không bao giờ interrupt developer flow
    → Không notification, không popup, không prompt giữa session
    → Chỉ output khi developer chủ động trigger

P2: "Cụ thể cho project, không generic"
    → Concept page viết trong ngữ cảnh codebase CỤ THỂ
    → "useEffect trong project NÀY gây bug ở đâu" chứ không phải
      "useEffect là gì"
    → Nếu output giống Google/StackOverflow → đã fail

P3: "Actionable, không chỉ informational"
    → Mỗi gap phải có suggested action cụ thể
    → Developer đọc xong biết phải làm gì tiếp, không phải tự suy luận

P4: "Additive only"
    → Không bao giờ overwrite existing knowledge
    → Chỉ append, update, enrich
    → Developer tin tưởng rằng data không bị mất

P5: "Zero config to start, infinite config if needed"
    → `dkc init` là đủ để bắt đầu
    → Power users có thể customize mọi template, threshold, trigger

P6: "Con người là biên tập viên, không phải khán giả"
    → Compiler sinh draft, developer có thể review/edit/annotate
    → Concept page có "Human Notes" section mà compiler KHÔNG BAO GIỜ chạm
    → Nhưng review là OPTIONAL — không review cũng không block pipeline
    → Adapted từ Karpathy: "con người chuyển vai từ người ghi chép
      sang người biên tập và định hướng"

P7: "Mọi hoạt động đều để lại dấu vết"
    → log.md ghi mọi compile, lint, query event
    → Developer biết knowledge base đang "sống" hay "chết"
    → Audit trail cho trust: biết AI ghi gì, khi nào, từ session nào
```

### 1.4 Positioning vs Anthropic's Existing Features

```
┌─────────────────────┬──────────────────────┬──────────────────────────┐
│                     │ Anthropic hiện tại   │ DKC (toolkit này)        │
├─────────────────────┼──────────────────────┼──────────────────────────┤
│ Thời điểm           │ Trong session        │ Sau session, async       │
│ Persistence         │ Mất khi session end  │ Tích lũy vĩnh viễn      │
│ Format              │ Terminal output      │ Markdown files           │
│ Developer agency    │ AI chủ động          │ Developer chủ động       │
│ Tracking            │ Không                │ Delegation map, gaps     │
│ Team value          │ Cá nhân              │ Mở rộng team/org         │
│ Integration         │ Native               │ Plugin + CLI             │
└─────────────────────┴──────────────────────┴──────────────────────────┘

Kết luận: DKC BỔ SUNG cho Explanatory/Learning mode, KHÔNG THAY THẾ.
```

---

## 2. Core Concepts & Definitions

### 2.1 Glossary

| Term | Definition |
|------|-----------|
| **Session** | Một phiên làm việc của developer với Claude Code, từ lúc bắt đầu đến khi commit hoặc kết thúc terminal. Đơn vị nhỏ nhất để compile. |
| **Session Debrief** | Bản tổng hợp sau mỗi session: quyết định kiến trúc, patterns áp dụng, trade-offs, unknowns. File markdown trong `sessions/`. |
| **Concept** | Một khái niệm kỹ thuật xuất hiện trong codebase (dependency injection, event loop, CQRS...). Được compile thành concept page riêng. |
| **Concept Page** | Trang wiki cho một concept, viết theo ngữ cảnh project cụ thể. Bao gồm: definition, usage in project, history, bugs & lessons, related concepts. |
| **Delegation Map** | Bản đồ tracking: phần nào AI viết, phần nào developer viết, phần nào đã review. Cấp độ file hoặc function. |
| **Delegation State** | Trạng thái của một file/function: `ai-generated`, `ai-generated-human-modified`, `ai-generated-human-reviewed`, `human-written`, `unknown`. |
| **Gap** | Một blind spot trong knowledge base: code chưa review, concept chưa hiểu, pattern chưa internalize. Luôn kèm suggested action. |
| **Knowledge Base** | Toàn bộ `.knowledge/` folder — tập hợp sessions, concepts, delegation map, gaps. |
| **Compile** | Quá trình phân tích conversation + diff + existing knowledge → sinh/update session debrief, concept pages, delegation map. |
| **Lint** | Quá trình scan knowledge base → tìm gaps, orphan concepts, inconsistencies. |

### 2.2 Concept Model (Entity Relationships)

```
Session Debrief ──references──▶ Concept Page
       │                            │
       │ contains                   │ links to
       ▼                            ▼
  Decisions                   Related Concepts
  Patterns Applied
  Trade-offs
  Unknowns ─────triggers────▶ Gap (persistent-unknown)
  Delegation Info ──feeds──▶ Delegation Map
                                    │
                                    │ scanned by
                                    ▼
                              Gaps Analyzer
                                    │
                                    ▼
                               gaps.md
```

---

## 3. Tech Stack

### 3.1 Runtime & Language

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Language** | TypeScript (strict mode) | Type safety cho complex data models; Claude Code ecosystem là TS/JS; developer target audience quen thuộc |
| **Runtime** | Node.js >= 18 | LTS, native ESM support, Claude Code chạy trên Node |
| **Package Manager** | npm | Standard, không cần extra dependency |
| **Build** | tsup | Zero-config TS bundler, fast, outputs CJS + ESM |

### 3.2 Dependencies (Minimal)

```json
{
  "dependencies": {
    "commander": "^12.0.0",       // CLI framework — mature, zero-dep
    "gray-matter": "^4.0.0",      // Frontmatter parsing cho markdown files
    "glob": "^11.0.0",            // File pattern matching
    "diff": "^7.0.0",             // Text diff — compare AI code vs committed
    "chalk": "^5.0.0",            // Terminal colors cho CLI output
    "slugify": "^1.6.0"           // Concept name → filename
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0",           // Test framework
    "@types/node": "^20.0.0"
  }
}
```

**Nguyên tắc chọn dependency:**
- Mỗi dep phải giải quyết 1 vấn đề cụ thể mà tự viết tốn > 200 dòng
- Zero-dep hoặc minimal-dep packages preferred
- KHÔNG dùng LLM SDK trong toolkit — Claude Code đã có sẵn, DKC chỉ compose prompts và đọc output

### 3.3 Không dùng LLM API trực tiếp

DKC **KHÔNG** gọi Anthropic API. Thay vào đó, DKC:
1. Compose prompt + context → inject vào Claude Code session qua plugin hook
2. Claude Code (đã có API access) xử lý prompt
3. DKC parse output → ghi files

Lý do:
- Không cần API key riêng — dùng chính subscription Claude Code của developer
- Không tốn token ngoài session — compile chạy trong context Claude Code
- Đơn giản hóa architecture — DKC chỉ là orchestrator, không phải AI engine

### 3.4 File Format

| Data | Format | Rationale |
|------|--------|-----------|
| Knowledge base content | Markdown (.md) | Human-readable, git-friendly, Claude đọc tốt |
| Metadata | YAML frontmatter trong .md | Structured data kèm content, parse được bằng gray-matter |
| Config | `.dkc.config.json` | Standard JSON, IDE autocomplete |
| Templates | Markdown (.md.tpl) | Chính là markdown với placeholder |

---

## 4. System Architecture

### 4.1 Project Structure

```
developer-knowledge-compiler/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
├── LICENSE
│
├── src/
│   ├── index.ts                    # Main entry — export public API
│   │
│   ├── cli/
│   │   ├── index.ts                # CLI entry point (bin/dkc)
│   │   ├── commands/
│   │   │   ├── init.ts             # dkc init
│   │   │   ├── reflect.ts          # dkc reflect
│   │   │   ├── gaps.ts             # dkc gaps
│   │   │   ├── learned.ts          # dkc learned
│   │   │   ├── concept.ts          # dkc concept <name>
│   │   │   └── status.ts           # dkc status
│   │   └── output.ts              # Terminal output formatter
│   │
│   ├── plugin/
│   │   ├── index.ts                # Claude Code plugin entry
│   │   ├── hooks.ts                # SessionStart, SessionEnd hooks
│   │   └── slash-commands.ts       # /reflect, /gaps, /concept handlers
│   │
│   ├── core/
│   │   ├── knowledge-base.ts       # KnowledgeBase class — CRUD operations
│   │   ├── config.ts               # Config loader & defaults
│   │   └── schema.ts               # TypeScript types & interfaces
│   │
│   ├── collectors/
│   │   ├── conversation.ts         # Parse Claude Code conversation history
│   │   ├── git-diff.ts             # Parse git diff output
│   │   └── file-context.ts         # Collect modified files metadata
│   │
│   ├── compilers/
│   │   ├── session-debrief.ts      # Conversation + diff → session markdown
│   │   ├── concept-wiki.ts         # Extract & compile concept pages
│   │   ├── delegation-map.ts       # Track AI vs human code
│   │   └── index-generator.ts      # Regenerate index.md
│   │
│   ├── analyzers/
│   │   ├── gaps.ts                 # Scan knowledge base → find blind spots
│   │   ├── patterns.ts             # Detect repeated patterns
│   │   └── learning-summary.ts     # Aggregate learnings over time period
│   │
│   ├── prompts/
│   │   ├── session-debrief.md      # Prompt template for session compile
│   │   ├── concept-extract.md      # Prompt template for concept extraction
│   │   ├── concept-page.md         # Prompt template for concept page gen
│   │   ├── delegation-classify.md  # Prompt template for delegation scoring
│   │   └── gaps-analysis.md        # Prompt template for gaps lint
│   │
│   ├── templates/
│   │   ├── CLAUDE.md.tpl           # CLAUDE.md injection content
│   │   ├── KNOWLEDGE.md.tpl        # Schema definition template
│   │   ├── session.md.tpl          # Session debrief template
│   │   ├── concept.md.tpl          # Concept page template
│   │   ├── delegation-map.md.tpl   # Delegation map template
│   │   ├── gaps.md.tpl             # Gaps template
│   │   ├── log.md.tpl              # Activity log template
│   │   └── config.json.tpl         # Default config template
│   │
│   └── utils/
│       ├── markdown.ts             # Markdown parse/generate helpers
│       ├── slug.ts                 # Slugify concept names
│       ├── similarity.ts           # Code similarity scoring
│       ├── date.ts                 # Date formatting
│       ├── fs.ts                   # File system helpers
│       ├── log.ts                  # appendLog() — audit trail to log.md
│       └── backlink.ts             # Backlink weaving — scan & link concepts
│
├── tests/
│   ├── unit/
│   │   ├── collectors/
│   │   ├── compilers/
│   │   ├── analyzers/
│   │   └── utils/
│   ├── integration/
│   │   ├── init-flow.test.ts
│   │   ├── compile-pipeline.test.ts
│   │   └── gaps-analysis.test.ts
│   └── fixtures/
│       ├── conversations/          # Sample conversation histories
│       ├── diffs/                  # Sample git diffs
│       └── knowledge-bases/        # Sample .knowledge/ folders
│
└── scripts/
    └── post-commit.sh             # Git hook template
```

### 4.2 Data Flow Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              TRIGGER LAYER                  │
                    │                                             │
                    │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
                    │  │ /reflect │ │ git hook │ │ dkc reflect│  │
                    │  │ (plugin) │ │ (auto)   │ │ (CLI)      │  │
                    │  └────┬─────┘ └────┬─────┘ └─────┬──────┘  │
                    └───────┼────────────┼─────────────┼──────────┘
                            │            │             │
                            ▼            ▼             ▼
                    ┌─────────────────────────────────────────────┐
                    │            COLLECTOR LAYER                  │
                    │                                             │
                    │  ┌────────────────┐  ┌──────────────────┐   │
                    │  │ Conversation   │  │ Git Diff         │   │
                    │  │ Collector      │  │ Collector        │   │
                    │  │                │  │                  │   │
                    │  │ IN: session    │  │ IN: git repo     │   │
                    │  │     messages   │  │ OUT: structured  │   │
                    │  │ OUT: parsed    │  │      diff data   │   │
                    │  │      messages  │  │                  │   │
                    │  └───────┬────────┘  └────────┬─────────┘   │
                    └──────────┼─────────────────────┼─────────────┘
                               │                     │
                               ▼                     ▼
                    ┌─────────────────────────────────────────────┐
                    │            COMPILER LAYER                   │
                    │                                             │
                    │  ┌─────────────┐ ┌──────────┐ ┌──────────┐ │
                    │  │ Session     │ │ Concept  │ │Delegation│ │
                    │  │ Debrief    │ │ Wiki     │ │ Map      │ │
                    │  │ Compiler   │ │ Compiler │ │ Compiler │ │
                    │  └──────┬──────┘ └────┬─────┘ └────┬─────┘ │
                    └─────────┼─────────────┼────────────┼────────┘
                              │             │            │
                              ▼             ▼            ▼
                    ┌─────────────────────────────────────────────┐
                    │          KNOWLEDGE BASE (.knowledge/)       │
                    │                                             │
                    │  sessions/   concepts/   delegation/        │
                    │  index.md    gaps.md     KNOWLEDGE.md       │
                    └────────────────────┬────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │           ANALYZER LAYER                    │
                    │                                             │
                    │  ┌─────────────┐ ┌──────────────────────┐   │
                    │  │ Gaps        │ │ Learning Summary     │   │
                    │  │ Analyzer    │ │ Analyzer             │   │
                    │  │             │ │                      │   │
                    │  │ Trigger:    │ │ Trigger:             │   │
                    │  │  /gaps      │ │  /learned            │   │
                    │  │  weekly     │ │                      │   │
                    │  └─────────────┘ └──────────────────────┘   │
                    └─────────────────────────────────────────────┘
```

### 4.3 Plugin Architecture (Claude Code Integration)

```
Claude Code Plugin System
│
├── SessionStart Hook
│   └── DKC reads .knowledge/index.md
│       → injects context vào Claude session
│       → Claude biết developer đã biết gì, chưa biết gì
│
├── Custom Slash Commands (registered by plugin)
│   ├── /reflect  → trigger compile pipeline
│   ├── /gaps     → trigger gaps analyzer
│   ├── /concept  → search/create concept
│   └── /learned  → trigger learning summary
│
└── SessionEnd Hook (if available)
    └── Auto-trigger compile nếu session đủ dài (> 5 messages)
```

**Plugin entry point format (theo Claude Code plugin spec):**

```typescript
// src/plugin/index.ts
import type { Plugin } from '@anthropic-ai/claude-code';

export default {
  name: 'developer-knowledge-compiler',
  version: '1.0.0',

  hooks: {
    SessionStart: async ({ session, addSystemPrompt }) => {
      const kb = await loadKnowledgeBase(session.cwd);
      if (kb) {
        addSystemPrompt(kb.getContextPrompt());
      }
    },
    // SessionEnd nếu API cho phép
  },

  commands: {
    '/reflect': handleReflect,
    '/gaps': handleGaps,
    '/concept': handleConcept,
    '/learned': handleLearned,
  }
} satisfies Plugin;
```

---

## 5. Module Specifications

### 5.1 Module: `init` — Khởi tạo Knowledge Base

**Purpose:** Scaffold `.knowledge/` structure, update CLAUDE.md, install git hook.

**Input:**
```typescript
interface InitInput {
  projectRoot: string;           // Path tới project root
  options: {
    gitHook: boolean;            // Install post-commit hook? Default: true
    gitignore: boolean;          // Add .knowledge to .gitignore? Default: false
    skipClaudeMd: boolean;       // Skip CLAUDE.md update? Default: false
  };
}
```

**Output:**
```typescript
interface InitOutput {
  created: string[];             // List of files/dirs created
  modified: string[];            // List of files modified (CLAUDE.md, .gitignore)
  skipped: string[];             // List of files skipped (already exist)
  warnings: string[];            // Non-fatal warnings
}
```

**Logic:**

```
1. CHECK prerequisites
   - Verify projectRoot exists
   - Check if .knowledge/ already exists → warn & skip existing files
   - Check if .git/ exists (for hook installation)

2. CREATE directory structure
   .knowledge/
   ├── concepts/
   ├── sessions/
   └── delegation/

3. GENERATE template files
   - KNOWLEDGE.md    ← from templates/KNOWLEDGE.md.tpl
   - index.md        ← STRUCTURED knowledge map (see §5.8 Index Generator)
                       NOT just a file list — grouped by domain, 1-line summary
                       per concept, links, recency indicator
   - log.md          ← append-only audit trail (see §5.9 Activity Log)
   - concepts/_template.md  (includes "Human Notes" section — compiler never touches)
   - sessions/_template.md  (includes `status: auto-generated` frontmatter)
   - delegation/map.md
   - delegation/modules.md
   - gaps.md          ← initial "everything is unknown"
   - .dkc.config.json ← default config

4. UPDATE CLAUDE.md
   - If exists → append DKC section (check for existing section first)
   - If not exists → create with DKC section
   - NEVER overwrite existing CLAUDE.md content

5. INSTALL git hook (optional)
   - If .git/hooks/post-commit exists → append DKC trigger
   - If not exists → create with DKC trigger
   - Make executable: chmod +x

6. UPDATE .gitignore (optional)
   - If gitignore option true → add .knowledge/ to .gitignore
   - Default: false (knowledge base SHOULD be committed)

7. INITIAL SCAN (basic)
   - Read package.json → detect framework/libraries
   - Read project structure → create initial delegation/modules.md
   - DO NOT do deep analysis — that's for first /reflect
```

**Edge Cases:**
- `.knowledge/` partially exists (corrupted init) → repair, don't re-init
- CLAUDE.md has DKC section already → skip, don't duplicate
- No .git/ → skip hook, warn user
- Monorepo → init per-package or at root? → default root, configurable

---

### 5.2 Module: `Conversation Collector`

**Purpose:** Parse Claude Code conversation history thành structured data.

**Input:**
```typescript
interface ConversationRaw {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    toolUse?: Array<{
      name: string;
      input: Record<string, unknown>;
      output: string;
    }>;
  }>;
}
```

**Output:**
```typescript
interface ConversationParsed {
  sessionId: string;                // Generated unique ID
  startTime: string;                // ISO timestamp
  endTime: string;                  // ISO timestamp
  duration: number;                 // Minutes
  messageCount: number;

  userQuestions: Array<{
    index: number;
    text: string;
    type: 'question' | 'instruction' | 'clarification' | 'approval';
  }>;

  aiCodeBlocks: Array<{
    index: number;                  // Message index
    language: string;
    code: string;
    filePath?: string;              // If identifiable
    context: string;                // Surrounding explanation
  }>;

  aiExplanations: Array<{
    index: number;
    text: string;
    conceptsMentioned: string[];    // Extracted concept names
  }>;

  confusionSignals: Array<{
    index: number;
    text: string;
    type: 'explicit-question' | 'repeated-question' | 'misunderstanding' | 'long-explanation-needed';
    concept?: string;               // Related concept if identifiable
  }>;

  decisions: Array<{
    index: number;
    description: string;
    alternatives?: string[];        // Other options considered
    rationale?: string;
  }>;

  filesModified: string[];          // From tool use
  commandsRun: string[];            // From tool use
}
```

**Confusion Signal Detection Rules:**
```
EXPLICIT_QUESTION:
  - User message contains: "what is", "why", "explain", "how does",
    "I don't understand", "confused", "what do you mean"
  - Confidence: high

REPEATED_QUESTION:
  - User asks about same concept/topic > 1 time in session
  - Similarity threshold: > 0.7 cosine (simplified: shared keywords > 60%)
  - Confidence: high

MISUNDERSTANDING:
  - User applies code incorrectly → Claude corrects
  - Pattern: Claude says "actually", "that's not quite right",
    "let me clarify"
  - Confidence: medium

LONG_EXPLANATION_NEEDED:
  - Claude explanation > 300 words for a single concept
  - Indicates concept complexity or developer unfamiliarity
  - Confidence: low (may just be complex topic)
```

---

### 5.3 Module: `Git Diff Collector`

**Purpose:** Parse git diff thành structured data.

**Input:**
```typescript
interface GitDiffInput {
  projectRoot: string;
  mode: 'last-commit' | 'staged' | 'working';
}
```

**Output:**
```typescript
interface GitDiffParsed {
  commitHash?: string;
  commitMessage?: string;
  author?: string;
  timestamp?: string;

  files: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    oldPath?: string;               // For renamed files
    additions: number;
    deletions: number;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      content: string;              // Raw diff content
    }>;
  }>;

  stats: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
    newFiles: string[];
    significantChanges: string[];   // Files with > 50 lines changed
  };
}
```

**Implementation:**
```bash
# Commands to execute
git diff HEAD~1 --stat               # Overview
git diff HEAD~1 --numstat             # Per-file stats
git diff HEAD~1 -U3                   # Unified diff with 3 lines context
git log -1 --format="%H|%s|%an|%aI"  # Commit metadata
```

---

### 5.4 Module: `Session Debrief Compiler`

**Purpose:** Combine conversation + diff → session debrief markdown.

**Input:**
```typescript
interface SessionCompileInput {
  conversation: ConversationParsed;
  diff: GitDiffParsed;
  existingConcepts: string[];        // Slugs of existing concept pages
  config: DKCConfig;
}
```

**Output:**
```typescript
interface SessionDebrief {
  filePath: string;                  // sessions/YYYY-MM-DD-HH.md
  content: string;                   // Generated markdown

  metadata: {
    sessionId: string;
    date: string;
    duration: number;
    filesChanged: number;
    conceptsReferenced: string[];
    newConceptsDetected: string[];
    delegationEntries: DelegationEntry[];
  };
}
```

**Session Debrief Template:**

```markdown
---
session_id: {{sessionId}}
date: {{date}}
duration_minutes: {{duration}}
files_changed: {{filesChanged}}
concepts: [{{concepts}}]
---

# Session Debrief — {{date}}

## Summary
{{3-5 sentences: what was accomplished in this session}}

## Decisions Made
{{Each decision with rationale. Format:}}
- **Decision:** {{what was decided}}
  **Why:** {{rationale}}
  **Alternatives considered:** {{what was rejected and why}}

## Patterns Applied
{{Named patterns used. Format:}}
- **{{Pattern Name}}** — applied in `{{file}}`: {{brief context}}

## Trade-offs Accepted
- **Chose:** {{what}} **Over:** {{alternative}} **Because:** {{reason}}

## Unknowns & Learning Gaps
{{Things developer didn't fully understand. Format:}}
- **{{concept/topic}}** — {{evidence from conversation}}
  → Related concept: [[{{concept-slug}}]]

## Delegation Summary
| File | Status | Notes |
|------|--------|-------|
| {{file}} | {{ai-generated / human-written / mixed}} | {{brief note}} |
```

**Prompt Strategy:**

DKC does NOT call LLM API directly. Instead, it:
1. Composes a prompt with all collected data
2. Writes prompt to a temp file
3. Claude Code plugin triggers Claude to process it
4. DKC reads Claude's output → parses into structured data → writes files

```typescript
// Prompt composition (not API call)
function composeSessionDebriefPrompt(input: SessionCompileInput): string {
  return `
You are the Developer Knowledge Compiler.
Analyze the following session data and produce a debrief.

## Conversation Summary
${formatConversation(input.conversation)}

## Git Diff
${formatDiff(input.diff)}

## Existing Concepts in Knowledge Base
${input.existingConcepts.join(', ')}

## Output Requirements
Return ONLY valid markdown following the Session Debrief Template.
[... template here ...]

## Rules
- DECISIONS: Only architecture/design decisions with impact. Skip trivial.
- PATTERNS: Use official names (GoF, SOLID, etc.) when applicable.
- UNKNOWNS: Only with clear evidence from conversation. DO NOT guess.
- DELEGATION: Compare AI code blocks vs committed code for classification.
- Link concepts with [[concept-slug]] syntax.
- Maximum 200 lines.
`;
}
```

---

### 5.5 Module: `Concept Wiki Compiler`

**Purpose:** Extract concepts from session, create/update concept pages.

**Input:**
```typescript
interface ConceptCompileInput {
  sessionDebrief: SessionDebrief;
  conversation: ConversationParsed;
  diff: GitDiffParsed;
  existingConcepts: ConceptPage[];
}
```

**Output:**
```typescript
interface ConceptCompileOutput {
  created: ConceptPage[];           // New concept pages
  updated: ConceptPage[];           // Updated existing pages
  suggested: string[];              // Concepts to create later (not enough data now)
}

interface ConceptPage {
  slug: string;                     // Filename without .md
  name: string;                     // Human-readable name
  filePath: string;                 // concepts/<slug>.md
  content: string;                  // Markdown content

  metadata: {
    firstSeen: string;              // ISO date
    lastUpdated: string;            // ISO date
    sessionCount: number;           // How many sessions reference this
    relatedConcepts: string[];      // Slugs
    relatedFiles: string[];         // Project files using this concept
  };
}
```

**Concept Page Template:**

```markdown
---
name: {{conceptName}}
slug: {{slug}}
first_seen: {{date}}
last_updated: {{date}}
session_count: {{count}}
status: auto-generated          # auto-generated | human-reviewed
related_concepts: [{{slugs}}]
related_files: [{{files}}]
---

# {{conceptName}}

## What It Is (in this project)
{{1-2 sentences. NOT a generic definition.
Written specifically for how this concept manifests in THIS codebase.}}

## Where It's Used
{{Specific files, functions, modules in this project.}}
- `{{file:line}}` — {{how it's used here}}

## History
| Date | Session | What happened |
|------|---------|---------------|
| {{date}} | [[{{session}}]] | {{brief description}} |

## Bugs & Lessons
{{Bugs related to this concept, how they were fixed, what was learned.}}
- **{{date}}**: {{bug description}} → Fix: {{fix}} → Lesson: {{lesson}}

## Related Concepts
{{Links to other concept pages. AUTO-POPULATED by backlink weaving.}}
- [[{{related-slug}}]] — {{relationship description}}

## Human Notes
<!-- ⚠️ COMPILER SAFE ZONE: DKC will NEVER modify content below this line. -->
<!-- Developer ghi chú cá nhân ở đây: insight từ docs, blog, pair programming, -->
<!-- bất kỳ nguồn nào ngoài Claude Code session. -->
```

**Concept Extraction Rules:**
```
INCLUDE if:
  - Developer explicitly asked "what is X" or "explain X"
  - Pattern was applied for the first time in this project
  - A bug was caused by misunderstanding of concept
  - Concept appears in > 3 files touched in this session

EXCLUDE if:
  - Too generic: "function", "variable", "loop", "if-else", "class"
  - Developer clearly already knows it (uses fluently, never asks)
  - Only mentioned in passing, no substantial usage

MATCH existing concept:
  - Exact match on slug
  - Fuzzy match: "DI" ↔ "dependency-injection"
  - Alias list in concept metadata (configurable)

Maximum 5 new concepts per session (prevent noise)
```

**Backlink Weaving (post-compile step):**
```
After every concept CREATE or UPDATE:
  1. Scan ALL existing concept pages
  2. For each page, check if new concept is mentioned in content
  3. If mentioned but not in "Related Concepts" → append backlink
  4. Reverse: check if new page mentions existing concepts → add links

This runs AFTER compile, not during — to avoid circular updates.
Cost: scan N concept pages × 1 string search each. Negligible for < 200 pages.
```

**Auto-extract from long explanations (query file-back):**
```
During Session Debrief compilation, if:
  - Claude explanation about a concept > 300 words in conversation
  - AND that concept has an existing page OR is being created

THEN:
  - Extract key points from the long explanation
  - Append to concept page "What It Is" or "Bugs & Lessons" section
  - This is IMPLICIT file-back — no developer prompt needed
  - Follows P1: "ghi trong im lặng"

This ensures valuable explanations from coding sessions don't get lost
in conversation history — they're compiled into the persistent wiki.
```

---

### 5.6 Module: `Delegation Map Compiler`

**Purpose:** Track what AI wrote vs what developer wrote.

**Input:**
```typescript
interface DelegationInput {
  conversation: ConversationParsed;  // AI code blocks
  diff: GitDiffParsed;               // Committed code
  existingMap: DelegationMap;         // Previous state
}
```

**Output:**
```typescript
interface DelegationMap {
  lastUpdated: string;
  summary: {
    totalFiles: number;
    aiGenerated: number;
    aiModified: number;
    humanWritten: number;
    unreviewed: number;
    percentageAi: number;
  };

  entries: Array<{
    filePath: string;
    state: DelegationState;
    confidence: number;              // 0-1, how confident is the classification
    lastModified: string;
    sessions: string[];              // Session IDs that touched this file
    notes: string;
  }>;

  trend: Array<{
    date: string;
    percentageAi: number;
    percentageReviewed: number;
  }>;
}

type DelegationState =
  | 'ai-generated'                   // > 90% match with AI output
  | 'ai-generated-human-modified'    // 50-90% match
  | 'ai-generated-human-reviewed'    // AI wrote, dev explicitly reviewed
  | 'human-written'                  // < 50% match or no AI code block
  | 'unknown';                       // Pre-DKC code, no data
```

**Similarity Scoring Algorithm:**
```typescript
function calculateSimilarity(aiCode: string, committedCode: string): number {
  // 1. Normalize: strip whitespace, comments, formatting
  const normalizedAi = normalize(aiCode);
  const normalizedCommitted = normalize(committedCode);

  // 2. Line-by-line diff
  const changes = diffLines(normalizedAi, normalizedCommitted);

  // 3. Calculate: unchanged lines / total lines
  const unchanged = changes.filter(c => !c.added && !c.removed)
                           .reduce((sum, c) => sum + c.count, 0);
  const total = changes.reduce((sum, c) => sum + c.count, 0);

  return unchanged / total;  // 0.0 to 1.0
}
```

---

### 5.7 Module: `Gaps Analyzer`

**Purpose:** Scan knowledge base → find blind spots → generate actionable gaps.

**Input:**
```typescript
interface GapsInput {
  knowledgeBase: KnowledgeBase;      // Full .knowledge/ contents
  config: DKCConfig;
}
```

**Output:**
```typescript
interface GapsOutput {
  filePath: string;                  // gaps.md
  content: string;                   // Generated markdown

  stats: {
    total: number;
    high: number;
    medium: number;
    low: number;
    newSinceLastLint: number;
    resolvedSinceLastLint: number;
  };

  gaps: Array<{
    id: string;                      // Stable ID for tracking
    type: GapType;
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    location: string;                // File/module/concept reference
    evidence: string;                // Why this is flagged
    suggestedAction: string;         // What developer should do
    firstDetected: string;           // ISO date
    persistent: boolean;             // Still present after multiple lints?
  }>;
}

type GapType =
  | 'unreviewed-code'                // AI wrote, dev never read
  | 'untouched-ai-code'             // AI wrote, dev never modified
  | 'concept-no-page'               // Referenced but no concept page
  | 'orphan-concept'                // Page exists but not referenced recently
  | 'repeated-pattern'              // Pattern used > 3x, no concept page
  | 'persistent-unknown'            // Dev asked same question > 2 sessions
  | 'stale-knowledge'               // Concept page outdated (> 30 days no update)
  | 'missing-cross-reference';      // Concept mentioned in page but no [[link]]
```

**Gap Detection Rules:**

```
UNREVIEWED_CODE (priority: high if critical path)
  scan: delegation map entries with state == 'ai-generated'
  filter: file not in any session's "unknowns" or concept usage
  evidence: "File X was AI-generated in session Y and has never been reviewed"
  action: "Review file X — you haven't read this code yet"

PERSISTENT_UNKNOWN (priority: high)
  scan: session debriefs → unknowns
  filter: same concept appears in unknowns > 2 sessions
  evidence: "You've asked about X in sessions A, B, C"
  action: "Deep dive into X — create concept page with /concept <name>"

CONCEPT_NO_PAGE (priority: medium)
  scan: session debriefs → concepts referenced
  filter: concept slug not found in concepts/ folder
  evidence: "Concept X referenced in 3 sessions but has no page"
  action: "Run /concept X to create a page"

REPEATED_PATTERN (priority: medium)
  scan: session debriefs → patterns applied
  filter: pattern appears > 3 sessions, no concept page
  evidence: "Pattern X used in 5 sessions — time to internalize"
  action: "Create concept page to solidify understanding"

ORPHAN_CONCEPT (priority: low)
  scan: concept pages → check last session reference
  filter: no session references in > 60 days
  evidence: "Concept page X hasn't been relevant in 60 days"
  action: "Review if still relevant, archive if not"

STALE_KNOWLEDGE (priority: low)
  scan: concept pages → metadata.last_updated
  filter: > 30 days since last update, but concept still in use
  evidence: "Concept page X is 45 days old but referenced in recent session"
  action: "Update concept page with latest usage patterns"

MISSING_CROSS_REFERENCE (priority: low)
  scan: concept pages → content body
  filter: concept name Y mentioned in text of page X, but no [[Y]] link
  evidence: "Page X mentions 'dependency injection' but has no link to [[dependency-injection]]"
  action: "Auto-fixable — will be added by next backlink weaving pass"
```

---

### 5.8 Module: `Index Generator` — Knowledge Map

**Purpose:** Sinh `index.md` như hub điều hướng trung tâm cho Claude.

**Tại sao quan trọng (Karpathy principle):**
Claude mỗi session mới cần biết developer đã biết gì, chưa biết gì — mà không thể đọc hết tất cả concept pages. `index.md` là file duy nhất Claude đọc đầu tiên (qua SessionStart hook) để load toàn bộ knowledge state vào context window.

**Input:** Toàn bộ `.knowledge/` folder metadata (frontmatter only, không đọc full content).

**Output:** `index.md` — structured knowledge map.

**Format:**

```markdown
# Knowledge Base Index
> Last compiled: {{timestamp}} | {{totalConcepts}} concepts |
> {{totalSessions}} sessions | {{delegationCoverage}}% code coverage

## Concepts by Domain

### Architecture & Patterns
- [[dependency-injection]] — DI via constructor trong service layer (5 sessions, last: 2026-04-05) ★
- [[cqrs]] — Command/Query separation cho order module (2 sessions, last: 2026-03-28)

### React & Frontend
- [[use-effect]] — Side effects trong dashboard components, đã gây bug #42 (8 sessions) ★
- [[react-query]] — Data fetching pattern, replaced useEffect+useState (3 sessions)

### Database & Data
- [[prisma-migrations]] — Schema migration workflow (1 session, last: 2026-04-08) 🆕

## Recent Sessions (last 7 days)
- [[2026-04-08-14]] — Refactor order service, applied CQRS pattern
- [[2026-04-05-10]] — Fix dashboard loading bug (useEffect race condition)

## Active Gaps (top 3)
- 🔴 HIGH: useEffect race conditions — asked 3 times, consider deep-dive
- 🟡 MEDIUM: Prisma migration rollback — AI-generated, never reviewed
- 🟢 LOW: 4 concept pages stale > 30 days

## Legend
★ = frequently referenced (>5 sessions)  🆕 = new this week
```

**Rules:**
```
- Regenerate on EVERY compile (not just on-demand)
- Group concepts by domain — inferred from file paths and content
- 1-line summary per concept — extracted from "What It Is" section
- Recency indicator: ★ for frequent, 🆕 for new
- Include top 3 gaps inline — Claude sees gaps without opening gaps.md
- MUST fit in < 2000 tokens — Claude reads this EVERY session
- Sort within domain: most recent first
```

---

### 5.9 Module: `Activity Log`

**Purpose:** Append-only audit trail cho mọi DKC activity.

**File:** `.knowledge/log.md`

**Format:**
```markdown
# DKC Activity Log

| Timestamp | Event | Details |
|-----------|-------|---------|
| 2026-04-08 14:32 | compile | Session 2026-04-08-14: 3 concepts updated, 1 created |
| 2026-04-08 14:32 | backlink | Wove 2 new cross-references |
| 2026-04-07 09:15 | lint | gaps.md regenerated: 5 gaps (2 high, 2 medium, 1 low) |
| 2026-04-05 10:45 | compile | Session 2026-04-05-10: 1 concept updated, delegation map refreshed |
| 2026-04-01 00:00 | init | Knowledge base initialized |
```

**Implementation:**
```typescript
// src/utils/log.ts
async function appendLog(
  knowledgeDir: string,
  event: 'init' | 'compile' | 'lint' | 'query' | 'backlink',
  details: string
): Promise<void> {
  const logPath = path.join(knowledgeDir, 'log.md');
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `| ${timestamp} | ${event} | ${details} |\n`;
  await fs.appendFile(logPath, line);
}
```

**Rules:**
```
- APPEND ONLY — never truncate, never edit existing entries
- Call appendLog() at END of every: compile, lint, query, backlink weaving
- Include quantitative details: "3 concepts updated, 1 created"
- If log > 1000 lines → archive older entries to log.archive.md
- Developer can read log.md to know: is DKC alive? when did it last run?
```

---

### 5.10 Addendum: Session Debrief `status` field

Session debrief frontmatter includes `status` for optional human review:

```markdown
---
session_id: {{sessionId}}
date: {{date}}
duration_minutes: {{duration}}
files_changed: {{filesChanged}}
status: auto-generated          # auto-generated | human-reviewed
concepts: [{{concepts}}]
---
```

**Rules:**
```
- Default: auto-generated (compiler sets this)
- Developer can manually change to: human-reviewed
- Gaps Analyzer can optionally note: "15 debriefs not yet reviewed"
  but this is informational only — NEVER blocks pipeline
- No approval workflow — review is opt-in, not required
```

---

### 5.11 Addendum: Karpathy Alignment Checklist

Reference checklist mapping DKC design to Karpathy's LLM Wiki principles:

```
✅ Three layers: raw (conversation+diff) → wiki (.knowledge/) → schema (KNOWLEDGE.md)
✅ Compile over retrieve: session data compiled once, not re-analyzed per query
✅ Schema as discipline: KNOWLEDGE.md defines format, rules, naming for all output
✅ Lint / health-check: Gaps Analyzer scans for orphans, stale pages, missing links
✅ Additive only: P4 — never overwrite, only append/update/enrich
✅ index.md as navigation hub: structured knowledge map, Claude reads first (§5.8)
✅ Cross-reference network: backlink weaving step in Concept Compiler (§5.5)
✅ Query file-back: auto-extract from long explanations → concept pages (§5.5)
✅ Human as editor: "Human Notes" section + status field (§5.5, §5.10)
✅ log.md audit trail: append-only activity log (§5.9)

⚠️ Intentionally NOT included (scope control):
  - Broad ingest (web/paper/repo) → different product, use Obsidian for that
  - Vector search / RAG → index.md sufficient at <200 concept scale
  - Graph visualization → future, when knowledge base proves its value
```

---

## 6. Input / Output Contracts

### 6.1 Full I/O Matrix

```
┌────────────────┬─────────────────────────┬──────────────────────────────┐
│ Command        │ Input                   │ Output                       │
├────────────────┼─────────────────────────┼──────────────────────────────┤
│ dkc init       │ Project root path       │ .knowledge/ structure        │
│                │ Options (hooks, etc.)   │ Updated CLAUDE.md            │
│                │                         │ Git hook installed           │
│                │                         │ .dkc.config.json             │
├────────────────┼─────────────────────────┼──────────────────────────────┤
│ dkc reflect    │ Conversation history    │ sessions/YYYY-MM-DD-HH.md   │
│ (or /reflect)  │ Git diff               │ concepts/*.md (new/updated)  │
│                │ Existing knowledge base │ delegation/map.md (updated)  │
│                │                         │ index.md (regenerated as     │
│                │                         │   structured knowledge map)  │
│                │                         │ log.md (event appended)      │
│                │                         │ Terminal: summary (5 lines)  │
├────────────────┼─────────────────────────┼──────────────────────────────┤
│ dkc gaps       │ Full .knowledge/ folder │ gaps.md (regenerated)        │
│ (or /gaps)     │                         │ Terminal: top 5 gaps         │
├────────────────┼─────────────────────────┼──────────────────────────────┤
│ dkc learned    │ .knowledge/sessions/    │ Terminal: learning summary   │
│ (or /learned)  │ Period (default: 7d)    │ Concepts learned, patterns   │
│                │                         │ applied, gaps closed         │
├────────────────┼─────────────────────────┼──────────────────────────────┤
│ dkc concept X  │ Concept name            │ If exists: print content     │
│ (or /concept)  │ Knowledge base context  │ If not: create new page      │
│                │                         │ concepts/<slug>.md           │
├────────────────┼─────────────────────────┼──────────────────────────────┤
│ dkc status     │ .knowledge/ folder      │ Terminal: knowledge base     │
│                │                         │ health overview              │
│                │                         │ - Total sessions compiled    │
│                │                         │ - Total concepts             │
│                │                         │ - Delegation coverage %      │
│                │                         │ - Open gaps count            │
└────────────────┴─────────────────────────┴──────────────────────────────┘
```

### 6.2 Config Schema

```typescript
// .dkc.config.json
interface DKCConfig {
  version: "1.0";

  compile: {
    minSessionLength: number;         // Min messages to trigger compile. Default: 5
    maxConceptsPerSession: number;    // Cap new concepts per compile. Default: 5
    autoCompileOnCommit: boolean;     // Git hook trigger. Default: true
    quietMode: boolean;               // No terminal output on auto. Default: true
  };

  gaps: {
    unreviewedCodeThreshold: number;  // Days before flagging. Default: 7
    persistentUnknownThreshold: number; // Sessions before flagging. Default: 2
    orphanConceptDays: number;        // Days of inactivity. Default: 60
    staleKnowledgeDays: number;       // Days before stale. Default: 30
    maxGaps: number;                  // Cap displayed gaps. Default: 20
  };

  delegation: {
    similarityThreshold: {
      aiGenerated: number;            // > this = ai-generated. Default: 0.9
      mixed: number;                  // > this = mixed. Default: 0.5
    };
  };

  concepts: {
    excludeGeneric: string[];         // Concepts to always skip
    aliases: Record<string, string>;  // "DI" → "dependency-injection"
  };

  paths: {
    knowledgeDir: string;             // Default: ".knowledge"
    sessionsDir: string;              // Default: "sessions"
    conceptsDir: string;             // Default: "concepts"
    delegationDir: string;            // Default: "delegation"
  };
}
```

---

## 7. Slash Commands & CLI Interface

### 7.1 CLI Commands (outside Claude Code)

```bash
# Initialize
dkc init [--no-hook] [--gitignore] [--dir <path>]

# Compile current session
dkc reflect [--auto] [--quiet] [--diff-mode last-commit|staged|working]

# Analyze gaps
dkc gaps [--priority high|medium|low] [--type <gap-type>] [--limit <n>]

# Learning summary
dkc learned [--period 7d|30d|all] [--format table|prose]

# Concept lookup/create
dkc concept <name> [--create] [--update]

# Knowledge base status
dkc status

# Export (future)
dkc export [--format html|pdf|json]
```

### 7.2 Plugin Slash Commands (inside Claude Code)

```
/reflect         → Same as `dkc reflect` but with access to conversation history
/gaps            → Same as `dkc gaps --limit 5`
/concept <name>  → Same as `dkc concept <name>`
/learned         → Same as `dkc learned --period 7d`
```

**Key difference:** Plugin commands have access to **live conversation history** (Claude Code provides it). CLI commands can only read **git history** and **existing knowledge base**.

---

## 8. Technical Constraints & Ràng Buộc

### 8.1 Hard Constraints

```
HC-1: KHÔNG GỌI ANTHROPIC API TRỰC TIẾP
      DKC không có API key, không gọi /v1/messages.
      Mọi LLM processing đều qua Claude Code session.
      → Impact: compile chỉ chạy khi Claude Code session active,
        hoặc phải trigger new session.

HC-2: CLAUDE CODE PLUGIN API LIMITATIONS
      Plugin API có thể không expose:
      - Full conversation history (chỉ có current session)
      - SessionEnd hook (chưa chắc có)
      - Write access to conversation (chỉ đọc)
      → Mitigation: fallback sang git-based analysis khi không có
        conversation data.

HC-3: TOKEN BUDGET
      Mỗi compile consume tokens từ developer's subscription.
      Session debrief prompt + context ≈ 2000-5000 tokens input.
      Output ≈ 500-1500 tokens.
      → Impact: cần optimize prompt length, skip trivial sessions.

HC-4: MARKDOWN ONLY OUTPUT
      Knowledge base chỉ dùng markdown.
      Không database, không SQLite, không JSON store.
      → Reason: git-friendly, human-readable, Claude đọc tốt.
      → Limitation: search/query phải scan files, không có index.

HC-5: NODE.JS RUNTIME DEPENDENCY
      Claude Code chạy trên Node.js.
      DKC cũng phải chạy trên Node.js.
      → Impact: không dùng Python, không dùng Go.

HC-6: OFFLINE CAPABILITY
      Knowledge base files phải readable offline.
      Compiler cần Claude Code (online) nhưng reader không cần.
      → Impact: tách rõ compile (online) vs read (offline).
```

### 8.2 Soft Constraints

```
SC-1: COMPILE TIME < 30 SECONDS
      Developer không nên đợi > 30s cho compile.
      Nếu session quá dài → truncate conversation, focus recent messages.

SC-2: KNOWLEDGE BASE SIZE
      Sau 1 năm sử dụng, .knowledge/ không nên > 10MB.
      → Session debriefs: max 200 lines each
      → Concept pages: max 100 lines each
      → Delegation map: single file, aggregate level

SC-3: GIT-FRIENDLY
      Mọi changes nên tạo clean, reviewable diffs.
      Avoid regenerating files unnecessarily.
      Frontmatter order phải stable (sorted keys).

SC-4: BACKWARD COMPATIBLE
      Knowledge base format phải backward compatible.
      Schema changes → migration script, không break existing data.
      Version field trong KNOWLEDGE.md để track schema version.
```

### 8.3 Assumptions

```
A-1: Developer dùng git (DKC depends on git for diff analysis)
A-2: Developer dùng Claude Code (DKC is a Claude Code plugin)
A-3: Project có CLAUDE.md (standard Claude Code practice)
A-4: Node.js >= 18 installed (Claude Code requirement)
A-5: Claude Code plugin API stable (may change — need adapter layer)
A-6: Conversation history accessible via plugin API (needs verification)
```

### 8.4 Risks & Mitigations

```
R-1: Plugin API không expose conversation history
     Probability: Medium
     Impact: High — conversation is primary data source
     Mitigation:
       - Fallback: parse Claude Code log files (if available)
       - Fallback: manual paste conversation with /reflect
       - Fallback: git-only analysis (less accurate but functional)

R-2: Output quality thấp → developer bỏ dùng
     Probability: Medium
     Impact: Critical — product death
     Mitigation:
       - Manual validation trước khi automate
       - Quality scoring: mỗi debrief tự đánh giá 1-5
       - Feedback loop: /reflect --feedback cho developer rate output

R-3: Token cost quá cao
     Probability: Low
     Impact: Medium
     Mitigation:
       - Skip sessions < 5 messages
       - Truncate conversation to last 50 messages
       - Cache: don't re-compile if no new commits
       - Config: developer set max_tokens_per_compile

R-4: Claude Code plugin API breaking changes
     Probability: High (plugin system còn mới)
     Impact: Medium
     Mitigation:
       - Adapter pattern: abstract plugin API behind interface
       - CLI fallback: dkc commands work without plugin
       - Pin plugin API version in package.json
```

---

## 9. Pros & Cons Analysis

### 9.1 Toolkit Approach (chosen) vs Fork Claude Code

```
┌──────────────┬────────────────────────────┬───────────────────────────┐
│ Aspect       │ Toolkit (Plugin + CLI)     │ Fork Claude Code          │
├──────────────┼────────────────────────────┼───────────────────────────┤
│ Maintenance  │ ✅ Independent releases    │ ❌ Merge conflicts mỗi   │
│              │    Không phụ thuộc CC      │    khi CC update          │
│              │    release cycle           │                           │
├──────────────┼────────────────────────────┼───────────────────────────┤
│ Distribution │ ✅ npm install             │ ❌ Custom build, manual   │
│              │    Standard package        │    distribution           │
├──────────────┼────────────────────────────┼───────────────────────────┤
│ Integration  │ ⚠️ Limited by plugin API   │ ✅ Full access to CC     │
│ depth        │    May miss some data      │    internals              │
├──────────────┼────────────────────────────┼───────────────────────────┤
│ Risk         │ ✅ Low — if CC changes,    │ ❌ High — if CC changes, │
│              │    only adapter breaks     │    entire fork breaks     │
├──────────────┼────────────────────────────┼───────────────────────────┤
│ Adoption     │ ✅ Zero friction install   │ ❌ Replace entire CC     │
│              │    Keep existing CC        │    installation           │
├──────────────┼────────────────────────────┼───────────────────────────┤
│ Future       │ ✅ Anthropic could adopt   │ ❌ Divergent codebase    │
│              │    as official plugin      │    forever                │
└──────────────┴────────────────────────────┴───────────────────────────┘

Decision: Toolkit approach. Plugin API limitations are manageable.
```

### 9.2 DKC Overall Pros & Cons

```
PROS:
  ✅ Solves a real, growing problem (knowledge debt from AI coding)
  ✅ No competitor doing exactly this — unique positioning
  ✅ Tích lũy data tạo switching cost tự nhiên → retention
  ✅ Fits naturally into existing workflow — no behavior change needed
  ✅ Git-friendly — knowledge base is code-reviewable
  ✅ Team scalable — individual → team → org
  ✅ Open source friendly — community plugins, templates

CONS:
  ❌ Depends on Claude Code plugin API stability (risk)
  ❌ Quality highly dependent on LLM output quality
  ❌ Token cost per compile — adds to developer's bill
  ❌ Cold start: knowledge base empty → first value takes days
  ❌ Markdown-only: no search, no graph visualization, no dashboard
  ❌ Cannot track knowledge developer gains OUTSIDE Claude Code
     (reading docs, pair programming, etc.)

TRADE-OFFS ACCEPTED:
  ⚖️ Markdown over database: lose query power, gain simplicity & git-friendliness
  ⚖️ Plugin over fork: lose integration depth, gain maintainability
  ⚖️ Async over real-time: lose immediacy, gain non-interruption
  ⚖️ File-level over line-level delegation: lose granularity, gain performance
```

---

## 10. Execution Roadmap

### Step 1: Skeleton & Init (Priority: P0)

```
Goal: `dkc init` works, creates correct structure, CLI scaffolded.

Tasks:
  □ npm init, tsconfig, tsup setup
  □ CLI skeleton with commander.js (all commands registered, stubs only)
  □ Template files: all .tpl files written
    □ CLAUDE.md.tpl (with DKC section)
    □ KNOWLEDGE.md.tpl (schema definition)
    □ session.md.tpl (with status: auto-generated frontmatter)
    □ concept.md.tpl (with "Human Notes" compiler-safe section)
    □ delegation-map.md.tpl
    □ gaps.md.tpl
    □ index.md.tpl (structured knowledge map, not empty list)
    □ log.md.tpl (append-only audit trail with header)
    □ config.json.tpl
  □ init command: full implementation
    □ Directory creation (.knowledge/, concepts/, sessions/, delegation/)
    □ Template file generation
    □ CLAUDE.md modifier (append, not overwrite)
    □ Git hook installer
    □ .dkc.config.json generator
    □ appendLog('init', 'Knowledge base initialized')
  □ Implement appendLog() utility (src/utils/log.ts)
  □ Unit tests for init flow

Verify: Run `dkc init` on a real project →
  - correct structure created
  - log.md has init entry
  - index.md has structured header (not just empty)
  - concept template has "Human Notes" section
```

### Step 2: Collectors (Priority: P0)

```
Goal: Parse conversation and git diff into structured data.

Tasks:
  □ Git diff collector: full implementation
    □ Parse git diff output
    □ Parse git log metadata
    □ Handle edge cases (binary files, renames, empty commits)
  □ Conversation collector: full implementation
    □ Parse message array
    □ Extract code blocks
    □ Detect confusion signals
    □ Extract decisions
  □ Unit tests with fixture data (sample conversations, diffs)

Verify: Feed sample conversation + diff → get correct structured output.
```

### Step 3: Session Debrief Compiler (Priority: P0)

```
Goal: /reflect produces a useful session debrief + updates index + logs.

Tasks:
  □ Prompt template: session-debrief.md finalized
  □ Session debrief compiler: compose prompt from collector output
  □ Output parser: parse Claude's markdown response → structured data
  □ File writer: write sessions/YYYY-MM-DD-HH.md with frontmatter
    □ Include status: auto-generated in frontmatter
  □ Index Generator (§5.8): full implementation
    □ Read all concept pages frontmatter (not full content)
    □ Group concepts by domain (inferred from related_files paths)
    □ Generate 1-line summary per concept
    □ Include recency indicators (★, 🆕)
    □ Include top 3 gaps inline
    □ Enforce < 2000 token limit
  □ appendLog('compile', details) at end of pipeline
  □ CLI command: `dkc reflect` with --quiet and --auto flags
  □ Integration test: full pipeline conversation → debrief + index + log

### Step 4: Concept Wiki Compiler (Priority: P1)

```
Goal: Concepts auto-extracted, pages created/updated, backlinks woven.

Tasks:
  □ Prompt template: concept-extract.md finalized
  □ Prompt template: concept-page.md finalized
  □ Concept extractor: from session debrief → concept list
    □ Auto-extract from long explanations (>300 words) → concept content
      (query file-back: valuable explanations compiled, not lost in chat)
  □ Concept matcher: fuzzy match against existing pages
  □ Concept page creator: new page from template
    □ Include "Human Notes" section with compiler-safe comment
    □ Set status: auto-generated in frontmatter
  □ Concept page updater: append to existing page (additive only)
    □ NEVER touch "Human Notes" section
    □ Preserve existing status field if human-reviewed
  □ Backlink weaving (post-compile step):
    □ Scan all concept pages for mentions of new/updated concept
    □ Add [[link]] where concept name appears but link missing
    □ Reverse: add links from new page to existing concepts
    □ appendLog('backlink', 'Wove N new cross-references')
  □ Slug generator: normalize names, handle aliases
  □ CLI command: `dkc concept <n>`
  □ Integration test: session with new concept → page + backlinks

Verify:
  - After 5 sessions, concept pages reflect project-SPECIFIC knowledge
  - Backlinks connect related concepts automatically
  - "Human Notes" section untouched by compiler
  - Long explanations from conversation captured in concept pages
```

### Step 5: Delegation Map Compiler (Priority: P1)

```
Goal: AI vs human code tracked accurately.

Tasks:
  □ AI code block extractor from conversation
  □ Similarity comparator (normalized diff-based)
  □ File-level classifier
  □ Map generator: delegation/map.md
  □ Modules breakdown: delegation/modules.md
  □ Trend tracker: compare with previous map
  □ Integration test: session with mixed AI/human code → correct map

Verify: Map accurately reflects who wrote what. < 10% false positives.
```

### Step 6: Gaps Analyzer (Priority: P1)

```
Goal: /gaps returns actionable blind spots, including cross-reference gaps.

Tasks:
  □ Prompt template: gaps-analysis.md finalized
  □ Delegation scanner (unreviewed-code, untouched-ai-code)
  □ Concept scanner (concept-no-page, orphan-concept, stale-knowledge)
  □ Cross-reference scanner (missing-cross-reference — concept mentioned but no [[link]])
  □ Session pattern scanner (repeated-pattern, persistent-unknown)
  □ Priority calculator
  □ Action generator (every gap must have concrete suggested action)
  □ appendLog('lint', 'gaps.md regenerated: N gaps (breakdown)')
  □ CLI command: `dkc gaps`
  □ Integration test: knowledge base with known gaps → correct detection

Verify: Developer reads gaps.md → knows exactly what to do next.
        Every gap has actionable suggestion, not just observation.
```

### Step 7: Plugin Integration (Priority: P1)

```
Goal: Works inside Claude Code as plugin.

Tasks:
  □ Plugin entry point following Claude Code plugin spec
  □ SessionStart hook: load index.md as structured context
    (Claude reads knowledge map FIRST — knows what developer knows/doesn't know)
  □ Slash command handlers: /reflect, /gaps, /concept, /learned
  □ Conversation history access (or fallback if not available)
  □ Test: install plugin in Claude Code → commands work

Verify: Developer installs plugin → /reflect works inside Claude Code session.
        SessionStart loads index.md → Claude references knowledge base in responses.
```

### Step 8: Automation & Polish (Priority: P2)

```
Goal: Hands-off operation, production quality.

Tasks:
  □ Git hook: async compile, debounce, lock
  □ dkc status command
  □ dkc learned command
  □ Error handling: graceful failures, meaningful error messages
  □ Config validation: warn on invalid config
  □ README with installation, usage, examples
  □ Dogfood: use on own project for 2 weeks

Verify: Developer installs once, forgets about it, knowledge base grows.
```

---

## 11. Testing Strategy

### 11.1 Unit Tests (vitest)

```
collectors/
  □ conversation.test.ts
    - Parse empty conversation → empty output
    - Parse conversation with code blocks → extract correctly
    - Detect confusion signals (all types)
    - Extract decisions from approval patterns
    - Handle malformed messages gracefully

  □ git-diff.test.ts
    - Parse standard diff output
    - Handle renamed files
    - Handle binary files (skip gracefully)
    - Handle empty commits

compilers/
  □ session-debrief.test.ts
    - Compose correct prompt from inputs
    - Parse markdown output into structured data
    - Generate correct filename (date-based)
    - Handle missing diff (conversation-only session)

  □ concept-wiki.test.ts
    - Extract concepts from debrief
    - Fuzzy match existing concepts
    - Slug generation (special chars, unicode)
    - Additive update (never overwrite)

  □ delegation-map.test.ts
    - Similarity scoring accuracy
    - Classification thresholds
    - Trend calculation

analyzers/
  □ gaps.test.ts
    - Detect each gap type correctly
    - Priority assignment logic
    - Action generation

utils/
  □ similarity.test.ts — scoring edge cases
  □ slug.test.ts — normalization rules
  □ markdown.test.ts — frontmatter parse/generate
```

### 11.2 Integration Tests

```
  □ init-flow.test.ts
    - Fresh project → correct structure
    - Existing CLAUDE.md → append correctly
    - Existing .knowledge/ → repair/skip

  □ compile-pipeline.test.ts
    - Full flow: conversation + diff → all outputs
    - Incremental: second compile → update not overwrite
    - Minimal session → skip or minimal output

  □ gaps-analysis.test.ts
    - Knowledge base with known patterns → correct gaps
    - Empty knowledge base → bootstrap gaps
    - Resolved gaps → removed from output
```

### 11.3 Fixture Data

```
tests/fixtures/
  ├── conversations/
  │   ├── simple-bugfix.json        # 10 messages, 1 file changed
  │   ├── feature-development.json  # 50 messages, 5 files
  │   ├── refactoring.json          # 30 messages, many file moves
  │   ├── discussion-only.json      # 20 messages, 0 code changes
  │   └── minimal.json              # 3 messages, trivial fix
  │
  ├── diffs/
  │   ├── single-file.diff
  │   ├── multi-file.diff
  │   ├── new-files-only.diff
  │   └── rename-and-modify.diff
  │
  └── knowledge-bases/
      ├── empty/                    # Just initialized
      ├── mature/                   # 30 sessions, 15 concepts
      └── gaps-heavy/               # Many blind spots
```

---

## 12. Definition of Done

### 12.1 MVP (Minimum Viable Product)

```
All of these MUST work:

  ✅ `npm install -g developer-knowledge-compiler` installs cleanly
  ✅ `dkc init` creates correct .knowledge/ structure (incl. log.md)
  ✅ `dkc init` updates CLAUDE.md with DKC section
  ✅ `dkc init` installs git post-commit hook
  ✅ `dkc reflect` produces session debrief (with status: auto-generated)
  ✅ `dkc reflect` extracts and creates concept pages (with Human Notes section)
  ✅ `dkc reflect` runs backlink weaving after concept compile
  ✅ `dkc reflect` updates delegation map
  ✅ `dkc reflect` regenerates index.md as structured knowledge map
  ✅ `dkc reflect` appends event to log.md
  ✅ `dkc gaps` analyzes knowledge base (incl. missing-cross-reference)
  ✅ `dkc concept <name>` looks up or creates concept page
  ✅ `dkc status` shows knowledge base overview
  ✅ Post-commit hook triggers auto-compile silently
  ✅ All unit tests pass
  ✅ All integration tests pass
  ✅ README with clear installation & usage instructions
```

### 12.2 Quality Gates

```
  ✅ Session debrief: developer reads and finds > 1 new insight
  ✅ Concept page: content is project-SPECIFIC, not generic
  ✅ Concept page: "Human Notes" section never touched by compiler
  ✅ Delegation map: < 10% false positive classification rate
  ✅ Gaps: every gap has actionable suggested action
  ✅ Index.md: structured map < 2000 tokens, grouped by domain
  ✅ Backlinks: related concepts auto-linked after compile
  ✅ Log.md: every compile/lint event recorded
  ✅ Compile time: < 30 seconds for average session
  ✅ Zero interruption: no terminal output during coding session
  ✅ Knowledge base: readable offline without any tool
  ✅ Long explanations (>300 words) auto-extracted to concept pages
```

### 12.3 NOT in MVP (Future)

```
  ◻ Team knowledge graph (multi-developer)
  ◻ Web dashboard / visualization
  ◻ Spaced repetition / learning path
  ◻ Code review intelligence (PR integration)
  ◻ Knowledge health score
  ◻ Export to HTML/PDF
  ◻ VS Code extension
  ◻ dkc ingest <url> — broad ingest from external sources
  ◻ Graph visualization of concept network
  ◻ Vector search (QMD integration) for large knowledge bases
```

---

*End of SRS — Document ready for agent execution.*
