/**
 * ★ 服务端分析闸门必须与前端全部可作答题型一致。
 * 本地判分与 AI 分析可以同时适用于同一道客观题；`graded` 只描述前者，不再决定分析入口。
 * 必须遍历全部题型，避免以后新增题型时只接通前端或服务端其中一侧。
 *
 * ⚠️ 跨工程 import 用 `.ts` 扩展名（Node 不会把 `.js` 解析成 `.ts`）——
 * 写法照抄 `worksheet-ink-parity.test.ts`（那条已经跑通）。被加载的
 * `analysis-gate.ts` **零 import**，所以类型擦除加载得起来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_TYPE_OPTIONS } from './worksheet-questions.ts';
import { ANALYZABLE_TYPES } from '../../server/src/services/analysis-gate.ts';

test('阳性对照：前端题型表的每一项都有布尔 `graded`', () => {
  assert.ok(QUESTION_TYPE_OPTIONS.length > 2, '题型表里不止两个题型，否则本用例空转');
  const missing = QUESTION_TYPE_OPTIONS.filter((o) => typeof o.graded !== 'boolean').map((o) => o.value);
  assert.deepEqual(missing, [], `这些题型没有布尔 graded：${missing.join(', ')}`);
});

test('★ 前端全部可作答题型与服务端分析闸门集合相等', () => {
  const answerable = QUESTION_TYPE_OPTIONS.map((o) => o.value);
  assert.deepEqual(
    [...answerable].sort(),
    [...ANALYZABLE_TYPES].sort(),
    '前端可作答题型与服务端「可分析」的闸门分叉了',
  );
});

test('反证：前端新增题型但闸门漏掉 ⇒ 上一条必须红', () => {
  const fake = [...QUESTION_TYPE_OPTIONS.map((o) => o.value), 'future-type'];
  assert.notDeepEqual([...fake].sort(), [...ANALYZABLE_TYPES].sort());
  assert.deepEqual(fake.filter((type) => !ANALYZABLE_TYPES.includes(type)), ['future-type']);
});
