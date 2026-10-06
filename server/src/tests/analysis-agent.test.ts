/**
 * ★ M7b：编排层的三个纯函数。**本机验不了真模型**（没有可调用的平台/密钥），
 * 所以「什么情况下不该发」「发出去的消息长什么样」「模型返回的东西怎么收」
 * —— 能验的全部价值都在这几条上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_CAPABLE_PLATFORMS, NARRATIVE_MAX, analysisGateOf, buildAnalysisMessage, normalizeNarrative,
} from '../services/analysis-agent.js';
import { DEFAULT_ANALYSIS_KNOBS, buildAnalysisPayload, type AnalyzeEntry } from '../services/analysis-payload.js';

const inkEntry = (id: string): AnalyzeEntry => ({
  studentId: id,
  kind: 'ink',
  ink: {
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: [{ points: [[0, 0], [1, 1]] as Array<[number, number]>, width: 0.01, color: '#111111' }],
  },
});
const textEntries: AnalyzeEntry[] = [
  { studentId: 'p1', kind: 'text', text: '我认为是甲' },
  { studentId: 'p2', kind: 'text', text: '我觉得是乙' },
];
const payloadOf = (kind: 'text' | 'image' | 'mixed', entries?: AnalyzeEntry[]) => buildAnalysisPayload({
  question: { questionId: 'q1', typeLabel: '问答题', prompt: '说说你的看法', heading: '任务一 · 3' },
  entries: entries ?? (kind === 'text' ? textEntries : kind === 'image' ? [inkEntry('p1')] : [textEntries[0], inkEntry('p2')]),
  total: 40,
  knobs: DEFAULT_ANALYSIS_KNOBS,
});

/**
 * 一道**绘图题**的载荷。第二个参数就是「这题有没有教师给的初始图」——
 * 它的**判据**在 `analysis-question.ts` 的 `hasDrawingStarter`（`analysis-question.test.ts`
 * 钉着形状与题型），这里只验拼装这一侧：标记为真就该多那句说明、为假就一个字都不多。
 */
const drawingPayloadOf = (kind: 'text' | 'image' | 'mixed', drawingStarter: boolean) => buildAnalysisPayload({
  question: {
    questionId: 'q3', typeLabel: '绘图题', prompt: '画出水循环的过程', heading: '任务一 · 5', drawingStarter,
  },
  entries: kind === 'text' ? textEntries : kind === 'image' ? [inkEntry('p1')] : [textEntries[0], inkEntry('p2')],
  total: 40,
  knobs: DEFAULT_ANALYSIS_KNOBS,
});

/**
 * 那句话（产品文案）。**逐字钉住是有意的**：它进的是发给模型的提示词，
 * 改字就等于改评价口径 —— 而「改字」这件事本身不会让任何别的用例变红。
 */
const STARTER_NOTE_HEAD = /注意：本题的图里有教师预先给出的「初始图」内容/;
const STARTER_NOTE_CORE = /不要把初始图当作学生的成果/;

test('★ 平台能力：只有 coze 收得了图（其余三个都不行，各有逐字证据）', () => {
  assert.deepEqual([...IMAGE_CAPABLE_PLATFORMS], ['coze']);
});

test('🔴 非 coze 一律拒绝 —— **不分有没有图**（这是独立审查 I1 修的口径）', () => {
  // 🔴 原先这里只挡「有图 + 非 coze」，而 `proxyAnalysisRequest` 对**任何**非 coze 都直接回失败
  // ⇒ 纯文字载荷上**两道闸说的不是一件事**：预览说「可以发」，点确认之后必 502。
  // 而 `analysisGateOf` 是**界面唯一**的依据（`canSend`）⇒ 教师会被邀请去点一个必然失败的操作。
  // ⇒ 口径统一成「本版只接 coze」（与 `proxyAnalysisRequest` 逐字一致）。
  for (const platform of ['wenxin', 'zhipuai', 'coze-agent']) {
    for (const kind of ['text', 'image', 'mixed'] as const) {
      const gate = analysisGateOf(payloadOf(kind), platform);
      assert.equal(gate.ok, false, `${platform} + ${kind} 必须被拦下`);
      if (!gate.ok) {
        assert.match(gate.reason, /Coze/, '理由要指向换哪个平台');
        assert.match(gate.reason, new RegExp(platform), '理由里要点名是哪个平台');
      }
    }
  }
  assert.equal(analysisGateOf(payloadOf('text'), 'coze').ok, true);
  assert.equal(analysisGateOf(payloadOf('image'), 'coze').ok, true);
  assert.equal(analysisGateOf(payloadOf('mixed'), 'coze').ok, true);
});

test('🔴 零份已提交 ⇒ 拒绝（发空载荷只会得到一段编造的解读）', () => {
  const empty = buildAnalysisPayload({
    question: { questionId: 'q1', typeLabel: '问答题', prompt: 'x', heading: '1' },
    entries: [], total: 40, knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  const gate = analysisGateOf(empty, 'coze');
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.match(gate.reason, /还没有|尚无|没有已提交/);
});

test('消息文本：含题干、已交 N/M、逐条伪名与答案，以及固定引导语', () => {
  const msg = buildAnalysisMessage(payloadOf('text'));
  assert.match(msg, /任务一 · 3/);
  assert.match(msg, /说说你的看法/);
  assert.match(msg, /已交 2\/40/);
  assert.match(msg, /User_001/);
  assert.match(msg, /我认为是甲/);
  assert.match(msg, /请分析/, '固定引导语要在（模型据此知道要干什么）');
});

test('消息文本：纯绘图题给的是「N 张联系表」的说明，而不是一段空文档', () => {
  const msg = buildAnalysisMessage(payloadOf('image'));
  assert.match(msg, /联系表/);
  assert.match(msg, /User_001/, '要说清每格上方标着代号（否则模型不知道那是谁）');
});

test('🔴 探针说标签没画出来时，必须把编号对照**以文本形式附上**（否则那句话就是假的）', () => {
  // M7a 的运行期探针：打包环境缺 fontconfig 时 sharp 画不出 `<text>`，而图本身仍是好的。
  // 那时若还写「每格上方标着代号」，模型会照着它去猜 ⇒ **分析结果整体错位**。
  const entries: AnalyzeEntry[] = [inkEntry('p1'), inkEntry('p2'), inkEntry('p3')];
  const payload = payloadOf('image', entries);
  const blind = buildAnalysisMessage(payload, false);
  assert.match(blind, /没有标签/, '要说清图上没有标签');
  assert.match(blind, /第1格=User_001/, '要把编号对照附上');
  assert.match(blind, /第2格=User_002/);
  assert.match(blind, /第3格=User_003/);
  assert.ok(!blind.includes('每格上方标着'), '这时不许再说「每格上方标着代号」——那是假话');

  // 而探针正常时**不要**附那段对照（图上有标签，附上是噪音）
  const normal = buildAnalysisMessage(payloadOf('image'), true);
  assert.match(normal, /每格上方标着/);
  assert.ok(!normal.includes('第1格='), '正常时不该附对照表');
});

test('消息文本：mixed 时文档与图的说明**都在**（文字那几条只存在于文档里）', () => {
  const msg = buildAnalysisMessage(payloadOf('mixed'));
  assert.match(msg, /联系表/);
  assert.match(msg, /我认为是甲/, '文字作答那一条要跟着走');
});

test('★ 有教师初始图的绘图题：提示词必须说清「初始图不算学生的作答」', () => {
  // 🔴 为什么（产品语义）：教师给绘图题准备一张**初始图**（半成品流程图/思维导图/数学作图），
  // 学生在上面继续画。提交作答时服务端**按 id 把初始图剔除了** —— 只有学生自己画的那部分算作答；
  // 但**位图快照**（`drawing.image`）是**完整那张图**，教师的框与连线都在里面。
  // ⇒ 少了这一句，模型会把教师画的那半张当成学生的成果来夸/来评，
  //   教师看到的是一份「评价错了对象」的解读，而**全程没有任何报错**。
  for (const kind of ['text', 'image', 'mixed'] as const) {
    const msg = buildAnalysisMessage(drawingPayloadOf(kind, true));
    assert.match(msg, STARTER_NOTE_HEAD, `${kind}：缺了「图里有教师预先给出的初始图」这句说明`);
    assert.match(msg, STARTER_NOTE_CORE, `${kind}：缺了「不要算成学生的成果」那句 —— 那正是这句说明的全部意义`);
  }
});

test('★ 没有初始图的题目：一个字都不许多加（两向都要钉）', () => {
  // 🔴 为什么必须测这一向：条件写反（恒真）会让**每一道题**的提示词都多一句
  // 「图里有教师的初始图」—— 模型于是去找一段不存在的底稿。它的表现只是「解读有点怪」，
  // 教师和模型都不会报错，所以只能靠这条用例挡住。
  for (const kind of ['text', 'image', 'mixed'] as const) {
    const msg = buildAnalysisMessage(drawingPayloadOf(kind, false));
    assert.ok(!msg.includes('初始图'), `${kind}：这题没有初始图，提示词里不许出现「初始图」三个字`);
  }
  // 题面字面量**没写**这个键（老调用点、真题目没设过初始图）也必须落成「没有」。
  const meta = { questionId: 'q3', typeLabel: '绘图题', prompt: '画一画', heading: '5' };
  const noKey = buildAnalysisPayload({ question: meta, entries: textEntries, total: 40, knobs: DEFAULT_ANALYSIS_KNOBS });
  assert.equal(noKey.drawingStarter, false, '缺这个键 ⇒ false（落成 true 的表现就是每道题都多那句）');
  assert.ok(!buildAnalysisMessage(noKey).includes('初始图'));
});

test('★ 那句说明只出现一次，且排在题面之后（三种载荷形态都不许重复/错位）', () => {
  // 拼装是「正文 + 这句话」两步：曾经担心的错法是 head 与文档各拼一遍（mixed 时出现两次），
  // 或者只补在某一种形态上。同一句话重复说，模型会以为有两张初始图/两套口径；
  // 而它若插到题面前面（打断引导语与题面），模型会把它读成题目的一部分。
  for (const kind of ['text', 'image', 'mixed'] as const) {
    const msg = buildAnalysisMessage(drawingPayloadOf(kind, true));
    assert.equal(
      msg.split('不要把初始图当作学生的成果').length - 1, 1,
      `${kind}：同一句说明只许出现一次（重复 = 以为有两张初始图）`,
    );
    assert.ok(
      msg.indexOf('不要把初始图当作学生的成果') > msg.indexOf('题干：'),
      `${kind}：说明要排在题干/联系表说明之后，别把题面劈开`,
    );
  }
});

test('★ 拼装层**不按题型分流**：那句说明只认「有没有初始图」这个标记', () => {
  // 现有拼装是一条直路（没有「绘图题走这一支、别的题型走那一支」的分支）。题型的判据收在
  // `hasDrawingStarter`（`analysis-question.test.ts` 钉着「只有绘图题才算」）⇒
  // 「非绘图题不会多这句」靠的是**上游把标记判成 false**。这条用例把这件事写明白：
  // 换个题型标签、标记为真，那句说明照样跟着标记走。
  const odd = buildAnalysisPayload({
    question: { questionId: 'q1', typeLabel: '问答题', prompt: '说说你的看法', heading: '3', drawingStarter: true },
    entries: textEntries, total: 40, knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  assert.match(buildAnalysisMessage(odd), STARTER_NOTE_CORE, '拼装层只看标记 —— 题型不该在这里再判一次');
});

test('开启 AI 评分时消息带满分、评分标准与机器块协议；关闭时不带', () => {
  // ★ 2026-10-05：教师把「评分标准」与「评分要求」合并成同一个输入框 ⇒ 这里不再有
  // 独立的一行 `评分要求：…`；教师写的那份标准由载荷里的 `评分标准：…` 逐字带出。
  // ⚠️ 载荷**必须**用带 `rubricText` 的题面来构建：纯文字载荷走的是 `payload.text`
  // （`buildTextDocument` 里已经印了那一行），事后改 `payload.rubricText` 是改不动的。
  const scored = buildAnalysisPayload({
    question: { questionId: 'q1', typeLabel: '问答题', prompt: '说说你的看法', heading: '任务一 · 3', rubricText: '概念 3 分，表达 2 分' },
    entries: textEntries, total: 40, knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  const message = buildAnalysisMessage({ ...scored, aiScoring: { enabled: true, maxScore: 5, unit: '分', criteria: '概念 3 分，表达 2 分' } });
  assert.match(message, /满额：5 分/);
  assert.match(message, /评分标准：概念 3 分，表达 2 分/);
  assert.equal(
    message.split('概念 3 分，表达 2 分').length - 1, 1,
    '同一份标准只许出现一次 —— 从前它由「评分标准」与「评分要求」两行各说一遍',
  );
  assert.ok(!message.includes('评分要求：'), '「评分要求」那一行已随合并删除');
  assert.match(message, /<classnode-scores>/);
  assert.match(message, /"advice"/, '机器协议必须要求逐生返回可展开的详细建议');
  assert.match(message, /"student":"User_001"/);
  assert.ok(!buildAnalysisMessage(payloadOf('text')).includes('<classnode-scores>'));
});

test('混合填空会明确限制 AI 只评分指定空，避免重复计算自动评分部分', () => {
  const message = buildAnalysisMessage({ ...payloadOf('text'),
    aiScoring: {
      enabled: true,
      maxScore: 5,
      unit: '分',
      criteria: '说明理由是否合理',
      parts: [{ index: 2, maxScore: 5 }],
    },
  });
  assert.match(message, /只评价第 3 空（满额 5 分）/);
  assert.match(message, /其他空已由 ClassNode 本地自动评分/);
});

test('🔴 开了 AI 评分但教师没写评分标准 ⇒ 兜底那句必须在（否则模型会自己编一套给分口径）', () => {
  const noRubric = {
    ...payloadOf('text'),
    aiScoring: { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' },
  };
  const message = buildAnalysisMessage(noRubric);
  assert.match(message, /评分标准：（未提供评分标准）/);
  assert.match(message, /评分依据：教师未提供评分标准/);
  // 写了标准时**不许**再出现兜底那句：那是「教师没写」专用的话，
  // 混进提示词会让模型以为有两套依据（而它只会照着其中一套走）。
  const withRubric = buildAnalysisPayload({
    question: { questionId: 'q1', typeLabel: '问答题', prompt: '说说你的看法', heading: '任务一 · 3', rubricText: '结论正确 2 座奖杯' },
    entries: textEntries, total: 40, knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  const withRubricMessage = buildAnalysisMessage({ ...withRubric, aiScoring: { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '结论正确 2 座奖杯' } });
  assert.match(withRubricMessage, /评分标准：结论正确 2 座奖杯/);
  assert.ok(!withRubricMessage.includes('教师未提供评分标准'));
});

test('评分标准文字与图片附件顺序会明确告诉智能体', () => {
  const payload = buildAnalysisPayload({
    question: {
      questionId: 'q1', typeLabel: '问答题', prompt: '说明理由', heading: '8',
      rubricText: '结论正确 2 分，理由完整 3 分',
      rubricImageUrl: '/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.png',
    },
    entries: textEntries, total: 2, knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  const message = buildAnalysisMessage(payload);
  assert.match(message, /评分标准：结论正确 2 分，理由完整 3 分/);
  assert.match(message, /第 1 张图片是教师提供的评分标准/);
});

test('🔴 normalizeNarrative：空白 ⇒ 空串（⇒ 不写库）；超长 ⇒ 截断且标注；正常 ⇒ 去首尾空白', () => {
  assert.equal(normalizeNarrative('   \n  '), '');
  assert.equal(normalizeNarrative(null), '');
  assert.equal(normalizeNarrative(undefined), '');
  assert.equal(normalizeNarrative(42), '');
  assert.equal(normalizeNarrative({}), '');
  assert.equal(normalizeNarrative('  三段解读  '), '三段解读');
  const long = '甲'.repeat(NARRATIVE_MAX + 300);
  const out = normalizeNarrative(long);
  assert.ok(out.includes('甲'.repeat(NARRATIVE_MAX)), '前 NARRATIVE_MAX 个字要保留');
  assert.match(out, /已截断/);
  assert.match(out, new RegExp(String(NARRATIVE_MAX + 300)), '要说清原文多长');
  assert.ok(!out.includes(long), '不许原样带出超长内容');
});

test('🔴 纯零宽/格式字符也算空（`trim()` 不认识 U+200B）—— 否则会写进一段看不见的「解读」', () => {
  // 后果：`narrative` 变成「有值但看不见」⇒ 界面那块「AI 解读」渲染出来是空白，
  // 而教师以为分析过了（`payload?.narrative &&` 为真）。
  assert.equal(normalizeNarrative('\u200b'), '', 'U+200B 零宽空格');
  assert.equal(normalizeNarrative('\u200b\u200b\u200b'), '');
  assert.equal(normalizeNarrative('\ufeff'), '', 'U+FEFF BOM');
  assert.equal(normalizeNarrative(' \u200b \n '), '');
});

test('🔴 截断不许切出孤立代理对（否则那半个字符会一路进库）', () => {
  // 一个 emoji 是代理对（2 个 code unit）。切在第 4000 个 code unit 上会留下半个。
  const body = 'a'.repeat(NARRATIVE_MAX - 1) + '😀'.repeat(10);
  const out = normalizeNarrative(body);
  const isolated = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(!isolated.test(out), '截断之后不许留下孤立代理');
});

test('normalizeNarrative 边界：刚好到上限不截断', () => {
  const exact = '乙'.repeat(NARRATIVE_MAX);
  const out = normalizeNarrative(exact);
  assert.equal(out.length, NARRATIVE_MAX);
  assert.ok(!out.includes('已截断'));
});
