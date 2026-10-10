/** Default: read-only planning. --apply creates; --update --apply adjusts only this existing demo classroom. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { flattenQuestions, validateQuestion, grade, resolvePoints, DEFAULT_POINTS } from '../server/dist/services/worksheet-questions.js';
import { drawingSnapshot } from './lib/answer-snapshots.mjs';
import { findInkValueError } from '../server/dist/services/worksheet-ink.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server/package.json'));
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const db = path.join(root, 'server/prisma/dev.db');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
const updating = process.argv.includes('--update');
const apply = process.argv.includes('--apply');
const title = '四年级数学 · 数学游园会（8题综合测试）';
const classroomTitle = '三国班 · 数学游园会（8题测试）';
const output = path.join(root, '.dev/math-garden');
const uploaded = [];
let committed = false;
const q = (id, type, prompt, data, extra = {}) => ({ id, type, prompt, inputMode: 'keyboard', data, children: [], points: { full: 1, half: 0 }, ...extra });
const item = (id, text) => ({ id, text });
const prompt = '长方形活动区长6米、宽4米。铺满地面的面积是{填空域}平方米；围一圈护栏（不留入口）需要{填空域}米。（第1空直接填写，第2空从候选数中选择。）';
const runs = [];
let cursor = 0, blank = 0;
for (const match of prompt.matchAll(/\{填空域\}/g)) {
  if (match.index > cursor) runs.push({ start: cursor, end: match.index, blank: '' });
  runs.push({ start: match.index, end: match.index + 5, blank: `garden-blank-${++blank}` }); cursor = match.index + 5;
}
if (cursor < prompt.length) runs.push({ start: cursor, end: prompt.length, blank: '' });
const questions = [
  q('garden-q1', 'multi-choice', '套圈时，每人使用同样的圈。哪些安排能让比赛更公平？（多选）', {
    options: [{ key: 'A', text: '每位同学的投掷线到目标的距离相同' }, { key: 'B', text: '每人投掷次数相同' }, { key: 'C', text: '让个子高的同学站得更近' }, { key: 'D', text: '使用同样大小的目标' }], correctKeys: ['A', 'B', 'D'], partialCredit: 'allow-missing', explanation: '控制距离、次数和器材条件；身高不是改变距离的理由。',
  }),
  q('garden-q2', 'fill-blank', prompt, { promptRuns: runs, answers: [['24'], ['20']], fillScoring: 'per-blank', fillBlankSettings: { 'garden-blank-1': { mode: 'text', choices: [] }, 'garden-blank-2': { mode: 'inline', choices: ['10', '20', '24'] } }, explanation: '面积6×4=24平方米；周长(6+4)×2=20米。' }),
  q('garden-q3', 'match', '给摊位标志挑选图形：把图形与最贴切的特征连起来，每项只连一次。', {
    left: [item('l1', '长方形（不是正方形）'), item('l2', '正方形'), item('l3', '三角形'), item('l4', '圆')],
    right: [item('r3', '有三条边、三个角'), item('r1', '四个直角，两组对边相等，相邻边不等'), item('r4', '到圆心距离相等的点组成的封闭曲线'), item('r2', '四条边都相等，四个角都是直角')],
    pairs: [1, 2, 3, 4].map(n => ({ leftId: `l${n}`, rightId: `r${n}` })), explanation: '依据边和角的特征判断，正方形也属于特殊的长方形。',
  }),
  q('garden-q4', 'order', '测量活动区一条边的长度，把操作步骤排成合理顺序。', {
    items: [item('s3', '读出终点对应的刻度'), item('s1', '把卷尺零刻度对准起点'), item('s4', '记录长度并写上单位'), item('s2', '沿直边拉直卷尺，到达终点')], correctOrder: ['s1', 's2', 's3', 's4'], explanation: '先对零、再拉直、后读数，最后带单位记录。',
  }),
  q('garden-q5', 'categorize', '把这些量分成两类，注意长度和面积的单位。', {
    items: [item('i1', '护栏长20米'), item('i2', '地面24平方米'), item('i3', '彩带长80厘米'), item('i4', '标牌面积300平方厘米')], zones: [{ id: 'length', label: '长度（可测边或周长）' }, { id: 'area', label: '面积（铺满表面）' }], placement: { i1: 'length', i2: 'area', i3: 'length', i4: 'area' }, explanation: '米、厘米测长度；平方米、平方厘米测面积。',
  }),
  q('garden-q6', 'short-answer', '小明说：“6米×4米与7米×3米的两块长方形场地，周长相等，所以面积也相等。”你同意吗？请计算两块场地的周长和面积，再说明理由。', {
    answers: [['不同意。两块场地周长都是20米，面积分别24平方米和21平方米；周长相等，面积不一定相等。']], aiScoringEnabled: true, aiScoringMaxScore: 5,
    rubricText: '共5个奖励：明确不同意1个；两个周长都算对1个；两个面积都算对1个；说明周长相同不能推出面积相同1个；长度和面积单位正确1个。只写结论最多1个，接受等价表达，不要求逐字一致。',
  }, { points: { full: 5, half: 0 } }),
  q('garden-q7', 'drawing', '用数学画板画一个长方形活动区，在长边旁标“6米”，在短边旁标“4米”。只需画出大致形状，不要求按比例、数方格或计算周长和面积。', {
    drawingTool: 'math', drawingBackgroundPreset: 'small-grid', answers: [['画出大致封闭的长方形，在长边标6米、短边标4米。']], aiScoringEnabled: true, aiScoringMaxScore: 3,
    rubricText: '共3个奖励：画出可辨认的大致封闭长方形1个；在长边旁标6米1个；在短边旁标4米1个。允许旋转、轻微边线或落点误差；不要求精确比例、直角记号、数方格、周长或面积计算，不按美观扣分。缺失或错误只扣对应项，不重复扣。',
  }, { inputMode: 'handwriting', autoGrade: false, points: { full: 3, half: 0 } }),
  q('garden-q8', 'drawing', '用思维导图整理“长方形场地设计”。至少有“周长”“面积”“生活用途”三个分支，写出公式、单位以及本次6米×4米场地的结果，说明护栏和铺地分别用哪个量。', {
    drawingTool: 'mind-map', drawingBackgroundPreset: 'blank', answers: [['周长：(长+宽)×2，长度单位，20米，用于护栏；面积：长×宽，平方单位，24平方米，用于铺地；分支层次清楚。']], aiScoringEnabled: true, aiScoringMaxScore: 5,
    rubricText: '共5个奖励：中心主题及至少3个有意义的主分支1个；周长公式和20米正确1个；面积公式和24平方米正确1个；明确护栏用周长、铺地用面积1个；长度与面积单位正确且未混淆1个。接受同义标签及等价公式，不按美观评分，重复内容只计一次。',
  }, { inputMode: 'handwriting', autoGrade: false, points: { full: 5, half: 0 } }),
];
const content = { schemaVersion: 1, nodes: [
  { id: 'garden-t1', type: 'task', prompt: '任务一：筹备公平的游园会', inputMode: 'keyboard', data: { description: '四年级准备数学游园会。先到探究空间体验套圈，观察距离对公平的影响，再计算场地用量、选择标志图形。' }, children: questions.slice(0, 3) },
  { id: 'garden-t2', type: 'task', prompt: '任务二：测量与核对方案', inputMode: 'keyboard', data: { description: '用卷尺规范测量，分清长度和面积，并核对两种场地方案。' }, children: questions.slice(3, 6) },
  { id: 'garden-t3', type: 'task', prompt: '任务三：画图与整理方法', inputMode: 'keyboard', data: { description: '把6米×4米的方案画出来，用思维导图向其他同学介绍周长和面积的用途。' }, children: questions.slice(6) },
] };
const shortTexts = [
  '我不同意。第一个周长（6+4）×2=20米，面积6×4=24平方米。第二个周长（7+3）×2=20米，面积7×3=21平方米。围一圈一样长，里面能铺的大小不同。',
  '不同意。6+4和7+3都等于10，周长都是20米。一个里面有24个1平方米，另一个有21个，所以面积不一样。',
  '不对，24平方米和21平方米不相等。两个周长都20米，不能只看边加起来一样。',
  '不同意。6×4=24，7×3=21。周长都是20。',
  '我觉得不同意，第一个24平方米，另一个我算7×3=24平方米。它们形状不同。',
  '两个周长一样，都是20米。我还不会判断面积是不是一样。',
  '同意。6+4=10，7+3=10，所以面积都是10平方米。',
  '同意，围栏一样长，里面肯定一样大，都是20平方米。',
];
function mathData(level, index) {
  const x = -3 + index % 2, y = 2 + index % 2;
  const triangle = level === 2 && index % 2;
  const elements = [{ kind: 'polyline', closed: true, points: triangle ? [[x,y],[x+6,y],[x+3,y-4]] : [[x,y],[x+6,y],[x+6,y-4],[x,y-4]] }];
  if (!triangle) elements.push({kind:'label',at:[x+1,y+.9],text:level===2?'5米':'6米'});
  if (level === 0 || (index % 2 === 0)) elements.push({kind:'label',at:[x+6+.4,y-1],text:'4米'});
  return { elements };
}
function mindData(level, index) {
  const leaf = topic => ({ id: randomUUID(), topic });
  const branch = (topic, direction, topics) => ({ id: randomUUID(), topic, direction, children: topics.map(leaf) });
  return { nodeData: { id: randomUUID(), topic: '长方形场地', root: true, children: [
    branch('周长', 0, level === 2 ? ['长×宽', '20平方米'] : ['(长+宽)×2', '20米']),
    branch('面积', 1, level === 2 ? ['长+宽', '10平方米'] : ['长×宽', level === 1 && index % 2 ? '24米' : '24平方米']),
    ...(level === 1 && index % 2 === 0 ? [] : [branch('生活用途', 1, level === 2 ? ['护栏用面积'] : ['护栏用周长', '铺地用面积'])]),
  ] }, direction: 2 };
}
function objective(index, j) {
  // Stable learner tendency with question-specific slips; every objective question covers all verdicts.
  const level = index < 12 ? ((index + j * 3) % 13 === 0 ? 1 : 0) : index < 32 ? ((index + j * 2) % 4 < 2 ? 0 : 1) : ((index + j) % 5 === 0 ? 0 : 2);
  if (j === 0) return { format: 'choice/v1', selected: level === 0 ? ['A', 'B', 'D'] : level === 1 ? ['A', 'B'] : ['A', 'C'] };
  if (j === 1) return { format: 'fill-multi/v1', texts: level === 0 ? ['24', '20'] : level === 1 ? ['24', '10'] : ['10', '24'] };
  if (j === 2) return { format: 'match/v1', links: [1, 2, 3, 4].map(n => ({ leftId: `l${n}`, rightId: `r${level === 0 ? n : level === 1 ? (n <= 2 ? 3 - n : n) : (n % 4) + 1}` })) };
  if (j === 3) return { format: 'order/v1', order: level === 0 ? ['s1', 's2', 's3', 's4'] : level === 1 ? ['s1', 's3', 's2', 's4'] : ['s3', 's4', 's1', 's2'] };
  return { format: 'categorize/v1', assignment: level === 0 ? { i1: 'length', i2: 'area', i3: 'length', i4: 'area' } : level === 1 ? { i1: 'length', i2: 'area', i3: 'length', i4: 'length' } : { i1: 'area', i2: 'length', i3: 'area', i4: 'length' } };
}

try {
  assert.equal(flattenQuestions(content).filter(n => n.type !== 'task').length, 8);
  for (const node of flattenQuestions(content)) assert.deepEqual(validateQuestion(node), [], node.id);
  const klass = await prisma.class.findFirstOrThrow({ where: { name: '三国班' }, include: { students: { orderBy: { studentNo: 'asc' } } } });
  klass.students.sort((a, b) => Number(a.studentNo) - Number(b.studentNo));
  assert.equal(klass.students.length, 40);
  const webapp = await prisma.webapp.findFirstOrThrow({ where: { name: '套圈游戏-怎样才公平' } });
  const companion = await prisma.agent.findFirstOrThrow({ where: { name: '数学连环画评价助手', purpose: 'tutoring', enabled: true }, select: { id: true, name: true } });
  const analyst = await prisma.agent.findFirstOrThrow({ where: { purpose: 'analysis', enabled: true }, select: { id: true, name: true } });
  const existing = await prisma.classroom.findFirst({ where: { title: classroomTitle }, include: { worksheets: true } });
  if (updating) assert.ok(existing && existing.worksheets.length === 1, '需要唯一的原测试课堂与学习单');
  if (!updating && existing) throw new Error('同名测试课堂已存在，停止以免重复灌入。');
  const settings = { allowResubmit: true, autoGrade: true, answerMode: 'open', defaultInputMode: 'keyboard', rewardStyle: 'star', rewardStep: 1, halfStep: 0, analysisAgentId: analyst.id, backgroundTheme: 'creative-notebook' };
  const plan = [];
  const totals = questions.map(node => ({ questionId: node.id, type: node.type, correct: 0, partial: 0, incorrect: 0, ungraded: 0 }));
  for (const [index, student] of klass.students.entries()) {
    const level = index < 12 ? 0 : index < 32 ? 1 : 2;
    const answers = [];
    for (const [j, node] of questions.entries()) {
      let value;
      if (j < 5) value = objective(index, j);
      else if (j === 5) value = { format: 'text/v1', text: shortTexts[level === 0 ? index % 3 : level === 1 ? 2 + index % 4 : 5 + index % 3] };
      else {
        const tool = j === 6 ? 'math' : 'mind-map';
        const data = j === 6 ? mathData(level, index) : mindData(level, index);
        const image = `/uploads/chat/chat-${randomUUID()}.png`;
        value = { format: 'drawing/v1', canvas: { w: 320, h: 240 }, strokes: [], drawing: { tool, data, image } };
      }
      const verdict = grade(node, value, resolvePoints(node, DEFAULT_POINTS));
      if (j >= 6) assert.equal(findInkValueError(value), null, `${student.name}第${j + 1}题绘图格式`);
      totals[j][verdict?.state ?? 'ungraded']++;
      answers.push({ questionId: node.id, value, gradeState: verdict?.state ?? null, score: verdict?.score ?? null, isCorrect: verdict ? verdict.state === 'correct' : null });
    }
    plan.push({ studentId: student.id, name: student.name, studentNo: student.studentNo, level, answers });
  }
  for (const row of totals.slice(0, 5)) assert.ok(row.correct > 0 && row.incorrect > 0, JSON.stringify(row));
  console.log(JSON.stringify({ title, classroomTitle, students: plan.length, answers: plan.length * 8, webapp: webapp.name, companion: companion.name, analyst: analyst.name, totals }, null, 2));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify({ title, content, settings, totals, plan }, null, 2));
  const report = [
    '# 数学游园会测试数据验收说明', '',
    '这批作答是虚构的功能测试样本，不代表“三国班”真实学业水平。共3个任务、8道小题、40位参与者、320条已提交作答。未提前调用AI或伪造AI评分；三个主观题分别为5、3、5个奖励，等待教师实际运行AI评分。', '',
    '学习单：' + title, '课堂：' + classroomTitle, '探究空间：' + webapp.name, '智能学伴：' + companion.name, '分析智能体：' + analyst.name, '',
    '## 自动评分核对', '',
    '|题号|题型|全对|部分正确|答错|待AI评分|', '|---|---|---:|---:|---:|---:|',
    ...totals.map((r, i) => `|${i + 1}|${r.type}|${r.correct}|${r.partial}|${r.incorrect}|${r.ungraded}|`), '',
    '自动判分由现有grade函数生成。多选允许漏选但不允许错选；填空按空评分（2个空，每空答对1个奖励）；其他客观题全对1个奖励、未全对0个奖励（保留部分正确状态供分析）。', '',
    '## 主观题核对重点', '',
    '第6题：同周长、不同面积。完整正确的计算与反例应为5个奖励；缺单位应扣单位项；只算周长约1—2个奖励；认为同周长必同面积应明显低于正确反例，不可因文字流畅给高分。',
    '第7题：长方形与6米、4米标注都正确应3个奖励；缺宽边标注2个；长边误写5米但形状与宽边正确2个；画成三角形且无标注0个。无需计算周长面积或按比例作图。',
    '第8题：完整正确导图应5个奖励；缺生活用途分支约3个奖励；面积单位写成米应扣相应项；交换周长、面积公式且把护栏归面积应低分。以题内评分细则逐项核对，AI实际输出可能有合理差异。', '',
    '## 逐生检查索引', '', '|学号|姓名|第6题答案|第7题|第8题|', '|---|---|---|---|---|',
    ...plan.map((p, i) => `|${p.studentNo}|${p.name}|${p.answers[5].value.text}|${p.level === 0 ? '正确长方形与边长标注' : p.level === 1 ? (i % 2 ? '缺宽边标注' : '正确长方形与标注') : (i % 2 ? '画成三角形且无标注' : '长边误标5米')}|${p.level === 0 ? '完整正确' : p.level === 1 ? (i % 2 ? '面积单位写成米' : '缺生活用途分支') : '交换公式、用途混淆'}|`), '',
    '## AI分析预期', '',
    '应识别：多选漏选与错选不同；周长漏乘2；周长与面积混淆；长方形和正方形特征混淆；测量先读数后拉直；平方单位误写长度单位。分析统计必须与上表一致，逐生评分仅覆盖本次名单，不能用语文表达、美观或模拟姓名推断数学水平。', '',
    '所有人交齐，适合40人批量分析、漏评分补跑和重复评分验收。空白、未提交、照片手写未包含在本批中。学习单允许重做，三个模块已开放。', '',
  ].join('\n');
  const notesDir = path.join(root, 'docs/project-notes');
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, 'TEST-DATA-MATH-GARDEN-2026-10-10.md'), report);
  // Render actual snapshots even in dry mode so they can be inspected before writing business data.
  for (const person of plan) for (const answer of person.answers.slice(6)) {
    const { tool, data } = answer.value.drawing;
    const rendered = drawingSnapshot(tool, data);
    assert.ok(rendered?.svg);
    const preview = path.join(output, `${person.studentNo}-${tool}.png`);
    const grid = tool === 'math' ? '<defs><pattern id="grid" width="14" height="14" patternUnits="userSpaceOnUse" x="160" y="120"><path d="M14 0H0V14" fill="none" stroke="#dbe3ec" stroke-width="0.5"/></pattern></defs><rect width="320" height="240" fill="url(#grid)"/>' : '';
    const svg = rendered.svg.replace(/(<rect[^>]*fill="#ffffff"\s*\/>)/, '$1' + grid);
    await sharp(Buffer.from(svg)).png().toFile(preview);
  }
  if (!apply) { console.log('仅规划和快照预览，未写入数据库。'); }
  else {
    const backup = path.join(root, 'server/prisma/backups', `before-math-garden-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    execFileSync('python3', ['-c', 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()', db, backup]);
    const uploadDir = path.join(root, 'server/uploads/chat');
    fs.mkdirSync(uploadDir, { recursive: true });
    for (const person of plan) for (const answer of person.answers.slice(6, updating ? 7 : 8)) {
      const destination = path.join(uploadDir, path.basename(answer.value.drawing.image));
      fs.copyFileSync(path.join(output, `${person.studentNo}-${answer.value.drawing.tool}.png`), destination); uploaded.push(destination);
    }
    const result = await prisma.$transaction(async tx => {
      if (updating) {
        const worksheetId = existing.worksheets[0].worksheetId;
        const original = await tx.worksheet.findUniqueOrThrow({where:{id:worksheetId}});
        assert.equal(original.title,title);
        await tx.worksheet.update({where:{id:worksheetId},data:{content,settings}});
        const responses = await tx.worksheetResponse.findMany({where:{classroomId:existing.id,worksheetId},include:{participant:true,answers:true}});
        assert.equal(responses.length,40);
        for (const response of responses) {
          const person = plan.find(row=>row.studentId===response.participant.studentId);
          assert.ok(person);
          for (const old of response.answers) {
            const j = questions.findIndex(node=>node.id===old.questionId);
            assert.ok(j>=0);
            const value = j === 6 ? person.answers[6].value : old.value;
            const verdict = grade(questions[j],value,resolvePoints(questions[j],DEFAULT_POINTS));
            await tx.worksheetAnswer.update({where:{id:old.id},data:{...(j===6?{value}:{}),gradeState:verdict?.state??null,score:verdict?.score??null,isCorrect:verdict?verdict.state==='correct':null}});
          }
        }
        await tx.worksheetQuestionAnalysis.deleteMany({where:{classroomId:existing.id,worksheetId}});
        return {classroomId:existing.id,worksheetId,code:existing.code};
      }
      const sheet = await tx.worksheet.create({ data: { title, description: '四年级数学综合实践；3个任务、8道小题。模拟数据，仅用于功能验收。', content, settings } });
      const occupied = new Set((await tx.classroom.findMany({ where: { code: { not: null } }, select: { code: true } })).map(row => row.code));
      let code = '6808'; while (occupied.has(code)) code = String(Number(code) + 1);
      const room = await tx.classroom.create({ data: { title: classroomTitle, code, mode: 'standard', status: 'active', classes: { create: { classId: klass.id } }, worksheets: { create: { worksheetId: sheet.id } }, webapps: { create: { webappId: webapp.id } }, classroomAgents: { create: { agentId: companion.id } }, modules: { create: ['learning-sheet', 'explorer', 'companion'].map(moduleKey => ({ moduleKey, state: 'open' })) } } });
      const started = Date.now() - 45 * 60_000;
      for (const [index, person] of plan.entries()) {
        const participant = await tx.classroomStudent.create({ data: { classroomId: room.id, studentId: person.studentId, type: 'student', status: 'offline' } });
        const startedAt = new Date(started + index * 8000);
        const answers = person.answers.map((answer, j) => {
          const createdAt = new Date(startedAt.getTime() + j * 155000);
          const savedAt = new Date(createdAt.getTime() + 35000 + person.level * 18000 + index % 7 * 3000);
          return { ...answer, status: 'submitted', createdAt, savedAt, submittedAt: new Date(savedAt.getTime() + 8000), saveCount: 1 + (index + j) % 4 };
        });
        await tx.worksheetResponse.create({ data: { classroomId: room.id, worksheetId: sheet.id, participantId: participant.id, status: 'submitted', startedAt, submittedAt: answers[7].submittedAt, answers: { create: answers } } });
      }
      return { classroomId: room.id, worksheetId: sheet.id, code };
    }, { timeout: 60000 });
    committed = true;
    assert.equal(await prisma.worksheetResponse.count({ where: { classroomId: result.classroomId } }), 40);
    assert.equal(await prisma.worksheetAnswer.count({ where: { response: { classroomId: result.classroomId } } }), 320);
    assert.equal(await prisma.classroomGroup.count({ where: { classroomId: result.classroomId } }), 0);
    fs.writeFileSync(path.join(output, 'created.json'), JSON.stringify({ ...result, title, classroomTitle, backup, totals }, null, 2));
    console.log(updating ? '已调整原测试课堂：' : '已创建：', JSON.stringify({ ...result, backup }));
  }
} finally {
  if (!committed) for (const file of uploaded) fs.rmSync(file, { force: true });
  await prisma.$disconnect();
}
