import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransition } from '../services/classroom-state.js';

test('classroom state machine permits only intended transitions', () => {
  assert.equal(canTransition('active', 'pause'), true);
  assert.equal(canTransition('paused', 'resume'), true);
  assert.equal(canTransition('active', 'end'), true);
  assert.equal(canTransition('paused', 'end'), true);
  assert.equal(canTransition('ended', 'restore'), true);

  assert.equal(canTransition('paused', 'pause'), false);
  assert.equal(canTransition('active', 'resume'), false);
  assert.equal(canTransition('ended', 'end'), false);
  assert.equal(canTransition('active', 'restore'), false);
});
