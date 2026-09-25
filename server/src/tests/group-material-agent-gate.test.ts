/**
 * ★ M7b：**组材料那条路上的闸**（独立审查 C2 抓到）。
 *
 * 🔴 背景：`Agent.purpose` 那道闸最初只包住了 `ClassroomAgent` 那一条来源。而学生的
 * 「我该跟谁说话」**还有第二条来源** —— 组级材料（`ClassroomGroupMaterial(kind='agent')`
 * → `resolveGroupMaterialViews` → `groups[].agent`），那里**没有任何 purpose 判断**。
 *
 * 触发路径（教师用**正常 UI** 就能造出来）：高级模式的课 → 给某一组选「AI 智能体」→
 * 下拉里列的是**全部**智能体 → 选中那个分析型 bot → 该组学生打开聊天面板，
 * 顶上的名字就是那个「会收到全班作业」的 bot。
 *
 * ⇒ 组材料同样是**发给学生**的，所以它必须与 `classroomAgents[].agent` 走**同一把尺子**
 * （两者的视图形状逐字相同，那正是为了共用）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { resolveGroupMaterialViews } from '../services/group-material-resolve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

async function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-group-gate-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  return { prisma: new PrismaClient({ datasources: { db: { url } } }), dir };
}

test('🔴 组级材料指向分析型 ⇒ 学生拿到的 `groups[].agent` 必须是 null（不是那个 bot）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;

  const classroom = await p.classroom.create({ data: { title: '课', code: '8101', status: 'active', mode: 'advanced' } });
  const group = await p.classroomGroup.create({ data: { classroomId: classroom.id, name: '一组' } });
  const analysisBot = await p.agent.create({
    data: { name: '分析型·会收到全班作业', platform: 'coze', apiKey: 'k', enabled: true, purpose: 'analysis' },
  });
  const tutorBot = await p.agent.create({
    data: { name: '学伴', platform: 'coze', apiKey: 'k', enabled: true, purpose: 'tutoring' },
  });
  await p.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'agent', targetId: analysisBot.id } });

  const groups = await p.classroomGroup.findMany({
    where: { classroomId: classroom.id },
    select: { id: true, materials: { select: { kind: true, targetId: true } } },
  });
  const views = await resolveGroupMaterialViews(p, groups as never);
  assert.equal(views.get(group.id)?.agent, null,
    '🔴 分析型 bot 不许出现在发给学生的组材料里 —— 它与 `classroomAgents[].agent` 是同一条闸');

  // 阳性对照：换成学伴 bot ⇒ 照常下发（证明上面不是「整个 agent 视图坏了」）
  // ⚠️ 必须**重新取一遍 groups** —— `resolveGroupMaterialViews` 读的是传进去的那些行里的
  // `materials`，而复用上面那份（它的 `targetId` 还指着分析型）会让这条对照**假红**。
  await p.classroomGroupMaterial.update({
    where: { groupId_kind: { groupId: group.id, kind: 'agent' } }, data: { targetId: tutorBot.id },
  });
  const groups2 = await p.classroomGroup.findMany({
    where: { classroomId: classroom.id },
    select: { id: true, materials: { select: { kind: true, targetId: true } } },
  });
  const views2 = await resolveGroupMaterialViews(p, groups2 as never);
  assert.equal(views2.get(group.id)?.agent?.id, tutorBot.id, '学伴要照常下发');
  assert.equal(views2.get(group.id)?.agent?.name, '学伴');
});
