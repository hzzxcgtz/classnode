import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createDatabaseClient } from '../services/database-client.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
import { readImageCanvas } from '../services/worksheet-image-canvas.js';

const image = '/uploads/chat/chat-11111111-1111-4111-8111-111111111111.png';
const rubricImage = '/uploads/chat/chat-44444444-4444-4444-8444-444444444444.png';
const answer = { id: 'answer', kind: 'answer', x: 12, y: 74, width: 76, height: 16, label: '给同桌录音', detail: '', borderColor: 'transparent', backgroundColor: '#fff9de' };
const hint = { id: 'hint', kind: 'hint', x: 40, y: 45, width: 22, height: 6, label: '西沙群岛', detail: '位于南海西北部。' };
const canvas = { url: image, width: 1200, height: 1600, widgets: [answer, hint] };

test('整图布局拒绝越界、重复作答区和非本地图片', () => {
  assert.deepEqual(readImageCanvas(canvas), canvas);
  assert.equal(readImageCanvas({ ...canvas, url: 'https://example.com/test.png' }), null);
  assert.equal(readImageCanvas({ ...canvas, widgets: [{ ...answer, x: 90 }] }), null);
  assert.equal(readImageCanvas({ ...canvas, widgets: [answer, { ...answer, id: 'another' }] }), null);
  assert.equal(readImageCanvas({ ...canvas, widgets: [{ ...answer, backgroundColor: 'var(--theme)' }] })?.widgets[0].backgroundColor, undefined);
});

test('整图任务可保存并投影给学生，同桌录音评星随实名作答提交并保留录音版本', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-image-canvas-'));
  const previousRoot = process.env.CLASSNODE_DATA_DIR;
  process.env.CLASSNODE_DATA_DIR = dir;
  t.after(() => { if (previousRoot === undefined) delete process.env.CLASSNODE_DATA_DIR; else process.env.CLASSNODE_DATA_DIR = previousRoot; });
  fs.mkdirSync(path.join(dir, 'uploads/chat'), { recursive: true });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#e0ecf5' } }).png().toFile(path.join(dir, image.slice(1)));
  fs.copyFileSync(path.join(dir, image.slice(1)), path.join(dir, rubricImage.slice(1)));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  const prisma = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));
  const schema = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));
  execFileSync(process.execPath, [prisma, 'db', 'push', '--skip-generate', '--schema', schema],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = createDatabaseClient(url);
  const app = express();
  app.use(express.json());
  app.set('prisma', db);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let cookie = '';
  createTeacherSession({ setHeader: (_name: string, value: string) => { cookie = value.split(';')[0]; } } as never);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worksheets`;
  const call = (method: string, path: string, body?: unknown, token?: string) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const node = { id: 'q', type: 'short-answer', inputMode: 'audio', prompt: '海底住着谁', children: [],
    data: { imageCanvas: canvas, deskReview: { maxStars: 3, instruction: '听一听，有没有说清特点？' }, aiScoringEnabled: true } };
  const content = { schemaVersion: 1, nodes: [node] };
  const agent = await db.agent.create({ data: { name: '测试智能体', purpose: 'analysis', platform: 'coze', apiKey: 'unused', botId: 'test' } });
  const created = await call('POST', '', { title: '海底导览', content, settings: { allowResubmit: true, analysisAgentId: agent.id } });
  assert.equal(created.status, 200, await created.clone().text());
  const sheet = await created.json();
  assert.equal(sheet.content.nodes[0].data.evaluationMode, 'collect');
  const room = await db.classroom.create({ data: { status: 'active', mode: 'standard' } });
  await db.classroomWorksheet.create({ data: { classroomId: room.id, worksheetId: sheet.id } });
  const klass = await db.class.create({ data: { name: '示例班' } });
  const student = await db.student.create({ data: { classId: klass.id, name: '示例学生', studentNo: '01' } });
  const user = await db.classroomStudent.create({ data: { classroomId: room.id, studentId: student.id, type: 'student' } });
  const token = createStudentToken(room.id, user.id);
  const group = await db.classroomStudent.create({ data: { classroomId: room.id, type: 'group' } });
  const groupToken = createStudentToken(room.id, group.id);
  const root = `/${sheet.id}`;
  const view = await (await call('GET', root + '/student-view', undefined, token)).json();
  assert.deepEqual(view.content.nodes[0].data.imageCanvas, canvas);
  assert.equal(view.content.nodes[0].data.deskReview.maxStars, 3);
  const audio = { format: 'audio/v1', url: '/uploads/chat/chat-22222222-2222-4222-8222-222222222222.ogg', durationMs: 3000 };
  const save = (value: unknown, who = token) => call('PUT', root + '/answers', { questionId: 'q', value }, who);
  const submit = () => call('POST', root + '/answers/submit', { questionId: 'q' }, token);
  const waitForReview = async (reviewId: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const review = await db.worksheetAnswerReview.findUniqueOrThrow({ where: { id: reviewId } });
      if (review.status !== 'pending') return review;
      await delay(50);
    }
    assert.fail('个人评价超时');
  };
  assert.equal((await save(audio, groupToken)).status, 403);
  assert.equal((await save(audio)).status, 200);
  const incomplete = await submit();
  assert.equal(incomplete.status, 409);
  assert.equal((await incomplete.json()).code, 'desk-rating-required');
  assert.equal((await save({ ...audio, deskRating: { stars: 4, maxStars: 3 } })).status, 400);
  const first = { ...audio, deskRating: { stars: 2, maxStars: 3 } };
  assert.equal((await save(first)).status, 200);
  assert.equal((await submit()).status, 200);
  const own = await (await call('GET', root + '/answers', undefined, token)).json();
  assert.deepEqual(own.rows[0].value, first);

  const second = { ...first, url: '/uploads/chat/chat-33333333-3333-4333-8333-333333333333.ogg', deskRating: { stars: 3, maxStars: 3 } };
  assert.equal((await save(second)).status, 200);
  assert.equal((await submit()).status, 200);
  const stored = await db.worksheetAnswer.findFirstOrThrow({ include: { response: true, reviews: { orderBy: { createdAt: 'asc' } } } });
  assert.equal(stored.response.participantId, user.id);
  assert.equal(stored.score, null);
  assert.deepEqual(stored.reviews.map(review => review.value), [first, second]);
  assert.ok(stored.reviews.every(review => review.status === 'submitted'));

  const mixedCanvas = { ...canvas, widgets: [
    { ...answer, label: '观察录音', canvasEvaluation: { mode: 'ai', criteria: '录音标准：说清观察依据' } },
    { ...answer, id: 'photo', label: '作品照片', mode: 'photo', borderStyle: 'double',
      canvasEvaluation: { mode: 'ai', criteria: '照片标准：写出景物特点' } },
    { ...answer, id: 'note', mode: 'keyboard', borderStyle: 'dashed' },
    { ...answer, id: 'ink', mode: 'handwriting', borderStyle: 'dotted' },
  ] };
  const updated = await call('PUT', root, { content: { ...content, nodes: [{ ...node, data: { ...node.data, imageCanvas: mixedCanvas } }] } });
  assert.equal(updated.status, 200, await updated.clone().text());
  const upgraded = await updated.json();
  assert.equal(upgraded.content.nodes[0].type, 'image-canvas');
  assert.deepEqual(upgraded.content.nodes[0].data.imageCanvas, mixedCanvas);
  assert.deepEqual((await (await call('GET', root + '/answers', undefined, token)).json()).rows[0].value, second);
  const mixed = (answers: Record<string, unknown>) => ({ format: 'image-canvas/v1', answers });
  const partial = mixed({ answer: second, note: { format: 'text/v1', text: '这里有五色海水' } });
  assert.equal((await save(mixed({ note: second }))).status, 400);
  assert.equal((await save(partial)).status, 200);
  assert.equal((await submit()).status, 409);
  const complete = mixed({
    ...partial.answers, photo: { format: 'photo/v1', url: image },
    ink: { format: 'ink/v1', canvas: { w: 320, h: 160 }, strokes: [{ color: '#1f2937', width: 0.016, points: [[0.5, 0.5]] }] },
  });
  assert.equal((await save(complete)).status, 200);
  app.set('analysisProxy', async () => ({ success: true, content: '能够描述海里的景物。' }));
  const response = await submit();
  assert.equal(response.status, 200, await response.clone().text());
  const mixedReview = await response.json();
  assert.equal(mixedReview.reviewStatus, 'pending');
  assert.equal((await waitForReview(mixedReview.reviewId)).status, 'succeeded');
  assert.deepEqual((await (await call('GET', root + '/answers', undefined, token)).json()).rows[0].value, complete);

  const calls: string[] = [];
  app.set('analysisProxy', async (_agent: unknown, message: string, images: Buffer[], _signal: unknown, clips: Array<{ url: string; label: string }>) => {
    calls.push(message);
    if (message.includes('当前仅处理「作答区 1')) {
      assert.match(message, /录音标准：说清观察依据/);
      assert.doesNotMatch(message, /照片标准/);
      assert.equal(images.length, 1, '只附教师底图');
      assert.deepEqual(clips, [{ url: second.url, label: '示例学生#01' }]);
      return { success: true, content: '录音中的观察。<classnode-feedback>{"students":[{"student":"示例学生#01","advice":"补充具体观察"},{"student":"名单外#99","advice":"不得关联"}]}</classnode-feedback>' };
    }
    if (message.includes('当前仅处理「作答区 2')) {
      assert.match(message, /照片标准：写出景物特点/);
      assert.doesNotMatch(message, /录音标准/);
      assert.equal(images.length, 2, '底图和作答照片拼图');
      return { success: true, content: '照片中能辨认景物特点。<classnode-feedback>{"students":[{"student":"示例学生#01","advice":"照片表现具体"}]}</classnode-feedback>' };
    }
    if (message.includes('当前仅处理')) return { success: true, content: '其余区域只整理内容。' };
    assert.match(message, /录音中的观察/);
    assert.match(message, /照片中能辨认景物特点/);
    assert.match(message, /作答区 1 .+的 AI 评价要求：录音标准：说清观察依据/);
    assert.match(message, /典型表现与作答依据/);
    assert.match(message, /classnode-feedback/);
    return { success: true, content: '建议把景物特点转成具体的口头说明。' };
  });
  const query = `?classroomId=${room.id}`;
  const preview = await call('POST', root + '/analysis/q' + query);
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal((await preview.json()).sectioned, true);
  assert.equal((await call('POST', root + '/analysis/q/run' + query, undefined, token)).status, 403);
  const report = await call('POST', root + '/analysis/q/run' + query + '&analysisOnly=true');
  assert.equal(report.status, 200, await report.clone().text());
  assert.equal(calls.length, 5);
  const result = await report.json();
  assert.match(result.narrative, /整题总结/);
  assert.deepEqual(result.sectionAnalysis.map((area: { students: Array<{ studentId: string; feedback: string | null }> }) => area.students.map(row => [row.studentId, row.feedback])),
    [[[user.id, '补充具体观察']], [[user.id, '照片表现具体']], [[user.id, null]], [[user.id, null]]]);
  assert.deepEqual(result.sectionAnalysis[0].students[0].value, second);
  const loaded = await (await call('GET', root + '/analysis/q' + query)).json();
  assert.equal(loaded.stale, false);
  assert.deepEqual(loaded.sectionAnalysis, result.sectionAnalysis);
  const studentView = await (await call('GET', root + '/student-view', undefined, token)).json();
  assert.ok(!JSON.stringify(studentView).includes('canvasEvaluation'));
  assert.ok(!JSON.stringify(studentView).includes('补充具体观察'));

  const fill = { id: 'fill', type: 'fill-blank', inputMode: 'keyboard', prompt: '记录____、____、____、____', children: [], data: {
    answers: [['海水'], [], [], []],
    fillBlankSettings: {
      first: { mode: 'text', gradingMode: 'auto', maxScore: 1, evaluationVersion: 1, evaluationMode: 'answer', evaluationScored: true },
      second: { mode: 'text', gradingMode: 'ai', evaluationVersion: 1, evaluationMode: 'ai', evaluationScored: false, evaluationText: '描述颜色变化' },
      third: { mode: 'text', gradingMode: 'ai', evaluationVersion: 1, evaluationMode: 'ai', evaluationScored: false, evaluationText: '解释颜色变化原因' },
      fourth: { mode: 'text', gradingMode: 'none', evaluationVersion: 1, evaluationMode: 'collect', evaluationScored: false },
    },
  } };
  const savedFill = await call('PUT', root, { content: { ...content, nodes: [upgraded.content.nodes[0], fill] } });
  assert.equal(savedFill.status, 200, await savedFill.clone().text());
  const filled = await db.worksheetAnswer.create({ data: { responseId: stored.responseId, questionId: 'fill',
    value: { format: 'fill-multi/v1', texts: ['海水', '颜色深浅不同', '深浅不同导致的', '想研究珊瑚'] },
    status: 'submitted', submittedAt: new Date(), score: 1, isCorrect: true, gradeState: 'correct' } });
  app.set('analysisProxy', async (_agent: unknown, message: string) => {
    if (message.includes('当前仅处理「第 1 空」')) assert.match(message, /"result":"正确"/);
    if (message.includes('当前仅处理「第 2 空」')) {
      assert.match(message, /描述颜色变化/);
      assert.doesNotMatch(message, /解释颜色变化原因/);
      return { success: true, content: '第二空发现。<classnode-feedback>{"students":[{"student":"示例学生#01","advice":"可以比较两处颜色"}]}</classnode-feedback>' };
    }
    if (message.includes('当前仅处理「第 3 空」')) {
      assert.match(message, /解释颜色变化原因/);
      assert.doesNotMatch(message, /描述颜色变化/);
      return { success: true, content: '第三空发现。<classnode-feedback>{"students":[{"student":"示例学生#01","advice":"补上观察证据"}]}</classnode-feedback>' };
    }
    return { success: true, content: '汇总发现。' };
  });
  assert.equal((await call('POST', root + '/analysis/fill' + query)).status, 200);
  const fillReport = await call('POST', root + '/analysis/fill/run' + query + '&analysisOnly=true');
  assert.equal(fillReport.status, 200, await fillReport.clone().text());
  const fillResult = await fillReport.json();
  assert.deepEqual(fillResult.sectionAnalysis.map((area: { mode: string }) => area.mode), ['answer', 'ai', 'ai', 'collect']);
  assert.equal(fillResult.sectionAnalysis[0].students[0].correct, true);
  assert.equal(fillResult.sectionAnalysis[1].students[0].feedback, '可以比较两处颜色');
  assert.equal(fillResult.sectionAnalysis[2].students[0].feedback, '补上观察证据');
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: filled.id } })).score, 1);

  const layout = { id: 'peer-task', type: 'image-canvas', prompt: '听听同桌怎么说', inputMode: 'keyboard', children: [], data: {
    imageCanvas: { ...canvas, widgets: [
      { ...answer, id: 'peer', mode: 'peer-audio', deskReview: { maxStars: 5, instruction: '位置说得清楚吗？' } },
      { ...answer, id: 'audio', mode: 'audio' },
    ] },
  } };
  const updatedLayout = await call('PUT', root, { content: { ...content, nodes: [upgraded.content.nodes[0], fill, layout] } });
  assert.equal(updatedLayout.status, 200, await updatedLayout.clone().text());
  const publicLayout = await (await call('GET', root + '/student-view', undefined, token)).json();
  const peerTask = publicLayout.content.nodes.find((item: { id: string }) => item.id === 'peer-task');
  assert.deepEqual(peerTask.data.imageCanvas.widgets[0].deskReview, { maxStars: 5, instruction: '位置说得清楚吗？' });
  const savePeerTask = (value: unknown, who = token) => call('PUT', root + '/answers', { questionId: 'peer-task', value }, who);
  const submitPeerTask = () => call('POST', root + '/answers/submit', { questionId: 'peer-task' }, token);
  assert.equal((await savePeerTask(mixed({ peer: audio, audio }), groupToken)).status, 403);
  assert.equal((await savePeerTask(mixed({ peer: audio, audio }))).status, 200);
  assert.equal((await (await submitPeerTask()).json()).code, 'desk-rating-required');
  assert.equal((await savePeerTask(mixed({ peer: { ...audio, deskRating: { stars: 3, maxStars: 3 } }, audio }))).status, 400);
  const peer = { ...audio, deskRating: { stars: 4, maxStars: 5 } };
  assert.equal((await savePeerTask(mixed({ peer, audio }))).status, 200);
  assert.equal((await submitPeerTask()).status, 200);
  const record = await db.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'peer-task' }, include: { reviews: true } });
  assert.deepEqual(record.value, mixed({ peer, audio }));
  assert.deepEqual(record.reviews[0].value, record.value);
  assert.equal(record.score, null);
  const pairing = { id: 'matching', type: 'image-canvas', prompt: '给景物贴标签', inputMode: 'keyboard', children: [], data: {
    imageCanvas: { ...canvas, widgets: [
      { ...answer, id: 'region-coral', mode: 'region-match', matchShape: 'ellipse',
        matchConfig: { id: 'word-z', text: '珊瑚', correct: '找到了珊瑚', incorrect: '再观察颜色和形状' } },
      { ...answer, id: 'region-turtle', mode: 'region-match', x: 8, y: 24,
        matchConfig: { id: 'word-a', text: '海龟', correct: '', incorrect: '' } },
      { ...answer, id: 'caption', mode: 'keyboard', label: '观察说明' },
    ] },
  } };
  const saveLayout = (item: typeof pairing) => call('PUT', root, { content: { ...content, nodes: [item] } });
  const emptyWord = { ...pairing, data: { imageCanvas: { ...pairing.data.imageCanvas, widgets: pairing.data.imageCanvas.widgets.map((widget, i) =>
    i === 0 ? { ...widget, matchConfig: { id: 'word-z', text: ' ', correct: '', incorrect: '' } } : widget) } } };
  assert.equal((await saveLayout(emptyWord)).status, 400);
  const layoutResponse = await saveLayout(pairing);
  assert.equal(layoutResponse.status, 200, await layoutResponse.clone().text());
  const publicPairing = (await (await call('GET', root + '/student-view', undefined, token)).json()).content.nodes[0].data.imageCanvas;
  assert.deepEqual(publicPairing.matchChoices, [{ id: 'word-a', text: '海龟' }, { id: 'word-z', text: '珊瑚' }]);
  assert.deepEqual(publicPairing.widgets.map((widget: { label: string }) => widget.label), ['', '', '观察说明']);
  assert.doesNotMatch(JSON.stringify(publicPairing), /matchConfig|找到了珊瑚|再观察颜色和形状/);

  const check = (choiceId: string, targetId: string | null, generation = '0:0') =>
    call('POST', root + '/answers/match', { questionId: 'matching', choiceId, targetId, generation }, token);
  const wrong = { format: 'canvas-match/v1', targetId: 'region-turtle', targetNumber: 2, correct: false, feedback: '再观察颜色和形状' };
  const turtle = { format: 'canvas-match/v1', targetId: 'region-turtle', targetNumber: 2, correct: true, feedback: '配对正确！' };
  assert.deepEqual(await (await check('word-z', 'region-turtle')).json(), wrong);
  assert.deepEqual(await (await check('word-z', null)).json(), { correct: false, feedback: '再观察颜色和形状' });
  assert.deepEqual(await (await check('word-a', null)).json(), { correct: false, feedback: '这里不匹配，再试一次。' });
  assert.equal((await check('invalid-choice', null)).status, 400);
  assert.equal(await db.worksheetAnswer.count({ where: { questionId: 'matching' } }), 0);
  assert.deepEqual(await (await check('word-a', 'region-turtle')).json(), turtle);
  assert.equal((await check('word-z', 'caption')).status, 400);
  assert.equal((await check('region-coral', 'region-coral')).status, 400);
  assert.equal((await check('word-z', 'region-turtle', '99:0')).status, 409);
  await db.classroom.update({ where: { id: room.id }, data: { answersLocked: true } });
  assert.equal((await check('word-z', 'region-turtle')).status, 409);
  await db.classroom.update({ where: { id: room.id }, data: { answersLocked: false } });

  const saveMatching = (answers: Record<string, unknown>) => call('PUT', root + '/answers', { questionId: 'matching', value: mixed(answers) }, token);
  const submitMatching = () => call('POST', root + '/answers/submit', { questionId: 'matching' }, token);
  const caption = { format: 'text/v1', text: '看到了珊瑚与海龟' };
  assert.equal((await saveMatching({ 'word-z': wrong })).status, 200);
  assert.equal((await submitMatching()).status, 409);
  assert.equal((await saveMatching({ 'word-z': { ...wrong, correct: true, targetNumber: 1, feedback: '伪造' }, 'word-a': turtle, caption })).status, 200);
  assert.equal((await submitMatching()).status, 200);
  const matching = await db.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'matching' }, include: { reviews: true } });
  assert.deepEqual(matching.value, mixed({ 'word-z': wrong, 'word-a': turtle, caption }));
  assert.deepEqual(matching.reviews[0].value, matching.value);
  assert.equal(matching.score, null);

  const source = { x: 10, y: 20, width: 25, height: 10 };
  const ratedLayout = { ...pairing, data: { imageCanvas: { ...pairing.data.imageCanvas, matchTitle: '认一认海里的朋友', widgets: [
    ...pairing.data.imageCanvas.widgets.map(widget => widget.id === 'region-coral' && 'matchConfig' in widget
      ? { ...widget, textColor: '#ba593e', matchConfig: { ...widget.matchConfig, source, color: '#e4f4e9' } } : widget),
    { ...answer, id: 'stars', mode: 'star-rating', maxStars: 4, label: '同桌评星' },
  ] } } };
  const updateRating = await call('PUT', root, { content: { ...content, nodes: [ratedLayout] } });
  assert.equal(updateRating.status, 200, await updateRating.clone().text());
  const projection = (await (await call('GET', root + '/student-view', undefined, token)).json()).content.nodes[0].data.imageCanvas;
  assert.deepEqual(projection.matchChoices.find((choice: { id: string }) => choice.id === 'word-z'),
    { id: 'word-z', text: '珊瑚', source, color: '#e4f4e9', textColor: '#ba593e' });
  assert.equal(projection.matchTitle, '认一认海里的朋友');
  const projectedStars = projection.widgets.find((widget: { id: string }) => widget.id === 'stars');
  assert.equal(projectedStars.maxStars, 4);
  assert.equal(projectedStars.label, '星级评价');
  assert.doesNotMatch(JSON.stringify(projection), /matchConfig/);
  const stars = { format: 'canvas-stars/v1', stars: 3, maxStars: 4 };
  const ratedParts = { 'word-z': wrong, 'word-a': turtle, caption, stars };
  assert.equal((await saveMatching({ ...ratedParts, stars: { ...stars, stars: 5 } })).status, 400);
  assert.equal((await saveMatching({ ...ratedParts, stars: { ...stars, maxStars: 5 } })).status, 400);
  assert.equal((await saveMatching(ratedParts)).status, 200);
  const ratedSubmission = await submitMatching();
  assert.equal(ratedSubmission.status, 200);
  assert.equal((await ratedSubmission.json()).reviewStatus, 'submitted');
  const savedRating = await db.worksheetAnswer.findUniqueOrThrow({ where: { id: matching.id } });
  assert.deepEqual(savedRating.value, mixed(ratedParts));
  assert.equal(savedRating.score, null);

  const evaluation = (criteria: string) => ({ mode: 'ai', criteria });
  const reviewLayout = { ...ratedLayout, data: { imageCanvas: { ...ratedLayout.data.imageCanvas, widgets: [
    ...ratedLayout.data.imageCanvas.widgets.map(widget => ({ ...widget, canvasEvaluation: evaluation(
      widget.id === 'caption' ? '文字标准：写清观察对象' : '客观控件不能发起个人评价',
    ) })),
    { ...answer, id: 'photo', label: '作品照片', mode: 'photo', canvasEvaluation: {
      ...evaluation('照片标准：作品清晰'), evaluationImages: [rubricImage],
    } },
    { ...answer, id: 'recording', label: '观察录音', mode: 'audio', canvasEvaluation: evaluation('录音标准：说清依据') },
    { ...answer, id: 'ink', label: '手写笔记', mode: 'handwriting',
      canvasEvaluation: { ...evaluation('手写标准：重点醒目'), autoReview: false } },
  ] } } };
  const blankRubric = structuredClone(reviewLayout);
  blankRubric.data.imageCanvas.widgets.at(-1)!.canvasEvaluation.criteria = ' ';
  assert.equal((await saveLayout(blankRubric)).status, 400);
  const savedReviewLayout = await saveLayout(reviewLayout);
  assert.equal(savedReviewLayout.status, 200, await savedReviewLayout.clone().text());
  const reviewWidgets = (await savedReviewLayout.json()).content.nodes[0].data.imageCanvas.widgets;
  assert.ok(reviewWidgets.filter((widget: { mode: string }) => ['region-match', 'star-rating'].includes(widget.mode))
    .every((widget: { canvasEvaluation?: unknown }) => !widget.canvasEvaluation));
  const reviewProjection = (await (await call('GET', root + '/student-view', undefined, token)).json()).content.nodes[0].data;
  assert.equal(reviewProjection.studentAiReviewEnabled, true);
  assert.doesNotMatch(JSON.stringify(reviewProjection), /canvasEvaluation|标准：/);
  assert.ok(!JSON.stringify(reviewProjection).includes(rubricImage));

  const individualCalls: string[] = [];
  app.set('analysisProxy', async (_agent: unknown, message: string, images: Buffer[], _signal: unknown, clips: Array<{ url: string }>) => {
    individualCalls.push(message);
    assert.doesNotMatch(message, /客观控件不能发起个人评价|配对正确|3 \/ 4 星/);
    if (message.includes('文字标准')) {
      assert.match(message, /看到了珊瑚与海龟/);
      assert.equal(images.length, 1);
    }
    if (message.includes('照片标准')) assert.equal(images.length, 3, '底图、评价依据和学生照片');
    if (message.includes('手写标准')) assert.equal(images.length, 2);
    if (message.includes('录音标准')) assert.equal(clips[0].url, audio.url);
    return { success: true, content: '说清了观察对象。<classnode-feedback>{"students":[{"student":"示例学生#01","advice":"可以再补一个细节。"}]}</classnode-feedback>' };
  });
  const reviewParts = { ...ratedParts, photo: complete.answers.photo, recording: audio, ink: complete.answers.ink };
  assert.equal((await saveMatching({ ...reviewParts, ink: undefined })).status, 200);
  assert.equal((await submitMatching()).status, 409);
  assert.equal(individualCalls.length, 0);
  assert.equal((await saveMatching(reviewParts)).status, 200);
  const submitEntire = () => call('POST', root + '/answers/submit', { questionId: 'matching', requestId: 'review-entire-task' }, token);
  const wholeSubmission = await submitEntire();
  assert.equal(wholeSubmission.status, 200, await wholeSubmission.clone().text());
  const { reviewId, reviewStatus } = await wholeSubmission.json();
  assert.equal(reviewStatus, 'pending');
  assert.equal((await (await submitEntire()).json()).reviewId, reviewId);
  const four = await waitForReview(reviewId);
  assert.equal(four.status, 'succeeded', four.error ?? undefined);
  assert.equal(four.score, null);
  const allRegions = /观察说明[\s\S]*作品照片[\s\S]*观察录音[\s\S]*手写笔记/;
  assert.match(four.reason ?? '', allRegions);
  assert.match(four.advice ?? '', allRegions);
  assert.match(four.advice ?? '', /可以再补一个细节/);
  assert.doesNotMatch(four.reason ?? '', /星级评价|拖拽配对/);
  assert.equal(individualCalls.length, 4);
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: matching.id } })).score, null);
  const studentReviews = await (await call('GET', root + '/answers/reviews', undefined, token)).json();
  assert.equal(studentReviews.reviews[0].reason, four.reason);
  assert.equal(studentReviews.reviews[0].advice, four.advice);
});
