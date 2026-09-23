# P1 学习单 · 第一批 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生能在线完成教师制作的学习单，教师能在既有看板上实时看到进度与各题正确率。

**Architecture:** 学习单是一份可复用的模板（`Worksheet`，题目存 JSON 树），通过课堂级关联表
（`ClassroomWorksheet`）或组级材料表（`ClassroomGroupMaterial(kind='worksheet')`）接入课堂；
学生的作答落到 `WorksheetResponse` + 逐题一行的 `WorksheetAnswer`，实时看板与「按题看」都从后者聚合。

**Tech Stack:** Prisma + SQLite（`server/`，ESM + TypeScript）· Next.js 15 静态导出 + React 19（`src/`）·
Socket.IO · Node 内置测试运行器。

**Spec:** `specs/2026-09-23-p1-worksheet.md` —— 计划从规格论证，执行者**两份都要读**。
**进度表:** `specs/2026-09-23-p1-worksheet-progress.md` —— 每完成一步更新它。

---

## Global Constraints

以下对整个计划生效，每个任务的要求都隐含包含本节。

1. **既有测试必须继续全过。** 基线以动手前实测为准 —— **先跑一遍并把数字记进进度表**，
   不要引用任何历史数字（P2 交接文件里的 63 pass、group-materials 的 272 pass 都已过期）。
2. **不新增任何 npm 依赖。**
3. 提交信息中文；报告、注释、过程旁白一律中文（引用的原始输出保持原样）。
4. 🔴 **绝不 `prisma db push` 打在真实库上**（`server/prisma/dev.db`）。
   需要 DDL 时把 schema 复制到 `/tmp`、`DATABASE_URL="file:/tmp/…"` 再跑，用完删掉。
5. **不要用 `reset-password` 造教师数据** —— 它内部会 `revokeAllTeacherSessions()`，
   会把用户可能开着的教师标签页登出。走 `verify-password`，或直接改库副本。
6. **只允许一个 `pnpm build` / `pnpm test` 在跑**（它们写 `dist/`、`.next/`、`out/`）。
7. 🔴 **跑 `pnpm build` 之前先 `./dev.sh stop`，跑完 `./dev.sh start`，最后 `./dev.sh status` 复核 4000/4001 都在。** 这条被踩过三次。
8. 不碰 `CLAUDE.md` / `dev.sh` / `package.json` / `release.sh`。
9. **学生端不得出现 regex lookbehind**，不得使用 `Object.hasOwn` / `structuredClone` /
   `Array.prototype.at` / `findLast` / `:has()` / `@container` / `content-visibility` / `dvh`。
   （构建期检查只扫学生端；教师端可用现代 API，但构建日志会出现「边界提示」，那不是报错。）
10. **测试若改数据库，必须逐表还原并给出证据**；造测试数据一律用 `/tmp` 下的副本库。
11. 🔴 **任何「因此不扫 / 排除 / 安全 / 可以忽略」的结论，必须附一条命令或一段实测输出。**
12. 前端逻辑保持薄，**重逻辑（判分、答案剥离、状态机）全部放服务端** —— 本项目不引入前端测试框架。

---

## 文件结构

### 新增

| 文件 | 职责 |
|---|---|
| `server/src/services/worksheet-schema.ts` | 4 张新表的建表 DDL + 幂等探测（供 `index.ts` 调用，**独立成文件才能被测试**） |
| `server/src/services/worksheet-questions.ts` | 题型注册表：`grade()`、填空归一化、`stripAnswers()`、编辑期校验 |
| `server/src/routes/worksheets.ts` | 教师端 CRUD / duplicate / usage + 学生端 `student-view` / 作答 / 提交 / 已查看 |
| `src/app/teacher/worksheets/page.tsx` | 列表页（薄） |
| `src/app/teacher/worksheets/use-worksheet-list.ts` | 列表页状态（含删除守卫） |
| `src/app/teacher/worksheets/edit/page.tsx` | 编辑页（薄） |
| `src/app/teacher/worksheets/edit/use-worksheet-editor.ts` | 编辑器状态：content reducer + undo 栈 + 自动保存 |
| `src/app/teacher/worksheets/edit/question-card.tsx` | 单题卡片（题干 / 选项 / 答案 / ▲▼🗑） |
| `src/app/teacher/worksheets/edit/preview-modal.tsx` | 按 iPad 宽度渲染的预览弹窗 |
| `src/app/classroom/shell/use-module-viewport.ts` | ★ 公共 iOS 键盘 / viewport hook（chat 与学习单共用） |
| `src/app/classroom/worksheet/worksheet-panel.tsx` | 学生端学习单面板 |
| `src/app/classroom/worksheet/use-worksheet-answers.ts` | 作答状态 + localStorage 离线队列 + 防抖保存 |
| `src/app/classroom/worksheet/reward-badge.tsx` | 奖励符号的呈现（对错 / ⭐ / 🌸 / 分数） |
| `src/app/teacher/classroom/worksheet-tiles.tsx` | 看板格子的学习单内容区（四态） |
| `src/app/teacher/classroom/worksheet-drawer.tsx` | 抽屉的两种形态（按学生 / 按题） |

### 修改

| 文件 | 改动 |
|---|---|
| `server/prisma/schema.prisma` | 4 张新表 + `Classroom` / `ClassroomStudent` 各补反向关系字段 |
| `server/src/index.ts` | 调 `ensureWorksheetTables()`；注册 `/api/worksheets` |
| `server/src/services/group-material-resolve.ts` | `kind` 加 `'worksheet'`；`GroupMaterialView` 加 `worksheet` |
| `server/src/routes/classroom.ts` | 两处 `worksheet: 0` 改真数字；高级模式写 `kind='worksheet'`；读路径下发 |
| `server/src/socket/index.ts` | 作答保存后广播（含 `questionId`） |
| `src/lib/api.ts` · `src/lib/types.ts` | 新端点与类型 |
| `src/lib/classroom-modules.ts` | 无改动（`worksheet` 映射已在） |
| `src/app/classroom/shell/classroom-shell.tsx` | 学习单面板替掉 `ModulePlaceholder` |
| `src/app/classroom/chat/chat-panel.tsx` · `chat.module.css` | 改用公共 hook 与共享 CSS 变量 |
| `src/app/teacher/classroom/page.tsx` | `case 'worksheet'` 换真内容；徽章行「N 轮」→「已看 N/M」 |
| `src/app/teacher/classroom/new/page.tsx` | 每组第三个下拉 |
| `src/app/teacher/page.tsx` | 「作答反馈」全局设置分组 |

---

# 阶段 A — 服务端地基

### Task A1: 数据模型与建表

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/src/services/worksheet-schema.ts`
- Modify: `server/src/index.ts`（在 schema 同步块**靠前**位置调用）
- Test: `server/src/tests/worksheet-schema.test.ts`

**Interfaces:**
- Produces: `ensureWorksheetTables(prisma: PrismaClient): Promise<{ created: string[] }>` ——
  幂等地建 4 张表，返回本次真正建了哪些（用于测试断言与日志）。

- [ ] **Step 1: 改 `schema.prisma`**

  按规格 §4.1 加 4 个 model。**逐字使用规格 §4.1.2 的 DDL 对应的 Prisma 定义**，
  并在 `Classroom` 的 `webapps ClassroomWebapp[]` 之后补两行、在 `ClassroomStudent` 的
  `messages Message[]` 之后补一行（规格 §4.1.1）。

- [ ] **Step 2: 验证 schema 合法**

  ```bash
  cd server
  cp prisma/schema.prisma /tmp/wsv-schema.prisma
  DATABASE_URL="file:/tmp/wsv.db" npx prisma db push --schema=/tmp/wsv-schema.prisma --skip-generate
  ```

  Expected: `Your database is now in sync with your Prisma schema.`
  若报 `P1012 … missing an opposite relation field` ⇒ 反向关系没补全，回 Step 1。

- [ ] **Step 3: 把权威 DDL 与刚 dump 出来的对比**

  ```bash
  sqlite3 /tmp/wsv.db ".schema Worksheet" ".schema ClassroomWorksheet" ".schema WorksheetResponse" ".schema WorksheetAnswer"
  ```

  Expected: 与规格 §4.1.2 **逐字一致**。不一致就以本次 dump 为准，**同时更新规格**（两边分叉比抄错更糟）。

- [ ] **Step 4: 写失败的测试**

  ```ts
  // server/src/tests/worksheet-schema.test.ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { execFileSync } from 'node:child_process';
  import fs from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  import { PrismaClient } from '@prisma/client';
  import { ensureWorksheetTables } from '../services/worksheet-schema.js';

  /** 造一个「老库」：把 4 张新表 DROP 掉，模拟升级前的形状。 */
  function makeLegacyDb(file: string) {
    fs.copyFileSync(new URL('../../prisma/dev.db', import.meta.url).pathname, file);
    const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    return db;
  }

  test('在缺表的库上建出 4 张表，且第二次调用不重复建', async () => {
    const file = path.join(os.tmpdir(), `wsv-${process.pid}-${Date.now()}.db`);
    const db = makeLegacyDb(file);
    // 先制造「老库」形状：确保表不存在
    for (const t of ['WorksheetAnswer', 'WorksheetResponse', 'ClassroomWorksheet', 'Worksheet']) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
    }
    const first = await ensureWorksheetTables(db);
    assert.deepEqual(first.created.sort(), ['ClassroomWorksheet', 'Worksheet', 'WorksheetAnswer', 'WorksheetResponse']);
    const second = await ensureWorksheetTables(db);
    assert.deepEqual(second.created, [], '第二次调用必须什么都不建');
    // DDL 必须与 Prisma 的输出一致：用 sqlite_master 比对具名约束
    const ddl = await db.$queryRawUnsafe<{ sql: string }[]>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='WorksheetResponse'`);
    assert.match(ddl[0].sql, /WorksheetResponse_worksheetId_fkey.*ON DELETE RESTRICT/);
    assert.match(ddl[0].sql, /WorksheetResponse_participantId_fkey.*ON DELETE CASCADE/);
    await db.$disconnect();
    fs.rmSync(file, { force: true });
  });
  ```

- [ ] **Step 5: 跑测试确认失败**

  Run: `cd server && node --test dist/tests/worksheet-schema.test.js`（先 `pnpm build:server`）
  Expected: FAIL —— `ensureWorksheetTables` 不存在 / 模块找不到。

- [ ] **Step 6: 实现 `worksheet-schema.ts`**

  ```ts
  import type { PrismaClient } from '@prisma/client';

  /**
   * 4 张新表的建表 DDL。
   *
   * 🔴 **必须与 `prisma db push` 到空库后 dump 出来的输出逐字一致** —— 否则桌面版下次
   * `db push` 会再重建一次，而 `index.ts` 里按 `sqlite_master` 探测的同步块不会重跑，
   * 两边分叉。DDL 来源见规格 §4.1.2（在 /tmp 探针库上 dump，不碰真实库）。
   *
   * 建表顺序 = 外键依赖顺序：Worksheet 无依赖，ClassroomWorksheet 依赖它，
   * WorksheetResponse 依赖 Classroom / Worksheet / ClassroomStudent，WorksheetAnswer 最后。
   */
  const TABLES: Array<{ name: string; statements: string[] }> = [
    { name: 'Worksheet', statements: [`CREATE TABLE "Worksheet" (…逐字取自规格 §4.1.2…)`] },
    { name: 'ClassroomWorksheet', statements: [
      `CREATE TABLE "ClassroomWorksheet" (…)`,
      `CREATE INDEX "ClassroomWorksheet_worksheetId_idx" ON "ClassroomWorksheet"("worksheetId")`,
      `CREATE UNIQUE INDEX "ClassroomWorksheet_classroomId_worksheetId_key" ON "ClassroomWorksheet"("classroomId", "worksheetId")`,
    ] },
    { name: 'WorksheetResponse', statements: [`CREATE TABLE "WorksheetResponse" (…)`, `CREATE INDEX …`, `CREATE UNIQUE INDEX …`] },
    { name: 'WorksheetAnswer', statements: [`CREATE TABLE "WorksheetAnswer" (…)`, `CREATE INDEX …`, `CREATE UNIQUE INDEX …`] },
  ];

  /**
   * 幂等地建出学习单相关的 4 张表。
   *
   * 探测用 `sqlite_master` 而不是 `PRAGMA table_info`：这几张是**新表**，
   * 不存在「表在但缺列」的中间态；用表名探测更直接，也让「第二次调用不重复建」可断言。
   */
  export async function ensureWorksheetTables(prisma: PrismaClient): Promise<{ created: string[] }> {
    const created: string[] = [];
    for (const table of TABLES) {
      const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table.name);
      if (rows.length > 0) continue;
      for (const sql of table.statements) await prisma.$executeRawUnsafe(sql);
      created.push(table.name);
    }
    if (created.length > 0) console.log(`[server] 学习单表已创建：${created.join(', ')}`);
    return { created };
  }
  ```

  ⚠️ 上面每个 `CREATE TABLE` 的括号内容**必须逐字抄规格 §4.1.2**，不要改写格式。

- [ ] **Step 7: 挂进 `index.ts`**

  在 schema 同步块的最前面（`ClassroomModule` 那段之前）插入：

  ```ts
  try {
    await ensureWorksheetTables(prisma);
  } catch (error) {
    console.warn('[server] 学习单建表失败，学习单功能可能不可用：', error);
  }
  ```

  **位置理由**（照抄 `ClassroomModule` 那段注释的同一套论证）：排在所有 legacy 条件语句
  **之前**，这样后面任一条老语句抛错都不会让这 4 张表没机会建。

- [ ] **Step 8: 跑测试确认通过**

  Run: `cd server && pnpm build && node --test dist/tests/worksheet-schema.test.js`
  Expected: PASS（1 pass）。

- [ ] **Step 9: 迁移真实库并验证据**

  ```bash
  ./dev.sh stop
  ./dev.sh start && sleep 3 && ./dev.sh logs | grep -i "学习单表已创建"
  sqlite3 server/prisma/dev.db ".tables" | tr ' ' '\n' | grep -E "^(Worksheet|ClassroomWorksheet|WorksheetResponse|WorksheetAnswer)$"
  ./dev.sh status
  ```

  Expected: 4 张表名都出现；4000 / 4001 都在。**把输出粘进进度表。**

- [ ] **Step 10: 提交**

  ```bash
  git add server/prisma/schema.prisma server/src/services/worksheet-schema.ts server/src/index.ts server/src/tests/worksheet-schema.test.ts
  git commit -m "feat(server): 学习单四张表与幂等建表"
  ```

---

### Task A2: 题型注册表与判分

**Files:**
- Create: `server/src/services/worksheet-questions.ts`
- Test: `server/src/tests/worksheet-grade.test.ts`

**Interfaces:**
- Produces:
  - `type QuestionType = 'single-choice' | 'fill-blank' | 'short-answer'`
  - `interface QuestionNode { id: string; type: QuestionType; prompt: string; inputMode: 'keyboard'|'handwriting'; data: Record<string, unknown>; children: QuestionNode[] }`
  - `interface WorksheetContent { schemaVersion: number; nodes: QuestionNode[] }`
  - `flattenQuestions(content: WorksheetContent): QuestionNode[]` —— 深度优先展开（第一批没有容器，但结构已预留）
  - `stripAnswers(content: WorksheetContent): WorksheetContent` —— ★ 服务端剥离答案，返回**新对象**
  - `grade(node: QuestionNode, value: unknown): boolean | null` —— `null` = 该题型不判分
  - `normalizeFillText(raw: string): string`
  - `validateQuestion(node: QuestionNode): string[]` —— 编辑期校验，返回中文错误

- [ ] **Step 1: 写失败的测试**

  ```ts
  // server/src/tests/worksheet-grade.test.ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { grade, normalizeFillText, stripAnswers, type QuestionNode, type WorksheetContent } from '../services/worksheet-questions.js';

  const choice: QuestionNode = { id: 'q1', type: 'single-choice', prompt: '…', inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'] }, children: [] };
  const fill: QuestionNode = { id: 'q2', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: ['光合作用', '光合作用作用'] }, children: [] };
  const short: QuestionNode = { id: 'q3', type: 'short-answer', prompt: '…', inputMode: 'keyboard',
    data: {}, children: [] };

  test('单选：选中正确键即对，多选不给分', () => {
    assert.equal(grade(choice, { format: 'choice/v1', selected: ['B'] }), true);
    assert.equal(grade(choice, { format: 'choice/v1', selected: ['A'] }), false);
    assert.equal(grade(choice, { format: 'choice/v1', selected: ['A', 'B'] }), false);
    assert.equal(grade(choice, { format: 'choice/v1', selected: [] }), false);
  });

  test('填空：任一可接受答案即对', () => {
    assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用' }), true);
    assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用作用' }), true);
    assert.equal(grade(fill, { format: 'fill/v1', text: '呼吸作用' }), false);
  });

  test('归一化：去首尾空格、全角转半角、折叠连续空格', () => {
    assert.equal(normalizeFillText('  光合作用  '), '光合作用');
    assert.equal(normalizeFillText('ＡＢＣ'), 'ABC');
    assert.equal(normalizeFillText('光合  作用'), '光合 作用');
    assert.equal(normalizeFillText('光合\t作用'), '光合 作用');
  });

  test('🔴 归一化不做大小写不敏感 —— 化学式必须区分', () => {
    assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用'.toLowerCase() }), false);
  });

  test('问答题永远不判分', () => {
    assert.equal(grade(short, { format: 'text/v1', text: '随便' }), null);
  });

  test('🔴 stripAnswers 剥掉答案，且不改原对象', () => {
    const content: WorksheetContent = { schemaVersion: 1, nodes: [choice, fill, short] };
    const stripped = stripAnswers(content);
    const json = JSON.stringify(stripped);
    assert.ok(!json.includes('correctKeys'), 'correctKeys 必须被剥掉');
    assert.ok(!json.includes('answers'), 'answers 必须被剥掉');
    assert.equal(JSON.stringify(content).includes('correctKeys'), true, '原对象不得被改动');
    assert.equal(stripped.nodes.length, 3, '题数与题序不变');
    assert.equal(stripped.nodes[0].prompt, choice.prompt, '题干保留');
  });
  ```

- [ ] **Step 2: 跑测试确认失败**

  Run: `cd server && pnpm build && node --test dist/tests/worksheet-grade.test.js`
  Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `worksheet-questions.ts`**

  ```ts
  /** 学习单的题型注册表。**纯函数，全部在服务端** —— 本项目不引入前端测试框架（规格 §11）。 */

  export type QuestionType = 'single-choice' | 'fill-blank' | 'short-answer';

  export interface QuestionNode {
    id: string;
    type: QuestionType;
    prompt: string;
    inputMode: 'keyboard' | 'handwriting';
    data: Record<string, unknown>;
    children: QuestionNode[];
  }
  export interface WorksheetContent { schemaVersion: number; nodes: QuestionNode[] }

  /**
   * 填空题的文本归一化。
   *
   * 🔴 **刻意不做大小写不敏感**（规格 §3-T）：化学式 / 英文填空的大小写是语义的一部分，
   * 把 `CO2` 判成 `co2` 正确比不判更糟。英文题请教师在 `answers` 里多列几个写法。
   */
  export function normalizeFillText(raw: string): string {
    return raw
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))  // 全角→半角
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 深度优先展开题目（第一批没有容器节点，但 content 是树，遍历写成递归不会过时）。 */
  export function flattenQuestions(content: WorksheetContent): QuestionNode[] {
    const out: QuestionNode[] = [];
    const walk = (nodes: QuestionNode[]) => {
      for (const node of nodes) { out.push(node); walk(node.children ?? []); }
    };
    walk(content.nodes ?? []);
    return out;
  }

  /** 答案字段的键名。**唯一来源** —— stripAnswers 与各题型共用，防止漏剥一个。 */
  const ANSWER_KEYS = ['correctKeys', 'answers', 'explanation'] as const;

  /**
   * 剥离答案 —— 学生端 `student-view` 的唯一过滤点（规格 §5.4）。
   *
   * 🔴 **必须在服务端做，且必须返回新对象**：前端过滤等同于未过滤；就地改动会让
   * 后续复用同一份 content 的代码拿到已经被破坏的数据。
   */
  export function stripAnswers(content: WorksheetContent): WorksheetContent {
    const stripNode = (node: QuestionNode): QuestionNode => {
      const data: Record<string, unknown> = { ...node.data };
      for (const key of ANSWER_KEYS) delete data[key];
      return { ...node, data, children: (node.children ?? []).map(stripNode) };
    };
    return { ...content, nodes: (content.nodes ?? []).map(stripNode) };
  }

  /** 判分。返回 `null` 表示该题型不参与判分（主观题）。 */
  export function grade(node: QuestionNode, value: unknown): boolean | null {
    if (node.type === 'short-answer') return null;
    const v = (value ?? {}) as { selected?: unknown; text?: unknown };
    if (node.type === 'single-choice') {
      const correct = Array.isArray(node.data.correctKeys) ? (node.data.correctKeys as string[]) : [];
      const selected = Array.isArray(v.selected) ? (v.selected as string[]) : [];
      return selected.length === 1 && correct.length === 1 && selected[0] === correct[0];
    }
    if (node.type === 'fill-blank') {
      const answers = Array.isArray(node.data.answers) ? (node.data.answers as string[]) : [];
      if (typeof v.text !== 'string') return false;
      const normalized = normalizeFillText(v.text);
      return answers.some((answer) => normalizeFillText(answer) === normalized);
    }
    return null;
  }

  /** 编辑期校验。返回中文错误列表，空数组表示通过。 */
  export function validateQuestion(node: QuestionNode): string[] {
    const errors: string[] = [];
    if (!node.prompt.trim()) errors.push('题干不能为空');
    if (node.type === 'single-choice') {
      const options = Array.isArray(node.data.options) ? (node.data.options as unknown[]) : [];
      const correct = Array.isArray(node.data.correctKeys) ? (node.data.correctKeys as string[]) : [];
      if (options.length < 2) errors.push('单选题至少需要两个选项');
      if (correct.length !== 1) errors.push('单选题必须且只能指定一个正确答案');
    }
    if (node.type === 'fill-blank') {
      const answers = Array.isArray(node.data.answers) ? (node.data.answers as string[]) : [];
      if (!answers.some((a) => typeof a === 'string' && a.trim())) errors.push('填空题至少要有一个可接受的答案');
    }
    return errors;
  }
  ```

- [ ] **Step 4: 跑测试确认通过**

  Run: `cd server && pnpm build && node --test dist/tests/worksheet-grade.test.js`
  Expected: PASS（6 pass）。

- [ ] **Step 5: 反证 —— 证明归一化那两条测试真的在区分**

  临时把 `normalizeFillText` 里的全角转换那行注释掉，重跑：
  Expected: `归一化` 那条 **FAIL**。改回来，再跑一次 PASS。
  **把这次反证的命令与输出记进进度表** —— 「通过」的对照本身也要被验证过。

- [ ] **Step 6: 提交**

  ```bash
  git add server/src/services/worksheet-questions.ts server/src/tests/worksheet-grade.test.ts
  git commit -m "feat(server): 学习单题型注册表与判分"
  ```

---

# 阶段 B — 服务端接口

### Task B1: 教师端 CRUD、守卫与鉴权

**Files:**
- Create: `server/src/routes/worksheets.ts`
- Modify: `server/src/index.ts`（注册）
- Test: `server/src/tests/worksheet-routes.test.ts`

**Interfaces:**
- Consumes: `stripAnswers` / `validateQuestion` / `flattenQuestions`（A2）
- Produces: HTTP 端点（规格 §5.3）。老师端：`GET /`（列表，`?page&pageSize&search`）、
  `GET /:id`、`POST /`、`PUT /:id`、`DELETE /:id`、`POST /:id/duplicate`、`GET /:id/usage`。

- [ ] **Step 1: 写失败的测试（守卫是重点）**

  ```ts
  // server/src/tests/worksheet-routes.test.ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  // 复用 classroom-webapp-link.test.ts 的临时库搭建方式（读那个文件照抄，不要另发明一套）
  ```

  必测四条：
  1. **只被组级引用**的学习单 ⇒ `/usage` 的 `used` 为真、`DELETE` 被 400 拦下（**这是新的那条，最容易漏**）
  2. 有**历史 `WorksheetResponse`** ⇒ `DELETE` 被拦下，且文案里带「已收到 K 份作答」（规格 §5.5）
  3. `duplicate` 深拷贝：改副本的 content **不影响**原件（逐字比对原件 content）
  4. 学生 token 访问教师端端点 ⇒ 403（不是 401）

- [ ] **Step 2: 跑测试确认失败**

  Run: `cd server && pnpm build && node --test dist/tests/worksheet-routes.test.js`
  Expected: FAIL。

- [ ] **Step 3: 实现路由**

  要点（其余照 `routes/webapps.ts` 的形状）：

  ```ts
  /**
   * 学习单路由。
   *
   * 鉴权在 index.ts 注册时分层（本项目约定：路由自身不加重认证）——
   * 但本路由**混装**教师端与学生端，所以注册处的那段中间件是安全的关键，
   * 见 index.ts 里 `app.use('/api/worksheets', …)` 的注释。
   */

  /**
   * 删除守卫要数**三样**，不是两样（规格 §5.5）：
   *   ① 课堂级关联 `ClassroomWorksheet`
   *   ② 组级材料 `ClassroomGroupMaterial(kind='worksheet')`
   *   ③ **历史作答 `WorksheetResponse`**
   *
   * 🔴 ③ 不是可选的：Prisma 对必填关系默认 `ON DELETE RESTRICT`（权威 DDL 里
   * `WorksheetResponse_worksheetId_fkey` 就是 RESTRICT）⇒ 只数前两样会给出
   * 「没在用」的 400，然后数据库拒绝 —— 一个**说谎的 400**。
   * 文案要给出出路：编辑 / 复制一份，而不是一句「不能删除」。
   */
  async function worksheetUsage(prisma: PrismaClient, worksheetId: string) {
    const [classroomLinks, groupLinks, responses] = await Promise.all([
      prisma.classroomWorksheet.findMany({ where: { worksheetId }, include: { classroom: { select: { id: true, title: true, status: true } } } }),
      prisma.classroomGroupMaterial.findMany({ where: { kind: 'worksheet', targetId: worksheetId }, include: { group: { include: { classroom: { select: { id: true, title: true, status: true } } } } } }),
      prisma.worksheetResponse.count({ where: { worksheetId } }),
    ]);
    // …合并成 classrooms[]（去重）+ responseCount
  }
  ```

  **`duplicate` 必须深拷贝**：`content` 与 `settings` 都走 `structuredClone` 的等价物
  （服务端 Node 24 有 `structuredClone`，可直接用；这条限制只针对学生端前端）。
  标题加后缀 `（副本）`。

- [ ] **Step 4: 在 `index.ts` 注册（★ 安全关键）**

  ```ts
  // 学习单：教师端 CRUD + 学生端 student-view / 作答 / 提交，**同一条路由混装**。
  // 学生只放行三种形状，其余一律回落到 requireTeacher：
  //   · GET  /:id/student-view      读自己那一份（服务端已剥离答案）
  //   · PUT  /:id/answers           保存单题（幂等）
  //   · POST /:id/answers/submit    提交单题
  // ⚠️ 路由处理器**内部**还必须校验：该学生所属参与者的学习单解析结果 `=== :id`。
  //    这里只校验「是本课堂的学生」，不够 —— 高级模式下不同组拿的是不同的学习单。
  // ⚠️ 「已查看」是 `POST /:id/review`，**不在**上面三种形状里 ⇒ 自然走 requireTeacher。
  //    改动这段正则时务必确认它仍然不匹配 review。
  app.use('/api/worksheets', (req, res, next) => {
    const student = getStudentSession(req);
    if (student) {
      const view = req.method === 'GET' && /^\/[^/]+\/student-view\/?$/.test(req.path);
      const save = req.method === 'PUT' && /^\/[^/]+\/answers\/?$/.test(req.path);
      const submit = req.method === 'POST' && /^\/[^/]+\/answers\/submit\/?$/.test(req.path);
      if (view || save || submit) return next();
    }
    requireTeacher(req, res, next);
  }, worksheetRoutes);
  ```

- [ ] **Step 5: 跑测试确认通过**

  Run: `cd server && pnpm build && node --test dist/tests/worksheet-routes.test.js`
  Expected: PASS。

- [ ] **Step 6: 反证 —— 证明鉴权那段真的在拦**

  临时把中间件改成无条件 `next()`，重跑 Step 1 的第 4 条：
  Expected: **FAIL**（学生 token 拿到了教师端数据）。改回来。
  **记录进进度表。**

- [ ] **Step 7: 提交**

  ```bash
  git add server/src/routes/worksheets.ts server/src/index.ts server/src/tests/worksheet-routes.test.ts
  git commit -m "feat(server): 学习单路由、删除守卫与分层鉴权"
  ```

---

### Task B2: 课堂关联

**Files:**
- Modify: `server/src/services/group-material-resolve.ts`
- Modify: `server/src/routes/classroom.ts`
- Test: `server/src/tests/group-material-resolve.test.ts`（扩充）

**Interfaces:**
- Consumes: 无（纯扩展现有函数）
- Produces: `resolveMaterialTargetId({ …, kind: 'agent' | 'webapp' | 'worksheet' })`；
  `GroupMaterialView` 加 `worksheet: { id: string; title: string } | null`。

- [ ] **Step 1: 扩充测试**

  在现有 `group-material-resolve.test.ts` 里加 `kind: 'worksheet'` 的逐组合断言：
  `advanced` + 自己组有 / 自己组无 / 找不到组 / `group` / `standard`。
  **「自己组无」必须带反证**：课堂级数组里故意放一份**别的组的**，断言学生**没拿到它**。

- [ ] **Step 2: 跑测试确认失败**

  Expected: FAIL —— TS 不接受 `kind: 'worksheet'`。

- [ ] **Step 3: 扩展 `group-material-resolve.ts`**

  - `kind` 联合类型加 `'worksheet'`
  - `GroupMaterialView` 加 `worksheet` 字段
  - `resolveGroupMaterialViews` 加一条 `worksheet` 的 `in` 查询（**第三条，与组数无关**）

- [ ] **Step 4: 改 `routes/classroom.ts`**

  1. **两处三件套判据**（`classroomMaterialError` 调用点）：
     - 标准/分组（现 `worksheet: 0`）⇒ 该课堂的 `ClassroomWorksheet` 行数（0 或 1）
     - 高级 ⇒ `normalizedGroups.filter(g => g.worksheetId).length`
  2. **高级模式创建**：`for (const [kind, targetId] of …)` 那个数组加 `['worksheet', group.worksheetId]`；
     入参 `groups[].worksheetId` 走与 `webappId` **同一套**归一化（空串/缺字段 ⇒ `null`）
  3. **标准/分组创建**：`ClassroomWorksheet` 写入，`createdAt` 用与 `webappLinkRows` **同一条**
     「按勾选顺序写严格递增时间戳」的处理（否则排序落到 uuid 字典序，学生打开的跟教师以为的不是同一份）
  4. **读路径**：`GET /code/:code`、`GET /:id`、`GET /all`、`GET /active` 与 `join-classroom`
     的 `groups[].materials` 都带上 `worksheet`

- [ ] **Step 5: 跑测试确认通过**

  Run: `cd server && pnpm build && pnpm test`
  Expected: 全过（与基线比对）。

- [ ] **Step 6: 提交**

  ```bash
  git add server/src/services/group-material-resolve.ts server/src/routes/classroom.ts server/src/tests/
  git commit -m "feat(server): 学习单接入课堂关联与组级材料"
  ```

---

### Task B3: 学生端读取、作答与判分

**Files:**
- Modify: `server/src/routes/worksheets.ts`
- Test: `server/src/tests/worksheet-student.test.ts`

**Interfaces:**
- Consumes: `stripAnswers` / `grade` / `flattenQuestions`（A2）；`resolveMaterialTargetId`（B2）
- Produces: `GET /:id/student-view`、`PUT /:id/answers`、`POST /:id/answers/submit`

- [ ] **Step 1: 写失败的测试**

  1. 🔴 **`student-view` 返回的 JSON 不含任何答案字段**（断言整串 `!includes('correctKeys')` 与 `!includes('answers')`）
  2. **越权**：学生 A 读 B 组那份的 `student-view` ⇒ 403
  3. **越权**：学生 A 往 B 组那份提交 ⇒ 403
  4. `PUT` 幂等：同一 `(participant, worksheet, questionId)` 连续两次 ⇒ 只有一行，`value` 是后一次
  5. 提交时判分：`autoGrade` 关 ⇒ `isCorrect` 为 `null`；开 ⇒ 客观题有值、问答题恒 `null`
  6. `allowResubmit` 为真时，改已提交的题 ⇒ `status` 回到 `draft`

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

  ```
  GET /:id/student-view
    ① 解析该 token 的参与者 → 其学习单解析结果（resolveMaterialTargetId(kind='worksheet')）
    ② 断言 === req.params.id，不等则 403（不是 404 —— 404 会让「不是这一份」与「不存在」混淆）
    ③ 返回 { id, title, description, content: stripAnswers(content), settings: { allowResubmit, autoGrade } }
       ⚠️ 只返回学生需要的 settings 子集，不要把整个 settings 原样丢出去

  PUT /:id/answers     body { questionId, value }
    ① 权限同 ②
    ② 校验 questionId 属于该 content（flattenQuestions 里找得到），否则 400
    ③ upsert WorksheetAnswer：value、status='draft'、submittedAt=null
    ④ 同时 upsert WorksheetResponse：status='in-progress'、startedAt ??= now
    ⑤ 广播（B4 里接）

  POST /:id/answers/submit   body { questionId }
    ① 权限、questionId 校验同上
    ② autoGrade 开 ⇒ isCorrect = grade(node, value)（问答题得 null）
    ③ status='submitted'、submittedAt=now
    ④ 全部题都 submitted ⇒ WorksheetResponse.status='submitted'、submittedAt=now
    ⑤ 返回 { isCorrect } —— **不含 score**（规格 §3-S）
  ```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 反证 —— 答案剥离**

  临时把 `stripAnswers` 换成恒等函数，重跑 Step 1 的第 1 条：
  Expected: **FAIL**。改回来。**记录进进度表。**

- [ ] **Step 6: 提交**

  ```bash
  git commit -m "feat(server): 学生端学习单读取、作答与判分"
  ```

---

### Task B4: 「已查看」与实时广播

**Files:**
- Modify: `server/src/routes/worksheets.ts` · `server/src/socket/index.ts`
- Test: `server/src/tests/worksheet-realtime.test.ts`

**Interfaces:**
- Produces:
  - `POST /:id/review` body `{ participantId, questionId }`（**教师专用**）
  - socket 事件 `worksheet-answer-updated`：`{ classroomId, participantId, questionId, status, isCorrect, reviewedAt }`
    发给房间 `classroom:<id>`

- [ ] **Step 1: 写失败的测试**

  1. `review` 用学生 token ⇒ 403（这个端点**不在**学生放行的三种形状里）
  2. `review` 设 `reviewedAt`；再次调用 ⇒ 更新为新时间
  3. 保存作答后，房间 `classroom:<id>` 收到 `worksheet-answer-updated`，**载荷含 `questionId`**
     （看板的「正在做第 N 题」靠它，缺了这条链就断）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

  ⚠️ 在 `index.ts` 那段中间件的注释里已经写明：`/^\/[^/]+\/review\/?$/` 不匹配任何学生形状。
  实现后**回到那段注释核对一遍**，确认改动没有让 review 落进学生放行集。

- [ ] **Step 4: 跑测试确认通过 · 提交**

  ```bash
  git commit -m "feat(server): 学习单已查看标记与实时广播"
  ```

---

# 阶段 C — 教师端

### Task C1: 列表页 `/teacher/worksheets/`

**Files:**
- Create: `src/app/teacher/worksheets/page.tsx` · `use-worksheet-list.ts`
- Modify: `src/lib/api.ts` · `src/lib/types.ts`

**Interfaces:**
- Consumes: B1 的端点
- Produces: `api.getWorksheets()` / `createWorksheet` / `updateWorksheet` / `deleteWorksheet` / `duplicateWorksheet` / `getWorksheetUsage`

- [ ] **Step 1: 加 API 与类型**（`src/lib/api.ts` 与 `src/lib/types.ts`，照 `WebappSummary` 那一组写）

- [ ] **Step 2: 写列表页**

  **照 `src/app/teacher/webapps/page.tsx` 的形状**（薄 page + controller hook + 卡片 + overlays + `Toast` + `Pagination`）。
  与它不同的地方只有三处：

  1. 卡片点的动作是**跳转到编辑页** `/teacher/worksheets/edit/?id=`，不是打开表单弹窗
  2. 「新建」也跳编辑页（`?id=` 缺省）
  3. 删除守卫的文案要区分三种引用（规格 §5.5）：课堂引用 / 组级引用 / **历史作答 K 份**，
     并给出出路（编辑 / 复制一份）

- [ ] **Step 3: 门禁**

  ```bash
  npx tsc --noEmit && npx eslint src/app/teacher/worksheets/
  ```
  Expected: 退出 0。

- [ ] **Step 4: 提交**

  ```bash
  git commit -m "feat(teacher): 学习单列表页"
  ```

---

### Task C2: 编辑器页（最大的一块）

**Files:**
- Create: `src/app/teacher/worksheets/edit/page.tsx` · `use-worksheet-editor.ts` · `question-card.tsx` · `preview-modal.tsx`

**Interfaces:**
- Consumes: C1 的 API
- Produces: 编辑器；`content` 的形状必须与 A2 的 `WorksheetContent` 一致

- [ ] **Step 1: content reducer（含 undo 栈）**

  ```ts
  /**
   * content 的唯一写入口。所有改动都经 reducer，**撤销栈才可能正确** ——
   * 散落 setState 的第一处就是 undo 开始漏的地方。
   *
   * 题目 id 用 `crypto.randomUUID()` 生成一次，此后**不随位置变化**
   * （规格 §3-P：答案按 questionId 关联，改序不能让已答数据错位）。
   */
  type Action =
    | { kind: 'add'; questionType: QuestionType }
    | { kind: 'updatePrompt'; id: string; prompt: string }
    | { kind: 'updateData'; id: string; patch: Record<string, unknown> }
    | { kind: 'move'; id: string; delta: -1 | 1 }
    | { kind: 'remove'; id: string }
    | { kind: 'undo' } | { kind: 'redo' };
  ```

- [ ] **Step 2: 三种题型的卡片**

  - **单选题**：题干 textarea + 选项列表（增删改）+ 正确答案单选
  - **填空题**：题干 + 「答案」textarea，**一行一个可接受答案**（规格 §3-R）
  - **问答题**：题干

  **第一批没有 ⚙**（规格 §6.2）。

- [ ] **Step 3: 撤销重做 + 自动保存**

  - `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` + 顶栏两个按钮
  - 每 10 秒或失焦写 `localStorage`，键 `worksheet-draft:<id|new>`；**不写服务端**（规格 §3-Y）
  - 打开编辑页时若 localStorage 有更新的草稿 ⇒ 顶部提示「发现未保存的草稿，[恢复] [丢弃]」

- [ ] **Step 4: 设置面板 + 预览**

  - 「设置」：描述、**自动判分**、**提交后可否修改**（规格 §6.3）
  - 「预览」：弹窗，**按 iPad 宽度（768px）渲染**学生端 `Answer` 组件

- [ ] **Step 5: 被使用时警告**

  保存前查 `/usage`；有引用时顶栏挂 `⚠ 本单正在被 N 堂课使用 · 保存后学生端会立即看到变化`；
  **删题**时另弹确认，文案含已收到的作答份数（规格 §6.4）。

- [ ] **Step 6: 门禁 + 提交**

  ```bash
  npx tsc --noEmit && npx eslint src/app/teacher/worksheets/
  git commit -m "feat(teacher): 学习单编辑器"
  ```

---

### Task C3: 创建页第三个下拉

**Files:**
- Modify: `src/app/teacher/classroom/new/page.tsx`

**Interfaces:**
- Consumes: B2 的创建端点（`groups[].worksheetId`）

- [ ] **Step 1: 加 `groupWorksheetIds`**

  与现有 `groupAgentIds` / `groupWebappIds` **同构**（`Record<ClassGroupId, string | null>`），
  并扩展 `allDecided`：

  ```ts
  const allDecided = classGroups.every(
    (g) => g.id in groupAgentIds && g.id in groupWebappIds && g.id in groupWorksheetIds,
  );
  ```

  ⚠️ 「不指定」用 `null`、**键不存在**表示未选 —— 写回 `''` 会让上面的 `in` 判断把
  「不指定」判成「没配置」而拦住提交，功能等于没做（`p2-group-materials.md` §4.8 已写明）。

- [ ] **Step 2: 重做每组那一行的排布**

  🔴 三个下拉**并排塞进去会明显变挤**（`p2-group-materials.md` §4.8 明确要求重新设计）。
  **必须先出效果再改代码**：先截一张当前两个下拉的图，改完再截一张对比，把两张都贴进进度表。

- [ ] **Step 3: 标准/分组模式的课堂级学习单下拉**

  与现有 `selectedWebappId` 同构，加 `selectedWorksheetId`；提交时随请求发出。

- [ ] **Step 4: 端到端手测**

  三种模式各建一堂：标准（全班一份）、分组（全班一份）、高级（每组各一份 + 有一组不指定）。
  Expected: 三堂都建得出来；高级模式下「全部组都不指定 + 无课堂级材料」⇒ 400。

- [ ] **Step 5: 门禁 + 提交**

  ```bash
  npx tsc --noEmit && npx eslint src/app/teacher/classroom/new/
  git commit -m "feat(teacher): 创建页每组可选学习单"
  ```

---

# 阶段 D — 学生端与看板

### Task D1: 公共 iOS 键盘 / viewport hook

**Files:**
- Create: `src/app/classroom/shell/use-module-viewport.ts`
- Modify: `src/app/classroom/chat/chat-panel.tsx` · `chat.module.css`

**Interfaces:**
- Produces: `useModuleViewport(options: { active: boolean; containerRef: RefObject<HTMLElement | null>; cssVar: string }): void`

- [ ] **Step 1: 抽取**

  把 `chat-panel.tsx:146-219` 那段 effect **原样搬进**新 hook：`visualViewport` 量高、
  120ms settle、`focusin`/`focusout`/`resize`/`orientationchange` 四个监听、
  `scrollLockRef` 的取锁/放锁幂等语义、以及「**刻意不移除 CSS 变量**」那条。

  ⚠️ **一行都不要改语义** —— 那段代码里的每条注释都是一次事故换来的。搬家时把注释一起搬。

- [ ] **Step 2: 两边都挂**

  ```ts
  // chat-panel.tsx
  useModuleViewport({ active, containerRef: chatShellRef, cssVar: '--module-viewport-height' });
  // worksheet-panel.tsx（D2 里写）
  useModuleViewport({ active, containerRef: worksheetShellRef, cssVar: '--module-viewport-height' });
  ```

  **共用同一个变量名是刻意的**：同一时刻只有一个模块 `active`，共用意味着切换时
  不会出现「新面板的变量还没被设过」的那一帧（Safari 15 不认识 `100dvh`，兜底会退化成 `auto`）。

- [ ] **Step 3: 改 CSS**

  `chat.module.css` 的 `--chat-viewport-height` → `--module-viewport-height`（两处）。
  全局搜一遍确认没有遗漏：`grep -rn "chat-viewport-height" src/`

- [ ] **Step 4: 真机回归**

  🔴 **必须在真 iPad 上验**：学伴面板里点输入框 ⇒ 键盘弹出 ⇒ 输入框可见、页面不跳；
  切到学习单再切回 ⇒ 键盘仍然正常；反复切 5 次 ⇒ 页面仍可滚动（证明 scroll lock 没叠死）。
  **把结果记进进度表。**

- [ ] **Step 5: 提交**

  ```bash
  git commit -m "refactor(classroom): 抽出共用的 iOS 键盘与 viewport hook"
  ```

---

### Task D2: 学生端学习单面板

**Files:**
- Create: `src/app/classroom/worksheet/worksheet-panel.tsx` · `use-worksheet-answers.ts`
- Modify: `src/app/classroom/shell/classroom-shell.tsx` · `module-placeholder.tsx`

**Interfaces:**
- Consumes: D1 的 hook；B3 的端点
- Produces: `<WorksheetPanel />`，实现 §4.3 的 `ModulePanelProps` 契约

- [ ] **Step 1: 接线**

  - `classroom-shell.tsx`：`worksheet` 层渲染真面板
  - `module-placeholder.tsx`：`PlaceholderModuleId = Exclude<ModuleId, 'companion' | 'explore' | 'worksheet'>`
    ⇒ 会变成 `never`。**这是刻意的编译期门**：它保证了「外壳把真面板渲染成占位」不再合法。
    把这个类型连同它的注释一起删掉，并在外壳的调用点做同样的收窄。

- [ ] **Step 2: 离线队列（最不能出错的一块）**

  ```ts
  /**
   * 作答的本地队列。
   *
   * 🔴 **绝不静默丢数据**（规格 §8.3）—— 这是本模块唯一一条不能妥协的要求。
   * 队列写在 localStorage，键 `worksheet-queue:<classroomId>:<participantId>`，
   * 每条 = { questionId, value, at }。`online` 事件恢复后按 `at` 升序重放。
   */
  ```

  - 本地 state 立即更新（零延迟）
  - 防抖 1.5s → `PUT /answers`
  - 失败 ⇒ 留在队列，顶部显示 `⚠ 离线 · N 条待同步`（整条变琥珀）
  - 重放成功后从队列移除；**只有服务端返回 200 才移除**

- [ ] **Step 3: 面板 UI**（规格 §8.2）

  整卷滚动（层内滚动容器，`.stage` 是 `overflow:hidden`，见规格 §8.1）· 顶部条（标题 / 进度 / 保存状态 / 奖励累计）·
  每题 `✓ 已提交` / `◐ 作答中` 状态 · 每题下方「提交本题」· **不做题目导航**。

- [ ] **Step 4: 边界**

  - 本组未配置学习单 ⇒ 显示「本组未配置学习单」，**不拿别组的顶上**
  - 被切成预告/隐藏 ⇒ 提示 + 送回首页，**已作答内容不丢**

- [ ] **Step 5: 门禁**

  ```bash
  ./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
  ```
  Expected: 构建通过（含 Safari 15 兼容检查）、4000/4001 都在。

- [ ] **Step 6: 提交**

  ```bash
  git commit -m "feat(classroom): 学生端学习单面板"
  ```

---

### Task D3: 教师看板格子

**Files:**
- Create: `src/app/teacher/classroom/worksheet-tiles.tsx`
- Modify: `src/app/teacher/classroom/page.tsx`

- [ ] **Step 1: 内容区四态**（规格 §7.2）

  `还没开始` / `正在做 第 N 题 · 题型` / `停在第 N 题 · X 分钟`（琥珀底 + 文字，**不用 ⚠**）/ `✓ N 题已全部提交`，
  下面是逐题状态方格阵（**只编码状态，不编码对错**）。

- [ ] **Step 2: 替掉占位**

  `renderTileContent` 的 `case 'worksheet'` 从 `placeholder('学习单 · 尚未支持', …)` 换成真内容。
  顶栏 `ModuleCountChip` 的 `hint="尚未支持"` 与 `muted` 一并去掉。

- [ ] **Step 3: 徽章行**

  `{rounds} 轮` 在 `tileModule === 'worksheet'` 时换成 `已看 N/M`。
  ⚠️ 徽章行从此**模块相关** —— 三种模块都要回归一遍（学伴仍显示轮数）。

- [ ] **Step 4: 手测 + 提交**

  一个标准课堂 + 一个高级课堂，各看一遍格子。

  ```bash
  git commit -m "feat(teacher): 看板格子的学习单内容区"
  ```

---

### Task D4: 教师看板抽屉

**Files:**
- Create: `src/app/teacher/classroom/worksheet-drawer.tsx`
- Modify: `src/app/teacher/classroom/page.tsx`

- [ ] **Step 1: 形态 A —— 按参与者**（规格 §7.3）

  逐题列表：题号 / 题型 / 状态 / 对错（有 `isCorrect` 时）/ 原答案 / 「标记已查看」。
  ⚠️ **主观题只有「已查看」，没有对错**。

- [ ] **Step 2: 形态 B —— 按题**

  🔴 **必须「先按学习单分组，再按题」**：高级模式下每个组可以是**不同的学习单**，
  「全班共有的第 3 题」并不存在。标准/分组模式下只有一份，会自动退化成一层。
  第二层：题目列表（正确率 / 已交 N/M）→ 点某题 → 该题全部作答（**按参与者列出，可能是组不是人**）。

- [ ] **Step 3: 顶栏入口**

  加一个**与「跟随/指定」模式无关**的入口（挂在那两种模式下都会在某个模式里消失）。
  顶栏已经很挤，**改前先截图、改后再截一张**，两张都贴进度表。

- [ ] **Step 4: 提交**

  ```bash
  git commit -m "feat(teacher): 学习单抽屉的按人与按题两种形态"
  ```

---

### Task D5: 奖励形式

**Files:**
- Create: `src/app/classroom/worksheet/reward-badge.tsx`
- Modify: `src/app/teacher/page.tsx` · `src/lib/api.ts`

- [ ] **Step 1: 全局设置**

  在 `/teacher/` 现有设置区加「作答反馈」分组：形式四选一（对错 / ⭐ / 🌸 / 分数）+ 步长（1/2/3/5）。
  存 `Setting` 表，键 `worksheet-reward-style` 与 `worksheet-reward-step`。
  **不做「学段」**（规格 §9.2）。

- [ ] **Step 2: 学生端呈现**

  ```tsx
  /**
   * 奖励符号 —— `isCorrect` 的**呈现**，不是数据（规格 §9.1）。
   *
   * 🔴 绝不把星星/花朵/分数存进数据库：一旦落库，教师端「哪道题错得多」、导出、
   * P4 的分析型智能体都要面对一个「⭐ 是什么数」的问题。
   *
   * 显示值由**得分**算，不由 `isCorrect` 布尔算：
   *   `score = 1` ⇒ 全对档的步长；`score = 0.5` ⇒ 半对档的步长；`score = 0` ⇒ 0。
   *   **今天得分只可能是 0 或 1**（第一批没建 `score`，规格 §3-S），所以行为与
   *   「`isCorrect ? step : 0`」逐字相同 —— 但**接口要按得分写**。
   *
   * 🔴 理由（2026-09-23 用户裁定）：M4 会引入部分得分（多选「漏选算半对」，
   *   以及排序题 / 连线题的部分正确），届时**教师可配两档步长**（原话：
   *   「全对给两朵小花，半对半错给一朵」）。那时只改判分与多一行配置，
   *   不必回头改这里 —— 而若现在写成布尔，将来还要改一次，且学生会看到累计值跳变。
   *
   * 关掉自动判分 ⇒ 没有得分 ⇒ 没有奖励 —— 不需要第二个开关。
   */
  ```

  出现在**两处**：每题旁（交完立刻）+ 顶部累计（`⭐×3`）。**教师端不出现**。

- [ ] **Step 3: 提交**

  ```bash
  git commit -m "feat(teacher): 学习单作答反馈的奖励形式"
  ```

---

# 阶段 E — 收口

### Task E1: 验收

**Files:**
- Create: `specs/2026-09-23-p1-worksheet-acceptance.md`

- [ ] **Step 1: 逐条走规格 §10.2**

  含**端到端那一条**：教师做一张 3 题学习单 → 建课关联 → **真学生在一台老 iPad 上做完并逐题提交**
  → 教师看板实时显示正在做第 N 题 / 进度 / 按题正确率 → 断网重连后答案一条不丢。

- [ ] **Step 2: 门禁全跑一遍**

  ```bash
  npx tsc --noEmit
  npx eslint
  ./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
  cd server && pnpm test
  ```

- [ ] **Step 3: 更新进度表**

  把 E1 标 ✅，把门禁基线与最终数字并列写清，并把规格 §13 待定项里这次实施中碰到的逐条更新。

- [ ] **Step 4: 提交**

  ```bash
  git add specs/
  git commit -m "docs: P1 学习单第一批验收记录"
  ```

---

## 自检（计划写完后控制器跑一遍）

**1. 规格覆盖** —— 逐节对照：

| 规格章节 | 落在哪个任务 |
|---|---|
| §4 数据模型 | A1 |
| §5.1 材料解析 | B2 |
| §5.2 三件套判据 | B2 |
| §5.3 接口 | B1 / B3 / B4 |
| §5.4 答卷安全 | B3（Step 5 有反证） |
| §5.5 删除守卫 | B1（三样引用） |
| §5.6 判分与归一化 | A2 |
| §5.7 实时回传 | B4 |
| §6 编辑器 | C1 / C2 |
| §7 教师看板 | D3 / D4 |
| §8 学生端作答 | D2 |
| §9 奖励形式 | D5 |
| §10.2 验收 | E1 |
| §11 测试要求 | A2 / B1 / B3 / B4 |
| §1.5 兼容性边界 | D2 Step 5（构建含兼容检查） |

**2. 占位符扫描** —— 无 `TBD` / `TODO` / 「照 Task N 办」。

**3. 类型一致性** —— `QuestionNode` / `WorksheetContent` / `resolveMaterialTargetId` 的签名
在 A2 定义、在 B2/B3/C2 使用，三处必须逐字一致；`useModuleViewport` 的选项对象在 D1 定义、
在 D1/D2 使用，必须一致。

**4. 两处已知的实施风险，任务里已埋检查点：**
- D1 抽 hook 时**不得改语义**（那段注释都是事故换来的）
- B1 的鉴权正则改动后要**重新核对**它仍然不匹配 `review`
