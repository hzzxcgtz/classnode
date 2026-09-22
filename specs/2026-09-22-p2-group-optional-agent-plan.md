# 分组可选智能体 实施计划

> 🔴 **本计划已作废，不要照着它实施。**
> 它实现的是「`ClassroomGroup.agentId` 改成可空」，而用户 2026-09-22 追加要求之后，
> 权威设计变成了「**按组的课堂材料**」（`ClassroomGroupMaterial` 关联表，
> 三种材料共用；`agentId` 整列迁走而不是改可空）。
>
> 权威文档：**`specs/2026-09-22-p2-group-materials.md`**。
> 本计划**不会**被修补沿用 —— 迁移的形状、写入路径、读路径、UI 都要重做，
> 新计划会在新 spec 定稿后由 writing-plans 重新产出。
>
> 仍然可复用的部分：Global Constraints、任务 0 的前置（干净工作区 + 基线实测）。
> **基线数字也过期了**（本计划写的是 244，2026-09-22 实测已是 272）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「分组模式」与「高级模式」的每个小组都能不指定智能体，且「不指定」意味着**该组没有 AI**，而不是静默借用别的组的。

**Architecture:** `ClassroomGroup.agentId` 改为可空，配一条自写的 SQLite 表重建迁移（老库的列是 `NOT NULL`，`db push` 不许碰真实库）。同时消掉三处既有缺陷：socket 选智能体不再回落到 `classroomAgents[0]`（高级模式下那是各组智能体的并集）、`GET /code/:code` 不再解引用 null、分组模式的 `uniqueAgentIds[0]` 不再写 `undefined`。

**Tech Stack:** Prisma + SQLite（`server/`，ESM + TypeScript）；Next.js 15 静态导出 + React 18（`src/`）；Node 内置测试运行器（`node --test`）。

**Spec:** `specs/2026-09-22-p2-group-optional-agent.md` —— **本计划从它论证，执行者两份都要读**。它的「背景与现状」一节列出了三处缺陷的 file:line 证据。

## Global Constraints

1. 既有测试必须继续全过。**基线以任务 0 的实测为准**，不要引用 `specs/2026-09-20-p2-explore-assistant.md` 里的「63 pass」——那是 P2 之前的数字。
2. 不得出现 regex lookbehind；不得使用 `Object.hasOwn` / `structuredClone` / `Array.prototype.at` / `findLast` / `:has()` / `@container` / `content-visibility`。构建期闸门会 fail。
3. **不新增任何 npm 依赖。**
4. 提交信息中文，格式 `<type>(scope): <做了什么>`。报告、注释、过程旁白一律中文；引用的原始输出保持原样不翻译。
5. 🔴 **绝不 `prisma db push` 打在真实库上（`server/prisma/dev.db`）。** 本任务要**在临时库上**跑一次 `db push` 来导出权威 DDL —— 必须用 `DATABASE_URL="file:/tmp/..."`，用完删掉。这条踩过一次，删掉了活库的一整列。
6. 不要用 `reset-password` 造教师数据（它会 `revokeAllTeacherSessions()`）。
7. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
8. **跑 `pnpm build` 之前先 `./dev.sh stop`，跑完 `./dev.sh start`，最后 `./dev.sh status` 复核 4000/4001 都在。** 被踩过三次：`pnpm build` 覆盖 `.next` 会把正在跑的 dev server 打成 500，实施者因此拿到过假的绿灯。
9. **不碰** `CLAUDE.md` / `dev.sh` / `package.json`。
10. 测试若改数据库，必须逐表还原并给出证据。造测试数据一律用 `/tmp` 下的副本库。
11. 🔴 **任何「因此不扫 / 排除 / 安全 / 可以忽略」的结论，必须附一条命令或一段实测输出。** 没有命令的排除 = 未验证的排除。

### 已实测的权威事实（执行者不必重做，但要能复核）

**Prisma 对可空版本的真实输出**。方法：把 `schema.prisma` 的 `agentId` 改成 `String?`、`agent` 改成 `Agent?` 复制到 `/tmp`，`DATABASE_URL="file:/tmp/probe.db" prisma db push`，再 `sqlite3 .schema ClassroomGroup`。与真实库逐行对比，**唯一差异**是 `"agentId" TEXT NOT NULL` → `"agentId" TEXT`；具名 CONSTRAINT、`ON DELETE CASCADE ON UPDATE CASCADE`、索引名逐字相同。全库 `pragma_table_info` 规范化对比同样只有这一处差异（外加真实库残留的 `_prisma_migrations` 表，与本改动无关）。

⇒ **重建 DDL 就是下面这一份，抄它，不要自己写行内 `REFERENCES`。**

```sql
CREATE TABLE "new_ClassroomGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentId" TEXT,
    "sourceClassGroupId" TEXT,
    CONSTRAINT "ClassroomGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomGroup_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ClassroomGroup_classroomId_idx" ON "ClassroomGroup"("classroomId");
```

---

## Task 0: 前置（不写代码）

**Files:** 无

- [ ] **Step 1: 确认工作区是干净的**

```bash
cd /Users/zxc/myprojects/classnode && git status --porcelain
```

预期：**空**。本任务的改动要落在干净的边界上，否则与在制品缠在同一批 diff 里，之后无法单独审、单独回退。不空就停下来找用户，**不要**替用户提交。

- [ ] **Step 2: 记录测试基线**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm test 2>&1 | tail -20
```

记下 `pass` / `fail` 的实际数字，**写进本任务的报告**。后面每一步的「全过」都以这个数字为准。

> **控制器在 2026-09-22 实测的基线**（供比对，执行时仍要自己重测一遍）：
> - `cd server && pnpm test` → **244 pass / 0 fail**
> - 注意 `server` 包里 `test` 的脚本本身就是 `pnpm build && node --test dist/tests/*.test.js`，**已经包含编译**，不要再单独跑 `build:server`（那是根包的脚本，在 `server/` 下不存在）。
> - ⚠️ `specs/2026-09-20-p2-explore-assistant.md` 写的「63 pass」是 P2 开始前的数字，早已过时；那个文件里的「pnpm lint 3 条 warning」同样过时（见下）。**不要拿那两份旧数字当期望值。**

- [ ] **Step 3: 记录 tsc / lint 基线**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit
npx eslint src/app/classroom/ src/lib/
```

> **控制器实测**：`tsc` 退出 0、零输出；限定范围 eslint 退出 0、**恰好 1 条 warning**（`src/app/classroom/identity/use-student-session.ts:112` 的 `tokenData`）——这一条与 P2 文档记载的一致。
>
> ⚠️ 但**全仓 `pnpm lint` 现在是 632 条 warning（0 error，退出 0）**，而 P2 文档记的是 3 条。多出来的 631 条全部来自 `server/vendor/snapdom.js`（压缩成一行的第三方产物，被 eslint 扫到了）。这是 P2.2/P2.3 引入 vendor 目录带来的漂移，**与本任务无关**，本任务的门禁用上面的**限定范围**那条，不要用全仓数字。

---

## Task 1: 迁移模块（探测 + 备份 + 重建 + 标记）

**Files:**
- Create: `server/src/services/classroom-group-agent-migration.ts`
- Create: `server/src/tests/classroom-group-agent-migration.test.ts`
- Modify: `server/src/index.ts:39-53`（泛化备份函数）、`:384-400` 之后（调用新迁移）

**Interfaces:**
- Consumes: 无（本任务是第一个）
- Produces:
  - `needsNullableAgentColumn(columns: { name: string; notnull: number }[]): boolean`
  - `ensureClassroomGroupAgentNullable(prisma: PrismaClient, backup: (label: string) => string | null): Promise<'skipped' | 'migrated'>`
  - `index.ts` 内的 `backupDatabase(label: string): string | null`（由 `backupDatabaseBeforeParticipantMigration` 泛化而来）

> **与 spec §4.2 的一处偏离（有意）**：spec 写「标记与调用放在 `index.ts`」。本计划把**编排**（标记 + 备份 + 中止 + 重建）收进服务模块，只把**回调**留给 `index.ts`。理由：spec 的验收清单要求验证「备份失败时中止」，而写在 `index.ts` 里的编排没法被测试。备份**函数本身**仍在 `index.ts`（它依赖 `process.env.DATABASE_URL`），通过参数传进去。

- [ ] **Step 1: 写失败测试：探测函数**

新建 `server/src/tests/classroom-group-agent-migration.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { needsNullableAgentColumn } from '../services/classroom-group-agent-migration.js';

// 探测函数被抽成纯函数，就是为了能在这里喂两种列形状。
// 集成测试里「读不到列」与「已经是可空的」会走向同一个分支，区分不开。
test('探测：agentId 仍为 NOT NULL ⇒ 需要重建', () => {
  assert.equal(needsNullableAgentColumn([{ name: 'agentId', notnull: 1 }]), true);
});

test('探测：agentId 已可空 ⇒ 不需要重建', () => {
  assert.equal(needsNullableAgentColumn([{ name: 'agentId', notnull: 0 }]), false);
});

// 🔴 反证（阴性对照）：这两条如果与上面同真，说明断言恒真、探测根本没在区分。
test('反证：列不存在 ⇒ 不得判定为「需要重建」', () => {
  assert.equal(needsNullableAgentColumn([{ name: 'sourceClassGroupId', notnull: 0 }]), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/zxc/myprojects/classnode/server
node --test dist/tests/classroom-group-agent-migration.test.js
```

（首次要先 `pnpm build` 把测试编译到 `dist/`。）

预期：FAIL —— 模块不存在。

- [ ] **Step 3: 写模块骨架与探测函数**

新建 `server/src/services/classroom-group-agent-migration.ts`：

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * 分组「不指定智能体」的结构迁移。
 *
 * 为什么需要迁移而不是只改 schema.prisma：SQLite 不支持
 * `ALTER COLUMN ... DROP NOT NULL`，而老库的 `ClassroomGroup.agentId` 是
 * `TEXT NOT NULL`。只改 schema 的话 —— 开发机（`./dev.sh db reset` 重建过）没问题、
 * 测试（临时库由 `db push` 现造）永远绿，**只有用户的真实老库会在写入 null 时
 * 撞 NOT NULL ⇒ 500「创建课堂失败」**，而那个文案与「参数不合法」长得一模一样。
 * 见 specs/2026-09-22-p2-group-optional-agent.md §4.2。
 */

type TableInfoRow = { name: string; notnull: number };

/** 迁移标记。只在真的重建过一次时写。 */
const MIGRATION_MARKER = 'classroom-group-nullable-agent-migration-v1';

/**
 * 纯探测：`agentId` 是不是仍然 `NOT NULL`。
 *
 * 抽成纯函数是为了能直接喂两种列形状做正反断言 —— 集成测试里「读不到列」与
 * 「已经是可空的」会走向同一个分支，只靠集成测试区分不开。
 */
export function needsNullableAgentColumn(columns: TableInfoRow[]): boolean {
  const agentId = columns.find((column) => column.name === 'agentId');
  // 列不存在 ⇒ 不重建。全新安装时表由 db push 按新 schema 建出、本来就是可空的；
  // 「表结构根本不对」是另一种情况，静默重建会掩盖它，宁可不动。
  return agentId !== undefined && agentId.notnull === 1;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/classroom-group-agent-migration.test.js
```

预期：3 pass / 0 fail。

- [ ] **Step 5: 写失败测试：迁移的真库级行为（造旧表）**

追加到同一个测试文件。**这一段是本任务的核心，也是防假绿的关键：临时库必须自己造 `NOT NULL` 的旧表，不能拿 `db push` 现造的库测。**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensureClassroomGroupAgentNullable } from '../services/classroom-group-agent-migration.js';

/**
 * 🔴 造一张**旧形状**的表，而不是让 prisma db push 建库。
 *
 * 本仓现有的临时库都是 `db push` 建的（见 classroom-webapp-link.test.ts:27-29 的说明），
 * 那种库里 agentId **天生就是可空的** —— 拿它测迁移会**永远绿**，而真实老库仍然 500。
 * 这正是本项目反复出现的「假绿」形态，所以这里手工建表。
 *
 * 🔴 必须带上**两张子表与子表数据**。`PRAGMA foreign_keys` 是**按连接**生效的，
 * 而 Prisma 有连接池：pragma 一旦落在与 `DROP TABLE` 不同的连接上就不生效，
 * 此时 SQLite 的 `DROP TABLE` 会执行一次隐式 `DELETE FROM` 父表，**触发子表的外键动作**
 * —— `ClassroomStudent.groupId` 是 `ON DELETE SET NULL`（全班学生的分组被清空）、
 * `ClassroomGroupMember.groupId` 是 `ON DELETE CASCADE`（成员快照被整批删除）。
 * 没有子表数据，这个测试就**测不到**它，而且是静默的数据销毁。
 */
async function openLegacyDb(): Promise<{ prisma: PrismaClient; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-group-mig-'));
  const file = path.join(dir, 'legacy.db');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Classroom" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Agent" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceClassGroupId" TEXT,
    CONSTRAINT "ClassroomGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomGroup_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroup_classroomId_idx" ON "ClassroomGroup"("classroomId")`);
  // 子表 1：groupId 为 ON DELETE SET NULL
  await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomStudent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'student',
    "studentId" TEXT,
    "groupId" TEXT,
    CONSTRAINT "ClassroomStudent_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomStudent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClassroomGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`);
  // 子表 2：groupId 为 ON DELETE CASCADE
  await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomGroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "ClassroomGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClassroomGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  // ⚠️ 三列都要有，且 key 要有唯一索引：Prisma 的 create/upsert 会**在客户端生成 id**
  //    并把它放进 INSERT，少一列就直接失败；findUnique({where:{key}}) 也依赖那条唯一索引。
  //    列定义照真实库实测（server/prisma/dev.db 的 .schema Setting）。
  await prisma.$executeRawUnsafe(`CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key")`);
  return { prisma, dir };
}

test('迁移：旧表（agentId NOT NULL）被重建为可空，且数据逐行不变', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });

  await prisma.$executeRawUnsafe(`INSERT INTO "Classroom" ("id") VALUES ('c1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Agent" ("id") VALUES ('a1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroup" ("id","classroomId","name","agentId","sourceClassGroupId")
    VALUES ('g1','c1','第一组','a1','sg1'), ('g2','c1','第二组','a1',NULL)`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomStudent" ("id","classroomId","groupId") VALUES ('cs1','c1','g1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroupMember" ("id","classroomId","groupId","name") VALUES ('gm1','c1','g1','张三')`);

  const backupCalls: string[] = [];
  const result = await ensureClassroomGroupAgentNullable(prisma, (label) => { backupCalls.push(label); return '/tmp/fake-backup.db'; });

  assert.equal(result, 'migrated');

  const columns = await prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>(`PRAGMA table_info('ClassroomGroup')`);
  assert.equal(needsNullableAgentColumn(columns), false, 'agentId 必须已变为可空');

  // 逐行比对，不是比行数 —— 行数验不出列被删（P2 的 T5 就是这么栽的）。
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "id","classroomId","name","agentId","sourceClassGroupId" FROM "ClassroomGroup" ORDER BY "id"`,
  );
  assert.deepEqual(rows, [
    { id: 'g1', classroomId: 'c1', name: '第一组', agentId: 'a1', sourceClassGroupId: 'sg1' },
    { id: 'g2', classroomId: 'c1', name: '第二组', agentId: 'a1', sourceClassGroupId: null },
  ]);

  const indexes = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ClassroomGroup' AND name NOT LIKE 'sqlite_%'`,
  );
  assert.deepEqual(indexes.map((index) => index.name), ['ClassroomGroup_classroomId_idx']);

  // 🔴 子表数据必须**原样幸存**。这两条是 PRAGMA foreign_keys 那个按连接生效的坑的判据：
  //    若 pragma 没生效，DROP TABLE 会触发 ON DELETE SET NULL / CASCADE，
  //    下面两条会分别看到 null 与「行没了」。
  const students = await prisma.$queryRawUnsafe<{ id: string; groupId: string | null }[]>(
    `SELECT "id","groupId" FROM "ClassroomStudent"`,
  );
  assert.deepEqual(students, [{ id: 'cs1', groupId: 'g1' }], '学生的分组不得被 SET NULL');

  const members = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "ClassroomGroupMember"`);
  assert.deepEqual(members.map((m) => m.id), ['gm1'], '成员快照不得被级联删除');

  assert.equal(backupCalls.length, 1, '确实需要重建时必须且只备份一次');

  // 迁移后可空：写入 null 必须成功（这是本迁移存在的唯一理由）。
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroup" ("id","classroomId","name","agentId") VALUES ('g3','c1','第三组',NULL)`);
});
```

> ⚠️ **如果上面两条子表断言红了，停下并上报，不要自己绕过。** 那说明 `PRAGMA foreign_keys = OFF` 没有落在执行 `DROP TABLE` 的那条连接上，当前写法会造成**静默的子表数据销毁**。已知的可行退路：改用 Node 内置的 `node:sqlite`（`DatabaseSync`）直接打开库文件跑这段迁移 —— 它是单连接，没有连接池不确定性，且**不引入任何新依赖**。是否走这一步由用户决定。

test('迁移：已经是可空的表 ⇒ 跳过，且不备份', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  // 先跑一次把它变成可空
  await ensureClassroomGroupAgentNullable(prisma, () => '/tmp/fake.db');
  // 清掉标记，模拟「标记丢了但表已经对了」
  await prisma.$executeRawUnsafe(`DELETE FROM "Setting" WHERE "key" = ?`, 'classroom-group-nullable-agent-migration-v1');

  const backupCalls: string[] = [];
  const result = await ensureClassroomGroupAgentNullable(prisma, (label) => { backupCalls.push(label); return '/tmp/fake.db'; });

  assert.equal(result, 'skipped');
  assert.equal(backupCalls.length, 0, '不需要重建时不得产生备份文件');
});

test('迁移：标记已置位 ⇒ 重复调用是空操作（不重复备份）', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  await expect(ensureClassroomGroupAgentNullable(prisma, () => '/tmp/fake.db')).resolves.toBe('migrated');
  const backupCalls: string[] = [];
  await ensureClassroomGroupAgentNullable(prisma, (label) => { backupCalls.push(label); return '/tmp/fake.db'; });
  assert.equal(backupCalls.length, 0);
});

// 🔴 反证：备份失败必须**中止**，不得照常改表。
test('迁移：备份失败 ⇒ 抛错中止，表结构原样不动', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });

  await assert.rejects(
    () => ensureClassroomGroupAgentNullable(prisma, () => null),
    /备份失败/,
  );

  const columns = await prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>(`PRAGMA table_info('ClassroomGroup')`);
  assert.equal(needsNullableAgentColumn(columns), true, '中止后必须仍是旧结构 —— 没有备份就没有回滚依据');
});
```

> ⚠️ `openLegacyDb` 里只建了迁移真正会碰的四张表。`ensureClassroomGroupAgentNullable` **不得**依赖其它表——若它需要，测试会红，那说明职责划错了。

- [ ] **Step 6: 运行测试确认失败**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/classroom-group-agent-migration.test.js
```

预期：FAIL —— `ensureClassroomGroupAgentNullable` 未导出。

- [ ] **Step 7: 实现编排与重建**

追加到 `server/src/services/classroom-group-agent-migration.ts`：

```ts
/**
 * 重建 `ClassroomGroup` 让 `agentId` 可空。
 *
 * ⚠️ 下面的 DDL 是**实测出来的**，不是照文档推的：把 schema.prisma 的 agentId 改成
 * `String?` 后 `db push` 到一个 /tmp 临时库，dump 出来与真实库逐行对比，唯一差异就是
 * `"agentId" TEXT NOT NULL` → `"agentId" TEXT`。**具名 CONSTRAINT、ON UPDATE CASCADE、
 * 索引名必须逐字保留** —— 否则桌面版下一次 db push 会再重建一次，而本模块按
 * table_info 探测、不会重跑，两边就此分叉。
 *
 * ⚠️ 顺序必须是 DROP 旧表 → RENAME 新表，不能反过来：SQLite ≥3.25 的
 * `ALTER TABLE ... RENAME` 会改写其它表里指向被改表名的 REFERENCES 子句，
 * 先 RENAME 旧表会把 ClassroomStudent / ClassroomGroupMember 的外键指到临时表名上。
 * 仓内 participant-migration.ts:107-108 是同一个坑的既有处置。
 *
 * ⚠️ `ClassroomGroup` 被两张子表外键引用：ClassroomStudent.groupId
 * （真实库实测为 ON DELETE SET NULL）与 ClassroomGroupMember.groupId（ON DELETE CASCADE）。
 * `PRAGMA foreign_keys = OFF` 是必需的。
 *
 * ⚠️ `PRAGMA foreign_keys` **在事务内无效**，所以本函数**不得**包进 `$transaction`。
 */
export async function ensureClassroomGroupAgentNullable(
  prisma: PrismaClient,
  backup: (label: string) => string | null,
): Promise<'skipped' | 'migrated'> {
  const done = await prisma.setting.findUnique({ where: { key: MIGRATION_MARKER } }).catch(() => null);
  if (done) return 'skipped';

  const columns = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('ClassroomGroup')`);
  if (!needsNullableAgentColumn(columns)) {
    // 全新安装（表本来就对）或表结构异常。写标记，避免每次启动都探一遍。
    await prisma.setting.upsert({
      where: { key: MIGRATION_MARKER },
      update: { value: 'skipped' },
      create: { key: MIGRATION_MARKER, value: 'skipped' },
    });
    return 'skipped';
  }

  // 改的是列结构，没有备份就没有回滚依据 ⇒ 备份失败必须中止，不沿用既有那条迁移
  // 「备份失败也继续」的宽松度（index.ts:389-391 的 if (backupPath) 只是不打日志）。
  const backupPath = backup('classroom-group-nullable-agent');
  if (!backupPath) {
    throw new Error('[server] ClassroomGroup 迁移中止：备份失败，未改动任何表结构');
  }
  console.log(`[server] Database backup created: ${backupPath}`);

  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE "new_ClassroomGroup" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "classroomId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "agentId" TEXT,
      "sourceClassGroupId" TEXT,
      CONSTRAINT "ClassroomGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ClassroomGroup_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    await prisma.$executeRawUnsafe(`INSERT INTO "new_ClassroomGroup" ("id", "classroomId", "name", "agentId", "sourceClassGroupId")
      SELECT "id", "classroomId", "name", "agentId", "sourceClassGroupId" FROM "ClassroomGroup"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "ClassroomGroup"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "new_ClassroomGroup" RENAME TO "ClassroomGroup"`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroup_classroomId_idx" ON "ClassroomGroup"("classroomId")`);
  } finally {
    await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  }

  await prisma.setting.upsert({
    where: { key: MIGRATION_MARKER },
    update: { value: 'completed' },
    create: { key: MIGRATION_MARKER, value: 'completed' },
  });
  console.log('[server] ClassroomGroup nullable-agent migration complete');
  return 'migrated';
}
```

- [ ] **Step 8: 运行测试确认通过**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/classroom-group-agent-migration.test.js
```

预期：7 pass / 0 fail。

- [ ] **Step 9: 泛化备份函数并接线（`index.ts`）**

`server/src/index.ts:39-53` 改名并加 label 参数，**保持既有那条迁移产出的文件名逐字不变**：

```ts
function backupDatabase(label: string): string | null {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl.startsWith('file:')) return null;
  const configuredPath = databaseUrl.slice('file:'.length);
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  if (!fs.existsSync(databasePath)) return null;
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `before-${label}-${stamp}.db`);
  fs.copyFileSync(databasePath, backupPath);
  return backupPath;
}
```

⚠️ 既有调用点 `:389` 必须改成 `backupDatabase('participant-migration')` —— 这样产出的仍是 `before-participant-migration-<stamp>.db`，与历史上已有的备份文件同名形。

然后在 `:400` 的 `catch` 之后、屏蔽词种子之前，插入：

```ts
  // 分组「不指定智能体」：ClassroomGroup.agentId 由 NOT NULL 改为可空。
  // ⚠️ 必须排在上面那条参与者迁移**之后** —— 那一步保证 ClassroomGroup.sourceClassGroupId
  //    列已存在，而下面的表重建会把它一起搬到新表。反过来会漏列。
  try {
    await ensureClassroomGroupAgentNullable(prisma, backupDatabase);
  } catch (e) {
    console.error('[server] ClassroomGroup nullable-agent migration failed:', e);
    throw e;
  }
```

并在文件顶部补 import：`import { ensureClassroomGroupAgentNullable } from './services/classroom-group-agent-migration.js';`

- [ ] **Step 10: 更新既有测试的 mock 形状**

`server/src/tests/group-participant-flow.test.ts:14` 现在回的是 `[{ name: 'sourceClassGroupId' }]` —— **没有 `notnull` 字段**。本任务没改 `participant-migration.ts` 的读取类型，所以这条 mock 暂时仍然有效；但为了不让它成为下一个人的陷阱，把该行改成完整形状并加注释：

```ts
      // ⚠️ 形状要与 PRAGMA table_info 真实返回一致（含 notnull）。
      //    少一个字段不会让谁报错，只会让「按 notnull 判断」的逻辑静默走错分支。
      if (sql.includes("table_info('ClassroomGroup')")) {
        return [{ name: 'id', notnull: 1 }, { name: 'classroomId', notnull: 1 }, { name: 'name', notnull: 1 },
                { name: 'agentId', notnull: 1 }, { name: 'sourceClassGroupId', notnull: 0 }];
      }
```

- [ ] **Step 11: 跑全量测试**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm test 2>&1 | tail -20
```

预期：与任务 0 的基线相比 **pass 增加、fail 仍为 0**。

- [ ] **Step 12: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add server/src/services/classroom-group-agent-migration.ts server/src/tests/classroom-group-agent-migration.test.ts server/src/index.ts server/src/tests/group-participant-flow.test.ts
git commit -m "feat(server): ClassroomGroup.agentId 可空的结构迁移（含备份与中止）"
```

---

## Task 2: schema 可空 + 服务端三处缺陷

**Files:**
- Modify: `server/prisma/schema.prisma:153,157`
- Modify: `server/src/routes/classroom.ts:311`、`:377-380`、`:389-394`、`:437-438`、`:804-816`
- Modify: `server/src/socket/index.ts:1562-1568`（抽出纯函数）
- Test: `server/src/tests/classroom-webapp-link.test.ts`（追加）、`server/src/tests/group-agent-resolution.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的迁移（无代码依赖，只是同一个批次一起发布）
- Produces:
  ```ts
  export function resolveAgentSlot<T>(
    mode: string,
    groups: { id: string; agent: T | null }[],
    classroomAgents: { agent: T | null }[],
    studentGroupId: string | null | undefined,
  ): T | null;
  ```
  **泛型是必需的**：调用点随后要读 `agent.enabled`（`:1575-1598` 的停用分支）与 `agent.name`（`agent-disabled` 事件的载荷）。把返回类型写成收窄的 `{ id?: string; enabled?: boolean }` 会让这两处编译不过，或者逼实施者加一个丢类型的断言 —— 那是本次改动正在清除的东西。

- [ ] **Step 1: 改 schema**

`server/prisma/schema.prisma` 第 153 行：

```prisma
  agentId    String? // 该组绑定的智能体（null = 本组不指定，三件套规则下合法）
```

第 157 行：

```prisma
  agent     Agent?          @relation(fields: [agentId], references: [id], onDelete: Cascade)
```

⚠️ 只改 `ClassroomGroup` 这两行。**`ClassroomAgent`（约 :182-191）的 `agentId`/`agent` 必须保持必填** —— 用 sed 批量替换会连它一起改掉（控制器实测踩过）。

- [ ] **Step 2: 生成客户端**

```bash
cd /Users/zxc/myprojects/classnode && pnpm --filter classnode-server db:generate
```

⚠️ 不跑这一步的话 Prisma 客户端类型仍是 `Agent`（非空），`tsc` 不会提示下面 Step 4 的解引用错误，它们会静默到运行期。

- [ ] **Step 3: 记录 tsc 报出的错误**

```bash
cd /Users/zxc/myprojects/classnode && npx tsc --noEmit 2>&1 | head -30
```

把每一条都记进报告。这是**改动的真实影响面**——后面每一步都要把它消掉。预期至少包含 `routes/classroom.ts` 里对 `group.agent` 的访问。

- [ ] **Step 4: 修读路径（🔴 不解引用 null）**

`server/src/routes/classroom.ts:804-816` 改成：

```ts
      groups: (classroom.mode === 'advanced' || classroom.mode === 'group')
        ? classroom.groups.map(group => ({
            id: group.id,
            name: group.name,
            agentId: group.agentId,
            // 组可以不指定智能体（三件套规则）⇒ 这里必须是条件构造。
            // ⚠️ 原写法 `agent: { id: group.agent.id, ... }` 在 agent 为 null 时抛
            //    TypeError，被外层的 catch 吞成 500，而学生端首屏就调这个接口
            //    ⇒ **整间课堂的学生都进不去**，不只是没配智能体的那一组。
            agent: group.agent ? {
              id: group.agent.id,
              name: group.agent.name,
              logo: group.agent.logo,
              platform: group.agent.platform,
              enabled: group.agent.enabled,
              greeting: group.agent.greeting,
            } : null,
          }))
        : undefined,
```

- [ ] **Step 5: 修高级模式写入路径**

`server/src/routes/classroom.ts:373-379` 的窄化：

```ts
    const normalizedGroups = groups.map((group: unknown) => {
      const input = typeof group === 'object' && group !== null ? group as Record<string, unknown> : {};
      return {
        name: typeof input.name === 'string' ? input.name.trim() : '',
        // 空串一律归一成 null：否则 '' 会成为**第三种状态**落库。'' 与 null 在所有
        // `?.` 判空里表现一致（都 falsy），看起来是对的，直到有人写
        // `where: { agentId: null }` 的统计 —— 那种查询一条都匹配不到 ''。
        agentId: typeof input.agentId === 'string' && input.agentId ? input.agentId : null,
      };
    });
    if (normalizedGroups.some(group => !group.name)) return res.status(400).json({ error: '分组名称不能为空' });
```

`:389-394` 的三件套判据改成按**有智能体的组数**计：

```ts
    const materialError = classroomMaterialError({
      // ⚠️ 必须是「有智能体的组数」，不是组的数量。用 normalizedGroups.length 的话
      //    「所有组都不指定 + 没有网页」会通过校验，建出一间三件套全空的教室 ——
      //    而 classroomMaterialError 存在的理由正是防这个（见 :151-152 的注释）。
      agent: normalizedGroups.filter(group => group.agentId).length,
      webapp: webapp.id ? 1 : 0,
      worksheet: 0,
    });
```

`:437-438` 删掉 `as string[]` 并过滤：

```ts
    // ⚠️ 原写法是 `[...new Set(normalizedGroups.map(group => group.agentId))] as string[]`。
    //    那个 as 断言正是让 tsc 闭嘴的东西：db:generate 之后这里其实是 (string | null)[]，
    //    断言一删编译器就会说话；留着它，错误只会推迟到运行期的事务里炸成 500。
    const uniqueAgentIds = [...new Set(
      normalizedGroups.map(group => group.agentId).filter((id): id is string => id !== null),
    )];
```

- [ ] **Step 6: 修分组模式的 500**

`server/src/routes/classroom.ts:311`：

```ts
            // 分组模式：全组共用一个智能体；不选智能体是合法的（三件套规则），
            // 此时写 null。⚠️ 原写法 `uniqueAgentIds[0]` 在空数组时是 undefined，
            //    TS 认为它是 string 所以 tsc 一声不吭，Prisma 在事务里抛必填缺失
            //    ⇒ 500「创建课堂失败」。前端 new/page.tsx:129 明确允许这个组合。
            agentId: uniqueAgentIds[0] ?? null,
```

- [ ] **Step 7: 写失败测试：socket 选智能体的纯函数**

新建 `server/src/tests/group-agent-resolution.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentSlot } from '../socket/index.js';

const A = { id: 'agent-a', name: 'A 智能体' };
const B = { id: 'agent-b', name: 'B 智能体' };

test('高级模式：学生自己的组有智能体 ⇒ 用它', () => {
  const got = resolveAgentSlot('advanced', [{ id: 'g1', agent: A }], [{ agent: B }], 'g1');
  assert.equal(got?.id, 'agent-a');
});

// 🔴 本改动最严重的一处。反证：classroomAgents 里**故意**放一个别的组的智能体，
//    断言学生没有拿到它 —— 这条如果红，说明回落还在。
test('🔴 高级模式：自己组不指定智能体 ⇒ 返回 null，**不得**借用别组的', () => {
  const got = resolveAgentSlot('advanced', [{ id: 'g1', agent: null }], [{ agent: B }], 'g1');
  assert.equal(got, null, '不得回落到 classroomAgents[0] —— 高级模式下那是各组智能体的并集');
});

test('分组模式：同上，组没有智能体就是没有', () => {
  const got = resolveAgentSlot('group', [{ id: 'g1', agent: null }], [{ agent: B }], 'g1');
  assert.equal(got, null);
});

test('标准模式：组的概念不适用 ⇒ 用课堂的第一个智能体', () => {
  const got = resolveAgentSlot('standard', [], [{ agent: B }], null);
  assert.equal(got?.id, 'agent-b');
});

test('标准模式：没有智能体 ⇒ null', () => {
  assert.equal(resolveAgentSlot('standard', [], [], null), null);
});

test('分组模式：找不到学生的组 ⇒ null（不回落）', () => {
  assert.equal(resolveAgentSlot('group', [{ id: 'g1', agent: A }], [{ agent: B }], 'g-missing'), null);
});
```

- [ ] **Step 8: 运行确认失败**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-agent-resolution.test.js
```

预期：FAIL —— `resolveAgentSlot` 未导出（构建可能先因为 `socket/index.ts` 的类型错误失败，那是 Step 3 记录的错误，正好一起修）。

- [ ] **Step 9: 抽出纯函数并替换调用点**

在 `server/src/socket/index.ts` 里 `storeWebappFrame` 附近的模块级位置加：

```ts
/**
 * 「该学生此刻该用哪个智能体」。
 *
 * 抽成纯函数是为了能对四种组合逐条断言 —— 这三行是本改动最危险的地方，
 * 内联在 send-message 处理器里只能靠端到端手测。
 *
 * 🔴 **高级/分组模式下不得回落到 `classroomAgents[0]`。** 那个数组在高级模式下是
 * **各组智能体的并集**（routes/classroom.ts:437-438 派生），回落到它等于让
 * 「不指定智能体」的组静默地用另一个组的智能体对话 —— 错名字、错提示词、
 * 错平台账号，AI 正常回答、对话正常入库、**零报错**。
 *
 * 泛型 T 让调用点拿到的是 Prisma 的具体智能体类型，`agent.enabled` / `agent.name`
 * 照旧可读；不要把它收窄成一个手写的窄类型，那会逼出一处丢类型的断言。
 */
export function resolveAgentSlot<T>(
  mode: string,
  groups: { id: string; agent: T | null }[],
  classroomAgents: { agent: T | null }[],
  studentGroupId: string | null | undefined,
): T | null {
  if (mode === 'group' || mode === 'advanced') {
    const group = groups.find(candidate => candidate.id === studentGroupId);
    return group?.agent ?? null;
  }
  return classroomAgents[0]?.agent ?? null;
}
```

把 `:1562-1568` 替换成：

```ts
        const agent = resolveAgentSlot(
          classroom.mode,
          classroom.groups,
          classroom.classroomAgents,
          classroomStudent.groupId,
        );
```

（保留紧随其后的 `if (!agent) { socket.emit('ai-error', { error: '未配置AI智能体' }); return; }` 不变。）

- [ ] **Step 10: 运行测试确认通过**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-agent-resolution.test.js
```

预期：6 pass / 0 fail。

- [ ] **Step 11: 写服务端集成测试**

追加到 `server/src/tests/classroom-webapp-link.test.ts`（它已经有真 Prisma + 真临时库的脚手架：`openTempDb` / `seed` / `startServer`）。

⚠️ `seed(prisma, webappCount)` 的返回值是 **`{ cls, student, agent, webapps }`** —— 智能体是**单数 `agent`**（见该文件 `:87-96`），不是数组。下面的用例已按此写。

```ts
test('高级模式：某一组不指定智能体 ⇒ 建得出来，该组 agentId 为 null', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '有一组不指定',
    classId: cls.id,
    groups: [
      { name: '第一组', agentId: agent.id },
      { name: '第二组', agentId: null },
    ],
  });
  const body = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(body));

  const groups = await db.prisma.classroomGroup.findMany({
    where: { classroomId: body.id! }, orderBy: { name: 'asc' },
  });
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.name === '第二组')!.agentId, null);

  // classroomAgents 只应含非空的那个，且不得含 null
  const links = await db.prisma.classroomAgent.findMany({ where: { classroomId: body.id! } });
  assert.deepEqual(links.map(l => l.agentId), [agent.id]);
});

test('🔴 高级模式：某组不指定 ⇒ GET /code/:code 返回 200（不是 500），该组 agent 为 null', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await (await server.post('/api/classroom/create-advanced', {
    title: '有一组不指定', classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id }, { name: '第二组', agentId: null }],
  })).json() as { id: string };
  const code = (await db.prisma.classroom.findUnique({ where: { id: created.id } }))!.code!;

  const res = await server.get(`/api/classroom/code/${code}`);
  const body = await res.json() as { groups?: { name: string; agent: unknown }[]; error?: string };
  // 原写法会在这里 500 —— 而且是**整间课堂**的学生都进不去，不只那一组。
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.groups!.find(g => g.name === '第二组')!.agent, null);
  assert.ok(body.groups!.find(g => g.name === '第一组')!.agent);
});

test('分组模式：不选智能体 + 选网页 ⇒ 200（回归原来的 500）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  // ⚠️ 分组模式要求「所选班级必须已有分组」，否则会先撞 :281 的 400。
  //    执行者需确认 seed 的班级是否有 ClassGroup；没有就自己建一个（见下方注释）。
  const { cls, webapps } = await seed(db.prisma, 1);
  await db.prisma.classGroup.create({ data: { classId: cls.id, name: '第一组', studentIds: '[]' } });
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create', {
    title: '分组只选网页', classIds: [cls.id], mode: 'group', webappIds: [webapps[0].id],
  });
  const body = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(await db.prisma.classroom.count(), before + 1);
  const groups = await db.prisma.classroomGroup.findMany({ where: { classroomId: body.id! } });
  assert.ok(groups.length > 0, '分组模式必须真的建出组');
  for (const group of groups) assert.equal(group.agentId, null, '分组模式没选智能体时每组都应为 null');
});

test('高级模式：所有组都不指定 + 没有网页 ⇒ 400（三件套至少一项）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create-advanced', {
    title: '全空', classId: cls.id,
    groups: [{ name: '第一组', agentId: null }, { name: '第二组', agentId: null }],
  });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /AI 智能体/);
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');
});

test('高级模式：agentId 传空串 ⇒ 落库为 null，不是空串', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '空串归一', classId: cls.id,
    groups: [{ name: '第一组', agentId: '' }], webappIds: [webapps[0].id],
  });
  const body = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(body));
  const group = (await db.prisma.classroomGroup.findMany({ where: { classroomId: body.id! } }))[0];
  assert.equal(group.agentId, null);
  // 直接查 null 必须能查到 —— 这正是「'' 与 null 归一」要保证的事
  assert.equal(await db.prisma.classroomGroup.count({ where: { agentId: null } }), 1);
});
```

- [ ] **Step 12: 跑全量测试与 tsc**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit
cd server && pnpm test 2>&1 | tail -20
```

预期：`tsc` 退出 0、零输出；测试 pass 相比 Task 1 之后继续增加、fail 为 0。

- [ ] **Step 13: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add server/prisma/schema.prisma server/src/routes/classroom.ts server/src/socket/index.ts server/src/tests/classroom-webapp-link.test.ts server/src/tests/group-agent-resolution.test.ts
git commit -m "feat(server): 分组可选智能体，并修掉静默回落、null 解引用与分组模式 500"
```

---

## Task 3: 前端创建页「不指定」

**Files:**
- Modify: `src/app/teacher/classroom/new/page.tsx:35,125,200,411,442-455,465-493,651-653`
- Modify: `src/lib/types.ts:394-398`
- Test: 手工（该页无既有自动化测试）

**Interfaces:**
- Consumes: Task 2 的 `POST /api/classroom/create-advanced` 接受 `agentId: string \| null`
- Produces: `AdvancedClassroomGroupInput.agentId: string | null`

- [ ] **Step 1: 改类型**

`src/lib/types.ts:394-398`：

```ts
export interface AdvancedClassroomGroupInput {
  name: string;
  /** `null` = 本组显式选了「不指定智能体」（三件套规则下合法）。 */
  agentId: string | null;
  studentIds: string[];
}
```

- [ ] **Step 2: 改状态模型**

`src/app/teacher/classroom/new/page.tsx:35`：

```tsx
  // 值语义（三者必须可区分，否则「不指定」会被当成「没配置」而拦住提交）：
  //   键不存在  = 还没选
  //   string    = 选了某个智能体
  //   null      = 显式选了「不指定」
  const [groupAgentIds, setGroupAgentIds] = useState<Record<string, string | null>>({});
```

- [ ] **Step 3: 改校验判据**

`:125` 那一行改成「每组都必须**做出决定**」：

```tsx
      // `in` 对 null 值为真、对缺失键为假 —— 正好是「必须做出决定」的判据。
      // ⚠️ 不要写回 `every(g => groupAgentIds[g.id])`：那样 null 会被当成未配置。
      const allDecided = classGroups.every(g => g.id in groupAgentIds);
      if (loadingGroups) errors.groupAgents = '班级分组仍在加载，请稍候';
      else if (classGroups.length === 0) errors.groupAgents = '当前班级没有可用分组，请重新选择班级';
      else if (!allDecided) errors.groupAgents = '请为每个小组选择智能体，或选择「不指定」';
```

- [ ] **Step 4: 改连带计数**（漏一处进度条就会撒谎）

`:200`：

```tsx
  const configuredGroupCount = classGroups.filter(g => g.id in groupAgentIds).length;
```

⚠️ 同时检查 `:213-215` 的步骤③完成度用的是 `configuredGroupCount === classGroups.length` —— 它不用改（口径随计数一起变了），但**必须打开确认**它引用的就是 `configuredGroupCount`，不是别的表达式。

- [ ] **Step 5: 加「不指定」选项**

`:465-493` 的选项列表，在 `agents.map(...)` **之前**插入一项。样式照抄相邻选项（`new/page.tsx:471-489` 实测），只去掉头像块：

```tsx
                      <button type="button" onClick={() => {
                        setGroupAgentIds(prev => ({ ...prev, [g.id]: null }));
                        clearError('groupAgents');
                        setOpenDropdownGroupId(null);
                      }}
                      style={{
                        width: '100%', border: 0, fontFamily: 'inherit', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', cursor: 'pointer', fontSize: "0.813rem",
                        background: groupAgentIds[g.id] === null ? '#eef2ff' : 'white',
                        transition: 'background 0.1s',
                        borderBottom: '1px solid #f1f5f9',
                      }}>
                        <div style={{ width: 20, height: 20, borderRadius: 4, background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.75rem", fontWeight: 700 }}>—</div>
                        <span style={{ color: '#64748b' }}>不指定（本组不使用 AI）</span>
                        {groupAgentIds[g.id] === null && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="#2563eb" stroke="white" strokeWidth="3" style={{ marginLeft: 'auto' }}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
```

⚠️ 触发器的三态渲染（`:442-455` 现在把空值渲染成灰字「选择AI智能体」）必须一起改，否则「不指定」与「还没选」在触发器上长得一样：

```tsx
  const picked = groupAgentIds[g.id];
  const hasDecided = g.id in groupAgentIds;
  // 未决定 → 灰字提示；决定为 null → 明确显示「不指定」；否则显示智能体名
```

`:411` 的「必填」标记**保留**（「必须做出决定」仍然是必填）。

- [ ] **Step 6: 改底部摘要**

`:651-653`：保留 `{configuredGroupCount}/{classGroups.length} 个小组已配置`，并追加未指定计数：

```tsx
  {(() => {
    const unspecified = classGroups.filter(g => g.id in groupAgentIds && groupAgentIds[g.id] === null).length;
    return unspecified > 0 ? `（${unspecified} 个未指定智能体）` : null;
  })()}
```

- [ ] **Step 7: 手工验证**

```bash
cd /Users/zxc/myprojects/classnode && ./dev.sh start && ./dev.sh status
```

浏览器打开 `http://localhost:4000/teacher/classroom/new/`，选一个**有分组的班级** + 高级模式，逐条走：

- 什么都不选 ⇒ 提交被拦住，文案含「或选择「不指定」」
- 每组都选智能体 ⇒ 与改动前行为一致
- 某组选「不指定」⇒ 触发器显示「不指定」，摘要出现「（1 个未指定智能体）」，提交成功
- 「不指定」与「还没选」在视觉上**可区分**

- [ ] **Step 8: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add src/app/teacher/classroom/new/page.tsx src/lib/types.ts
git commit -m "feat(teacher): 新建课堂支持每组「不指定智能体」"
```

---

## Task 4: 前端展示层不再回落到别组的智能体

**Files:**
- Create: `src/lib/classroom-agent.ts`
- Modify: `src/app/classroom/chat/chat-panel.tsx:296-302`
- Modify: `src/app/classroom/home/student-home.tsx:147-154`
- Modify: `src/lib/types.ts`（`agent` 改可空）、`src/lib/socket-events.ts:9`

**Interfaces:**
- Consumes: Task 2 的服务端下发形状（`groups[].agent` 可为 null）
- Produces: `effectiveAgentFor(classroom, selectedStudent): AgentSummary | null`

- [ ] **Step 1: 建解析函数**

新建 `src/lib/classroom-agent.ts`：

```ts
import type { AgentSummary } from './types';

interface ClassroomAgentShape {
  mode?: string;
  groups?: { id: string; agent?: AgentSummary | null }[];
  agents?: AgentSummary[];
}

/**
 * 「这个学生此刻实际生效的智能体」——**唯一**的解析口径。
 *
 * ⚠️ 抽出来是因为原来有两个各写一份的回落（chat-panel 与 student-home），而那个回落
 * 在高级模式下是**错的**：`classroom.agents` 是各组智能体的并集
 * （server/src/routes/classroom.ts:437-438 派生），组里没智能体时回落到它
 * 会显示**别人组的名字和头像** —— 即使服务端已经改对了，界面仍然在撒谎。
 */
export function effectiveAgentFor(
  classroom: ClassroomAgentShape | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): AgentSummary | null {
  if (!classroom) return null;

  const isGrouped = classroom.mode === 'group' || classroom.mode === 'advanced';
  if (isGrouped) {
    // 分组/高级：只认自己的组。组没有智能体 ⇒ 没有，**不回落**。
    const group = selectedStudent?.groupId
      ? classroom.groups?.find(item => item.id === selectedStudent.groupId)
      : undefined;
    return group?.agent ?? null;
  }

  // 标准模式：没有组的语义，课堂第一个智能体就是它。
  return classroom.agents?.[0] ?? null;
}
```

- [ ] **Step 2: 替换 chat-panel 的回落**

`src/app/classroom/chat/chat-panel.tsx:296-302` 整个 `getCurrentAgent` 函数体替换为对 `effectiveAgentFor` 的调用（保留函数名与调用点不变，最小改动）：

```tsx
  const getCurrentAgent = () => effectiveAgentFor(classroom, selectedStudent);
```

并在文件顶部加 import。⚠️ 先确认 `renderAgentAvatar`（`:304-320`）与 `:712` 对 `null` 的处理仍然是既有的「占位渐变块 + `theAgent?.name?.[0] || 'AI'`」——**保持不变**。

- [ ] **Step 3: 替换 student-home 的回落**

`src/app/classroom/home/student-home.tsx:147-154` 同样改为 `effectiveAgentFor(classroom, selectedStudent)`，`?? fallbackName`（`MODULE_META.companion.label`）的兜底**保留**。

- [ ] **Step 4: 改类型**

`src/lib/types.ts` 里 `groups[].agent` 由 `AgentSummary` 改为 `AgentSummary | null`（约 `:302`/`:322`/`:355` 三处，执行者用 `grep -n "agent:" src/lib/types.ts` 逐个确认哪些属于 `groups`）；`src/lib/socket-events.ts:9`（`joined` 事件）同步。

⚠️ 只改 `groups` 下的那个 `agent`。`agents[]` 里的元素类型、`classroomAgents` 等不受影响。

- [ ] **Step 5: 验证**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit
npx eslint src/app/classroom/ src/lib/
```

两者均退出 0。然后 `pnpm build`（先 `./dev.sh stop`）确认学生端 bundle 仍通过 Safari 15 兼容闸门。

- [ ] **Step 6: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add src/lib/classroom-agent.ts src/lib/types.ts src/lib/socket-events.ts src/app/classroom/chat/chat-panel.tsx src/app/classroom/home/student-home.tsx
git commit -m "fix(classroom): 学生端智能体解析不再回落到别组的智能体"
```

---

## Task 5: 门禁与端到端验收

**Files:** 无（只验证）

- [ ] **Step 1: 全量门禁**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit                       # 退出 0、零输出
npx eslint src/app/classroom/ src/lib/ # 退出 0
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
cd server && pnpm test 2>&1 | tail -20
```

记下每一步的实际输出。`./dev.sh status` 必须显示 **4000 与 4001 都在**。

- [ ] **Step 2: 真实库迁移演练（用副本，不碰真实库）**

```bash
cd /Users/zxc/myprojects/classnode
cp server/prisma/dev.db /tmp/cn-migrate-check.db
```

用 `DATABASE_URL="file:/tmp/cn-migrate-check.db"` 启动服务（**不是** `server/prisma/dev.db`），观察启动日志：

- [ ] 出现 `Database backup created: .../before-classroom-group-nullable-agent-*.db`
- [ ] 出现 `ClassroomGroup nullable-agent migration complete`
- [ ] `sqlite3 /tmp/cn-migrate-check.db ".schema ClassroomGroup"` 显示 `"agentId" TEXT`（不再有 `NOT NULL`），且具名 CONSTRAINT 与索引逐字保留
- [ ] 与 `server/prisma/dev.db` 做 `pragma_table_info` 规范化对比，差异**只有 `agentId` 那一行**
- [ ] 再启动一次：日志里**没有**第二次备份、没有第二次重建（标记生效）
- [ ] 演练完 `rm -f /tmp/cn-migrate-check.db` 及其 `backups/` 目录

- [ ] **Step 3: 端到端手工验收（照 spec §七）**

逐条走完 spec 的 A/B/C/D 四段清单（迁移、创建与运行、回归、门禁），每条记录实测结果。特别确认：

- [ ] 🔴 高级模式某组「不指定」的学生发消息得到「未配置AI智能体」，且**没有**用到任何其它组的智能体
- [ ] `GET /api/classroom/code/<code>` 对含空智能体组的课堂返回 200
- [ ] 分组模式不选智能体 + 选网页 ⇒ 200
- [ ] 标准模式「只选网页不选智能体」照旧 200

- [ ] **Step 4: 汇总报告**

报告里必须包含：`git diff --stat`、改动前后行数、**「有没有删除任何既有行为」的明确回答**、以及每条「通过」所依据的实际命令输出。**没有命令输出的「通过」不算证据。**

---

## 交付边界（本计划不做）

- **不隐藏学伴模块。** 没配智能体的组，学生仍看得到「智能学伴」tab，发消息得到「未配置AI智能体」。这是用户 2026-09-22 确认的语义。
- **不加「进门常驻提示」。**
- **教师端可见性不动**（仪表盘设置弹窗已能显示「未配置」）。
- **不做「运行时改组绑定」**——创建后不可更改的既有产品决定不变。
- **不动探究网页那一侧。**
