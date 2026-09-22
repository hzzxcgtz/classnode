import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  ensureGroupMaterials,
  needsGroupMaterialsMigration,
} from '../services/group-materials-migration.js';

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
  const columns = await prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>(`PRAGMA table_info('ClassroomGroup')`);
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
