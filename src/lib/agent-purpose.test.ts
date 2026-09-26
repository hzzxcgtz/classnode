/**
 * ★「认不出就当学伴」这条规矩的**前端唯一判据**。
 *
 * 🔴 为什么它不是装饰：`Agent.purpose` 是后加的列（`index.ts` 的 `ALTER TABLE … DEFAULT 'tutoring'`），
 * 而判据一旦写成 `agent.purpose === 'tutoring'`，**缺字段 / `null` 的老行会被整个吞掉** ——
 * 那些 bot 本来就是学伴。症状是**静默的**：智能体列表筛「学习类」之后少了几张卡片，
 * 不报错、没有红。
 *
 * 🔴 为什么要对拍服务端：这条规矩服务端已经有一份（`normalizeAgentPurpose`）。两边分叉的方向
 * 恰好是相反的两件事 —— 前端分叉 = 列表面板少显示；服务端分叉 = 学生**看得见**分析型
 * （那是「会收到全班作业」的 bot）。所以两份必须逐值相等，且**由用例钉住**。
 *
 * ⚠️ 跨工程 import 用 `.ts` 扩展名（Node 不把 `.js` 解析成 `.ts`）—— 写法照抄
 * `analysis-gate-parity.test.ts`。被加载的 `agent-purpose.ts` **零 import**，所以类型擦除加载得起来；
 * ⇒ 那个文件里**不许** import 任何东西，否则这条用例会 `ERR_MODULE_NOT_FOUND`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentPurposeOf } from './agent-purpose.ts';
import { normalizeAgentPurpose } from '../../server/src/services/agent-purpose.ts';

/**
 * 判据的取值域。**这张表是"两边都要过一遍"的那一份** ——
 * 不是「两侧各挑几个代表性值」，那样将来一侧改了表、另一侧没改，用例照样绿。
 */
const CASES: unknown[] = [
  'tutoring',
  'analysis',
  // ↓ 老行：`purpose` 列加进来之前存下的行，读到的是这几种
  undefined,
  null,
  '',
  // ↓ 手改坏的值
  'Tutoring',
  'ANALYSIS',
  'analysis ',
  0,
  1,
  {},
  [],
  '别的什么',
];

test('阳性对照：用例表里真的有一个 analysis（否则下面几条全是空转）', () => {
  assert.ok(CASES.includes('analysis'), '表里没有 analysis ⇒ 对拍是空转的');
  assert.ok(CASES.some((v) => v !== 'analysis' && v !== 'tutoring'), '表里没有"认不出的值" ⇒ 回落那一半没被验过');
});

test('只有字面 analysis 是分析型，其余一律学伴', () => {
  const analysis = CASES.filter((v) => agentPurposeOf(v) === 'analysis');
  assert.deepEqual(analysis, ['analysis']);
});

test('★ 与「学生能不能看见」那道闸同源：逐值对拍服务端的 normalizeAgentPurpose', () => {
  for (const value of CASES) {
    assert.equal(
      agentPurposeOf(value),
      normalizeAgentPurpose(value),
      `值 ${JSON.stringify(value)} 上两侧分叉了 —— 前端会列出「学习类」里混着分析型，或分析型在列表里消失`,
    );
  }
});

test('反证：把判据写成严格等值 ⇒ 老行必须被吞掉（这条要是绿了，说明回落根本没生效）', () => {
  const tooStrict = (raw: unknown) => (raw === 'tutoring' ? 'tutoring' : 'analysis');
  const legacy = CASES.filter((v) => v === undefined || v === null || v === '');
  assert.ok(legacy.length > 0, '阳性对照：表里必须有老行取值');
  assert.deepEqual(
    legacy.map(tooStrict),
    legacy.map(() => 'analysis'),
    '严格等值读老行读出了别的东西 —— 那这条反证的靶子就不成立了',
  );
  // 而真正的判据在同一批值上必须回 'tutoring'：
  assert.deepEqual(legacy.map(agentPurposeOf), legacy.map(() => 'tutoring'));
});
