# 按组的课堂材料 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 高级模式下每个小组各自指定 AI 智能体与探究网页（学习单将来同样），用一张 `kind` 关联表统一承载。

**Architecture:** 新增 `ClassroomGroupMaterial(groupId, kind, targetId)`；把 `ClassroomGroup.agentId` 整列**迁进去并删掉**（不是改成可空）；同时把「课堂级网页」在高级模式下实体化成每组一份，避免行为回归。`targetId` 是多态的、**没有真外键** —— 补偿是删除守卫扩到新表 + 运行期容忍悬空（读不到就当未配置）。

**Tech Stack:** Prisma + SQLite（`server/`，ESM + TypeScript）；Next.js 15 静态导出 + React 18（`src/`）；Node 内置测试运行器（`node --test`）。

**Spec:** `specs/2026-09-22-p2-group-materials.md` —— **本计划从它论证，执行者两份都要读。** 它的 §1.2 列了三处既有缺陷的 file:line 证据，§5 记了「为什么不是把 agentId 改成可空」的取舍。

## Global Constraints

1. 既有测试必须继续全过。**基线以任务 0 的实测为准**（控制器在 2026-09-22 实测：**272 pass / 0 fail**）。
2. 不得出现 regex lookbehind；不得使用 `Object.hasOwn` / `structuredClone` / `Array.prototype.at` / `findLast` / `:has()` / `@container` / `content-visibility`。构建期闸门会 fail。
3. **不新增任何 npm 依赖。**
4. 提交信息中文，格式 `<type>(scope): <做了什么>`。报告、注释、过程旁白一律中文；引用的原始输出保持原样不翻译。
5. 🔴 **绝不 `prisma db push` 打在真实库上（`server/prisma/dev.db`）。** 本任务要在临时库上跑 `db push` 只为**导出权威 DDL** —— 必须 `DATABASE_URL="file:/tmp/…"`，用完删掉。这条踩过一次，删掉了活库一整列。
6. 不要用 `reset-password` 造教师数据（它会 `revokeAllTeacherSessions()`）。
7. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
8. **跑 `pnpm build` 之前先 `./dev.sh stop`，跑完 `./dev.sh start`，最后 `./dev.sh status` 复核 4000/4001 都在。** 被踩过三次。
9. **不碰** `CLAUDE.md` / `dev.sh` / `package.json`。
10. 测试若改数据库，必须逐表还原并给出证据。造测试数据一律用 `/tmp` 下的副本库。
11. 🔴 **任何「因此不扫 / 排除 / 安全 / 可以忽略」的结论，必须附一条命令或一段实测输出。**
12. **`server` 包里 `test` 的脚本本身是 `pnpm build && node --test dist/tests/*.test.js`**，**已经含编译**，不要额外跑 `build:server`（那是根包脚本，`server/` 下不存在）。

---

## Task 0: 前置（不写代码）

**Files:** 无

- [ ] **Step 1: 确认工作区干净**

```bash
cd /Users/zxc/myprojects/classnode && git status --porcelain
```

预期：只有 `?? design/`（设计稿，未跟踪，与本任务无关）。**若有别的，停下来找用户** —— 这次要在真实库上做表重建与数据搬迁，没有可对照的 HEAD 就分不清是谁造成的。

- [ ] **Step 2: 记录测试基线**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm test 2>&1 | tail -8
```

> **控制器 2026-09-22 实测：272 pass / 0 fail。** 记下你实测的数字，写进报告，后面每步的「全过」都以它为准。

- [ ] **Step 3: 记录 tsc / lint 基线**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit                        # 预期：退出 0、零输出
npx eslint src/app/classroom/ src/lib/  # 预期：退出 0、恰好 1 条既有 warning（use-student-session.ts 的 tokenData）
```

---

## Task 1: 迁移模块（权威 DDL + 搬数据 + 实体化 + 重建）

**Files:**
- Create: `server/src/services/group-materials-migration.ts`
- Create: `server/src/tests/group-materials-migration.test.ts`
- Modify: `server/src/index.ts`（在既有的 participant 迁移之后调用它）

**Interfaces:**
- Consumes: `index.ts:39-53` 已有的备份函数（本任务把它泛化成 `backupDatabase(label)`）
- Produces:
  - `export function needsGroupMaterialsMigration(columns: { name: string; notnull: number }[]): boolean`
  - `export async function ensureGroupMaterials(prisma: PrismaClient, backup: (label: string) => string | null): Promise<'skipped' | 'migrated'>`

> **本任务不改 `schema.prisma`**（所以 `tsc` 全程是绿的，不与 Task 2 冲突）。新表的 DDL 直接写进迁移文件里 —— 逐字取自下面的实测。

- [ ] **Step 1: 先导出权威 DDL（在临时库上，不碰真实库）**

先看当前真实库里 `ClassroomGroup` 长什么样（**只读**）：

```bash
cd /Users/zxc/myprojects/classnode
sqlite3 -readonly server/prisma/dev.db ".schema ClassroomGroup"
```

把 `schema.prisma` 复制到 `/tmp`，在副本上做**两处**改动：新增 `ClassroomGroupMaterial` 模型；从 `ClassroomGroup` 删掉 `agentId` 与 `agent` 两行（并把 `ClassroomGroup` 上的 `Agent` 关系一起删）。

```bash
rm -rf /tmp/gm-probe && mkdir -p /tmp/gm-probe
# 手工编辑 /tmp/gm-probe/schema.prisma（见上），然后：
cd server && DATABASE_URL="file:/tmp/gm-probe/probe.db" ./node_modules/.bin/prisma db push --schema /tmp/gm-probe/schema.prisma --skip-generate
sqlite3 -readonly /tmp/gm-probe/probe.db ".schema ClassroomGroup"
sqlite3 -readonly /tmp/gm-probe/probe.db ".schema ClassroomGroupMaterial"
```

**把这两段输出原样贴进报告。** 预期形状（**以实测为准，不要照抄这段**）：

```sql
CREATE TABLE "ClassroomGroupMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomGroupMaterial_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClassroomGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClassroomGroupMaterial_groupId_kind_key" ON "ClassroomGroupMaterial"("groupId", "kind");
CREATE INDEX "ClassroomGroupMaterial_kind_targetId_idx" ON "ClassroomGroupMaterial"("kind", "targetId");
```

⚠️ 重建后的 `ClassroomGroup` 必须**只少掉 `agentId` 一列**，具名 CONSTRAINT、`ON UPDATE CASCADE`、索引名逐字保留。做完 `rm -rf /tmp/gm-probe`。

- [ ] **Step 2: 写失败测试：探测函数**

新建 `server/src/tests/group-materials-migration.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { needsGroupMaterialsMigration } from '../services/group-materials-migration.js';

// 探测抽成纯函数，是为了能直接喂两种列形状做正反断言 ——
// 集成测试里「读不到列」与「已经是新形状」会走向同一个分支，区分不开。
test('探测：ClassroomGroup 还有 agentId ⇒ 需要迁移', () => {
  assert.equal(needsGroupMaterialsMigration([{ name: 'id', notnull: 1 }, { name: 'agentId', notnull: 1 }]), true);
});

test('探测：agentId 已不在 ⇒ 不需要迁移', () => {
  assert.equal(needsGroupMaterialsMigration([{ name: 'id', notnull: 1 }, { name: 'name', notnull: 1 }]), false);
});

// 🔴 反证（阴性对照）：列清单为空时不得判定为「需要迁移」——
// 那会让一个**全新安装**（表由 db push 按新 schema 建出）也走重建路径。
test('反证：空列清单 ⇒ 不需要迁移', () => {
  assert.equal(needsGroupMaterialsMigration([]), false);
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-materials-migration.test.js
```

预期：FAIL —— 模块不存在。

- [ ] **Step 4: 写模块骨架与探测函数**

新建 `server/src/services/group-materials-migration.ts`：

```ts
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * 「按组的课堂材料」的结构迁移（见 specs/2026-09-22-p2-group-materials.md §4.2）。
 *
 * 它做三件事，**顺序不能换**：
 *   ① 建 `ClassroomGroupMaterial` 表；
 *   ② 把 `ClassroomGroup.agentId` 每一行搬成一行 `kind='agent'`；
 *   ③ 把「课堂级网页」在**高级模式**的课堂里实体化成每组一份 ——
 *      ⚠️ 少了这一步就是**行为回归**：改成按组之后，每个组的「没配」都会触发
 *      「不回落」，那些课堂会突然什么都看不到。
 * 然后重建 `ClassroomGroup` 去掉 `agentId` 列。
 *
 * ⚠️ SQLite 不支持 `DROP COLUMN` 到我们需要的程度，所以是**表重建** —— 与
 * `participant-migration.ts:84-114` 同一套范式。那张表被两张子表外键引用，
 * 重建期间必须关掉外键，而 `PRAGMA foreign_keys` **按连接生效且事务内无效**。
 */

type TableInfoRow = { name: string; notnull: number };

const MIGRATION_MARKER = 'classroom-group-materials-migration-v1';

/**
 * 纯探测：`ClassroomGroup` 上还有没有 `agentId` 列。
 *
 * 抽成纯函数是为了能直接喂两种列形状做正反断言。
 * ⚠️ 空数组（表不存在 / 读不到）**不触发迁移** —— 全新安装的表由 db push 按新
 * schema 建出、本来就没有这一列；「表结构根本不对」是另一种情况，静默重建会掩盖它。
 */
export function needsGroupMaterialsMigration(columns: TableInfoRow[]): boolean {
  if (columns.length === 0) return false;
  return columns.some((column) => column.name === 'agentId');
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-materials-migration.test.js
```

预期：3 pass / 0 fail。

- [ ] **Step 6: 写失败测试：真库级迁移行为（造旧表 + 子表数据）**

追加到同一个测试文件。**这一段是本任务的核心，也是防假绿的关键。**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensureGroupMaterials } from '../services/group-materials-migration.js';

/**
 * 🔴 手工造一张**旧形状**的库，而不是让 `prisma db push` 建。
 *
 * 本仓现有的临时库都是 `db push` 建的（`classroom-webapp-link.test.ts:21-30`），
 * 那种库里 `ClassroomGroup` **天生就是没有 agentId 的新形状** ⇒ 拿它测迁移会
 * **永远绿**，而真实老库仍然坏。这是本项目反复出现的假绿形态。
 *
 * 🔴 必须带**两张子表与子表数据**。`PRAGMA foreign_keys` 是按**连接**生效的
 * （Prisma 有连接池），pragma 一旦没落在执行 `DROP TABLE` 的那条连接上，
 * SQLite 的隐式 `DELETE FROM` 会触发子表的外键动作 ——
 * `ClassroomStudent.groupId` 是 **ON DELETE SET NULL**（全组学生的分组被清空）、
 * `ClassroomGroupMember.groupId` 是 **ON DELETE CASCADE**（成员快照被整批删除）。
 * 没有子表数据，这个测试**测不到**它，而且是静默的数据销毁。
 */
async function openLegacyDb(): Promise<{ prisma: PrismaClient; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-gm-mig-'));
  const file = path.join(dir, 'legacy.db');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Classroom" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Agent" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Webapp" ("id" TEXT NOT NULL PRIMARY KEY)`);
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
  // 实体化那一步要读的两张表
  await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomWebapp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "webappId" TEXT NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Setting" ("id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "value" TEXT NOT NULL)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key")`);
  return { prisma, dir };
}

test('迁移：旧表的 agentId 变成材料行；子表数据逐行幸存；列被删掉', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });

  await prisma.$executeRawUnsafe(`INSERT INTO "Classroom" ("id") VALUES ('c1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Agent" ("id") VALUES ('a1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Webapp" ("id") VALUES ('w1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroup" ("id","classroomId","name","agentId","sourceClassGroupId")
    VALUES ('g1','c1','第一组','a1','sg1'), ('g2','c1','第二组','a1',NULL)`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomStudent" ("id","classroomId","groupId") VALUES ('cs1','c1','g1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroupMember" ("id","classroomId","groupId","name") VALUES ('gm1','c1','g1','张三')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomWebapp" ("id","classroomId","webappId") VALUES ('cw1','c1','w1')`);

  const backupCalls: string[] = [];
  const result = await ensureGroupMaterials(prisma, (label) => { backupCalls.push(label); return '/tmp/fake-backup.db'; });
  assert.equal(result, 'migrated');
  assert.equal(backupCalls.length, 1, '确实需要迁移时必须且只备份一次');

  // ① 列没了
  const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('ClassroomGroup')`);
  assert.equal(needsGroupMaterialsMigration(columns), false, 'agentId 必须已经不在了');

  // ② 组本身逐行不变
  const groups = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "id","classroomId","name","sourceClassGroupId" FROM "ClassroomGroup" ORDER BY "id"`,
  );
  assert.deepEqual(groups, [
    { id: 'g1', classroomId: 'c1', name: '第一组', sourceClassGroupId: 'sg1' },
    { id: 'g2', classroomId: 'c1', name: '第二组', sourceClassGroupId: null },
  ]);

  // ③ 每个非空 agentId 恰好一行 kind='agent'
  const agentRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "groupId","kind","targetId" FROM "ClassroomGroupMaterial" WHERE "kind"='agent' ORDER BY "groupId"`,
  );
  assert.deepEqual(agentRows, [
    { groupId: 'g1', kind: 'agent', targetId: 'a1' },
    { groupId: 'g2', kind: 'agent', targetId: 'a1' },
  ]);

  // 🔴 ④ 子表数据必须**原样幸存**。这两条是 `PRAGMA foreign_keys` 那个
  //     「按连接生效」的坑的判据：pragma 没生效时 DROP TABLE 会触发
  //     ON DELETE SET NULL / CASCADE，下面两条会分别看到 null 与「行没了」。
  const students = await prisma.$queryRawUnsafe<{ id: string; groupId: string | null }[]>(
    `SELECT "id","groupId" FROM "ClassroomStudent"`,
  );
  assert.deepEqual(students, [{ id: 'cs1', groupId: 'g1' }], '学生的分组不得被 SET NULL');
  const members = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "ClassroomGroupMember"`);
  assert.deepEqual(members.map((m) => m.id), ['gm1'], '成员快照不得被级联删除');

  // ⑤ 索引仍在
  const indexes = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ClassroomGroup' AND name NOT LIKE 'sqlite_%'`,
  );
  assert.deepEqual(indexes.map((i) => i.name), ['ClassroomGroup_classroomId_idx']);
});

test('🔴 迁移：高级模式 + 有课堂级网页 ⇒ 实体化成每组一份（否则是行为回归）', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });

  await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'standard'`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Classroom" ("id","mode") VALUES ('c-adv','advanced'), ('c-std','standard')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Agent" ("id") VALUES ('a1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Webapp" ("id") VALUES ('w1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroup" ("id","classroomId","name","agentId")
    VALUES ('g-adv','c-adv','甲组','a1'), ('g-std','c-std','乙组','a1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomWebapp" ("id","classroomId","webappId")
    VALUES ('cw-adv','c-adv','w1'), ('cw-std','c-std','w1')`);

  await ensureGroupMaterials(prisma, () => '/tmp/fake.db');

  const webappRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "groupId","kind","targetId" FROM "ClassroomGroupMaterial" WHERE "kind"='webapp' ORDER BY "groupId"`,
  );
  assert.deepEqual(
    webappRows,
    [{ groupId: 'g-adv', kind: 'webapp', targetId: 'w1' }],
    '**只有高级模式**的组要实体化 —— 标准/分组模式继续用课堂级网页，不该长出组级行',
  );
});

test('迁移：标记已置位 ⇒ 重复调用是空操作（不重复备份）', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  await ensureGroupMaterials(prisma, () => '/tmp/fake.db');
  const backupCalls: string[] = [];
  assert.equal(await ensureGroupMaterials(prisma, (l) => { backupCalls.push(l); return '/tmp/fake.db'; }), 'skipped');
  assert.equal(backupCalls.length, 0);
});

// 🔴 反证：备份失败必须**中止**，不得照常改表。
test('迁移：备份失败 ⇒ 抛错中止，表结构原样不动', async (t) => {
  const { prisma, dir } = await openLegacyDb();
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });

  await assert.rejects(() => ensureGroupMaterials(prisma, () => null), /备份失败/);

  const columns = await prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>(`PRAGMA table_info('ClassroomGroup')`);
  assert.equal(needsGroupMaterialsMigration(columns), true, '中止后必须仍是旧结构 —— 没有备份就没有回滚依据');
});
```

- [ ] **Step 7: 跑测试确认失败**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-materials-migration.test.js
```

预期：FAIL —— `ensureGroupMaterials` 未导出。

- [ ] **Step 8: 实现迁移**

追加到 `server/src/services/group-materials-migration.ts`（DDL 用 Step 1 实测出来的那一份，**逐字**）：

```ts
/**
 * 建新表 + 搬数据 + 实体化 + 重建 ClassroomGroup（去掉 agentId）。
 *
 * ⚠️ 顺序是硬的：**实体化必须在 agentId 搬完之后、标记置位之前**。
 * ⚠️ 不得包进 `$transaction`（`PRAGMA foreign_keys` 在事务内无效）。
 */
export async function ensureGroupMaterials(
  prisma: PrismaClient,
  backup: (label: string) => string | null,
): Promise<'skipped' | 'migrated'> {
  const done = await prisma.setting.findUnique({ where: { key: MIGRATION_MARKER } }).catch(() => null);
  if (done) return 'skipped';

  const columns = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('ClassroomGroup')`);
  if (!needsGroupMaterialsMigration(columns)) {
    await prisma.setting.upsert({
      where: { key: MIGRATION_MARKER },
      update: { value: 'skipped' },
      create: { key: MIGRATION_MARKER, value: 'skipped' },
    });
    return 'skipped';
  }

  // 改的是结构 + 搬数据，没有备份就没有回滚依据 ⇒ 失败必须中止。
  const backupPath = backup('classroom-group-materials');
  if (!backupPath) throw new Error('[server] 课堂材料迁移中止：备份失败，未改动任何表结构');
  console.log(`[server] Database backup created: ${backupPath}`);

  // ① 建新表（DDL 逐字取自临时库 db push 后的 dump —— 见计划 Task 1 Step 1）
  await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomGroupMaterial" ( ... )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomGroupMaterial_groupId_kind_key" ON "ClassroomGroupMaterial"("groupId", "kind")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroupMaterial_kind_targetId_idx" ON "ClassroomGroupMaterial"("kind", "targetId")`);

  // ② 搬 agentId。⚠️ `@default(uuid())` 是 **Prisma 客户端**生成的，
  //    手写 SQL 必须自己给 id —— 所以逐行在 JS 里生成，不用 SQL 拼 uuid。
  //    量级是「每节课每组一行」，几十行，逐条没有性能问题，
  //    而 SQL 拼出来的 uuid 格式一旦与客户端不同，会带来很难查的后续问题。
  const legacyGroups = await prisma.$queryRawUnsafe<{ id: string; agentId: string | null }[]>(
    `SELECT "id", "agentId" FROM "ClassroomGroup"`,
  );
  for (const group of legacyGroups) {
    if (!group.agentId) continue;
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "ClassroomGroupMaterial" ("id","groupId","kind","targetId") VALUES (?, ?, 'agent', ?)`,
      randomUUID(), group.id, group.agentId,
    );
  }

  // ③ 实体化：高级模式 + 有课堂级网页 ⇒ 给它的**每个组**写一行 kind='webapp'。
  //    少了这一步，改成按组之后每个组都会「没配」⇒ 触发「不回落」⇒ 已经存在的
  //    课堂突然什么都看不到。这是**行为回归**，不是清理。
  const advancedWithWebapp = await prisma.$queryRawUnsafe<{ classroomId: string; webappId: string }[]>(
    `SELECT c."id" AS classroomId, cw."webappId" AS webappId
       FROM "Classroom" c
       JOIN "ClassroomWebapp" cw ON cw."classroomId" = c."id"
      WHERE c."mode" = 'advanced'`,
  );
  for (const row of advancedWithWebapp) {
    const groups = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "ClassroomGroup" WHERE "classroomId" = ?`, row.classroomId,
    );
    for (const group of groups) {
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "ClassroomGroupMaterial" ("id","groupId","kind","targetId") VALUES (?, ?, 'webapp', ?)`,
        randomUUID(), group.id, row.webappId,
      );
    }
  }

  // ④ 重建 ClassroomGroup 去掉 agentId。
  // ⚠️ 顺序必须 DROP 旧表 → RENAME 新表（不能反过来）：SQLite ≥3.25 的
  //    ALTER TABLE ... RENAME 会改写其它表里指向被改表名的 REFERENCES 子句，
  //    先 RENAME 旧表会把子表的外键指到一个临时表名上。
  // ⚠️ 必须走 INSERT SELECT 把列显式列出来（重建后列少了）。
  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE "new_ClassroomGroup" ( ... 见实测 ... )`);
    await prisma.$executeRawUnsafe(`INSERT INTO "new_ClassroomGroup" ("id","classroomId","name","sourceClassGroupId")
      SELECT "id","classroomId","name","sourceClassGroupId" FROM "ClassroomGroup"`);
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
  console.log('[server] Classroom group materials migration complete');
  return 'migrated';
}
```

⚠️ 上面三处 `...` 是**省略号，不是占位符**：它们的完整内容就是你 Step 1 从临时库 dump 出来的原文。**照抄，不要自己写。**

- [ ] **Step 9: 跑测试确认通过**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-materials-migration.test.js
```

预期：6 pass / 0 fail。

- [ ] **Step 10: 泛化备份函数并接线**

`server/src/index.ts:39-53` 的 `backupDatabaseBeforeParticipantMigration()` 改名成 `backupDatabase(label)`，文件名 `before-${label}-<stamp>.db`；**既有那条迁移的 label 用 `participant-migration`**，保证它产出的文件名与历史上已有的备份逐字一致。然后在既有的 participant 迁移块（`:384-400`）**之后**插入：

```ts
  // 「按组的课堂材料」：新增 ClassroomGroupMaterial，并把 ClassroomGroup.agentId 迁进去、删列。
  // ⚠️ 必须排在上面那条参与者迁移之后 —— 那条保证 ClassroomGroup 的结构已经是它预期的形状。
  try {
    await ensureGroupMaterials(prisma, backupDatabase);
  } catch (e) {
    console.error('[server] Classroom group materials migration failed:', e);
    throw e;
  }
```

- [ ] **Step 11: 跑全量测试**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm test 2>&1 | tail -8
```

预期：与 Step 2 的基线相比 **pass 增加 6、fail 仍为 0**。

- [ ] **Step 12: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add server/src/services/group-materials-migration.ts server/src/tests/group-materials-migration.test.ts server/src/index.ts
git commit -m "feat(server): 按组课堂材料的结构迁移（建表 + 搬 agentId + 实体化网页 + 删列）"
```

---

## Task 2: schema + 服务端全链路

**Files:**
- Modify: `server/prisma/schema.prisma`（新增 `ClassroomGroupMaterial`；`ClassroomGroup` 删 `agentId`/`agent`）
- Modify: `server/src/routes/classroom.ts`（高级创建 / 读路径 / 分组模式的 500）
- Modify: `server/src/socket/index.ts`（智能体解析）
- Modify: `server/src/routes/agents.ts`、`server/src/routes/webapps.ts`（删除守卫与 usage）
- Create: `server/src/services/group-material-resolve.ts`
- Test: `server/src/tests/group-material-resolve.test.ts`（新建）、`classroom-webapp-link.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的表
- Produces:
  ```ts
  export function resolveMaterialTargetId(input: {
    mode: string;
    studentGroupId: string | null | undefined;
    groupMaterials: { groupId: string; kind: string; targetId: string }[];
    classroomLevelId: string | null;
    kind: 'agent' | 'webapp';
  }): string | null;
  ```

- [ ] **Step 1: 改 schema**

`server/prisma/schema.prisma`：

```prisma
/// 小组级课堂材料：高级模式下每个小组各自指定的智能体 / 探究网页 /（将来）学习单。
/// ⚠️ `targetId` 是**多态**的（Agent.id / Webapp.id / 将来 Worksheet.id），
/// 所以**没有真外键** —— 补偿是 routes 里的删除守卫（见 agents.ts / webapps.ts），
/// 以及运行期容忍悬空 id（读不到 ⇒ 当作未配置）。
model ClassroomGroupMaterial {
  id        String   @id @default(uuid())
  groupId   String
  kind      String
  targetId  String
  createdAt DateTime @default(now())

  group ClassroomGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  /// 每组每种材料**至多一个** ⇒ 「单选」是数据库层面的约束，不是 UI 约定。
  @@unique([groupId, kind])
  /// 反查「这个材料被哪些组用了」—— 删除守卫与 /usage 走这条。
  @@index([kind, targetId])
}
```

`ClassroomGroup` 里**删掉这两行**：

```prisma
  agentId    String // 该组绑定的智能体
  agent     Agent           @relation(fields: [agentId], references: [id], onDelete: Cascade)
```

并加上 `materials ClassroomGroupMaterial[]`。

- [ ] **Step 2: 生成客户端并记录错误**

```bash
cd /Users/zxc/myprojects/classnode && pnpm --filter classnode-server db:generate
npx tsc --noEmit 2>&1 | head -30
```

把每一条错误记进报告 —— 那是这次改动的**真实影响面**，后面每一步都在消它。

- [ ] **Step 3: 写失败测试：材料解析纯函数**

新建 `server/src/tests/group-material-resolve.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMaterialTargetId } from '../services/group-material-resolve.js';

const base = { groupMaterials: [], classroomLevelId: null as string | null };

test('高级模式：自己组有 ⇒ 用它', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g1', kind: 'agent', targetId: 'a1' }], kind: 'agent',
    classroomLevelId: 'a-class' });
  assert.equal(got, 'a1');
});

// 🔴 本改动最严重的一处。反证：课堂级**故意**放一个别的组的材料，
//    断言学生没有拿到它 —— 这条如果红，说明回落还在。
test('🔴 高级模式：自己组没有 ⇒ null，**不得**用课堂级的顶上', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g2', kind: 'agent', targetId: 'a2' }], kind: 'agent',
    classroomLevelId: 'a-class' });
  assert.equal(got, null, '不得回落到课堂级 —— 那是「静默用错别人的材料」');
});

test('高级模式：找不到自己的组 ⇒ null（不回落）', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g-missing',
    groupMaterials: [{ groupId: 'g1', kind: 'agent', targetId: 'a1' }], kind: 'agent', classroomLevelId: 'a-class' });
  assert.equal(got, null);
});

test('高级模式：材料行存在但 kind 对不上 ⇒ null（kind 是判据的一部分）', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g1', kind: 'webapp', targetId: 'w1' }], kind: 'agent', classroomLevelId: 'a-class' });
  assert.equal(got, null);
});

test('标准/分组模式：用课堂级那一个', () => {
  for (const mode of ['standard', 'group']) {
    const got = resolveMaterialTargetId({ ...base, mode, studentGroupId: 'g1',
      groupMaterials: [{ groupId: 'g1', kind: 'agent', targetId: 'a-group' }], kind: 'agent',
      classroomLevelId: 'a-class' });
    assert.equal(got, 'a-class', `${mode} 必须用课堂级 —— 那个模式全班共用一套材料`);
  }
});

test('标准模式：课堂级也没有 ⇒ null', () => {
  assert.equal(resolveMaterialTargetId({ ...base, mode: 'standard', studentGroupId: null, kind: 'agent' }), null);
});
```

- [ ] **Step 4: 跑测试确认失败**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-material-resolve.test.js
```

预期：FAIL —— 模块不存在。

- [ ] **Step 5: 实现纯函数**

新建 `server/src/services/group-material-resolve.ts`：

```ts
/**
 * 「该学生此刻该用哪一份材料」——**唯一**的解析口径。
 *
 * 抽成纯函数是为了逐组合断言。这三行是本改动最危险的地方：内联在
 * send-message 处理器里只能靠端到端手测。
 *
 * 🔴 **高级模式下不得回落到课堂级**。实测过的一种形态：那个数组在高级模式下曾是
 * 「各组材料的并集」，回落到它等于让学生静默地用另一个组的智能体/网页，
 * 而 AI 正常回答、教师完全看不出（见 spec §1.2 ①）。
 */
export function resolveMaterialTargetId(input: {
  mode: string;
  studentGroupId: string | null | undefined;
  groupMaterials: { groupId: string; kind: string; targetId: string }[];
  classroomLevelId: string | null;
  kind: 'agent' | 'webapp';
}): string | null {
  if (input.mode === 'advanced') {
    if (!input.studentGroupId) return null;
    const hit = input.groupMaterials.find(
      (m) => m.groupId === input.studentGroupId && m.kind === input.kind,
    );
    return hit ? hit.targetId : null;   // 没有就是没有，**不回落**
  }
  return input.classroomLevelId;
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
cd /Users/zxc/myprojects/classnode/server && pnpm build && node --test dist/tests/group-material-resolve.test.js
```

预期：6 pass / 0 fail。

- [ ] **Step 7: 改写入路径（高级创建）**

`server/src/routes/classroom.ts` 的高级创建处理器：

1. 窄化（`:373-379`）改成三种材料，**空串与缺字段一律归一成 `null`**：

```ts
      const toId = (raw: unknown): string | null =>
        (typeof raw === 'string' && raw.trim() ? raw.trim() : null);
      return {
        name: typeof input.name === 'string' ? input.name.trim() : '',
        agentId: toId(input.agentId),
        webappId: toId(input.webappId),
      };
```

2. 校验 `:380` 只留名称非空，文案不变。
3. `:389-394` 的三件套判据改成按**真的配了的材料数**计：

```ts
      agent: normalizedGroups.filter((g) => g.agentId).length,
      webapp: (webapp.id ? 1 : 0) + normalizedGroups.filter((g) => g.webappId).length,
```

4. **删掉课堂级的网页落库**（`:405` 那一行 `webapps: { create: … }`）—— 高级模式的网页权威来源是每组一份（spec §4.3 写了理由）。
5. **删掉从各组 agentId 派生 `classroomAgents`** 的那一段（`:437-438`）。
6. 在组创建之后，为每个非空材料写一行：

```ts
        for (const [kind, targetId] of [['agent', group.agentId], ['webapp', group.webappId]] as const) {
          if (!targetId) continue;
          await tx.classroomGroupMaterial.create({ data: { groupId: classroomGroup.id, kind, targetId } });
        }
```

⚠️ `refineGroupWebappId`（若存在）这类「组级网页也要校验它存在」的检查要一并加上 —— 与课堂级那条走同一个解析口径，别长出第二套。

- [ ] **Step 8: 改运行期（socket 选智能体）**

`server/src/socket/index.ts:1816-1823` 那段替换成：

```ts
        // 该用哪个智能体：**唯一**的口径在 `resolveMaterialTargetId` 里。
        // 这里只负责把「课堂里有哪些组的哪份材料」与「课堂级那一份」喂给它。
        const agentId = resolveMaterialTargetId({
          mode: classroom.mode,
          studentGroupId: classroomStudent.groupId,
          groupMaterials: classroom.groups.flatMap((g) => g.materials.map((m) => ({
            groupId: g.id, kind: m.kind, targetId: m.targetId,
          }))),
          classroomLevelId: classroom.classroomAgents[0]?.agentId ?? null,
          kind: 'agent',
        });
        let agent = agentId ? (agentById.get(agentId) ?? null) : null;
        if (!agent) {
          socket.emit('ai-error', { error: '未配置AI智能体' });
          return;
        }
```

⚠️ `agentById` 要从**已有的那次 classroom 查询**里拿：把 `groups` 的 include 扩成 `{ include: { materials: true } }` 之外，agent 的取法有两种 —— 若 `classroomAgents` 的 include 已能覆盖标准/分组模式，高级模式那一路还要一次 `agent.findMany({ where: { id: { in: 本课堂材料里的 agent targetId } } })`。**执行者自己看查询形态选最省的那种，并在报告里说明选了哪种、为什么。** 不许为了省这一条查询而回到「用课堂级数组兜底」。

- [ ] **Step 9: 改读路径（`GET /code/:code`）**

`server/src/routes/classroom.ts:804-818` 改成（**条件构造，不解引用 null**）：

```ts
      groups: (classroom.mode === 'advanced' || classroom.mode === 'group')
        ? await Promise.all(classroom.groups.map(async (group) => {
            const materials = group.materials;
            const agentRow = materials.find((m) => m.kind === 'agent');
            const webappRow = materials.find((m) => m.kind === 'webapp');
            const agent = agentRow ? await prisma.agent.findUnique({ where: { id: agentRow.targetId } }) : null;
            const webapp = webappRow ? await prisma.webapp.findUnique({ where: { id: webappRow.targetId } }) : null;
            return {
              id: group.id,
              name: group.name,
              // ⚠️ 两个都可能是 null（组可以不配，而且没有真外键 ⇒ 目标可能已被删）。
              //    今天那处非空解引用（`group.agent.id`）会让**整间课堂** 500。
              agent: agent ? { id: agent.id, name: agent.name, logo: agent.logo, platform: agent.platform, enabled: agent.enabled, greeting: agent.greeting } : null,
              webapp: webapp ? { id: webapp.id, name: webapp.name, entryPath: webapp.entryPath } : null,
            };
          }))
        : undefined,
```

⚠️ 这会改变 `groups[]` 的形状（`agentId` 没了、多了 `webapp`）⇒ `src/lib/types.ts`、`socket-events.ts` 与断言该形状的用例都要一起改（Task 4 负责客户端）。

- [ ] **Step 10: 修分组模式的 500**

`server/src/routes/classroom.ts:313` 的 `agentId: uniqueAgentIds[0]` **整行删掉** —— 迁移后 `ClassroomGroup` 没有 `agentId` 列了，分组模式继续用课堂级智能体（§4.4）。这一处 500 因此自然消失。

- [ ] **Step 11: 扩删除守卫（🔴 漏了会删出悬空引用）**

`server/src/routes/agents.ts`：

- `/usage`（`:375-380`）：`classroomGroup.count({ where: { agentId } })` 换成 `classroomGroupMaterial.count({ where: { kind: 'agent', targetId: id } })`；
- 同处那段 union 出 `classrooms` 的查询（`:343-…`）也要改成 union `classroomAgent` 与 `classroomGroupMaterial`（后者 join 到 group 再取 classroom）；
- DELETE 守卫（`:431-432`）：同样把 `classroomGroup.count` 换成新表，**报错文案里的「N 个分组」改成「N 个小组」**（现在数的是组级材料行，语义一致但说法要准）。

`server/src/routes/webapps.ts`：

- `/usage`（`:445-453`）与 DELETE 守卫（`:692`）：**两边都**要把 `classroomGroupMaterial(kind='webapp')` 算进去。⚠️ 网页这一侧今天是**一条**路径（课堂级），加了组级之后变**两条** —— 这正是最容易漏的地方。

- [ ] **Step 12: 追加真库测试**

在 `server/src/tests/classroom-webapp-link.test.ts` 里追加（它已有真 Prisma + 真临时库的脚手架；注意 `seed()` 返回的是**单数** `agent`）：

1. 高级模式：某组只配网页不配智能体 ⇒ 200；该组 `materials` 只有 `webapp` 一行；`agent` 为 null。
2. 高级模式：某组什么都没配 + 另一组配了 ⇒ 200；该组不产生任何材料行。
3. 所有组都不配 + 无课堂级材料 ⇒ 400。
4. `GET /code/:code` 对含空材料的课堂 ⇒ **200**（不是 500），该组 `agent`/`webapp` 均为 null。
5. `agentId: ''` ⇒ **不落库**（不是落一行空串）—— 用 `classroomGroupMaterial.count({ where: { targetId: '' } })` 断言为 0。
6. **回归**：分组模式「不选智能体 + 选网页」⇒ 200（原来是 500）。
7. 🔴 **删除守卫**：一个**只被组级材料引用**的智能体 ⇒ `/usage` 的 `used` 为真、DELETE 被 400 拦下；一个只被组级材料引用的网页 ⇒ 同样。**这两条是新的，必须有独立用例** —— 它们正是最容易漏的那一处。

- [ ] **Step 13: 跑全量测试与 tsc**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit
cd server && pnpm test 2>&1 | tail -8
```

预期：`tsc` 退出 0、零输出；测试 fail 为 0。

- [ ] **Step 14: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add server/prisma/schema.prisma server/src/routes/ server/src/socket/index.ts server/src/services/group-material-resolve.ts server/src/tests/
git commit -m "feat(server): 高级模式每组可配智能体与探究网页，删掉 agentId 列并修三处静默缺陷"
```

---

## Task 3: 前端创建页（高级模式每组两个选择器）

**Files:**
- Modify: `src/app/teacher/classroom/new/page.tsx`
- Modify: `src/lib/api.ts`、`src/lib/types.ts`（`AdvancedClassroomGroupInput`）

**Interfaces:**
- Consumes: Task 2 的 `POST /api/classroom/create-advanced`（每组 `agentId` / `webappId` 均可为 null）
- Produces: `AdvancedClassroomGroupInput { name: string; agentId: string | null; webappId: string | null; studentIds: string[] }`

- [ ] **Step 1: 改类型与状态模型**

`src/lib/types.ts`：`AdvancedClassroomGroupInput` 加 `webappId: string | null`，`agentId` 改成 `string | null`。

`new/page.tsx`：`groupAgentIds` 保持 `Record<string, string | null>`，**新增一个同形状的 `groupWebappIds`**。两者的值语义相同（键不存在 = 还没选；`null` = 显式「不指定」；`string` = 选了哪个）。

⚠️ **「不指定」不能用 `''` 表达** —— `every(g => ids[g.id])` 会把 `''` 判成未配置而拦住提交，功能等于没做。

- [ ] **Step 2: 校验改成「每组每种材料都必须做出决定」**

`:125` 那一处扩成两个 kind 各判一次：

```tsx
      const allDecided = classGroups.every(g => g.id in groupAgentIds && g.id in groupWebappIds);
```

`errors.groupAgents` 的文案改成「请为每个小组选择智能体与探究网页，或都选「不指定」」。

- [ ] **Step 3: 每组那一行加第二个下拉**

照同文件探究网页**课堂级**那个下拉的写法（那里已经有「点第二次取消」的函数式 updater 与注释）做出组级版本：一个 agent 下拉 + 一个 webapp 下拉，各自带「不指定」项。

⚠️ **这一格会明显变挤。** 先在浏览器里看一眼再定排布（纵向堆叠 / 两列 / 折叠），不要直接把两个下拉并排塞进去。**把你实际采用的排布与理由写进报告。**

- [ ] **Step 4: 连带改计数与摘要**

`:200` 的 `configuredGroupCount`、`:213-215` 的完成度、`:411` 的「必填」标记、`:651-653` 的摘要 —— 全部按**两个 kind 都决定了**算，否则进度条与摘要会说谎。

- [ ] **Step 5: 手工验证**

```bash
cd /Users/zxc/myprojects/classnode && ./dev.sh start && ./dev.sh status
```

浏览器打开 `/teacher/classroom/new/`，选一个有分组的班级 + 高级模式，逐条走：

- 什么都不选 ⇒ 提交被拦住，文案提到「不指定」
- 某组只选智能体、不选网页 ⇒ 提交成功，且该组的网页是「不指定」
- 某组两个都选「不指定」⇒ 提交成功
- 「不指定」与「还没选」在**两个**下拉上都可区分

- [ ] **Step 6: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add src/app/teacher/classroom/new/page.tsx src/lib/api.ts src/lib/types.ts
git commit -m "feat(teacher): 高级模式每组可分别选择智能体与探究网页"
```

---

## Task 4: 学生端（网页与智能体都来自自己的组，不回落）

**Files:**
- Modify: `src/lib/types.ts`、`src/lib/socket-events.ts`（`groups[]` 的新形状）
- Create: `src/lib/classroom-material.ts`
- Modify: `src/app/classroom/explore/explore-panel.tsx`、`src/app/classroom/chat/chat-panel.tsx`、`src/app/classroom/home/student-home.tsx`、`src/app/classroom/use-classroom-session.ts`

**Interfaces:**
- Consumes: Task 2 的 `GET /code/:code` 的 `groups[].agent` / `groups[].webapp`（均可为 null）
- Produces: `effectiveGroupMaterial<T>(classroom, selectedStudent, kind): T | null`

- [ ] **Step 1: 改类型**

`src/lib/types.ts` 与 `src/lib/socket-events.ts`：`groups[]` 的 `agent` 改成 `AgentSummary | null`、`agentId` 删掉、加 `webapp: { id; name; entryPath } | null`。

- [ ] **Step 2: 建解析函数**

新建 `src/lib/classroom-material.ts`：

```ts
import type { AgentSummary, ClassroomWebappSummary } from './types';

interface GroupMaterials {
  id: string;
  agent?: AgentSummary | null;
  webapp?: ClassroomWebappSummary | null;
}
interface ClassroomMaterials {
  mode?: string;
  groups?: GroupMaterials[];
  agents?: AgentSummary[];
  /** 课堂级网页。⚠️ 字段名以 `GET /code/:code` 实际返回的为准 ——
   *  执行者自己 `grep -n 'webapps' server/src/routes/classroom.ts` 确认，别信这份计划。 */
  webapps?: ClassroomWebappSummary[];
}

/** 学生自己那个组；没有组就不返回（`undefined` 与「找到了但没材料」在下面都被 `?? null` 收成 null）。 */
function ownGroup(
  classroom: ClassroomMaterials,
  selectedStudent: { groupId?: string | null } | null | undefined,
): GroupMaterials | undefined {
  if (!selectedStudent?.groupId) return undefined;
  return classroom.groups?.find((group) => group.id === selectedStudent.groupId);
}

/**
 * 「这个学生此刻实际生效的智能体」——**唯一**的解析口径。
 *
 * 🔴 抽出来是因为原来有两个各写一份的回落（`chat-panel.tsx` 与 `student-home.tsx`），
 * 而那个回落**在高级模式下是错的**：`classroom.agents` 曾是各组智能体的并集
 * （`routes/classroom.ts:437-438` 派生），组里没有时回落到它会显示**别人组的名字和头像**
 * —— 即使服务端改对了，界面仍然在撒谎。
 *
 * 高级模式**一律不回落**：没有就是没有（spec §4.4）。
 */
export function effectiveGroupAgent(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): AgentSummary | null {
  if (!classroom) return null;
  if (classroom.mode === 'advanced') return ownGroup(classroom, selectedStudent)?.agent ?? null;
  // 标准 / 分组模式：课堂级那一个（分组模式全班共用一套材料，spec §1.3）
  return classroom.agents?.[0] ?? null;
}

/** 同上，取探究网页。⚠️ 高级模式下返回 null 表示**该组没配**，调用方要显示「本组未配置探究网页」。 */
export function effectiveGroupWebapp(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): ClassroomWebappSummary | null {
  if (!classroom) return null;
  if (classroom.mode === 'advanced') return ownGroup(classroom, selectedStudent)?.webapp ?? null;
  return classroom.webapps?.[0] ?? null;
}
```

⚠️ **不要写成一个带 `fallback` 参数的通用函数** —— 那样很容易被后来的人传成 `true`，而「高级模式不回落」这条正是本改动的核心红线。两个函数各自写死自己的分支。

- [ ] **Step 3: 三处消费点改用它**

`chat-panel.tsx`（头像与欢迎卡片）、`student-home.tsx`（学伴卡名称）、`explore-panel.tsx`（**网页 id**）统一改用它。

⚠️ `explore-panel.tsx` 那处最关键：它的 `webappId` 决定学生打开哪个网页。该组没有网页时，面板要显示**「本组未配置探究网页」**，**不渲染 iframe**，也不能拿课堂级那个顶上。

- [ ] **Step 4: 验证**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit
npx eslint src/app/classroom/ src/lib/
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
```

- [ ] **Step 5: 提交**

```bash
cd /Users/zxc/myprojects/classnode
git add src/lib/ src/app/classroom/
git commit -m "fix(classroom): 学生端材料来自自己的组，高级模式不再回落"
```

---

## Task 5: 门禁与端到端验收

**Files:** 无（只验证）

- [ ] **Step 1: 全量门禁**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit
npx eslint src/app/classroom/ src/lib/
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
cd server && pnpm test 2>&1 | tail -8
```

记下每一步的实际输出。`./dev.sh status` 必须显示 **4000 与 4001 都在**。

- [ ] **Step 2: 真实库迁移演练（用副本，不碰真实库）**

```bash
cp server/prisma/dev.db /tmp/gm-check.db
```

用 `DATABASE_URL="file:/tmp/gm-check.db"` 启动服务（**不是** `server/prisma/dev.db`），观察启动日志：

- [ ] 出现 `Database backup created: …/before-classroom-group-materials-*.db`
- [ ] 出现 `Classroom group materials migration complete`
- [ ] `sqlite3 /tmp/gm-check.db ".schema ClassroomGroup"`：**没有 `agentId`**，具名 CONSTRAINT 与索引逐字保留
- [ ] 与 `server/prisma/dev.db` 做 `pragma_table_info` 规范化对比：差异**只有 agentId 那一列**
- [ ] `sqlite3 /tmp/gm-check.db "SELECT kind, COUNT(*) FROM ClassroomGroupMaterial GROUP BY kind;"`：`agent` 的行数 = 演练前库里 `ClassroomGroup` 的行数
- [ ] **子表数据幸存**：`SELECT COUNT(*) FROM ClassroomStudent WHERE groupId IS NOT NULL;` 与演练前一致
- [ ] 再启动一次：没有第二次备份、没有第二次迁移
- [ ] 完事 `rm -f /tmp/gm-check.db`

- [ ] **Step 3: 端到端手工验收（照 spec §七）**

逐条走完 spec 的 A/B/C/D 四段清单。特别确认：

- [ ] 高级模式某组「不指定智能体」的学生发消息得到「未配置AI智能体」，**没有**用到任何其它组的智能体
- [ ] 高级模式某组配了网页 ⇒ 该组学生打开的**是那个**网页
- [ ] 高级模式某组没配网页 ⇒ 该组学生看到「本组未配置探究网页」，**不是**课堂级那个
- [ ] `GET /api/classroom/code/<code>` 对含空材料的课堂返回 200
- [ ] 分组模式不选智能体 + 选网页 ⇒ 200
- [ ] 标准模式照旧

- [ ] **Step 4: 汇总报告**

必须包含：`git diff --stat`、改动前后行数、**「有没有删除任何既有行为」的明确回答**、以及每条「通过」所依据的实际命令输出。**没有命令输出的「通过」不算证据。**

---

## 交付边界（本计划不做）

- **不做学习单本体**（`kind` 留位，但不写 `'worksheet'` 这个值）。
- **不做分组模式按组**（它继续用课堂级材料）。
- **不做运行时改组绑定**。
- **不删**老课堂里那批惰性的 `ClassroomAgent` 行（派生被删掉后它们不再产生，但历史的还在；删历史行属于另一个决定）。
