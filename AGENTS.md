# DKC Agent Team — Development Workflow

## Tổng Quan

Đây là mô tả agent team cho việc xây dựng DKC toolkit. Mỗi agent có vai trò rõ ràng, input/output contracts cụ thể, và flow tương tác giữa các agent được định nghĩa trước.

### Agent Descriptions (Chi tiết)

| Agent | File | Mô tả |
|-------|------|-------|
| PM | [agents/pm.md](agents/pm.md) | Product Manager — vision, scope guard, acceptance criteria |
| Tech Lead | [agents/tech-lead.md](agents/tech-lead.md) | Senior Architect — module breakdown, interfaces, build order |
| Dev | [agents/dev.md](agents/dev.md) | Module Developer — implement + test, nhiều instances |
| QA | [agents/qa.md](agents/qa.md) | Quality Assurance — test, bug reports, coverage |
| Integration | [agents/integration.md](agents/integration.md) | System Integrator — CLI/plugin wiring, pipeline orchestration |
| Doc | [agents/doc.md](agents/doc.md) | Documentation — templates, prompts, slash commands |

### Workflow Detail
- [agents/workflow.md](agents/workflow.md) — Sprint cycle, execution order mapping, conflict resolution

```
                    ┌──────────────┐
                    │   PM Agent   │ ← SRS + CLAUDE.md
                    │  (Điều phối) │
                    └──────┬───────┘
                           │ Requirements & Priorities
                           ▼
                    ┌──────────────────┐
                    │ Tech Lead Agent  │ ← System Design
                    │ (Kiến trúc)      │
                    └──────┬───────────┘
                           │ Module specs + Interface contracts
                           ▼
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Dev Agent│ │ Dev Agent│ │ Dev Agent│
        │ (Module) │ │ (Module) │ │ (Module) │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             ▼            ▼            ▼
        ┌──────────────────────────────────┐
        │         QA Agent (Test)          │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │     Integration Agent (Glue)     │
        └──────────────────────────────────┘
```

---

## 1. PM Agent — Product Manager / Điều Phối Dự Án

**Vai trò:** Giữ vision sản phẩm, đảm bảo mọi output bám sát SRS và design principles (P1-P7). Là "source of truth" cho requirements.

**Input:**
- SRS document (`../SRS-developer-knowledge-compiler.md`)
- CLAUDE.md (corrected design decisions)
- Feedback từ user (stakeholder)
- Status reports từ các agent khác

**Output:**
- **Sprint backlog**: Danh sách tasks ưu tiên theo Execution Order (Step 1→8)
- **Acceptance criteria**: Mỗi task có definition of done cụ thể
- **Decision log**: Khi có conflict giữa SRS và thực tế, PM quyết định và ghi lại lý do
- **Scope guard**: Reject feature creep, nhắc lại "DKC bổ sung cho Claude Code, không thay thế"

**Quy tắc:**
1. Luôn reference SRS section number khi ra yêu cầu (ví dụ: "theo SRS §5.2")
2. Ưu tiên P0 modules trước, không jump ahead
3. Khi dev agent hỏi "có nên thêm X?", PM check: X có trong SRS không? Có vi phạm P1-P7 không?
4. Mỗi sprint review: so sánh output vs Definition of Done (SRS §12)

**Trigger:** Được gọi khi bắt đầu sprint mới, khi có conflict cần quyết định, hoặc khi cần review deliverable.

---

## 2. Tech Lead Agent — Senior Architect

**Vai trò:** Dịch requirements từ PM thành technical specs. Tách module, định nghĩa interfaces, đảm bảo system design coherent.

**Input:**
- Sprint backlog từ PM
- CLAUDE.md §1 (Integration Architecture) — hiểu Claude Code internals
- CLAUDE.md §8 (Corrected interfaces) — đảm bảo dùng đúng data format
- SRS §4 (System Architecture) + §5 (Module Specifications)
- Current codebase state

**Output:**
- **Module breakdown**: Tách task thành files cụ thể, mỗi file có interface rõ ràng
- **Interface contracts**: TypeScript interfaces cho input/output của mỗi module
- **Dependency graph**: Module nào depend module nào, build order
- **Technical decisions**: Khi SRS thiếu detail, TL quyết định và document
- **Code review checklist**: Tiêu chí kỹ thuật cho mỗi PR

**Quy tắc:**
1. Mỗi module phải có clear boundary — import chỉ qua public interface
2. Theo SRS §3.2: minimal dependencies, mỗi dep giải quyết vấn đề > 200 LOC
3. CORRECTED interfaces (CLAUDE.md §8) override SRS §5.2 — dùng JSONL reader, không dùng messages array
4. Plugin integration dùng `.claude-plugin/plugin.json` + file-based structure (CLAUDE.md §1.1), KHÔNG dùng TypeScript Plugin interface
5. Đảm bảo mỗi module testable independently

**Trigger:** Sau khi PM xác nhận sprint backlog, trước khi dev agents bắt đầu code.

---

## 3. Dev Agent — Module Developer (có thể song song nhiều instances)

**Vai trò:** Implement từng module theo specs từ Tech Lead. Một Dev Agent focus vào 1 module tại 1 thời điểm.

**Input:**
- Module spec từ Tech Lead (interface contracts, file paths, logic description)
- Template files (CLAUDE.md §4, §5)
- Existing code (nếu module depends on other modules)
- Test fixtures

**Output:**
- Source code (`src/<module>/`)
- Unit tests (`tests/unit/<module>/`)
- Test fixtures nếu cần (`tests/fixtures/`)

**Quy tắc:**
1. Chỉ code module được assign — không sửa module khác
2. Export chỉ qua public interface đã định nghĩa
3. Viết tests TRƯỚC hoặc CÙNG LÚC với implementation (không để sau)
4. TypeScript strict mode, no `any` trừ khi Tech Lead approve
5. Không thêm dependencies ngoài danh sách SRS §3.2 mà không hỏi Tech Lead
6. Code phải pass lint + type check trước khi báo done

**Specializations (khi cần):**
- **Dev Agent — Core**: `src/core/`, `src/utils/`, `src/templates/`
- **Dev Agent — Collectors**: `src/collectors/`
- **Dev Agent — Compilers**: `src/compilers/`
- **Dev Agent — Plugin**: `src/plugin/`, `hooks/`, `commands/`, `skills/`
- **Dev Agent — Analyzers**: `src/analyzers/`
- **Dev Agent — CLI**: `src/cli/`

**Trigger:** Sau khi Tech Lead deliver module spec.

---

## 4. QA Agent — Quality Assurance / Test Engineer

**Vai trò:** Đảm bảo code đúng theo spec, tests đủ coverage, edge cases được handle.

**Input:**
- Module specs từ Tech Lead (acceptance criteria)
- Source code từ Dev Agent
- Existing tests
- SRS §11 (Testing Strategy)
- SRS §12 (Definition of Done)

**Output:**
- **Test report**: Pass/fail, coverage numbers
- **Bug reports**: Mô tả bug, steps to reproduce, expected vs actual
- **Integration test cases**: Khi modules cần work together
- **Edge case list**: Cases mà Dev Agent có thể miss

**Quy tắc:**
1. Test theo SRS §11 Testing Strategy:
   - Unit tests: mỗi function, edge cases
   - Integration tests: pipeline flows (init → collect → compile → analyze)
   - Fixture-based: dùng sample conversations, diffs từ `tests/fixtures/`
2. Check Definition of Done (SRS §12) cho mỗi module
3. Không fix bugs trực tiếp — report lại cho Dev Agent
4. Test cả happy path VÀ error paths
5. Verify templates output đúng format (frontmatter, sections, etc.)

**Trigger:** Sau khi Dev Agent báo module done. Cũng chạy integration tests khi nhiều modules done.

---

## 5. Integration Agent — System Integrator / Glue

**Vai trò:** Kết nối các modules thành pipeline hoàn chỉnh. Đảm bảo data flow đúng từ Trigger → Collector → Compiler → Knowledge Base → Analyzer.

**Input:**
- Completed modules từ Dev Agents
- Data flow diagram (SRS §4.2)
- Plugin architecture (CLAUDE.md §1)
- Integration test results từ QA

**Output:**
- **CLI wiring**: `src/cli/commands/` gọi đúng pipeline
- **Plugin wiring**: `.claude-plugin/plugin.json`, `hooks/hooks.json`, skill directories, agent definitions
- **Pipeline orchestration**: Compose modules theo correct order
- **End-to-end test scenarios**

**Quy tắc:**
1. Không viết business logic — chỉ wire modules together
2. Respect module boundaries — chỉ dùng public interfaces
3. Plugin integration theo CLAUDE.md §1.1 (`.claude-plugin/plugin.json`, NOT TypeScript export)
4. Hooks theo CLAUDE.md §1.2 (command type, stdin JSON format)
5. Test full pipeline: transcript.jsonl → ConversationParsed → SessionDebrief → .knowledge/ files

**Trigger:** Khi các modules của 1 step (trong Execution Order) đều done và pass QA.

---

## 6. Doc Agent — Documentation & Templates

**Vai trò:** Maintain templates, generate documentation, đảm bảo knowledge base output format consistent.

**Input:**
- Template specs (CLAUDE.md §4, §5, §6)
- Current template files
- User feedback on output quality

**Output:**
- Template files (`src/templates/*.md.tpl`)
- Prompt templates (`src/prompts/*.md`)
- Skill files (`skills/*/SKILL.md` — directory format)
- Command markdown files (`commands/*.md`)
- README updates (khi có feature mới)

**Quy tắc:**
1. Templates phải match EXACTLY với CLAUDE.md §4 (Concept Page) và §5 (Session Debrief)
2. Prompt templates phải follow SRS §5.4 strategy
3. Skill/command files theo Claude Code format (CLAUDE.md §1.7)
4. Giữ "Human Notes" section trong mọi concept template (P4: additive only)
5. Frontmatter phải có `status: auto-generated` field

**Trigger:** Đầu project (tạo initial templates), và khi template cần update.

---

## Development Flow

### Sprint Cycle

```
1. PM Agent: Chọn Step tiếp theo từ Execution Order
   ↓
2. PM Agent: Tạo sprint backlog với acceptance criteria
   ↓
3. Tech Lead Agent: Tách thành module specs, define interfaces
   ↓
4. Dev Agent(s): Implement song song (nếu modules độc lập)
   ↓  ← Doc Agent: Tạo/update templates nếu cần
   ↓
5. QA Agent: Test từng module
   ↓
6. Dev Agent(s): Fix bugs từ QA
   ↓
7. Integration Agent: Wire modules, run integration tests
   ↓
8. QA Agent: Integration testing
   ↓
9. PM Agent: Review deliverable vs acceptance criteria
   ↓
10. Commit & move to next Step
```

### Conflict Resolution

```
Scope question    → PM Agent quyết định (check SRS + principles)
Technical choice  → Tech Lead Agent quyết định (document rationale)
Bug vs feature    → PM Agent phân loại
Test coverage     → QA Agent recommend, Tech Lead approve threshold
```

### Iteration Protocol

Khi có yêu cầu mới hoặc thay đổi:

```
1. User → PM Agent: Yêu cầu mới
2. PM Agent: Evaluate vs current SRS
   - Nếu trong scope → thêm vào backlog, ưu tiên
   - Nếu ngoài scope → discuss với user, update SRS nếu approve
3. Tech Lead: Impact analysis — modules nào bị ảnh hưởng?
4. Dev Agent(s): Implement changes
5. QA Agent: Regression testing
6. Integration Agent: Re-verify pipelines
```

---

## Implementation: Cách Dùng Agent Team Trong Claude Code

Mỗi "agent" ở đây là một **prompt context + role** khi chúng ta work. Cách áp dụng:

### Option A: Sequential (đơn giản, recommend cho MVP)
Tôi (Claude) đóng từng vai trò theo thứ tự trong sprint cycle. Mỗi khi chuyển role, tôi announce rõ:

```
🎯 [PM] Sprint 1: Skeleton & Init
📐 [Tech Lead] Module breakdown cho Step 1...
💻 [Dev] Implementing src/core/config.ts...
🧪 [QA] Testing config module...
🔗 [Integration] Wiring CLI commands...
```

### Option B: Parallel (dùng Agent tool, cho tasks lớn)
Spawn sub-agents cho các modules độc lập:
- Agent 1: Dev — `src/core/`
- Agent 2: Dev — `src/utils/`
- Agent 3: Doc — templates

### Option C: Hybrid (recommend cho production)
- PM + Tech Lead: Sequential (cần human review)
- Dev modules: Parallel (independent work)
- QA + Integration: Sequential (depends on dev output)

---

## Bắt Đầu: Step 1 Checklist

Theo Execution Order, Step 1 là **Skeleton & Init (P0)**:

### PM Backlog:
- [ ] Project skeleton: `npm init`, `tsconfig.json`, `tsup.config.ts`
- [ ] CLI skeleton: `commander.js` setup với `bin/dkc`
- [ ] Template files: tất cả `.md.tpl` files
- [ ] `dkc init` command: full implementation theo SRS §5.1
- [ ] Unit tests cho init flow

### Tech Lead Module Breakdown:
```
src/
  index.ts                    # Public API exports
  cli/
    index.ts                  # CLI entry (commander setup)
    commands/
      init.ts                 # Init command handler
    output.ts                 # Terminal output formatter
  core/
    knowledge-base.ts         # KnowledgeBase CRUD
    config.ts                 # Config loader & defaults
    schema.ts                 # TypeScript interfaces
  templates/
    *.md.tpl                  # All template files
  utils/
    markdown.ts               # Markdown helpers
    slug.ts                   # Slugify
    date.ts                   # Date formatting
    fs.ts                     # FS helpers
```

### Definition of Done (Step 1):
1. `npm run build` succeeds
2. `npx dkc init` creates correct `.knowledge/` structure
3. All template files match CLAUDE.md §4, §5, §6
4. `npx dkc init` on existing project → skips, doesn't overwrite
5. Unit tests pass with >80% coverage cho init module
6. TypeScript strict mode, no errors
