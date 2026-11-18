import test from 'node:test';
import type { Prisma } from '@prisma/client';
import assert from 'node:assert/strict';
import { validateQuestion, grade, stripAnswers, type QuestionNode } from '../services/worksheet-questions.js';
import { ratingConfig, readRatingAnswer } from '../services/worksheet-rating.js';
import { analysisAnswerText, analysisQuestionDetails } from '../services/analysis-question.js';
import { wordCloudRequirementsOf } from '../services/analysis-feedback.js';
import { studentAnswerText } from '../services/worksheet-record-docx.js';
const question = (): QuestionNode => ({
  id: 'q_rating', type: 'rating', prompt: '分享你的评价', inputMode: 'keyboard', autoGrade: false, children: [],
  data: { evaluationVersion: 1, evaluationMode: 'collect', evaluationScored: false,
    rating: { maxStars: 3, dimensions: [{ id: 'clarity', text: '清晰程度' }], commentEnabled: true, commentPrompt: '有什么建议？' },
    wordCloudRequirements: '提炼有依据的共同观点' },
});
const answer = { format: 'rating/v1', maxStars: 3, ratings: { clarity: 2 }, text: '说明清楚，希望增加示例。' };
test('评价题合法配置可保存，参与者能读取维度和提示，不自动判分', () => {
  const q = question();
  assert.deepEqual(validateQuestion(q), []);
  assert.deepEqual(stripAnswers({ schemaVersion: 1, nodes: [q] }).nodes[0].data.rating, q.data.rating);
  assert.equal(grade(q, answer, { full: 1, half: 0 }), null);
  assert.equal(grade({ ...q, autoGrade: true }, answer, { full: 1, half: 0 }), null);
  assert.equal(ratingConfig(q.data).maxStars, 3);
});
test('评价题拒绝重复维度、空名称、非法上限或AI评分模式', () => {
  for (const rating of [
    { maxStars: 3, minCommentLength: 0, dimensions: [{ id: 'a', text: '清晰程度' }] },
    { maxStars: 3, minCommentLength: 1.5, dimensions: [{ id: 'a', text: '清晰程度' }] },
    { maxStars: 0, dimensions: [{ id: 'a', text: '清晰程度' }] },
    { maxStars: 3, dimensions: [] },
    { maxStars: 3, dimensions: [{ id: 'a', text: '' }] },
    { maxStars: 3, dimensions: [{ id: 'a', text: '甲' }, { id: 'a', text: '乙' }] },
  ]) assert.ok(validateQuestion({ ...question(), data: { ...question().data, rating } }).length);
  assert.ok(validateQuestion({ ...question(), data: { ...question().data, evaluationMode: 'ai' } }).length);
});
test('整体分析及作答导出包含维度、星级和原始文字，云提炼要求可用', () => {
  const q = question();
  const text = analysisAnswerText(q, answer);
  assert.match(text || '', /清晰程度：2 \/ 3/);
  assert.match(text || '', /希望增加示例/);
  assert.equal(studentAnswerText(answer, q), text);
  assert.equal(wordCloudRequirementsOf(q), '提炼有依据的共同观点');
  assert.match(analysisQuestionDetails(q), /观点云只从文字感想提炼/);
  assert.deepEqual(readRatingAnswer(q.data, answer), answer);
});

test('真实提交接口拒绝空白及不足字数的感想，但允许草稿保存与关闭文字后的评星提交', async t => {
  const { createServer } = await import('node:http');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { default: express } = await import('express');
  const { createDatabaseClient } = await import('../services/database-client.js');
  const { createTeacherSession } = await import('../middleware/auth.js');
  const { createStudentToken } = await import('../middleware/student-auth.js');
  const { worksheetAccessGate, worksheetRoutes } = await import('../routes/worksheets.js');
  const { prepareTemporarySqliteFile } = await import('./helpers/temporary-sqlite.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-rating-submit-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)), 'db', 'push', '--skip-generate', '--schema', fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url))], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = createDatabaseClient(url);
  const app = express();
  app.use(express.json()); app.set('prisma', db);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const address = server.address() as import('node:net').AddressInfo;
  let cookie = '';
  createTeacherSession({ setHeader: (_name: string, value: string) => { cookie = value.split(';')[0]; } } as never);
  const call = (method: string, route: string, body?: unknown, token?: string) => fetch(`http://127.0.0.1:${address.port}/api/worksheets${route}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const q = question();
  q.data.rating = { ...ratingConfig(q.data), minCommentLength: 5, dimensions: [{ id: 'design', text: '教学设计' }, { id: 'goals', text: '目标设计', parentId: 'design' }, { id: 'clarity', parentId: 'goals', text: '清晰程度', runs: [{ start: 0, end: 2, bold: true, italic: false, underline: true, emphasis: false, color: '#315c86' }] }] };
  const created = await call('POST', '', { title: '评价题提交校验', content: { schemaVersion: 1, nodes: [q] }, settings: { allowResubmit: true } });
  assert.equal(created.status, 200, await created.clone().text());
  const sheet = await created.json();
  assert.deepEqual(sheet.content.nodes[0].data.rating, q.data.rating);
  const reread = await (await call('GET', `/${sheet.id}`)).json();
  assert.deepEqual(reread.content.nodes[0].data.rating, q.data.rating);
  const room = await db.classroom.create({ data: { status: 'active', mode: 'standard' } });
  await db.classroomWorksheet.create({ data: { classroomId: room.id, worksheetId: sheet.id } });
  const klass = await db.class.create({ data: { name: '测试班' } });
  const student = await db.student.create({ data: { classId: klass.id, name: '测试参与者', studentNo: '01' } });
  const participant = await db.classroomStudent.create({ data: { classroomId: room.id, studentId: student.id, type: 'student' } });
  const token = createStudentToken(room.id, participant.id);
  const save = (text: string) => call('PUT', `/${sheet.id}/answers`, { questionId: q.id, value: { ...answer, text } }, token);
  const updateDefinition = (node: QuestionNode, title = sheet.title) => call('PUT', `/${sheet.id}`, { title, content: { schemaVersion: 1, nodes: [node] } });
  const fiveStars = () => ({ ...q, data: { ...q.data, rating: { ...ratingConfig(q.data), maxStars: 5 } } });
  assert.equal((await updateDefinition(fiveStars())).status, 200, '未作答时可以调整上限');
  assert.equal((await updateDefinition(q)).status, 200);
  const submit = () => call('POST', `/${sheet.id}/answers/submit`, { questionId: q.id }, token);
  for (const text of ['', '   \n', '清 楚']) {
    assert.equal((await save(text)).status, 200);
    assert.equal((await updateDefinition(fiveStars())).status, 409, '草稿同样保护已有星级');
    const res = await submit();
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'rating-incomplete');
    const row = await db.worksheetAnswer.findFirst({ where: { response: { worksheetId: sheet.id }, questionId: q.id } });
    assert.equal(row?.status, 'draft');
    assert.equal(row?.score, null);
  }
  const partial = await call('PUT', `/${sheet.id}/answers`, { questionId: q.id, value: { ...answer, ratings: {}, text: '讲解清楚易懂' } }, token);
  assert.equal(partial.status, 200, '纯文字可存为草稿');
  const incomplete = await submit();
  assert.equal(incomplete.status, 409);
  assert.match((await incomplete.json()).error, /还差 1 项/);
  assert.equal((await save('讲解清楚易懂')).status, 200);
  assert.equal((await submit()).status, 200);
  await t.test('已交评价的上限、末级维度和题目删除受到事务保护，说明与分组仍可调整', async () => {
    const current = ratingConfig(q.data);
    const attempts: QuestionNode[] = [
      fiveStars(),
      { ...q, data: { ...q.data, rating: { ...current, dimensions: [...current.dimensions, { id: 'extra', text: '新增维度' }] } } },
      { ...q, data: { ...q.data, rating: { ...current, dimensions: [...current.dimensions.map(d => d.id === 'clarity' ? { ...d, parentId: 'design' } : d), { id: 'child', text: '原末级改为分组', parentId: 'clarity' }] } } },
      { ...q, data: { ...q.data, rating: { ...current, dimensions: current.dimensions.filter(d => d.id !== 'clarity') } } },
      { ...question(), id: 'replacement_question' },
    ];
    for (const candidate of attempts) {
      const response = await updateDefinition(candidate, '不应写入的标题');
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal((await response.json()).code, 'rating-definition-in-use');
    }
    await db.worksheet.update({ where: { id: sheet.id }, data: { content: { schemaVersion: 1, nodes: [fiveStars()] } as unknown as Prisma.InputJsonValue } });
    assert.equal((await updateDefinition(q)).status, 200, '已存在的错误上限可恢复到所有原作答的上限，不改动作答');
    const preserved = await db.worksheet.findUniqueOrThrow({ where: { id: sheet.id } });
    assert.equal(preserved.title, sheet.title, '冲突不能写入同一请求的其他字段');
    assert.equal(ratingConfig((preserved.content as unknown as { nodes: QuestionNode[] }).nodes[0].data).maxStars, 3);
    const stored = await db.worksheetAnswer.findFirstOrThrow({ where: { response: { worksheetId: sheet.id }, questionId: q.id } });
    assert.deepEqual(readRatingAnswer(q.data, stored.value)?.ratings, { clarity: 2 });
    assert.match(analysisAnswerText(q, stored.value) ?? '', /2 \/ 3/);
    assert.match(studentAnswerText(stored.value, q) ?? '', /2 \/ 3/);
    q.data.rating = { ...current, dimensions: current.dimensions.map(d => d.id === 'clarity' ? { ...d, text: '清晰程度：补充说明' } : { ...d, text: `${d.text}（分组）` }) };
    assert.equal((await updateDefinition(q)).status, 200, '更改说明、格式、分组名称不隐藏原评价');
  });
  q.data.rating = { ...ratingConfig(q.data), commentEnabled: false };
  const updated = await call('PUT', `/${sheet.id}`, { title: sheet.title, content: { schemaVersion: 1, nodes: [q] }, settings: { allowResubmit: true } });
  assert.equal(updated.status, 200, await updated.clone().text());
  assert.equal((await save('')).status, 200);
  assert.equal((await submit()).status, 200);
  await db.worksheetResponse.deleteMany({ where: { worksheetId: sheet.id } });
  assert.equal((await updateDefinition(fiveStars())).status, 200, '清空原作答后可以调整量表');
});


test('保存拒绝断链、循环和四级维度，支持单维度及混合层级', () => {
  const make = (dimensions: unknown[]) => ({ ...question(), data: { ...question().data, rating: { maxStars: 3, dimensions } } });
  const valid = [{ id: 'a', text: '一级' }, { id: 'b', text: '二级', parentId: 'a' }, { id: 'c', text: '三级', parentId: 'b' }];
  assert.deepEqual(validateQuestion(make(valid)), []);
  for (const dimensions of [
    [...valid, { id: 'd', text: '四级', parentId: 'c' }],
    [{ id: 'a', text: '断链', parentId: 'missing' }],
    [{ id: 'a', text: '循环A', parentId: 'b' }, { id: 'b', text: '循环B', parentId: 'a' }],
    [{ id: 'a', text: '自身', parentId: 'a' }],
  ]) assert.ok(validateQuestion(make(dimensions)).some(error => error.includes('三级')));
  assert.deepEqual(validateQuestion(make([{ id: 'a', text: '整体感受' }])), []);
});
