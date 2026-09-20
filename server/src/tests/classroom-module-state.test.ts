import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODULE_KEYS, MODULE_STATES, DEFAULT_MODULE_STATE,
  isValidModuleKey, isValidModuleState,
} from '../services/classroom-module-state.js';

test('module keys and states are the expected closed sets', () => {
  assert.deepEqual([...MODULE_KEYS].sort(), ['companion', 'explorer', 'learning-sheet']);
  assert.deepEqual([...MODULE_STATES].sort(), ['hidden', 'open', 'preview']);
});

test('default module state is preview', () => {
  assert.equal(DEFAULT_MODULE_STATE, 'preview');
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
