import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INITIAL_MODULE_STATE, MODULE_KEYS, MODULE_STATES, DEFAULT_MODULE_STATE,
  initialModuleRows, isValidModuleKey, isValidModuleState,
} from '../services/classroom-module-state.js';

test('module keys and states are the expected closed sets', () => {
  assert.deepEqual([...MODULE_KEYS].sort(), ['companion', 'explorer', 'learning-sheet']);
  assert.deepEqual([...MODULE_STATES].sort(), ['hidden', 'open', 'preview']);
});

test('default module state is preview', () => {
  assert.equal(DEFAULT_MODULE_STATE, 'preview');
});

/* ── ★ 2026-09-29（教师）：「这三个模块在创建后默认是开放」──────────────── */

test('🔴 新建课堂的初始态是「开放」', () => {
  assert.equal(INITIAL_MODULE_STATE, 'open');
});

test('🔴 initialModuleRows：三个模块各一行、顺序与 `MODULE_KEYS` 一致', () => {
  assert.deepEqual(initialModuleRows(), [
    { moduleKey: 'learning-sheet', state: 'open' },
    { moduleKey: 'explorer', state: 'open' },
    { moduleKey: 'companion', state: 'open' },
  ]);
  // ⚠️ 长度单列一条：上面那条 deepEqual 在「多一行」时会红，但**漏一行**时
  // `MODULE_KEYS.map` 出来的也少一行 —— 两条一起才拦得住「漏种一个模块」。
  assert.equal(initialModuleRows().length, MODULE_KEYS.length);
});

test('🔴 初始态与兜底态**不是一回事**（拆成两个常量就是为这个）', () => {
  // 新建要宽松（开箱即可用），兜底要保守（行缺失 / 行里的值认不出 = 一次读失败）。
  // 合成一个常量的表现是二者必有一错，而**两边都不报错**。
  assert.equal(INITIAL_MODULE_STATE, 'open');
  assert.equal(DEFAULT_MODULE_STATE, 'preview');
  assert.notEqual(INITIAL_MODULE_STATE, DEFAULT_MODULE_STATE);
});

test('🔴 initialModuleRows 每次返回新数组（调用方改它不该污染下一次）', () => {
  const first = initialModuleRows();
  first[0].state = 'hidden';
  assert.equal(initialModuleRows()[0].state, 'open');
});

test('module key validation accepts only known keys', () => {
  assert.equal(isValidModuleKey('learning-sheet'), true);
  assert.equal(isValidModuleKey('explorer'), true);
  assert.equal(isValidModuleKey('companion'), true);
  assert.equal(isValidModuleKey('worksheet'), false); // 旧的候选名，必须被拒
  assert.equal(isValidModuleKey(''), false);
  assert.equal(isValidModuleKey(null), false);
  assert.equal(isValidModuleKey(undefined), false);
  assert.equal(isValidModuleKey(42), false);
});

test('module state validation accepts only known states', () => {
  assert.equal(isValidModuleState('open'), true);
  assert.equal(isValidModuleState('preview'), true);
  assert.equal(isValidModuleState('hidden'), true);
  assert.equal(isValidModuleState('locked'), false);
  assert.equal(isValidModuleState(''), false);
  assert.equal(isValidModuleState(null), false);
  assert.equal(isValidModuleState({ open: true }), false);
});
