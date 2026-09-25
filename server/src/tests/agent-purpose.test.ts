/**
 * ★ M7b：`Agent.purpose` 是**一门闸**，不是一个标签。
 *
 * 🔴 少了它，「会收到全班作业」的分析型 bot 会出现在小学生的聊天列表里
 * （学生端的列表来自 `ClassroomAgent`，而服务端今天只读 `agent.enabled` —— `routes/classroom.ts:1090`）。
 * 🔴 过滤点**至少两处**：HTTP 首屏（`routes/classroom.ts:1085`）与 socket 的 `joined` 载荷
 * （`socket/index.ts:1151`）—— 本用例钉住那个**共用的**助手，两处都走它。
 * （后者那里的注释逐字写着「学生端拿到的组材料必须与 `GET /code/:code` **逐字一致**」。）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PURPOSES, normalizeAgentPurpose, studentAgentView } from '../services/agent-purpose.js';

test('取值域只有两个，默认是 tutoring', () => {
  assert.deepEqual([...AGENT_PURPOSES], ['tutoring', 'analysis']);
  assert.equal(normalizeAgentPurpose(undefined), 'tutoring');
  assert.equal(normalizeAgentPurpose(''), 'tutoring');
  assert.equal(normalizeAgentPurpose('nope'), 'tutoring', '坏值回落默认，不是抛');
  assert.equal(normalizeAgentPurpose(42), 'tutoring');
  assert.equal(normalizeAgentPurpose('analysis'), 'analysis');
  assert.equal(normalizeAgentPurpose('tutoring'), 'tutoring');
});

test('🔴 学生可见的只剩 tutoring（缺字段的旧行按 tutoring 算 —— 它们本来就是学伴）', () => {
  const rows = [
    { id: 'a', purpose: 'tutoring' },
    { id: 'b', purpose: 'analysis' },
    { id: 'c' },                       // 旧行：`purpose` 列刚加上，值由 DEFAULT 补，理论上不会缺
    { id: 'd', purpose: null },
    { id: 'e', purpose: 'tutoring' },
  ];
  const visible = rows
    .map((r) => studentAgentView({ agent: { ...r, name: r.id, logo: null, platform: 'coze', enabled: true } }))
    .filter((v) => v !== null);
  assert.deepEqual(visible.map((v) => v!.id), ['a', 'c', 'd', 'e']);
});

test('🔴 `studentAgentView` 对分析型回 null（两处调用点据此跳过它）', () => {
  const base = { id: 'x', name: '分析 bot', logo: null, platform: 'coze', enabled: true, greeting: null };
  assert.equal(studentAgentView({ agent: { ...base, purpose: 'analysis' } }), null);
  const view = studentAgentView({ agent: { ...base, purpose: 'tutoring' } });
  assert.deepEqual(view, { id: 'x', name: '分析 bot', logo: null, platform: 'coze', enabled: true, greeting: null });
});

test('反证：把判据写成「只挡 analysis 且字段必须存在」⇒ 旧行会被漏掉（本用例证明我们没那样写）', () => {
  const strict = (raw: unknown) => raw === 'analysis';
  const rows = [{ id: 'c' }, { id: 'b', purpose: 'analysis' }];
  // 严格判据也挡得住 analysis；分歧在「缺字段的行」—— 我们的判据**保留**它们（它们本来就是学伴）
  const visible = rows
    .map((r) => studentAgentView({ agent: { ...r, name: r.id, logo: null, platform: 'coze', enabled: true } }))
    .filter((v) => v !== null);
  assert.deepEqual(rows.filter((r) => !strict(r.purpose)).map((r) => r.id), ['c']);
  assert.deepEqual(visible.map((v) => v!.id), ['c'], '两边在这一点上一致');
  // 而真正要防的是「判据写成 `purpose === 'tutoring'`」—— 那会把旧行整个吞掉：
  const tooStrict = (raw: unknown) => raw === 'tutoring';
  assert.deepEqual(rows.filter((r) => tooStrict(r.purpose)).map((r) => r.id), [], '那样写旧行全没了');
});
