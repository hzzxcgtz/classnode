import assert from 'node:assert/strict';
import test from 'node:test';
import { abortClassroomStreams, clearCurrentStudentConnection } from '../socket/index.js';

test('stale socket disconnect cannot mark a reconnected student offline', () => {
  const connections = new Map([['classroom-1:student-1', 'new-socket']]);
  assert.equal(clearCurrentStudentConnection(connections, 'classroom-1:student-1', 'old-socket'), false);
  assert.equal(connections.get('classroom-1:student-1'), 'new-socket');

  assert.equal(clearCurrentStudentConnection(connections, 'classroom-1:student-1', 'new-socket'), true);
  assert.equal(connections.has('classroom-1:student-1'), false);
});

test('pausing one classroom aborts only its active AI streams', () => {
  const connections = new Map([
    ['classroom-1:student-1', 'socket-1'],
    ['classroom-2:student-2', 'socket-2'],
  ]);
  const first = new AbortController();
  const second = new AbortController();
  const streams = new Map([['socket-1', first], ['socket-2', second]]);

  assert.equal(abortClassroomStreams('classroom-1', connections, streams), 1);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(streams.has('socket-1'), false);
  assert.equal(streams.has('socket-2'), true);
});
