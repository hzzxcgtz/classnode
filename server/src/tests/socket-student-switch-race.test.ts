import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { createStudentToken } from '../middleware/student-auth.js';
import { setupSocketHandlers } from '../socket/index.js';

for (const pauseAt of ['membership', 'online-write']) {
  test(`退出身份发生在 ${pauseAt} 等待中时，不留下在线学生`, async () => {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const prisma = {
      classroom: { findUnique: async () => ({ id: 'switch-room', status: 'active', classroomAgents: [], groups: [] }) },
      classroomStudent: {
        findFirst: async () => {
          if (pauseAt === 'membership') { reached(); await gate; }
          return { id: 'switch-student', studentId: null };
        },
        updateMany: async ({ data }: { data: { status: string } }) => {
          if (pauseAt === 'online-write' && data.status === 'online') { reached(); await gate; }
          return { count: 1 };
        },
      },
    };
    let connect!: (socket: unknown) => void;
    const broadcasts: string[] = [];
    const io = {
      on: (_event: string, handler: typeof connect) => { connect = handler; },
      to: () => ({ emit: (event: string) => { broadcasts.push(event); } }),
      sockets: { sockets: new Map() },
    };
    setupSocketHandlers(io as unknown as Server, prisma as unknown as PrismaClient);
    function socket(id: string) {
      const handlers = new Map<string, (...args: any[]) => any>();
      const emitted: { event: string; payload: any }[] = [];
      const value = { id, connected: true, data: {}, rooms: new Set<string>(), handshake: { headers: {} },
        on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
        emit: (event: string, payload: any) => emitted.push({ event, payload }),
        join: () => {}, leave: () => {},
      };
      connect(value);
      return { value, handlers, emitted };
    }
    const student = socket('switch-client');
    const join = student.handlers.get('join-classroom')!({ classroomCode: '1234', studentId: 'switch-student', token: createStudentToken('switch-room', 'switch-student') });
    await waiting;
    student.value.connected = false;
    await student.handlers.get('disconnect')!();
    release();
    await join;
    const observer = socket('switch-observer');
    observer.handlers.get('listen-classroom-status')!('switch-room');
    assert.deepEqual(observer.emitted.find(item => item.event === 'online-students')?.payload.studentIds, []);
    assert.equal(broadcasts.includes('student-online'), false);
  });
}
