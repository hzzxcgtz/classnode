import assert from 'node:assert/strict';
import test from 'node:test';
import { nextLoginAttempt } from '../routes/settings.js';

test('login attempt counter resets after its time window', () => {
  const start = 1_000_000;
  const first = nextLoginAttempt(undefined, start);
  const second = nextLoginAttempt(first, start + 1_000);
  const afterWindow = nextLoginAttempt(second, start + 10 * 60_000 + 1_000);

  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal(afterWindow.count, 1);
});

test('five consecutive failed logins trigger a temporary block that resets afterwards', () => {
  const start = 1_000_000;
  let attempt = nextLoginAttempt(undefined, start);
  for (let i = 1; i < 5; i++) attempt = nextLoginAttempt(attempt, start + i * 1_000);
  assert.equal(attempt.count, 5);
  assert.equal(attempt.blockedUntil, start + 4_000 + 60_000);

  const afterBlock = nextLoginAttempt(attempt, attempt.blockedUntil);
  assert.equal(afterBlock.count, 1);
  assert.equal(afterBlock.blockedUntil, 0);
});
