import assert from 'node:assert/strict';
import test from 'node:test';
import { abortClassroomStreams, clearCurrentStudentConnection, staleTeacherRooms } from '../socket/index.js';

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

test('换看板时只清掉上一个课堂的教师房间，教师首页的 status: 房间不动', () => {
  const rooms = ['socket-1', 'teacher:classroom-1', 'status:classroom-1'];

  assert.deepEqual(staleTeacherRooms(rooms, 'classroom-2'), ['teacher:classroom-1']);
});

test('重复加入同一个课堂的看板不会先把自己踢出去', () => {
  assert.deepEqual(staleTeacherRooms(['socket-1', 'teacher:classroom-1'], 'classroom-1'), []);
});

test('没有旧教师房间时不产生任何 leave', () => {
  assert.deepEqual(staleTeacherRooms(['socket-1'], 'classroom-2'), []);
});
