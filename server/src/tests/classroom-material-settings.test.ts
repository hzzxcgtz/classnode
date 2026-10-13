import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import classroomRoutes from '../routes/classroom.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
import { agentContextStart, agentHistoryWhere, beginClassroomRequest, endClassroomRequest, beginMaterialEdit, endMaterialEdit } from '../services/classroom-material-edit.js';
import { ensureClassroomMaterialColumns } from '../services/classroom-material-schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('课堂材料更换：真实 SQLite 事务、历史隔离与旧库升级', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-material-settings-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [path.resolve(here, '../../node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', `--schema=${path.resolve(here, '../../prisma/schema.prisma')}`], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  const events: Array<{ room: string; name: string; payload: unknown }> = [];
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', { to: (room: string) => ({ emit: (name: string, payload: unknown) => events.push({ room, name, payload }) }) });
  app.use(classroomRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const put = (id: string, body: unknown) => fetch(`${base}/${id}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const a = await prisma.agent.create({ data: { name: '学伴 A', platform: 'coze', apiKey: 'test' } });
  const b = await prisma.agent.create({ data: { name: '学伴 B', platform: 'coze', apiKey: 'test' } });
  const analysis = await prisma.agent.create({ data: { name: '分析型', platform: 'coze', apiKey: 'test', purpose: 'analysis' } });
  const disabled = await prisma.agent.create({ data: { name: '停用', platform: 'coze', apiKey: 'test', enabled: false } });
  const w1 = await prisma.webapp.create({ data: { name: '网页一', entryPath: 'index.html' } });
  const w2 = await prisma.webapp.create({ data: { name: '网页二', entryPath: 'index.html' } });
  const ws = await prisma.worksheet.create({ data: { title: '固定学习单', content: {}, settings: {} } });
  const classroom = await prisma.classroom.create({ data: {
    title: '原课堂', code: '5678', classroomAgents: { create: { agentId: a.id } },
    webapps: { create: { webappId: w1.id } }, worksheets: { create: { worksheetId: ws.id } },
  } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id } });
  const response = await prisma.worksheetResponse.create({ data: { classroomId: classroom.id, worksheetId: ws.id, participantId: participant.id, status: 'submitted', submittedAt: new Date() } });
  const answer = await prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q1', value: { text: '已有答案' } } });
  const oldMessage = await prisma.message.create({ data: { classroomId: classroom.id, studentId: participant.id, role: 'assistant', agentId: a.id, content: '旧学伴回答' } });
  await prisma.webappUsage.create({ data: { classroomId: classroom.id, studentId: participant.id, webappId: w1.id, durationMs: 1234 } });

  await t.test('冻结字段拒绝，失败时名称与所有关联不变', async () => {
    for (const frozen of [{ worksheetId: ws.id }, { worksheetIds: [ws.id] }, { mode: 'advanced' }, { classIds: [] }]) {
      assert.equal((await put(classroom.id, { title: '不应保存', ...frozen })).status, 400);
    }
    assert.equal((await prisma.classroom.findUniqueOrThrow({ where: { id: classroom.id } })).title, '原课堂');
    assert.equal(events.length, 0);
  });
  await t.test('无效、停用和分析型对象拒绝，事务不留下部分改动', async () => {
    for (const agentId of ['missing', disabled.id, analysis.id, '']) assert.equal((await put(classroom.id, { title: '不应保存', agentId, webappId: w2.id })).status, 400);
    assert.equal((await put(classroom.id, { agentId: b.id, webappId: 'missing' })).status, 400);
    assert.equal((await prisma.classroomAgent.findFirstOrThrow({ where: { classroomId: classroom.id } })).agentId, a.id);
  });
  await t.test('生成中阻止换学伴，换网页仍允许；修改期间阻止新的提问', async () => {
    assert.ok(beginClassroomRequest(classroom.id));
    try {
      assert.equal((await put(classroom.id, { agentId: b.id })).status, 409);
      assert.equal((await put(classroom.id, { webappId: w2.id })).status, 200);
    } finally { endClassroomRequest(classroom.id); }
    assert.ok(beginMaterialEdit(classroom.id));
    try {
      assert.equal(beginClassroomRequest(classroom.id), false);
      assert.equal((await put(classroom.id, { title: '并发写' })).status, 409);
    } finally { endMaterialEdit(classroom.id); }
  });
  await t.test('更换学伴保留学习单、答案、聊天和网页活动，向两端广播', async () => {
    events.length = 0;
    assert.equal((await put(classroom.id, { title: '改名', agentId: b.id })).status, 200);
    assert.deepEqual(events.map(e => [e.room, e.name]), [[`classroom:${classroom.id}`, 'classroom-materials-changed'], [`teacher:${classroom.id}`, 'classroom-materials-changed']]);
    assert.equal((await prisma.classroomAgent.findFirstOrThrow({ where: { classroomId: classroom.id } })).agentId, b.id);
    assert.equal((await prisma.classroomWorksheet.findFirstOrThrow({ where: { classroomId: classroom.id } })).worksheetId, ws.id);
    assert.deepEqual(await prisma.worksheetAnswer.findUniqueOrThrow({ where: { id: answer.id } }), answer);
    assert.deepEqual(await prisma.message.findUniqueOrThrow({ where: { id: oldMessage.id } }), oldMessage);
    assert.equal((await prisma.webappUsage.findFirstOrThrow({ where: { classroomId: classroom.id } })).durationMs, 1234);
  });
  await t.test('持久化上下文起点：新学伴不读旧历史，切回 A 也重新开始', async () => {
    let cr = await prisma.classroom.findUniqueOrThrow({ where: { id: classroom.id } });
    const cutoff = agentContextStart(cr.agentContextStarts, 'classroom');
    assert.ok(cutoff);
    assert.equal((await prisma.message.findMany({ where: agentHistoryWhere(participant.id, b.id, cutoff) })).length, 0);
    const fresh = await prisma.message.create({ data: { classroomId: classroom.id, studentId: participant.id, role: 'user', agentId: b.id, content: '新提问', createdAt: new Date(cutoff.getTime() + 1) } });
    assert.deepEqual((await prisma.message.findMany({ where: agentHistoryWhere(participant.id, b.id, cutoff) })).map(m => m.id), [fresh.id]);
    assert.equal((await put(classroom.id, { agentId: b.id, title: '仅改名' })).status, 200);
    cr = await prisma.classroom.findUniqueOrThrow({ where: { id: classroom.id } });
    assert.equal(agentContextStart(cr.agentContextStarts, 'classroom')?.toISOString(), cutoff.toISOString());
    assert.equal((await put(classroom.id, { agentId: a.id })).status, 200);
    cr = await prisma.classroom.findUniqueOrThrow({ where: { id: classroom.id } });
    assert.equal((await prisma.message.findMany({ where: agentHistoryWhere(participant.id, a.id, agentContextStart(cr.agentContextStarts, 'classroom')) })).length, 0);
  });
  await t.test('高级模式仅修改目标小组，拒绝跨课堂小组及小组学习单修改', async () => {
    const advanced = await prisma.classroom.create({ data: { mode: 'advanced' } });
    const g1 = await prisma.classroomGroup.create({ data: { classroomId: advanced.id, name: '一组', materials: { create: [{ kind: 'agent', targetId: a.id }, { kind: 'webapp', targetId: w1.id }, { kind: 'worksheet', targetId: ws.id }] } } });
    const g2 = await prisma.classroomGroup.create({ data: { classroomId: advanced.id, name: '二组', materials: { create: { kind: 'agent', targetId: a.id } } } });
    assert.equal((await put(advanced.id, { groups: [{ id: g1.id, agentId: b.id, webappId: w2.id }] })).status, 200);
    const g1materials = await prisma.classroomGroupMaterial.findMany({ where: { groupId: g1.id } });
    assert.equal(g1materials.find(m => m.kind === 'worksheet')?.targetId, ws.id);
    assert.equal(g1materials.find(m => m.kind === 'agent')?.targetId, b.id);
    assert.equal((await prisma.classroomGroupMaterial.findFirstOrThrow({ where: { groupId: g2.id } })).targetId, a.id);
    const cr = await prisma.classroom.findUniqueOrThrow({ where: { id: advanced.id } });
    assert.ok(agentContextStart(cr.agentContextStarts, g1.id));
    assert.equal(agentContextStart(cr.agentContextStarts, g2.id), undefined);
    for (const body of [{ agentId: b.id }, { groups: [{ id: 'other', agentId: b.id }] }, { groups: [{ id: g1.id, worksheetId: ws.id }] }, { groups: [{ id: g1.id }, { id: g1.id }] }]) assert.equal((await put(advanced.id, body)).status, 400);
  });
  await t.test('分组模式修改课堂级材料，结束后禁止修改', async () => {
    await prisma.classroom.update({ where: { id: classroom.id }, data: { mode: 'group' } });
    assert.equal((await put(classroom.id, { webappId: w1.id })).status, 200);
    assert.equal((await put(classroom.id, { groups: [] })).status, 400);
    await prisma.classroom.update({ where: { id: classroom.id }, data: { status: 'ended' } });
    assert.equal((await put(classroom.id, { agentId: b.id })).status, 409);
    assert.equal((await put('missing', { title: 'x' })).status, 404);
  });
  await t.test('旧库升级补列可重跑且保留原有答案和聊天', async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE "Classroom" DROP COLUMN "agentContextStarts"');
    await prisma.$executeRawUnsafe('ALTER TABLE "Classroom" DROP COLUMN "materialsRevision"');
    await ensureClassroomMaterialColumns(prisma);
    await ensureClassroomMaterialColumns(prisma);
    assert.equal((await prisma.classroom.findUniqueOrThrow({ where: { id: classroom.id } })).materialsRevision, 0);
    assert.deepEqual(await prisma.worksheetAnswer.findUniqueOrThrow({ where: { id: answer.id } }), answer);
    assert.deepEqual(await prisma.message.findUniqueOrThrow({ where: { id: oldMessage.id } }), oldMessage);
  });
});
