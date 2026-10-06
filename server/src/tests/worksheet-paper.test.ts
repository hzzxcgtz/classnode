/**
 * 「教师用卷」的判据层（★ 2026-09-30，教师）。
 *
 * 🔴 这一组守的是**纸上的每一句话**：docx 渲染本机验不了（没有 Word），所以
 * 「这道题在纸上写着什么」必须全部落在 `worksheet-paper.ts` 里、被这里逐条钉住。
 *
 * ⚠️ 两条最要紧的性质：
 *   ① 题号走 `flattenAnswerable`（与看板 / 抽屉 / 学生端同一个函数）——
 *      纸上与学生屏幕上的题号不一致，教师念「第 3 题」时全班找不着；
 *   ② 特殊题型的**答案**要教师念得出来（归类按框归并、连线用字母、排序用学生看到的序号）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorksheetPaper, paperQuestion } from '../services/worksheet-paper.js';
import { TASK_TYPE } from '../services/worksheet-heading.js';
import { PAPER_BLANK_TEXT } from '../services/worksheet-questions.js';
import type { QuestionNode } from '../services/worksheet-questions.js';
// ★ 2026-09-30：`body` / `answer` 从 `string` 变成了行内部件数组 ⇒ 既有断言用 `inlineText`
// 包一层（**剥掉定界符**，行为一个字不变）。新增的公式断言则比**完整部件**。
import { inlineText } from '../services/worksheet-paper.js';
import { splitMath } from '../services/worksheet-math.js';
import type { PaperInline } from '../services/worksheet-paper.js';

/** 一格文字 → 行内部件（走**真实**的 `splitMath`，所以夹具里也能放公式）。 */
const P = (text: string): PaperInline[] => splitMath(text);

/**
 * 借一道题的最小合法节点（形状与库里的 JSON 一致）。
 * ⚠️ `points` 在**节点上**、不在 `data` 里（题型无关的字段，见 `QuestionNode.points` 的注释）——
 * 放进 `data` 的后果是「教师填的分值在纸上读不出来」，而它只是回落成了默认档。
 */
function q(
  id: string, type: string, data: Record<string, unknown> = {}, prompt = `题干 ${id}`,
  extra: Record<string, unknown> = {},
): QuestionNode {
  return { id, type, prompt, inputMode: 'keyboard', data, children: [], ...extra } as unknown as QuestionNode;
}
function task(id: string, prompt: string, children: unknown[], description?: string): QuestionNode {
  return { id, type: TASK_TYPE, prompt, inputMode: 'keyboard', data: description ? { description } : {}, children } as unknown as QuestionNode;
}

const POINTS = { full: 1, half: 0 };
const paper = (nodes: unknown[], extra: Record<string, unknown> = {}) => buildWorksheetPaper({
  title: '第三课练习', description: '完成后一起讲评', content: { schemaVersion: 1, nodes }, fallbackPoints: POINTS, ...extra,
});

/** 取第 n 道题（跳过任务块）。 */
function questionAt(nodes: unknown[], index: number) {
  const blocks = paper(nodes).blocks.filter((block) => block.kind === 'question');
  const block = blocks[index];
  assert.ok(block && block.kind === 'question', `没有第 ${index + 1} 道题`);
  return block.question;
}

test('选择题：作答区是选项行，答案带上**选项原文**', () => {
  const node = q('q1', 'single-choice', {
    options: [{ key: 'A', text: '慈祥' }, { key: 'B', text: '爱幕' }, { key: 'C', text: '攀登' }],
    correctKeys: ['C'],
  }, '下列词语中，书写完全正确的一项是（  ）。');
  const got = questionAt([node], 0);
  assert.deepEqual(got.body.map(inlineText), ['A 慈祥', 'B 爱幕', 'C 攀登']);
  assert.equal(inlineText(got.answer), 'C 攀登');
  assert.equal(got.answerNote, null);
  assert.match(got.meta, /慧眼选择/, '题型印**别名**（教师：「题型使用别名，例如开心填空」）');
  assert.match(got.meta, /1 分/);
  // 🔴 选择题题干的「（  ）」**照原样印** —— 它就是这张卷子上的答题位，
  //    中文卷子本来就这么印。别把它换成下划线（那是填空题的形态）。
  assert.deepEqual(got.prompt, [{ kind: 'text', text: '下列词语中，书写完全正确的一项是（  ）。' }]);
});

test('多选题：答案用「、」并列', () => {
  const node = q('q1', 'multi-choice', {
    options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
    correctKeys: ['A', 'B'],
  });
  assert.equal(inlineText(questionAt([node], 0).answer), 'A 甲、B 乙');
});

test('判断题：不印作答区，答案翻成「对 / 错」', () => {
  const right = q('q1', 'true-false', { correctKeys: ['T'] }, '地球是圆的（  ）。');
  const wrong = q('q2', 'true-false', { correctKeys: ['F'] }, '太阳从西边升起（  ）。');
  assert.deepEqual(questionAt([right], 0).body.map(inlineText), []);
  assert.equal(inlineText(questionAt([right], 0).answer), '对');
  assert.equal(inlineText(questionAt([wrong], 0).answer), '错');
});

test('🔴 填空题的 `{填空域}` 在纸上印成 **8 个半角下划线**（教师从导出结果里看出来的）', () => {
  // 教师原话：「填空题的下划线使用 8 个连续的下划线」—— 原来是 4 个**全角**下划线，
  // 而全角字符在 Word 里是**四段断开的短线**，看着就是截图里那种难看的空格。
  const got = questionAt([q('q1', 'fill-blank', { answers: [['甲']] }, '植物需要{填空域}才能生长')], 0);
  assert.deepEqual(got.prompt, [{ kind: 'text', text: '植物需要________才能生长' }]);
  assert.equal(PAPER_BLANK_TEXT, '________', '纸上的空 = 8 个半角下划线（半角才会连成一条）');
  assert.ok(!PAPER_BLANK_TEXT.includes('＿'), '全角下划线不行（Word 里断成四段）');
});

test('🔴 表格：`{表格域}` 处**就地**嵌一张表（不是折成 `|` 分隔的文字）', () => {
  // 教师原话：「下方的表格要用 Word 里的真表格」。
  const node = q('q1', 'fill-blank', {
    answers: [['上午'], ['借书']],
    table: { rows: [
      [{ text: '时间' }, { text: '安排' }],
      [{ text: '周六' }, { text: '', blank: 'b1' }],
      [{ text: '周日' }, { text: '', blank: 'b2' }],
    ] },
  }, '看表填空：{表格域}然后说一说。');
  const parts = questionAt([node], 0).prompt;
  assert.deepEqual(parts.map((part) => part.kind), ['text', 'table', 'text']);
  assert.equal(parts[0].kind === 'text' && parts[0].text, '看表填空：');
  assert.equal(parts[2].kind === 'text' && parts[2].text, '然后说一说。');
  const table = parts[1];
  assert.ok(table.kind === 'table');
  assert.deepEqual(table.rows, [
    [{ text: P('时间'), blank: false }, { text: P('安排'), blank: false }],
    [{ text: P('周六'), blank: false }, { text: P(''), blank: true }],
    [{ text: P('周日'), blank: false }, { text: P(''), blank: true }],
  ]);
});

test('🔴 反面：题干里**没有** `{表格域}` 标记 ⇒ 那张表一个字都不画（判据是标记在不在）', () => {
  // 与渲染、与 `questionTextFor` 的投影**同一条**：没有标记 ⇒ 学生屏幕上根本没有这张表。
  // 留着表数据在纸上画出来，教师会以为学生也看得见。
  const node = q('q1', 'fill-blank', { answers: [['甲']], table: { rows: [[{ text: '甲' }]] } }, '植物需要{填空域}才能生长');
  const parts = questionAt([node], 0).prompt;
  assert.deepEqual(parts.map((part) => part.kind), ['text']);
});

test('填空题：单空不编号，多空逐空编号；没配答案的空**照样占号**', () => {
  const single = q('q1', 'fill-blank', { answers: [['高兴', '愉快']] });
  assert.equal(inlineText(questionAt([single], 0).answer), '高兴 / 愉快');
  const many = q('q2', 'fill-blank', { answers: [['高兴'], [], ['难过']] });
  // 中间那个空没配答案 ⇒ 印「—」占住编号：少了号，③会变成②，教师念错。
  assert.equal(inlineText(questionAt([many], 0).answer), '①高兴　②—　③难过');
});

test('选词填空：词库印在作答区（学生要在这些词里挑）', () => {
  const node = q('q1', 'choice-blank', { fillChoicePool: ['可爱', '可亲'], answers: [['可爱']] });
  const got = questionAt([node], 0);
  assert.deepEqual(got.body.map(inlineText), ['待选词：可爱　可亲']);
  assert.equal(inlineText(got.answer), '可爱');
});

test('简答题：多个可接受答案用「/」并起来', () => {
  const node = q('q1', 'short-answer', { answers: [['春天', '春季']] });
  assert.equal(inlineText(questionAt([node], 0).answer), '春天 / 春季');
});

test('🔴 排序题：作答区按**学生看到的顺序**编号，答案用那套序号表达', () => {
  const node = q('q1', 'order', {
    // 学生看到的顺序（打乱的）
    items: [{ id: 'a', text: '老师先讲解了乘船安全事项。' }, { id: 'b', text: '小船离岸，向湖心驶去。' }, { id: 'c', text: '我们穿好救生衣，依次上船。' }],
    correctOrder: ['c', 'a', 'b'],
  });
  const got = questionAt([node], 0);
  assert.deepEqual(got.body.map(inlineText), ['1 老师先讲解了乘船安全事项。', '2 小船离岸，向湖心驶去。', '3 我们穿好救生衣，依次上船。']);
  // 正确顺序是 c(3) → a(1) → b(2) ⇒ 纸上写 3 → 1 → 2（教师念的号就是这张纸上的号）。
  assert.equal(inlineText(got.answer), '3 → 1 → 2');
});

test('🔴 连线题：左右栏各一行，答案用字母；**留空项**要显式印出来', () => {
  const node = q('q1', 'match', {
    left: [{ id: 'l1', text: '顾全大局' }, { id: 'l2', text: '知错就改' }, { id: 'l3', text: '（留空项）' }],
    right: [{ id: 'r1', text: '舍己为人' }, { id: 'r2', text: '顾全大局' }],
    pairs: [{ leftId: 'l2', rightId: 'r2' }, { leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }],
  });
  const got = questionAt([node], 0);
  assert.deepEqual(got.body.map(inlineText), ['左：1 顾全大局　2 知错就改　3 （留空项）', '右：A 舍己为人　B 顾全大局']);
  // 一个左项可以连多个右项 ⇒ 用「、」并列；没连线的左项写「（不连）」。
  assert.equal(inlineText(got.answer), '1–A、B　2–B　3–（不连）');
});

test('🔴 归类题：作答区给条目与框，答案**按框归并**', () => {
  const node = q('q1', 'categorize', {
    items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '松树' }, { id: 'i3', text: '狗' }],
    // ⚠️ 框的文本键名是 `label`（不是 text）—— 读错的表现只是「框名是空的」。
    zones: [{ id: 'z1', label: '动物' }, { id: 'z2', label: '植物' }],
    placement: { i1: 'z1', i2: 'z2', i3: 'z1' },
  });
  const got = questionAt([node], 0);
  assert.deepEqual(got.body.map(inlineText), ['条目：①猫　②松树　③狗', '框：A 动物　B 植物']);
  assert.equal(inlineText(got.answer), 'A 动物：①③　B 植物：②');
});

test('🔴 绘图题：没有文字答案 —— 印一句说明，**不许**出现空的「答案：」', () => {
  const got = questionAt([q('q1', 'drawing', {})], 0);
  assert.equal(inlineText(got.answer), '');
  assert.match(got.answerNote ?? '', /绘图题/);
});

test('认不出的题型：题面照印，答案如实说读不出来', () => {
  const got = questionAt([q('q1', '未来的新题型', {})], 0);
  assert.equal(inlineText(got.answer), '');
  assert.match(got.answerNote ?? '', /读不出来/);
});

test('🔴 任务与散题的结构：任务带标题块，**连续散题不带头**；题号与 flattenAnswerable 一致', () => {
  const nodes = [
    q('loose1', 'short-answer', { answers: [['甲']] }),
    task('t1', '任务一', [q('a', 'short-answer', { answers: [['乙']] }), q('b', 'short-answer', { answers: [['丙']] })], '读下面的材料'),
    q('loose2', 'short-answer', { answers: [['丁']] }),
  ];
  const doc = paper(nodes);
  const kinds = doc.blocks.map((block) => (block.kind === 'task' ? `task:${block.title}` : `q:${block.question.heading}`));
  // 散题**不合成一段**、也不带标题块（与客户端 `groupAnswerable` 的「连续」规则同一条）。
  // ⚠️ 题号是**全卷连续**的（2026-10-01 起的规则，前端 `src/lib/worksheet-questions.ts` 开头写着，
  //    服务端 `worksheet-heading.ts` 是它的镜像）：任务里的两道题**接着**前面那道散题往下编，
  //    所以是「任务一 · 2」「任务一 · 3」，任务后面那道散题是第 4 题。
  //    不是「任务内从 1 重新数」—— 那个旧规矩已被 `0af140c` 连同矩阵那边的判据一起改掉了。
  assert.deepEqual(kinds, ['q:1', 'task:任务一', 'q:任务一 · 2', 'q:任务一 · 3', 'q:4']);
  const firstTask = doc.blocks.filter((block) => block.kind === 'task')[0];
  assert.ok(firstTask && firstTask.kind === 'task');
  assert.equal(firstTask.description, '读下面的材料');
  assert.equal(doc.questionCount, 4);
  assert.equal(doc.title, '第三课练习');
  assert.equal(doc.description, '完成后一起讲评');
});

test('分值：逐题写下的分值优先，没写的回落到学习单设置（fallback）', () => {
  const withOwn = paperQuestion(q('q1', 'short-answer', { answers: [['甲']] }, '题干', { points: { full: 5 } }), '1', POINTS);
  assert.match(withOwn.meta, /5 分/);
  const inherited = paperQuestion(q('q2', 'short-answer', { answers: [['甲']] }), '2', { full: 3, half: 1 });
  assert.match(inherited.meta, /3 分/);
});

test('坏数据不炸：空 content / 非数组 nodes / 空节点数组', () => {
  for (const content of [null, undefined, {}, { nodes: null }, { nodes: 'x' }, 42]) {
    const doc = buildWorksheetPaper({ title: 't', description: null, content, fallbackPoints: POINTS });
    assert.deepEqual(doc.blocks, []);
    assert.equal(doc.questionCount, 0);
  }
  // 阳性对照：一个真的有题的 content 必须**不是**空的（否则上面那条「都不炸」什么都没证明）。
  assert.equal(paper([q('q1', 'short-answer', { answers: [['甲']] })]).questionCount, 1);
});

// ---------------------------------------------------------------------------
// ★ 2026-09-30：数学公式进判据层
// ---------------------------------------------------------------------------

test('★ 题面里的公式进了判据层（不是渲染层现切的）', () => {
  const got = questionAt([q('q1', 'short-answer', { answers: [['x=5']] }, '计算 $x^2$ 的值')], 0);
  assert.deepEqual(got.prompt, [
    { kind: 'text', text: '计算 ' },
    { kind: 'math', tex: 'x^2' },
    { kind: 'text', text: ' 的值' },
  ]);
  // 🔴 反面：`$` 里那些**不成对**的写法原样留在文本部件里（安全阀在切分层，不在这里）。
  const loose = questionAt([q('q2', 'short-answer', { answers: [['甲']] }, '这本书 $5')], 0);
  assert.deepEqual(loose.prompt, [{ kind: 'text', text: '这本书 $5' }]);
});

test('★ 作答区与答案里的公式也进了判据层（一行一条，逐行切）', () => {
  const node = q('q1', 'single-choice', {
    options: [{ key: 'A', text: '$x=3$' }, { key: 'B', text: '普通选项' }],
    correctKeys: ['A'],
  });
  const got = questionAt([node], 0);
  // 选项行是 `A $x=3$` ⇒ 前缀与公式各是一段
  assert.deepEqual(got.body[0], [
    { kind: 'text', text: 'A ' },
    { kind: 'math', tex: 'x=3' },
  ]);
  // 答案带上选项原文 ⇒ 公式也在里面
  assert.deepEqual(got.answer, [
    { kind: 'text', text: 'A ' },
    { kind: 'math', tex: 'x=3' },
  ]);
  // 阳性对照：没有公式的那一行**必须只有一段**（否则上面那两条可能是形状凑巧）
  assert.deepEqual(got.body[1], [{ kind: 'text', text: 'B 普通选项' }]);
});

test('★ 表格单元格里的公式也进判据层（`inlineText` 剥掉定界符）', () => {
  const node = q('q1', 'fill-blank', {
    answers: [['x']],
    table: { rows: [[{ text: '$a<b$' }, { text: '说明' }]] },
  }, '看表：{表格域}');
  const table = questionAt([node], 0).prompt.find((part) => part.kind === 'table');
  assert.ok(table && table.kind === 'table');
  // 🔴 整个 `$a<b$` 是**一个**公式（tex 是 `a<b`）：开 `$` 后接 `a`（非空白 ⇒ 可开），
  //    闭合的是结尾那个 `$`（前面是 `b`、后面什么都没有 ⇒ 可闭）。
  //    这一条钉的就是「别把 `a<b` 从中间拆成两段」—— 拆了纸上就是一个孤零零的 `a`。
  assert.deepEqual(table.rows[0][0].text, [{ kind: 'math', tex: 'a<b' }]);
  // 阳性对照：没有公式的那一格**必须只有一段文字**。
  assert.deepEqual(table.rows[0][1].text, [{ kind: 'text', text: '说明' }]);
  // 顺带钉住「剥掉定界符」那一半（判分侧要用它）。
  assert.equal(inlineText(table.rows[0][0].text), 'a<b');
});
