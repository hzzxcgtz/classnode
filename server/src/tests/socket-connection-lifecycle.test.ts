import assert from 'node:assert/strict';
import test from 'node:test';
import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { createTeacherSession } from '../middleware/auth.js';
import { abortClassroomStreams, clearCurrentStudentConnection, setupSocketHandlers, staleTeacherRooms } from '../socket/index.js';

/**
 * 上面三个用例守的是 staleTeacherRooms 这个纯函数本身。下面三个守的是**调用点**：
 * handler 真的调用了它、leave 在 join 之前、鉴权失败时不 leave。
 * 没有这一层，「删掉那一行 leave」是一次静默回归——纯函数用例照样全绿。
 */

/** hasTeacherSessionCookie 只读 handshake.headers.cookie，而 createTeacherSession 只调 res.setHeader。 */
function teacherCookie(): string {
  const setCookies: string[] = [];
  const res = { setHeader: (_name: string, value: string) => { setCookies.push(value); } };
  createTeacherSession(res as unknown as Response);
  // cookieOptions 拼出的第一段就是 `classnode_teacher_session=<token>`。
  return setCookies[0].split(';')[0];
}

type FakeSocket = {
  id: string;
  rooms: Set<string>;
  handshake: { headers: { cookie?: string } };
  data: Record<string, unknown>;
  join: (room: string) => void;
  leave: (room: string) => void;
  emit: (event: string, payload?: unknown) => void;
  on: (event: string, handler: (...args: never[]) => unknown) => void;
};

/**
 * 用假 socket 跑通真实的 connection 回调，拿到 join-teacher-board 处理器。
 * 只为测试造这一层壳，setupSocketHandlers 的生产签名不动。
 */
function connectFakeSocket(options: { cookie?: string; rooms?: string[] } = {}) {
  // 房间变更的**时序**日志（join:X / leave:X 混在同一个数组里），顺序断言要靠它。
  const roomCalls: string[] = [];
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const emitted: { event: string; payload: unknown }[] = [];

  const socket: FakeSocket = {
    id: 'socket-1',
    rooms: new Set(options.rooms ?? []),
    handshake: { headers: options.cookie === undefined ? {} : { cookie: options.cookie } },
    data: {},
    join(room) { roomCalls.push(`join:${room}`); socket.rooms.add(room); },
    leave(room) { roomCalls.push(`leave:${room}`); socket.rooms.delete(room); },
    emit(event, payload) { emitted.push({ event, payload }); },
    on(event, handler) { handlers.set(event, handler); },
  };

  const connectionHandlers: ((socket: FakeSocket) => void)[] = [];
  const io = {
    on(event: string, handler: (socket: FakeSocket) => void) {
      if (event === 'connection') connectionHandlers.push(handler);
    },
  };
  setupSocketHandlers(io as unknown as Server, {} as unknown as PrismaClient);

  assert.equal(connectionHandlers.length, 1, 'setupSocketHandlers 应当注册恰好一个 connection 回调');
  connectionHandlers[0](socket);

  const handler = handlers.get('join-teacher-board');
  assert.ok(handler, 'connection 回调应当注册 join-teacher-board 处理器');

  return {
    socket,
    roomCalls,
    emitted,
    joinBoard: handler as unknown as (classroomId: string) => Promise<void>,
  };
}

test('换看板时 leave 收到上一个课堂的房间、join 收到新课堂的房间', async () => {
  const scout = connectFakeSocket({
    cookie: teacherCookie(),
    rooms: ['socket-1', 'teacher:classroom-1', 'status:classroom-1'],
  });

  await scout.joinBoard('classroom-2');

  assert.deepEqual(scout.roomCalls.filter(call => call.startsWith('leave:')), ['leave:teacher:classroom-1']);
  assert.deepEqual(scout.roomCalls.filter(call => call.startsWith('join:')), ['join:teacher:classroom-2']);
  // status: 房间不归这个 handler 管，不能被顺手清掉。
  assert.equal(scout.socket.rooms.has('status:classroom-1'), true);
  assert.equal(scout.socket.rooms.has('teacher:classroom-2'), true);
});

test('换看板时 leave 必须先于 join（否则刚加入的房间会被立刻退掉，看板收不到任何广播）', async () => {
  const scout = connectFakeSocket({
    cookie: teacherCookie(),
    rooms: ['socket-1', 'teacher:classroom-1'],
  });

  await scout.joinBoard('classroom-2');

  const leaveIndex = scout.roomCalls.indexOf('leave:teacher:classroom-1');
  const joinIndex = scout.roomCalls.indexOf('join:teacher:classroom-2');
  assert.ok(leaveIndex >= 0, 'leave 应当收到旧的 teacher: 房间');
  assert.ok(joinIndex >= 0, 'join 应当收到新的 teacher: 房间');
  assert.ok(leaveIndex < joinIndex, `leave 必须早于 join，实际时序：${scout.roomCalls.join(' -> ')}`);
  // 顺序反了的典型后果：新房间刚进就被 staleTeacherRooms 判定为过期而退掉。
  assert.equal(scout.socket.rooms.has('teacher:classroom-2'), true);
});

test('鉴权失败时不产生任何房间变更，只回 teacher-auth-error', async () => {
  for (const cookie of [undefined, 'classnode_teacher_session=凭空捏造的令牌']) {
    const anon = connectFakeSocket({ cookie, rooms: ['socket-1', 'teacher:classroom-1'] });

    await anon.joinBoard('classroom-2');

    assert.deepEqual(anon.roomCalls, [], `cookie=${String(cookie)} 时不应有任何 join/leave`);
    assert.equal(anon.socket.rooms.has('teacher:classroom-1'), true);
    assert.equal(anon.socket.rooms.has('teacher:classroom-2'), false);
    assert.deepEqual(anon.emitted.map(item => item.event), ['teacher-auth-error']);
  }
});

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
