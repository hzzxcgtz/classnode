// Local synthetic photo-answer fixtures. Generated images and intended texts stay in .dev/.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { validateQuestion, grade, DEFAULT_POINTS } from '../server/dist/services/worksheet-questions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server/package.json'));
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const db = path.join(root, 'server/prisma/dev.db');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
const output = path.join(root, '.dev/chinese-writing');
const title = '小学语文 · 课间的小事（拍照习作测试）';
const questionId = 'chinese-writing-photo-q1';
const rubricText = [
  '满分5个奖励，每项满足给1个奖励，未满足给0个，逐项相加，只给0—5的整数。',
  '①事件清楚：围绕一件课间发生的小事，交代人物以及发生了什么；真实观察小发现也可以，不强求矛盾、冲突或道理。完全偏题、只有空泛感叹不给此项。',
  '②细节具体：至少有两处与事件有关的具体细节，动作、语言、神态、观察到的样子均可；重复“很好玩”“跑呀跑”不算两处不同细节。',
  '③感受真实：写出与这件事相联系的心情、想法或心情变化，让读者明白为什么这样想；只有脱离具体事件的“很开心”不给此项，不要求上升为大道理。',
  '④表达连贯：句子基本通顺，事情或观察的先后能读懂，围绕中心，不无故跳到无关事情。少量自然口语不扣分。',
  '⑤用字标点：句子有合理断句和句末标点，常用字基本正确；允许1处不影响理解的错字或偶发漏标点，出现多处明显错字或整段无断句不给此项。',
  '80—120字是建议，不机械按字数扣分；短文仍按上述五项判断，不因写得长、辞藻华丽或套用金句加分。同一缺点不要在无关项重复扣分。',
  '只评价照片中可辨认的习作内容，不评字迹美观、纸张类型、涂改或摄影水平。潦草但可辨认的内容应与整洁字迹同等评分。',
  '遇到影响判断的无法辨认内容，应标明无法确认之处并按系统允许的待核实方式返回，不编造文字、不因为看不清直接判0分；提醒教师核实或请学生重拍。',
  '面向每位学生给一条温和、具体、可操作的小建议，指出这份习作下一步可以补哪种细节或怎样调整表达；完整习作也给有针对性的拓展建议。',
].join('\n');
const question = {
  id: questionId, type: 'short-answer', inputMode: 'photo', autoGrade: false,
  prompt: '课间的小事\n回想一次课间，写一件你亲身经历或观察到的小事：发生了什么？人物有什么动作、说了什么，或者你看到了什么？你当时有什么心情或想法？建议写80～120字。\n请写在白纸或格子纸上，再拍照上传；整段文字要拍全，尽量清晰。可以正常涂改，不要求字迹漂亮。',
  data: { answers: [], aiScoringEnabled: true, aiScoringMaxScore: 5, rubricText },
  points: { full: 5, half: 0 }, children: [],
};
const content = { schemaVersion: 1, nodes: [{ id: 'chinese-writing-photo-task', type: 'task', inputMode: 'keyboard', prompt: '任务：把课间的小事写具体', data: { description: '一段简短习作，写在纸上、拍照提交。模拟作答用于测试图片识别、AI评分和逐生建议。' }, children: [question] }] };
let committed = false;
const copied = [];
try {
  assert.deepEqual(validateQuestion(question), []);
  const plan = JSON.parse(fs.readFileSync(path.join(output, 'plan.json'), 'utf8'));
  const classes = await prisma.class.findMany({ include: { students: true } });
  const klass = classes.filter(c => c.students.length > 0).sort((a, b) => a.students.length - b.students.length)[0];
  assert.ok(klass, '需要已有的非空班级');
  klass.students.sort((a, b) => Number(a.studentNo) - Number(b.studentNo));
  assert.equal(klass.students.length, plan.length, '图片数量与人数不符，停止写入');
  const analyst = await prisma.agent.findFirstOrThrow({ where: { purpose: 'analysis', enabled: true }, select: { id: true, name: true } });
  const classroomTitle = `${klass.name} · 课间习作照片测试`;
  assert.equal(await prisma.classroom.count({ where: { title: classroomTitle } }), 0, '同名课堂已存在，停止以免重复创建');
  const settings = { allowResubmit: true, autoGrade: false, answerMode: 'open', defaultInputMode: 'photo', rewardStyle: 'star', rewardStep: 1, halfStep: 0, analysisAgentId: analyst.id, backgroundTheme: 'creative-notebook' };
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ title, classroomTitle, className: klass.name, count: plan.length, analyst: analyst.name, content, settings }, null, 2));
  } else {
    for (const row of plan) {
      const file = path.join(output, row.file);
      const meta = await sharp(file).metadata();
      assert.ok(meta.width >= 900 && meta.height >= 900, `图片过小：${row.file}`);
      assert.equal(grade(question, { format: 'photo/v1', url: '/uploads/chat/check.png' }, DEFAULT_POINTS), null);
    }
    const backup = path.join(root, 'server/prisma/backups', `before-chinese-writing-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    execFileSync('python3', ['-c', 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()', db, backup]);
    fs.mkdirSync(path.join(root, 'server/uploads/chat'), { recursive: true });
    for (const row of plan) {
      row.url = `/uploads/chat/chat-${randomUUID()}.png`;
      const destination = path.join(root, 'server', row.url);
      fs.copyFileSync(path.join(output, row.file), destination);
      copied.push(destination);
    }
    const result = await prisma.$transaction(async tx => {
      const sheet = await tx.worksheet.create({ data: { title, description: '1个任务、1道拍照问答题、5个奖励。全部为虚构的习作测试数据，不代表学生真实表现。', content, settings } });
      const codes = new Set((await tx.classroom.findMany({ select: { code: true } })).map(r => r.code));
      let code = '6810'; while (codes.has(code)) code = String(Number(code) + 1);
      const room = await tx.classroom.create({ data: { title: classroomTitle, code, mode: 'standard', status: 'active', classes: { create: { classId: klass.id } }, worksheets: { create: { worksheetId: sheet.id } }, modules: { create: [{ moduleKey: 'learning-sheet', state: 'open' }] } } });
      for (const [index, student] of klass.students.entries()) {
        const row = plan[index];
        const participant = await tx.classroomStudent.create({ data: { classroomId: room.id, studentId: student.id, type: 'student', status: 'offline' } });
        const startedAt = new Date(Date.now() - 20 * 60000 + index * 1000);
        const submittedAt = new Date(startedAt.getTime() + (7 + index % 6) * 60000);
        await tx.worksheetResponse.create({ data: { classroomId: room.id, worksheetId: sheet.id, participantId: participant.id, status: 'submitted', startedAt, submittedAt, answers: { create: [{ questionId, value: { format: 'photo/v1', url: row.url }, status: 'submitted', createdAt: startedAt, savedAt: submittedAt, submittedAt, saveCount: 1, score: null, gradeState: null, isCorrect: null }] } } });
        Object.assign(row, { studentId: student.id, name: student.name, studentNo: student.studentNo });
      }
      return { worksheetId: sheet.id, classroomId: room.id, code };
    }, { timeout: 60000 });
    committed = true;
    assert.equal(await prisma.worksheetResponse.count({ where: { classroomId: result.classroomId } }), plan.length);
    assert.equal(await prisma.worksheetAnswer.count({ where: { response: { classroomId: result.classroomId }, score: null, gradeState: null } }), plan.length);
    assert.equal(await prisma.classroomGroup.count({ where: { classroomId: result.classroomId } }), 0);
    const manifest = { ...result, title, classroomTitle, className: klass.name, analyst: analyst.name, backup, rubricText, plan };
    fs.writeFileSync(path.join(output, 'created.json'), JSON.stringify(manifest, null, 2));
    const report = ['# 小学语文拍照习作测试', '', `课堂：${classroomTitle}；课堂码：${result.code}。`, `学习单：${title}。${plan.length}人，每人1张模拟手写照片，全部已提交、待AI评分。分析智能体：${analyst.name}。`, '', '仅作虚构测试，不代表班级真实表现。未调用外部AI、未预填分数，识别原文不放入答案或AI载荷。下面是人工核对索引，参考分数不是标准机器输出，应结合实际生成图片判断。', '', '## 评分标准', '', rubricText, '', '## 逐生核对', '', '|学号|姓名|纸张|字迹|检查重点|', '|---|---|---|---|---|', ...plan.map(r => `|#${r.studentNo}|${r.name}|${r.paper.includes('squared') ? '格子纸' : '白纸'}|${r.messy ? '潦草' : '较清楚'}|${r.note}|`), '', '图片与生成用原文、提示词、创建清单保存在 `.dev/chinese-writing/`；实际作答图片存放在 `server/uploads/chat/`。数据库备份：' + backup, '', '在课堂的学习单答题情况中按题目查看，点击AI分析即可测试班级报告、逐生评分和小建议。注意核对内容较好但字迹潦草的#4、#17，不应因字迹扣分；#13可以因实际错字影响第⑤项。识别不清时应待核实，不能猜写作内容。', ''].join('\n');
    const notesDir = path.join(root, 'docs/project-notes');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(notesDir, 'TEST-DATA-CHINESE-WRITING-2026-10-10.md'), report);
    console.log(JSON.stringify({ ...result, classroomTitle, count: plan.length, backup }, null, 2));
  }
} finally {
  if (!committed) for (const file of copied) fs.rmSync(file, { force: true });
  await prisma.$disconnect();
}
