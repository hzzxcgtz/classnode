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
  question: { questionId: 'q1', typeLabel: '问答题', prompt: '说说你的看法', index: 2 },
  entries: entries ?? (kind === 'text' ? textEntries : kind === 'image' ? [inkEntry('p1')] : [textEntries[0], inkEntry('p2')]),
  total: 40,
  knobs: DEFAULT_ANALYSIS_KNOBS,
});

test('★ 平台能力：只有 coze 收得了图（其余三个都不行，各有逐字证据）', () => {
  assert.deepEqual([...IMAGE_CAPABLE_PLATFORMS], ['coze']);
});

test('🔴 有图 + 非 coze ⇒ 拒绝，且说清为什么（不是悄悄只发文档）', () => {
  for (const platform of ['wenxin', 'zhipuai', 'coze-agent']) {
    for (const kind of ['image', 'mixed'] as const) {
      const gate = analysisGateOf(payloadOf(kind), platform);
      assert.equal(gate.ok, false, `${platform} + ${kind} 必须被拦下`);
      if (!gate.ok) {
        assert.match(gate.reason, /收不了图|Coze/, '理由要说清是平台的问题，以及换哪个平台');
        assert.match(gate.reason, new RegExp(platform), '理由里要点名是哪个平台');
      }
    }
  }
  assert.equal(analysisGateOf(payloadOf('text'), 'wenxin').ok, true, '纯文字任何平台都行');
  assert.equal(analysisGateOf(payloadOf('image'), 'coze').ok, true);
  assert.equal(analysisGateOf(payloadOf('mixed'), 'coze').ok, true);
});

test('🔴 零份已提交 ⇒ 拒绝（发空载荷只会得到一段编造的解读）', () => {
  const empty = buildAnalysisPayload({
    question: { questionId: 'q1', typeLabel: '问答题', prompt: 'x', index: 0 },
    entries: [], total: 40, knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  const gate = analysisGateOf(empty, 'coze');
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.match(gate.reason, /还没有|尚无|没有已提交/);
});

test('消息文本：含题干、已交 N/M、逐条伪名与答案，以及固定引导语', () => {
  const msg = buildAnalysisMessage(payloadOf('text'));
  assert.match(msg, /第 3 题/);
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

test('normalizeNarrative 边界：刚好到上限不截断', () => {
  const exact = '乙'.repeat(NARRATIVE_MAX);
  const out = normalizeNarrative(exact);
  assert.equal(out.length, NARRATIVE_MAX);
  assert.ok(!out.includes('已截断'));
});
