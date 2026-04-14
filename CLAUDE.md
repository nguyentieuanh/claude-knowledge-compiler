# Developer Knowledge Compiler (DKC) — Build Context

## Project Identity

DKC la toolkit doc lap gan vao Claude Code qua plugin system, tu dong tich luy tri thuc cua developer sau moi coding session. Khong day developer trong luc code, ma **compile kien thuc xuyen session** thanh knowledge base persistent, searchable, va actionable.

**SRS document**: `../SRS-developer-knowledge-compiler.md`
**Claude Code source (reference)**: `../claude-code-source-code/`

---

## 1. Integration Architecture — Claude Code Data Flow

### 1.1 Plugin System (Primary Integration)

DKC tich hop qua plugin system cua Claude Code. Plugin duoc discover tu 3 sources:
1. **Session-only**: `--plugin-dir` flag khi chay Claude Code
2. **Marketplace**: `settings.enabledPlugins` (GitHub, npm, local)
3. **Built-in**: Ship cung CLI

**Plugin manifest** nam tai `.claude-plugin/plugin.json` (KHONG phai `manifest.json` o root):

```
developer-knowledge-compiler/
  .claude-plugin/
    plugin.json              # PluginManifest (validated by Zod schema)
  commands/                  # Slash commands (.md files)
    reflect.md
    gaps.md
    concept.md
    learned.md
    status.md
  skills/                    # Skills (DIRECTORY format, moi skill la folder)
    dkc-compile/
      SKILL.md
    dkc-reflect/
      SKILL.md
    dkc-gaps/
      SKILL.md
  agents/                    # Agent definitions (MOI)
    dkc-compiler/
      agent.md
  hooks/
    hooks.json               # Hook event bindings
  dist/                      # Compiled hook scripts (from src/hooks/)
    hooks/
      session-start.js
      session-end-collect.js
      session-end-compile.js
      post-tool-use.js
      pre-compact.js
      post-compact.js
  src/                       # TypeScript source
    hooks/
    core/
    collectors/
    compilers/
    analyzers/
    ...
```

**Plugin Manifest format** (from `src/utils/plugins/schemas.ts` — `PluginManifestSchema`):

```json
{
  "name": "developer-knowledge-compiler",
  "version": "1.0.0",
  "description": "Compile developer knowledge across coding sessions",
  "author": { "name": "DKC" },
  "commands": ["./commands"],
  "skills": ["./skills"],
  "agents": ["./agents"],
  "hooks": "./hooks/hooks.json",
  "userConfig": {
    "knowledgeBasePath": {
      "type": "string",
      "title": "Knowledge Base Path",
      "description": "Relative path to .knowledge/ folder",
      "default": ".knowledge"
    },
    "autoCompile": {
      "type": "boolean",
      "title": "Auto-compile on session end",
      "description": "Automatically compile knowledge when session ends",
      "default": true
    },
    "autoCompileMinMessages": {
      "type": "number",
      "title": "Min messages for auto-compile",
      "description": "Skip auto-compile if session shorter than this",
      "default": 5,
      "min": 1
    }
  }
}
```

**Manifest field reference** (from Zod schema):
- `commands`: string | string[] | Record<string, CommandMetadata> — paths to .md files or directories
- `skills`: string | string[] — paths to skill directories (moi skill la folder chua `SKILL.md`)
- `agents`: string | string[] — paths to agent definition directories
- `hooks`: string | object | array — path to hooks.json hoac inline config
- `mcpServers`: string | Record<string, McpServerConfig> | array — optional MCP servers
- `lspServers`: string | Record<string, LspServerConfig> | array — optional LSP servers
- `userConfig`: Record<string, UserConfigOption> — settings user config khi enable plugin
- `settings`: Record<string, unknown> — plugin settings merged into cascade

**LoadedPlugin type** (from `src/types/plugin.ts:48-70`):
- `name`, `manifest`, `path`, `source`, `repository` — identity
- `commandsPath / commandsPaths` — auto-detected `commands/` + manifest paths
- `skillsPath / skillsPaths` — auto-detected `skills/` + manifest paths
- `agentsPath / agentsPaths` — auto-detected `agents/` + manifest paths
- `hooksConfig: HooksSettings` — loaded from hooks.json
- `mcpServers`, `lspServers` — optional server configs
- `settings` — merged plugin settings

**Plugin construction** (`createPluginFromPath()` in `src/utils/plugins/pluginLoader.ts:1348+`):
1. Load `.claude-plugin/plugin.json` (fallback: default manifest with name)
2. Auto-detect `commands/`, `agents/`, `skills/`, `output-styles/` directories
3. Process manifest path fields (string, array, or object mapping)
4. Load hooks from `hooks/hooks.json` + merge with manifest hooks field
5. Load MCP/LSP configs

**IMPORTANT**: Khong co `import type { Plugin } from '@anthropic-ai/claude-code'`. Plugin dung file-based structure + `.claude-plugin/plugin.json`, KHONG phai TypeScript interface export.

### 1.2 Hook System — Auto-trigger & Context Injection

**Hook Events** (26 events, from `src/entrypoints/sdk/coreTypes.ts`):
```
SessionStart, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure,
UserPromptSubmit, Stop, StopFailure, SubagentStart, SubagentStop,
PreCompact, PostCompact, PermissionRequest, PermissionDenied, Setup,
TaskCreated, TaskCompleted, Elicitation, ElicitationResult,
ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded,
CwdChanged, FileChanged
```

**Hook Command Types** (5 loai):
```typescript
type HookCommand = 
  | { type: 'command'; command: string }   // Shell command, stdin/stdout JSON
  | { type: 'prompt'; prompt: string }     // LLM prompt evaluation (no tools)
  | { type: 'agent'; prompt: string }      // Sub-agent with full tool access
  | { type: 'http'; url: string }          // HTTP POST webhook
  | { type: 'function'; callback: ... }    // In-process (not persisted)
```

**CRITICAL — hooks.json format** (from `src/schemas/hooks.ts:176-223`):

Format la nested: `EventName` → array of matchers → moi matcher co `hooks[]` array.
**KHONG phai** flat `EventName` → array of hook commands.

```json
{
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/session-start.js",
          "timeout": 10,
          "statusMessage": "Loading knowledge context..."
        }
      ]
    }
  ],
  "SessionEnd": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/session-end-collect.js",
          "timeout": 15,
          "statusMessage": "Collecting session data..."
        },
        {
          "type": "agent",
          "prompt": "Read the session compile data from $CLAUDE_PLUGIN_DATA/pending-compile.json and execute the DKC compile pipeline. Use the dkc-compile skill instructions to generate session debrief, extract concepts, and update the knowledge base.",
          "statusMessage": "Compiling knowledge..."
        }
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/post-tool-use.js",
          "timeout": 5
        }
      ]
    }
  ],
  "PreCompact": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/pre-compact.js",
          "timeout": 5,
          "statusMessage": "Saving knowledge context..."
        }
      ]
    }
  ],
  "PostCompact": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/post-compact.js",
          "timeout": 5,
          "statusMessage": "Restoring knowledge context..."
        }
      ]
    }
  ]
}
```

**Hook stdin format** (from `src/entrypoints/sdk/coreSchemas.ts:387-445`):

Base fields (ALL hooks nhan duoc):
```json
{
  "session_id": "abc-123",
  "transcript_path": "~/.claude/projects/<hash>/abc-123.jsonl",
  "cwd": "/path/to/project",
  "permission_mode": "...",
  "agent_id": "...",
  "agent_type": "..."
}
```

PostToolUse additional fields:
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.ts", "content": "..." },
  "tool_response": "File written successfully",
  "tool_use_id": "toolu_xxx"
}
```

**Hook stdout format** (from `src/entrypoints/sdk/coreSchemas.ts:799-974`):

Sync response:
```json
{
  "continue": true,
  "suppressOutput": false,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "string injected vao Claude context"
  }
}
```

Async response (cho long-running hooks):
```json
{
  "async": true,
  "asyncTimeout": 60000
}
```

**Hook exit codes** (from `src/utils/hooks/hooksConfigManager.ts:29-60`):
- Exit 0: Success. stdout JSON parsed, stderr ignored
- Exit 2: **Blocking error** — stderr shown to Claude, execution blocked
- Other: Non-blocking error — stderr shown to user only

**Environment variables** available in hooks (from `src/utils/hooks.ts:882-926`):
```bash
CLAUDE_PROJECT_DIR          # Project root directory
CLAUDE_PLUGIN_ROOT          # Plugin installation directory
CLAUDE_PLUGIN_DATA          # Persistent data directory for plugin
CLAUDE_PLUGIN_OPTION_*      # User config values (uppercased key names)
SHELL                       # Current shell
```

**DKC Hook Architecture — Compile Pipeline**:

```
SessionStart (type: command)
  → Node.js doc .knowledge/index.md
  → Return { additionalContext: knowledgeContext }
  → Claude biet developer da biet gi

PostToolUse[Write|Edit] (type: command)
  → Node.js ghi tool_input vao delegation buffer
  → Buffer luu o $CLAUDE_PLUGIN_DATA/delegation-buffer.json
  → Fire-and-forget, khong return gi

PreCompact (type: command)
  → Save knowledge context snapshot vao $CLAUDE_PLUGIN_DATA/
  → Dam bao context khong mat khi compact

PostCompact (type: command)
  → Re-inject knowledge context tu snapshot
  → Return { additionalContext: refreshedContext }

SessionEnd — HYBRID APPROACH (CRITICAL):
  Hook 1 (type: command): Collect session data
    → Doc transcript, git diff, delegation buffer
    → Ghi temp file: $CLAUDE_PLUGIN_DATA/pending-compile.json
    → Khong can LLM, chi data prep

  Hook 2 (type: agent): LLM Compile
    → Sub-agent doc pending-compile.json
    → Co full tool access (Read, Write, Edit, Glob, Grep)
    → Chay compile pipeline: debrief + concepts + delegation
    → Ghi output vao .knowledge/

  TAI SAO HYBRID: Command hooks la shell scripts — KHONG co LLM access.
  Compile can LLM de analyze conversation → phai dung agent hook.
  Command hook lam data prep (nhanh, no-cost) → agent hook lam LLM work.
```

### 1.3 Conversation Data — Transcript Format

**Location**: `~/.claude/projects/<sanitized-cwd-path>/<sessionId>.jsonl`
- Path logic: `getProjectDir(cwd)` = `~/.claude/projects/` + `sanitizePath(cwd)`
- Moi dong la 1 JSON object (JSONL format)
- Source: `src/utils/sessionStorage.ts`

**TranscriptMessage** (from `src/types/logs.ts`):
```typescript
type TranscriptMessage = SerializedMessage & {
  parentUuid: UUID | null
  isSidechain: boolean
  gitBranch?: string
  agentId?: string
}

type SerializedMessage = Message & {
  cwd: string
  sessionId: string
  timestamp: string
  version: string
  gitBranch?: string
}
```

**Message Union** (from `src/types/message.ts`):
```typescript
type Message =
  | AssistantMessage    // type: 'assistant', message: BetaMessage
  | UserMessage         // type: 'user', message: { role, content }
  | SystemMessage       // type: 'system', subtype: 'informational'|'api_error'|...
  | AttachmentMessage   // type: 'attachment'
  | ProgressMessage     // type: 'progress'
  | TombstoneMessage    // type: 'tombstone' (deleted)
```

**UserMessage** — developer input:
```typescript
interface UserMessage {
  type: 'user'
  message: { role: 'user', content: string | ContentBlockParam[] }
  uuid: UUID
  timestamp: string
  origin?: 'agent' | 'teammate' | 'command' | 'system' | 'hook' | undefined
  // origin === undefined means human-typed
}
```

**AssistantMessage** — Claude output:
```typescript
interface AssistantMessage {
  type: 'assistant'
  uuid: UUID
  timestamp: string
  message: BetaMessage  // Anthropic SDK - contains content blocks
  // Content blocks: text, tool_use, tool_result, thinking
}
```

**Tool use data** nam trong AssistantMessage.message.content:
- `{ type: 'tool_use', id, name, input }` — tool call
- `{ type: 'tool_result', tool_use_id, content }` — tool result (trong UserMessage tiep theo)

### 1.4 Prompt History (backup data source)

**Location**: `~/.claude/history.jsonl`
- Format: `{ display, pastedContents, timestamp, project, sessionId }`
- Chi chua user input, KHONG co AI response
- Source: `src/history.ts`

### 1.5 Cost Data (bonus cho session debrief)

```typescript
type StoredCostState = {
  totalCostUSD: number
  totalLinesAdded: number
  totalLinesRemoved: number
  modelUsage: { [modelName: string]: {
    inputTokens: number
    outputTokens: number
    costUSD: number
  }}
}
```

### 1.6 Git Operation Detection (reusable)

`src/tools/shared/gitOperationTracking.ts` co san:
```typescript
detectGitOperation(command, output) -> {
  commit?: { sha, kind: 'committed'|'amended'|'cherry-picked' }
  push?: { branch }
  pr?: { action: 'created'|'merged'|... }
}
```

### 1.7 Skills System (cho slash commands)

**IMPORTANT**: Skills PHAI dung directory format, KHONG phai single .md file:

```
# SAI:
skills/dkc-compile.md

# DUNG:
skills/dkc-compile/SKILL.md
```

Disk-based skills — discovery locations:
- User scope: `~/.claude/skills/<name>/SKILL.md`
- Project scope: `.claude/skills/<name>/SKILL.md`
- Plugin scope: `plugin-dir/skills/<name>/SKILL.md`

**Skill frontmatter fields** (from `src/skills/loadSkillsDir.ts:185-265`):
```yaml
---
name: Display name
description: One-line description
when_to_use: When Claude should auto-invoke this skill
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
argument-hint: "[session-id]"
arguments: [arg1, arg2]
user-invocable: true          # true = /name available in typeahead
                               # false = hidden, only model can invoke via Skill tool
model: sonnet                  # Model override (haiku, sonnet, opus, or "inherit")
context: fork                  # 'inline' (default) or 'fork' (sub-agent)
agent: dkc-compiler            # Agent type when context=fork
effort: medium                 # low, medium, high
hooks: {}                      # Skill-specific hooks
paths: ["src/**/*.ts"]         # File path conditional visibility
---
```

**Inline vs Fork context** (CRITICAL cho DKC):

| | Inline (default) | Fork |
|---|---|---|
| Conversation history | Full access | NO access (isolated) |
| Tool access | Parent's tools | Defined by `allowed-tools` |
| Token budget | Shared with parent | Separate budget |
| Side effects | Affects main conversation | Isolated, returns result |
| Use when | Quick queries, context-aware | Heavy processing, compile |

DKC compile skills PHAI dung `context: fork` vi:
- Compile la heavy processing, khong nen pollute main conversation
- Can separate token budget (compile prompt co the dai)
- Result tra ve main conversation gon gon

**Variable substitution** trong skill .md:
- `${CLAUDE_PLUGIN_ROOT}` — plugin directory path
- `${CLAUDE_SKILL_DIR}` — skill's own directory (for bundled skills)
- `${user_config.X}` — user config values from manifest

**BundledSkillDefinition type** (from `src/skills/bundledSkills.ts:15-41`):
```typescript
type BundledSkillDefinition = {
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  agent?: string
  files?: Record<string, string>
  getPromptForCommand: (args, context) => Promise<ContentBlockParam[]>
}
```

### 1.8 Agent Definitions (MOI — cho compile tasks)

Plugin manifest ho tro `agents` field. DKC dinh nghia agent rieng cho compile:

```
agents/
  dkc-compiler/
    agent.md
```

Agent definition file (`agents/dkc-compiler/agent.md`):
```markdown
---
name: dkc-compiler
description: Compiles coding session into structured knowledge
model: sonnet
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

You are the DKC Compiler agent. Analyze coding session data and produce
structured knowledge outputs for the .knowledge/ directory.

## Your Task
1. Read session data from the provided path
2. Generate session debrief following the template
3. Extract concepts, update existing concept pages
4. Update delegation map based on AI vs human code
5. Regenerate index.md
6. Append to log.md

## Rules
- NEVER overwrite "Human Notes" sections (P4: additive only)
- Write context-specific content, NOT generic definitions (P2)
- Maximum 5 new concepts per session
- Use [[concept-slug]] syntax for cross-references
```

Agent duoc goi boi:
- Hook type `"agent"` (SessionEnd compile)
- Skill voi `context: fork` + `agent: dkc-compiler`

### 1.9 Plugin Environment & State Management (MOI)

**`CLAUDE_PLUGIN_DATA`** — persistent directory cho plugin state:
- Location: managed by Claude Code, persistent across sessions
- DKC dung de luu:
  - `delegation-buffer.json` — accumulated Write/Edit tracking (PostToolUse)
  - `pending-compile.json` — session data cho SessionEnd compile
  - `context-snapshot.json` — knowledge context backup (PreCompact)
  - `last-compile-state.json` — avoid duplicate compiles

```typescript
// Hook scripts access via environment variable:
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const bufferPath = path.join(pluginData, 'delegation-buffer.json');
```

**State flow**:
```
PostToolUse (Write) → append to delegation-buffer.json
PostToolUse (Edit)  → append to delegation-buffer.json
PreCompact          → save context-snapshot.json
PostCompact         → read context-snapshot.json → inject
SessionEnd cmd      → read delegation-buffer.json + transcript
                    → write pending-compile.json
                    → clear delegation-buffer.json
SessionEnd agent    → read pending-compile.json
                    → compile → write .knowledge/
                    → clear pending-compile.json
```

---

## 2. SRS Corrections Required

| # | SRS Section | Van de | Fix | Severity |
|---|-------------|--------|-----|----------|
| 1 | 5.2 `ConversationRaw` | Interface gia dinh `messages[]` array | Thay bang JSONL reader parse `TranscriptMessage` tung dong | **CRITICAL** |
| 2 | 4.3 Plugin entry | `import type { Plugin } from '@anthropic-ai/claude-code'` | Dung `.claude-plugin/plugin.json` + file-based structure | **CRITICAL** |
| 3 | 4.3 Plugin entry | `manifest.json` o root | Phai la `.claude-plugin/plugin.json` | **CRITICAL** |
| 4 | 4.3 Hooks format | Flat `"EventName": [{ type, command }]` | Nested `"EventName": [{ matcher?, hooks: [{ type, command }] }]` | **CRITICAL** |
| 5 | 4.3 Skills format | `skills/name.md` (single file) | `skills/name/SKILL.md` (directory format) | **HIGH** |
| 6 | 5.4 Prompt Strategy | "write prompt to temp file" | Dung skill `SKILL.md` (context: fork) hoac hook type `agent` | **HIGH** |
| 7 | 5.4 Compile pipeline | "compose prompt → Claude processes" (nhung HOW?) | Hybrid: command hook (data prep) → agent hook (LLM compile) | **CRITICAL** |
| 8 | HC-2 SessionEnd | "chua chac co" | **CONFIRMED EXISTS** trong HOOK_EVENTS (26 events) | Confirmed |
| 9 | A-6 Conversation | "needs verification" | **CONFIRMED** qua `transcript_path` trong hook stdin input | Confirmed |
| 10 | N/A | Khong co userConfig | Manifest ho tro `userConfig` cho plugin settings | **HIGH** |
| 11 | N/A | Khong co agent definitions | Manifest ho tro `agents` field cho custom agent types | **HIGH** |
| 12 | N/A | Khong co PreCompact/PostCompact | Can hooks de bao ve knowledge context khi compact | **MEDIUM** |
| 13 | N/A | Khong co CLAUDE_PLUGIN_DATA | Hooks can persistent state directory giua cac runs | **MEDIUM** |
| 14 | N/A | PostToolUse stdin field | `tool_result` → `tool_response` (correct field name) | **LOW** |

---

## 3. Karpathy Knowledge Base Evaluation

6 diem tu Karpathy's personal knowledge base philosophy, danh gia cho DKC context:

### 3.1 index.md as Navigation Hub — BO SUNG, priority cao

Karpathy: LLM doc index.md dau tien de dinh vi, khong scan toan bo folder.

**Phu hop cho DKC**: Claude Code moi session moi can biet developer da hieu gi, chua hieu gi — ma khong the doc het 50 concept pages. index.md giau context la cach duy nhat de Claude load nhanh knowledge state ma khong ton token scan tung file.

**Implementation**: Khong chi la danh sach file ma phai la structured map: concepts grouped by domain, moi entry co 1-line summary, link, va relevance score (recent vs stale). Index Generator phai rebuild index.md sau moi compile, voi format:

```markdown
## Active Concepts (referenced in last 30 days)
- [dependency-injection](concepts/dependency-injection.md) — DI pattern dung trong service layer, 5 sessions | last: 2026-04-05
- [event-loop](concepts/event-loop.md) — Node.js event loop gay bug o worker threads, 3 sessions | last: 2026-04-01

## Knowledge Gaps (top 5)
- react-hooks: asked 4 times, no concept page yet
- ...

## Recent Sessions
- [2026-04-08-14](sessions/2026-04-08-14.md) — Refactor auth middleware, 3 concepts touched
```

### 3.2 Cross-reference Weaving — BO SUNG NHE

Karpathy: Gia tri nam o "duong mon lien tuong" giua cac trang.

**Phu hop 1 phan**: DKC knowledge base hep hon Karpathy (xoay quanh 1 codebase). Related Concepts trong concept page template da co roi.

**Implementation**: Khong can module moi. Them 1 rule cho Concept Compiler: sau khi create/update page, scan existing pages tim mention -> append backlink. Them gap type `missing-cross-reference` vao Gaps Analyzer.

### 3.3 Query File-back Loop — BO SUNG GIAN TIEP

Karpathy: Cau tra loi hay nen tro thanh trang moi trong wiki.

**Phu hop co dieu kien**: Trong coding session binh thuong (khong qua slash command), developer hoi Claude "explain this pattern" -> Claude tra loi hay -> insight do troi mat vao conversation history. Session Debrief Compiler chi bat o "Unknowns" section, khong du chi tiet.

**Implementation**: KHONG them prompt "Save vao knowledge base?" (vi pham P1: khong interrupt flow). Thay vao do, nang cap Session Debrief Compiler: khi detect Claude giai thich dai (>300 words) ve 1 concept -> auto-extract thanh concept page content, khong chi ghi 1 dong o Unknowns. Day la file-back tu dong, dung tinh than "ghi trong im lang."

### 3.4 `dkc ingest <url>` — KHONG BO SUNG (MVP)

Karpathy: Ingest tu web, paper, repo.

**Scope creep nguy hiem**: DKC la toolkit cho coding knowledge tu Claude Code sessions. Neu them ingest URL -> DKC dang bien thanh general-purpose knowledge base tool -> canh tranh voi Obsidian + LLM Wiki -> khac product hoan toan.

**Thay the**: Dam bao concept page co section **"Human Notes"** ma compiler khong bao gio cham -> developer tu them insight tu nguon ngoai vao day.

### 3.5 Draft/Review Workflow — BO SUNG NHE

Karpathy: "Con nguoi chuyen vai tu nguoi ghi chep sang nguoi bien tap."

**Tension**: DKC thiet ke async, tu dong, khong interrupt. Neu them draft/review -> developer phai review tung session debrief -> them viec -> developer bo dung.

**Implementation**: Khong bat buoc review, nhung cho phep:
- Frontmatter them `status: auto-generated | human-reviewed`
- Developer muon review thi sua status. Khong review cung khong sao.
- Gaps Analyzer co the note "ban co 15 session debriefs chua review" nhung KHONG block bat cu thu gi.
- Concept page them **"Human Notes"** section (compiler skip section nay, P4: additive only).

### 3.6 log.md Audit Trail — BO SUNG, priority thap, cost thap

Karpathy: Can log.md ghi lich su ingest/query/lint.

**Rat phu hop**: Developer can biet knowledge base co dang "song" khong — khi nao compile lan cuoi, bao nhieu session da process, lint chay lan cuoi khi nao.

**Implementation**: Append-only markdown file, moi event 1 dong:
```markdown
- 2026-04-08 14:30 | compile | session-2026-04-08-14 | 3 concepts, 1 new, 12 files tracked
- 2026-04-07 09:15 | lint | 5 gaps found (2 high, 3 medium)
- 2026-04-06 16:00 | compile | session-2026-04-06-16 | 1 concept updated
```
Chi can utility function `appendLog()` goi o cuoi moi compile/lint/query. Khong can module rieng.

---

## 4. Updated Concept Page Template

```markdown
---
name: {{conceptName}}
slug: {{slug}}
first_seen: {{date}}
last_updated: {{date}}
session_count: {{count}}
status: auto-generated
related_concepts: [{{slugs}}]
related_files: [{{files}}]
---

# {{conceptName}}

## What It Is (in this project)
{{1-2 sentences. NOT generic. Written for THIS codebase.}}

## Where It's Used
- `{{file:line}}` — {{how it's used here}}

## History
| Date | Session | What happened |
|------|---------|---------------|

## Bugs & Lessons
- **{{date}}**: {{bug}} -> Fix: {{fix}} -> Lesson: {{lesson}}

## Related Concepts
- [[{{related-slug}}]] — {{relationship}}

## Human Notes
<!-- DKC compiler will NEVER modify this section. -->
<!-- Developer: add your own notes, links to docs, insights from reading, etc. -->
```

---

## 5. Updated Session Debrief Template

```markdown
---
session_id: {{sessionId}}
date: {{date}}
duration_minutes: {{duration}}
files_changed: {{filesChanged}}
concepts: [{{concepts}}]
status: auto-generated
cost_usd: {{cost}}
lines_added: {{linesAdded}}
lines_removed: {{linesRemoved}}
---

# Session Debrief — {{date}}

## Summary
{{3-5 sentences}}

## Decisions Made
- **Decision:** {{what}} | **Why:** {{rationale}} | **Alternatives:** {{rejected}}

## Patterns Applied
- **{{Pattern Name}}** — applied in `{{file}}`: {{context}}

## Trade-offs Accepted
- **Chose:** {{what}} **Over:** {{alt}} **Because:** {{reason}}

## Unknowns & Learning Gaps
- **{{concept}}** — {{evidence from conversation}}
  -> Related concept: [[{{concept-slug}}]]

## Auto-extracted Explanations
<!-- Populated when Claude explanation > 300 words about a concept -->
- **{{concept}}** (from message #{{index}}):
  {{condensed explanation, project-specific}}

## Delegation Summary
| File | Status | Notes |
|------|--------|-------|
```

---

## 6. Updated .knowledge/ Structure

```
.knowledge/
  KNOWLEDGE.md              # Schema definition, version
  index.md                  # RICH navigation hub (grouped, scored, summarized)
  log.md                    # Audit trail (append-only)
  gaps.md                   # Current gaps
  .dkc.config.json          # Config
  sessions/
    _template.md
    2026-04-08-14.md
  concepts/
    _template.md
    dependency-injection.md
  delegation/
    map.md
    modules.md
```

---

## 7. Updated Gap Types

```typescript
type GapType =
  | 'unreviewed-code'           // AI wrote, dev never read
  | 'untouched-ai-code'         // AI wrote, dev never modified
  | 'concept-no-page'           // Referenced but no concept page
  | 'orphan-concept'            // Page exists but not referenced recently
  | 'repeated-pattern'          // Pattern used > 3x, no concept page
  | 'persistent-unknown'        // Dev asked same question > 2 sessions
  | 'stale-knowledge'           // Concept page > 30 days no update
  | 'missing-cross-reference'   // Concept mentions another but no backlink (NEW)
```

---

## 8. ConversationRaw — Corrected Interface

SRS original gia dinh `messages[]` array — SAI. Phai doc JSONL:

```typescript
// CORRECT: Read from ~/.claude/projects/<hash>/<sessionId>.jsonl
interface TranscriptReader {
  sessionId: string
  transcriptPath: string  // From hook input or computed

  // Parse JSONL line by line
  parse(): AsyncGenerator<TranscriptMessage>
}

// Each line in .jsonl is one of these:
interface TranscriptMessage {
  type: 'user' | 'assistant' | 'system' | 'attachment' | 'progress' | 'tombstone'
  uuid: string
  timestamp: string
  cwd: string
  sessionId: string
  version: string
  gitBranch?: string
  parentUuid: string | null
  isSidechain: boolean
  agentId?: string

  // For type === 'user':
  message?: { role: 'user', content: string | ContentBlockParam[] }
  origin?: 'agent' | 'teammate' | 'command' | 'system' | 'hook' | undefined

  // For type === 'assistant':
  message?: BetaMessage  // Contains content blocks: text, tool_use, thinking
}

// DKC Conversation Collector output (derived from parsing above):
interface ConversationParsed {
  sessionId: string
  startTime: string              // First message timestamp
  endTime: string                // Last message timestamp
  duration: number               // Minutes

  userMessages: Array<{
    index: number
    text: string
    type: 'question' | 'instruction' | 'clarification' | 'approval'
    origin: string | undefined   // Filter: only undefined (human-typed)
  }>

  aiCodeBlocks: Array<{
    index: number
    language: string
    code: string
    filePath?: string            // From tool_use Write/Edit input
    context: string
  }>

  toolCalls: Array<{
    index: number
    toolName: string             // 'Write', 'Edit', 'Bash', 'Read', etc.
    input: Record<string, unknown>
    result?: string
  }>

  confusionSignals: Array<{
    index: number
    text: string
    type: 'explicit-question' | 'repeated-question' | 'misunderstanding' | 'long-explanation-needed'
    concept?: string
  }>

  filesModified: string[]       // From Write/Edit tool calls
  commandsRun: string[]         // From Bash tool calls
}
```

---

## 9. Design Principles (Final)

```
P1: "Ghi trong im lang, noi khi duoc hoi"
    -> Khong bao gio interrupt developer flow
    -> Khong notification, khong popup, khong prompt giua session

P2: "Cu the cho project, khong generic"
    -> Concept page viet trong ngu canh codebase CU THE

P3: "Actionable, khong chi informational"
    -> Moi gap phai co suggested action cu the

P4: "Additive only"
    -> Khong bao gio overwrite existing knowledge
    -> "Human Notes" section compiler NEVER touches

P5: "Zero config to start, infinite config if needed"

P6: "Index-first navigation" (NEW — from Karpathy)
    -> index.md la entry point cho moi session
    -> Rich, structured, scored — khong phai flat list

P7: "Silent file-back" (NEW — from Karpathy evaluation)
    -> Long AI explanations auto-extract into concept pages
    -> Khong hoi developer, khong interrupt, chi ghi
```

---

## 10. Execution Order

```
Step 1: Skeleton & Init (P0)
  - npm init, tsconfig, tsup
  - CLI skeleton (commander.js)
  - Template files (all .md.tpl)
  - init command full implementation
  - Unit tests

Step 2: Collectors (P0)
  - JSONL Transcript reader (CORRECTED from SRS)
  - Git diff collector
  - Unit tests with fixtures

Step 3: Session Debrief Compiler (P0)
  - Prompt composition
  - Output parser
  - Auto-extract long explanations (P7)
  - File writer + index updater (P6)
  - log.md append

Step 4: Concept Wiki Compiler (P1)
  - Concept extraction
  - Fuzzy matching
  - "Human Notes" preservation (P4)
  - Backlink weaving
  - log.md append

Step 5: Delegation Map Compiler (P1)

Step 6: Gaps Analyzer (P1)
  - All gap types including missing-cross-reference

Step 7: Plugin Integration (P1)
  - .claude-plugin/plugin.json (manifest)
  - hooks/hooks.json (CORRECTED nested format)
  - Slash commands as .md files (commands/)
  - Skills as directory/SKILL.md format (skills/)
  - Agent definitions (agents/dkc-compiler/agent.md)
  - Hook scripts: session-start, session-end (hybrid), post-tool-use
  - PreCompact/PostCompact hooks
  - SessionStart context injection
  - SessionEnd hybrid compile (command + agent)

Step 8: Automation & Polish (P2)
```

---

## 11. Key File References in Claude Code Source

| Purpose | File Path (relative to claude-code-source-code/) |
|---------|------------------------------------------------|
| **Types** | |
| Message types | `src/types/message.ts` |
| Hook types | `src/types/hooks.ts` |
| Plugin types (LoadedPlugin) | `src/types/plugin.ts:48-70` |
| Log types (TranscriptMessage) | `src/types/logs.ts` |
| Tool interface (ToolUseContext) | `src/Tool.ts:158-300` |
| **Plugin System** | |
| Plugin manifest schema (Zod) | `src/utils/plugins/schemas.ts:884-898` |
| Plugin loader & discovery | `src/utils/plugins/pluginLoader.ts:1348-1750+` |
| Plugin hook loading | `src/utils/plugins/loadPluginHooks.ts:1-288` |
| Plugin commands loading | `src/utils/plugins/loadPluginCommands.ts:1-400+` |
| Plugin operations | `src/services/plugins/pluginOperations.ts` |
| **Hook System** | |
| Hook execution engine | `src/utils/hooks.ts:747-3476` |
| Hook input/output schemas | `src/entrypoints/sdk/coreSchemas.ts:387-974` |
| Hook events list (26) | `src/entrypoints/sdk/coreTypes.ts:25` |
| Hook config & metadata | `src/utils/hooks/hooksConfigManager.ts:1-401` |
| Prompt hook execution | `src/utils/hooks/execPromptHook.ts` |
| Agent hook execution | `src/utils/hooks/execAgentHook.ts` |
| HTTP hook execution | `src/utils/hooks/execHttpHook.ts` |
| Hooks JSON schema (Zod) | `src/schemas/hooks.ts:176-223` |
| **Skills System** | |
| Bundled skills definition | `src/skills/bundledSkills.ts:15-41` |
| Skill dir loader & frontmatter | `src/skills/loadSkillsDir.ts:185-265` |
| Skill tool (invocation) | `src/tools/SkillTool/SkillTool.ts:119-150` |
| Forked agent (context: fork) | `src/utils/forkedAgent.ts:186-232` |
| **Data Sources** | |
| Transcript storage | `src/utils/sessionStorage.ts` |
| Transcript path logic | `src/utils/sessionStoragePortable.ts:329` — `getProjectDir()` |
| Prompt history | `src/history.ts` |
| Git tracking | `src/tools/shared/gitOperationTracking.ts` |
| Cost tracking | `src/cost-tracker.ts` + `src/bootstrap/state.ts` |

<!-- DKC:START -->
## Developer Knowledge Compiler (DKC)

> Run `/reflect` to compile knowledge from recent sessions.
<!-- DKC:END -->
