# Developer Knowledge Compiler (DKC)

**Automatically compile developer knowledge across Claude Code sessions into a persistent, searchable knowledge base.**

> **Philosophy:** Record silently, speak when asked. DKC never interrupts your flow — it compiles knowledge into your project's `.knowledge/` directory after each session.

*[Tiếng Việt ở bên dưới / Vietnamese version below](#tiếng-việt)*

---

## Features

- **Auto-compile** — After each session: session debrief, concept extraction, delegation map, gap analysis
- **Knowledge gaps** — Detects unreviewed AI code, recurring unknowns, missing cross-references, stale concepts
- **Index-first navigation** — Rich `index.md` so Claude knows what you know at the start of every session
- **Human Notes protected** — DKC never overwrites `## Human Notes` sections in concept pages
- **Bilingual** — Supports English and Vietnamese output (`language` config)
- **LLM-enhanced or deterministic** — Works with Anthropic, OpenAI, or any OpenAI-compatible provider. Falls back to deterministic mode without API key.

---

## Requirements

- **Node.js** >= 18
- **Claude Code** (CLI, Desktop, or IDE extension) — with plugin support
- *(Optional)* `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for LLM-enhanced compilation

---

## Quick Start (5 minutes)

### Step 1: Install DKC

**Option A — Install script (recommended, installs to `~/.dkc`):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nguyentieuanh/claude-knowledge-compiler/main/install.sh)
```

The script downloads the latest release, extracts it, optionally installs LLM SDKs, and adds the Claude Code alias to your shell config automatically.

**Option B — Git clone (for development or self-hosting):**

```bash
git clone https://github.com/nguyentieuanh/claude-knowledge-compiler.git ~/.dkc
cd ~/.dkc
npm install && npm run build
```

**Option C — Local tarball:**

```bash
bash install.sh --local dkc-v1.0.0.tar.gz
```

> For full installation details, see [INSTALL.md](install%20package/INSTALL.md).

### Step 2: Add to Claude Code

```bash
# If installed via script (default: ~/.dkc):
alias claude='claude --plugin-dir /Users/yourname/.dkc'

# If installed via git clone to a custom path:
alias claude='claude --plugin-dir /absolute/path/to/claude-knowledge-compiler'
```

Add the alias to `~/.zshrc` (or `~/.bashrc`) and reload:

```bash
echo 'alias claude="claude --plugin-dir /Users/yourname/.dkc"' >> ~/.zshrc
source ~/.zshrc
```

> **Important:** Use an absolute path. `~` and relative paths do not work with `--plugin-dir`.

**Verify the plugin loaded** — start Claude Code and look for `"Loading knowledge context..."` on startup, or check that `/reflect` appears in slash command suggestions.

### Step 3: Initialize in your project

```bash
cd /path/to/your-project
npx dkc init
```

This creates:

```
your-project/
  .knowledge/
    index.md          <- Navigation hub (Claude reads this first)
    log.md            <- Audit trail
    gaps.md           <- Current knowledge gaps
    sessions/         <- Session debriefs
    concepts/         <- Concept wiki pages
    delegation/       <- AI vs human code map
  .dkc.config.json    <- Configuration
  CLAUDE.md           <- Auto-updated with DKC section
```

### Step 4: Start coding

That's it. DKC works automatically in the background:

| When | What DKC does |
|------|---------------|
| Session starts | Loads knowledge context into Claude |
| Claude uses Write/Edit | Tracks file ownership |
| Before compact | Saves context snapshot |
| After compact | Restores context |
| Session ends | Compiles everything: debrief + concepts + gaps + index |

---

## Slash Commands (in Claude Code)

| Command | Description |
|---------|-------------|
| `/reflect` | Compile knowledge from the current session |
| `/gaps` | Show knowledge gaps and suggested actions |
| `/concept <name>` | Look up a concept in the knowledge base |
| `/learned` | Summary of your learning journey across sessions |

---

## CLI Commands

```bash
# Compile the most recent session
dkc reflect

# Compile a specific session
dkc reflect --session-id 2026-04-08-14

# Compile from a specific transcript
dkc reflect --transcript ~/.claude/projects/<hash>/<session>.jsonl

# Show knowledge gaps
dkc gaps

# Show knowledge base status
dkc status

# Initialize knowledge base
dkc init
```

---

## Configuration

File `.dkc.config.json` in your project root:

```json
{
  "knowledgeBasePath": ".knowledge",
  "autoCompile": true,
  "autoCompileMinMessages": 5,
  "maxConceptsPerSession": 5,
  "staleKnowledgeDays": 30,
  "language": "en",
  "version": "1"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `knowledgeBasePath` | Knowledge base directory | `.knowledge` |
| `autoCompile` | Auto-compile on session end | `true` |
| `autoCompileMinMessages` | Min messages to trigger compile | `5` |
| `maxConceptsPerSession` | Max new concepts per session | `5` |
| `staleKnowledgeDays` | Days before a concept is stale | `30` |
| `language` | Output language: `en` or `vi` | `en` |

### LLM Providers

Copy `.env.example` to `.env` in the DKC directory:

```bash
cp .env.example .env
```

Priority: `ANTHROPIC_API_KEY` > `OPENAI_API_KEY` > deterministic fallback.

Supports OpenAI-compatible providers (OpenRouter, Groq, Ollama, etc.) via `OPENAI_BASE_URL`.

---

## How It Works

```
Session starts
  -> SessionStart hook reads index.md -> injects into Claude context

During session
  -> PostToolUse[Write|Edit] -> tracks file changes in delegation buffer

Session ends
  -> Hook 1 (command): collect transcript + git diff + buffer
  |   -> writes pending-compile.json
  -> Hook 2 (agent): compile pipeline
      -> Session debrief (summary, decisions, patterns, unknowns)
      -> Concept wiki (create/update concept pages)
      -> Delegation map (AI vs human code tracking)
      -> Gaps analysis (8 gap types)
      -> Index update (navigation hub)
```

**Why two hooks for SessionEnd?** Command hooks are shell scripts with no LLM access. Compilation needs LLM to analyze conversations. Solution: hook 1 (command) does fast data prep, hook 2 (agent) does LLM work with full tool access.

---

## Example Output

After a session, DKC generates files like this:

**Session Debrief** (`.knowledge/sessions/2026-04-08-14.md`):

```markdown
---
session_id: 2026-04-08-14
date: "2026-04-08"
duration_minutes: 45
files_changed: 8
concepts: [dependency-injection, middleware-pattern]
status: auto-generated
lines_added: 156
lines_removed: 42
---

# Session Debrief — 2026-04-08

## Summary
Refactored auth middleware to use dependency injection. Modified 8 files
across src/middleware/ and src/services/. Added comprehensive tests.

## Decisions Made
- **Decision:** Use constructor injection over service locator | **Why:** Better testability

## Unknowns & Learning Gaps
- **dependency injection** — Asked about DI vs service locator pattern
  -> Related concept: [[dependency-injection]]

## Delegation Summary
| File | Status | Notes |
|------|--------|-------|
| `src/middleware/auth.ts` | ai-generated | |
| `src/services/token.ts` | ai-generated | |
```

**Concept Page** (`.knowledge/concepts/dependency-injection.md`):

```markdown
# Dependency Injection

## What It Is (in this project)
DI pattern used in the service layer to inject TokenValidator and SessionStore
into middleware constructors instead of importing them directly.

## Where It's Used
- `src/middleware/auth.ts:15` — createAuthMiddleware accepts injected dependencies

## Human Notes
<!-- DKC compiler will NEVER modify this section -->
<!-- Add your own notes here -->
```

---

## Plugin Structure

```
developer-knowledge-compiler/
  .claude-plugin/
    plugin.json           <- Plugin manifest
  hooks/
    hooks.json            <- Hook bindings
  commands/               <- Slash commands (/reflect, /gaps, /concept, /learned)
  skills/
    dkc-compile/SKILL.md  <- Compile skill (SessionEnd agent hook)
    dkc-reflect/SKILL.md  <- Reflect skill (user-invocable)
    dkc-gaps/SKILL.md     <- Gaps skill
  agents/
    dkc-compiler/
      agent.md            <- DKC Compiler agent definition
  dist/                   <- Built files (npm run build)
```

---

## Troubleshooting

### Plugin not loading

```bash
# Verify manifest is valid JSON
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'));console.log('OK')"

# Verify build output exists
ls dist/hooks/
# Expected: session-start.js, session-end-collect.js, post-tool-use.js, pre-compact.js, post-compact.js
```

If hooks are missing, rebuild:
```bash
npm run build
```

### `dkc` command not found

```bash
# Option 1: use npx
npx dkc init

# Option 2: link globally
cd /path/to/developer-knowledge-compiler && npm link
```

### SessionEnd not compiling

The hook only triggers if the session has >= `autoCompileMinMessages` (default: 5). For short sessions, compile manually:
```bash
dkc reflect
```

### Slash commands not showing

1. Restart Claude Code after adding the plugin
2. Check that the path in `--plugin-dir` is absolute
3. Verify `commands/` directory exists with `.md` files

---

## Development

```bash
npm test              # Run 119 tests
npm run build         # Build for production
npm run typecheck     # TypeScript strict check
npm run test:coverage # Coverage report
```

---

## License

MIT - see [LICENSE](LICENSE)

---

---

# Tiếng Việt

## Developer Knowledge Compiler (DKC)

**Tự động tích lũy tri thức của developer sau mỗi coding session với Claude Code thành knowledge base persistent, searchable.**

> **Triết lý:** Ghi trong im lặng, nói khi được hỏi. DKC không bao giờ interrupt flow làm việc — tự động compile kiến thức vào `.knowledge/` sau mỗi session.

---

## Cài đặt nhanh (5 phút)

### Bước 1: Cài DKC

**Cách A — Install script (khuyến nghị, cài vào `~/.dkc`):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nguyentieuanh/claude-knowledge-compiler/main/install.sh)
```

Script tự động: tải release, giải nén, hỏi cài LLM SDKs, thêm alias vào shell config.

**Cách B — Git clone (để phát triển hoặc tự host):**

```bash
git clone https://github.com/nguyentieuanh/claude-knowledge-compiler.git ~/.dkc
cd ~/.dkc
npm install && npm run build
```

> Xem hướng dẫn cài đặt đầy đủ: [INSTALL.md](install%20package/INSTALL.md)

### Bước 2: Thêm vào Claude Code

```bash
# Thêm alias vào ~/.zshrc (hoặc ~/.bashrc):
echo 'alias claude="claude --plugin-dir /Users/tên_bạn/.dkc"' >> ~/.zshrc
source ~/.zshrc
```

> **Lưu ý quan trọng:** Phải dùng đường dẫn tuyệt đối. `~` và relative path không hoạt động với `--plugin-dir`.

**Kiểm tra:** Khởi động Claude Code — nếu thấy `"Loading knowledge context..."` hoặc `/reflect` trong slash commands là đã hoạt động.

### Bước 3: Khởi tạo trong project

```bash
cd /path/to/your-project
dkc init
```

### Bước 4: Code bình thường

DKC hoạt động hoàn toàn tự động:

| Khi nào | DKC làm gì |
|---------|-----------|
| Bắt đầu session | Load knowledge context vào Claude |
| Claude dùng Write/Edit | Track file ownership |
| Trước compact | Lưu context snapshot |
| Sau compact | Restore context |
| Kết thúc session | Compile: debrief + concepts + gaps + index |

---

## Lệnh trong Claude Code

| Lệnh | Mô tả |
|-------|-------|
| `/reflect` | Compile knowledge từ session hiện tại |
| `/gaps` | Xem knowledge gaps và hành động đề xuất |
| `/concept <tên>` | Tra cứu concept trong knowledge base |
| `/learned` | Tổng kết learning journey qua các sessions |

---

## Lệnh CLI

```bash
dkc reflect                          # Compile session gần nhất
dkc reflect --session-id 2026-04-08  # Compile session cụ thể
dkc gaps                             # Xem knowledge gaps
dkc status                           # Trạng thái knowledge base
dkc init                             # Khởi tạo knowledge base
```

---

## Cấu hình

File `.dkc.config.json`:

| Trường | Mô tả | Mặc định |
|--------|-------|---------|
| `knowledgeBasePath` | Thư mục knowledge base | `.knowledge` |
| `autoCompile` | Tự động compile khi kết thúc session | `true` |
| `autoCompileMinMessages` | Số message tối thiểu để trigger | `5` |
| `maxConceptsPerSession` | Số concept mới tối đa mỗi session | `5` |
| `staleKnowledgeDays` | Ngày trước khi concept bị coi là stale | `30` |
| `language` | Ngôn ngữ output: `en` hoặc `vi` | `en` |

### LLM Providers

```bash
cp .env.example .env
# Điền API key. Ưu tiên: ANTHROPIC > OPENAI > deterministic fallback
# Hỗ trợ OpenAI-compatible providers (OpenRouter, Groq, Ollama...)
```

---

## Xử lý sự cố

| Vấn đề | Giải pháp |
|--------|----------|
| Plugin không load | Kiểm tra `--plugin-dir` dùng absolute path. Chạy `npm run build` |
| `dkc` not found | Dùng `npx dkc` hoặc `npm link` |
| SessionEnd không compile | Session ngắn hơn 5 messages. Dùng `dkc reflect` thủ công |
| Slash commands không hiện | Restart Claude Code sau khi thêm plugin |
