import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import classroomRoutes from '../routes/classroom.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';
import {
  drainWebappMonitor,
  hasWatchers,
  peekWebappMonitor,
  recordWebappSummary,
  sanitizeWebappEvent,
  staleTeacherRooms,
  validateWebappEventPayload,
  validateWebappFramePayload,
  validateWebappWatchPayload,
  webappMonitorSizes,
  setupSocketHandlers,
} from '../socket/index.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * 这个文件守的是**真实 handler**，不是纯函数 —— 探究助手实时链路的每一个失败模式
 * 都是静默的（没有报错、没有异常，只有「图墙冻住」或「学生白推」），所以每条断言
 * 都刻意配了**阴性对照**：只断言「不该发生时确实没发生」是不够的，同一份输入还必须
 * 在条件反过来时**确实生效**，否则「整条链路根本没接上」也会让断言通过。
 *
 * 内存态在 socket 模块里是**模块级**的（与 activeStreams / teacherNotificationCache 同款），
 * 用例之间共享 —— 每个会写状态的用例开头都调一次 resetMonitor() 把它清掉。
 * ══════════════════════════════════════════════════════════════════════════
 */

// ── 假 io / 假 socket：只为驱动真实的 connection 回调，不改 setupSocketHandlers 的签名 ──

type Emitted = { room: string; event: string; payload: unknown };

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

/** 学生的课堂参与者记录 ID（与 Interaction.studentId 同口径：参与者而不是 Student 表）。 */
const PARTICIPANT_ID = 'participant-1';

function teacherCookie(): string {
  const setCookies: string[] = [];
  const res = { setHeader: (_name: string, value: string) => { setCookies.push(value); } };
  createTeacherSession(res as unknown as Response);
  return setCookies[0].split(';')[0];
}

/**
 * socket 侧用到的 prisma 表面。`membership: false` 让课堂成员复查失败，
 * `linkedWebapp: false` 让「本课堂是否关联了这个网页」失败 —— 两者都是归属校验的阴性对照。
 *
 * `classroomId()` 是**可变**的：join-classroom 会拿令牌里的 classroomId 与
 * `classroom.findUnique` 的结果比对，两处不一致就会静默走到 student-auth-error
 * （什么都不发生）—— 所以这里必须能跟着用例里的课堂 id 走。
 */
function socketPrisma(classroomId: () => string, options: { membership?: boolean; linkedWebapp?: boolean } = {}) {
  return {
    classroom: {
      findUnique: async () => ({
        id: classroomId(),
        code: '1234',
        status: 'active',
        mode: 'standard',
        allowStudentStop: true,
        classroomAgents: [],
        groups: [],
      }),
    },
    classroomStudent: {
      findFirst: async () => (options.membership === false ? null : { id: PARTICIPANT_ID, blacklisted: false }),
      updateMany: async () => ({ count: 1 }),
    },
    classroomWebapp: {
      findFirst: async () => (options.linkedWebapp === false ? null : { id: 'link-1' }),
    },
  };
}

/**
 * 一个假 io：`to(room).emit` 记进 emits；`sockets.adapter.rooms` 是**真的会随
 * socket.join / socket.leave 变化**的房间表 —— 按需推流的判据（hasWatchers）读的就是它，
 * 用一份不随 join 变化的假表会让那条断言变成恒真。
 */
function createHarness(options: { membership?: boolean; linkedWebapp?: boolean } = {}) {
  const emits: Emitted[] = [];
  const roomMembers = new Map<string, Set<string>>();
  const sockets = new Map<string, FakeSocket>();
  const connectionHandlers: ((socket: FakeSocket) => void)[] = [];
  // join-classroom 会拿令牌里的 classroomId 与 classroom.findUnique 的结果比对，
  // 所以这个假 prisma 必须跟着用例里的课堂走（见 joinAsStudent）。
  let activeClassroomId = 'classroom-a';
  const prisma = socketPrisma(() => activeClassroomId, options);

  const io = {
    on(event: string, handler: (socket: FakeSocket) => void) {
      if (event === 'connection') connectionHandlers.push(handler);
    },
    to(room: string) {
      return { emit: (event: string, payload?: unknown) => { emits.push({ room, event, payload }); } };
    },
    emit(event: string, payload?: unknown) {
      emits.push({ room: '*', event, payload });
    },
    sockets: { sockets, adapter: { rooms: roomMembers } },
    engine: { clientsCount: 0 },
  };

  setupSocketHandlers(io as unknown as Server, prisma as unknown as PrismaClient);
  assert.equal(connectionHandlers.length, 1, 'setupSocketHandlers 应当注册恰好一个 connection 回调');

  function connect(options: { cookie?: string; id?: string } = {}) {
    const id = options.id ?? `socket-${sockets.size + 1}`;
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const socket: FakeSocket = {
      id,
      rooms: new Set([id]),
      handshake: { headers: options.cookie === undefined ? {} : { cookie: options.cookie } },
      data: {},
      join(room) { socket.rooms.add(room); const set = roomMembers.get(room) ?? new Set<string>(); set.add(id); roomMembers.set(room, set); },
      leave(room) { socket.rooms.delete(room); roomMembers.get(room)?.delete(id); },
      emit(event, payload) { emits.push({ room: id, event, payload }); },
      on(event, handler) { handlers.set(event, handler); },
    };
    sockets.set(id, socket);
    connectionHandlers[0](socket);
    return {
      id,
      socket,
      /** 房间成员表（= 服务端 join/leave 的真实效果）。 */
      members: (room: string) => [...(roomMembers.get(room) ?? [])],
      async call(event: string, payload?: unknown) {
        const handler = handlers.get(event);
        assert.ok(handler, `connection 回调应当注册 ${event} 处理器`);
        await (handler as unknown as (arg: unknown) => Promise<void>)(payload);
      },
      /** 模拟 Socket.IO 的断开：先从所有房间摘掉，再触发 disconnect 处理器。 */
      async disconnect() {
        for (const room of [...socket.rooms]) socket.leave(room);
        sockets.delete(id);
        const handler = handlers.get('disconnect');
        assert.ok(handler, 'connection 回调应当注册 disconnect 处理器');
        await (handler as unknown as () => Promise<void>)();
      },
    };
  }

  return {
    io,
    emits,
    connect,
    roomMembers,
    setClassroomId(id: string) { activeClassroomId = id; },
    events: (name: string) => emits.filter(item => item.event === name),
  };
}

/** 学生身份：走真实的 join-classroom（令牌是真的，verifyStudentToken 会验签）。 */
async function joinAsStudent(harness: ReturnType<typeof createHarness>, classroomId: string) {
  harness.setClassroomId(classroomId);
  const student = harness.connect();
  await student.call('join-classroom', {
    classroomCode: '1234',
    studentId: PARTICIPANT_ID,
    token: createStudentToken(classroomId, PARTICIPANT_ID),
  });
  return student;
}

/**
 * 内存态在 socket 模块里是**模块级**的（与 activeStreams / teacherNotificationCache 同款），
 * 所以用例之间共享。每个会写状态的用例开头调一次它。
 *
 * ⚠️ 用的是**生产代码里的 drain**，不是测试专用的后门 —— 于是「drain 能把这个课堂清干净」
 * 这件事被每个用例顺带验证一次；而漏调它只会造成跨用例的**多**数据，
 * 撞上这里那些精确断言（`clicks === 120`）会立刻变红，不会变成假绿。
 */
function resetMonitor(): void {
  drainWebappMonitor('classroom-a');
  drainWebappMonitor('classroom-b');
}

// ══════════════════════════════════════════════════════════════════════════
// 纯函数：学生上报载荷的形状校验（白名单式重建）
// ══════════════════════════════════════════════════════════════════════════

test('事件载荷是白名单式重建：契约之外的字段进不来', () => {
  // JSON.parse 造出来的 __proto__ 是**真 own 属性**（对象字面量里的 __proto__ 会去改原型，
  // 那不是这里要测的东西）。用来确认重建过程不会顺手把它带进结果或污染原型。
  const hostile = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const sanitized = sanitizeWebappEvent({
    kind: 'input',
    selector: 'input#answer',
    inputType: 'text',
    length: 12,
    depth: 0,
    to: '',
    at: 1700000000000,
    value: '学生的真实输入内容',
    nested: { deep: true },
    ...hostile,
  });
  assert.deepEqual(sanitized, {
    kind: 'input',
    selector: 'input#answer',
    inputType: 'text',
    length: 12,
    depth: 0,
    to: '',
    at: 1700000000000,
  });
  assert.equal(Object.keys(sanitized ?? {}).length, 7, '结果必须**恰好**是契约的 7 个字段');
  assert.equal(({} as Record<string, unknown>).polluted, undefined, '不得出现原型污染');
  assert.equal(JSON.stringify(sanitized).includes('学生的真实输入内容'), false);
  // 阴性：上面那条「恰好 7 个字段」不能因为 sanitize 返回 null 而空过。
  assert.notEqual(sanitized, null);
});

test('未知 kind 被丢弃（白名单，而不是「不在黑名单里就放行」）', () => {
  assert.equal(sanitizeWebappEvent({ kind: 'screenshot', selector: 'canvas' }), null);
  assert.equal(sanitizeWebappEvent({ kind: '', selector: 'canvas' }), null);
  // 阳性对照：同一形状、只把 kind 换成白名单里的，就必须通过 ——
  // 否则上一条断言在「sanitize 对什么都返回 null」时也成立。
  assert.notEqual(sanitizeWebappEvent({ kind: 'click', selector: 'canvas' }), null);
});

test('自由字符串字段被截到上界，数字字段被规范成非负整数', () => {
  const event = sanitizeWebappEvent({
    kind: 'click',
    selector: 'x'.repeat(5000),
    inputType: 'y'.repeat(5000),
    to: 'z'.repeat(5000),
    length: -5,
    depth: Number.NaN,
    at: Number.POSITIVE_INFINITY,
  });
  assert.ok(event);
  assert.equal(event.selector.length, 200);
  assert.equal(event.inputType.length, 64);
  assert.equal(event.to.length, 64);
  assert.equal(event.length, 0);
  assert.equal(event.depth, 0);
  assert.equal(event.at, 0);
});

test('外层形状：非数组 / 空数组 / 超量 / 字段缺失都整条丢弃', () => {
  const base = { classroomId: 'classroom-x', webappId: 'webapp-1' };
  assert.equal(validateWebappEventPayload(null), null);
  assert.equal(validateWebappEventPayload({ ...base, events: 'not-an-array' }), null);
  assert.equal(validateWebappEventPayload({ ...base, events: [] }), null);
  assert.equal(validateWebappEventPayload({ classroomId: '', webappId: 'webapp-1', events: [{ kind: 'click' }] }), null);
  assert.equal(validateWebappEventPayload({ classroomId: 'classroom-x', events: [{ kind: 'click' }] }), null);
  // 51 条 → 超过单条消息的上界（50），整条丢弃而不是截断
  const many = Array.from({ length: 51 }, () => ({ kind: 'click' }));
  assert.equal(validateWebappEventPayload({ ...base, events: many }), null);
  // 数组里全是非法事件 ⇒ 过滤后为空 ⇒ 丢弃（不是「返回一个空 events 的载荷」）
  assert.equal(validateWebappEventPayload({ ...base, events: [{ kind: 'nope' }] }), null);
  // 阳性对照：合法的一条必须通过，且长度恰好 1
  const ok = validateWebappEventPayload({ ...base, events: [{ kind: 'click' }, { kind: 'nope' }] });
  assert.ok(ok);
  assert.equal(ok.events.length, 1);
});

test('帧载荷：只接 data URL 图片，且有长度上界', () => {
  const base = { classroomId: 'classroom-x', webappId: 'webapp-1' };
  assert.equal(validateWebappFramePayload({ ...base, dataUrl: 'https://example.com/a.jpg' }), null);
  assert.equal(validateWebappFramePayload({ ...base, dataUrl: '' }), null);
  assert.equal(validateWebappFramePayload({ ...base, dataUrl: 123 }), null);
  assert.equal(validateWebappFramePayload({ ...base, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(32 * 1024) }), null);
  // 阳性对照：刚好在上界内的一张必须通过（否则上面那条在「什么都不通过」时也成立）
  assert.notEqual(validateWebappFramePayload({ ...base, dataUrl: 'data:image/jpeg;base64,AAAA' }), null);
});

test('订阅载荷只认非空 classroomId', () => {
  assert.equal(validateWebappWatchPayload({ classroomId: 'c1' }), 'c1');
  assert.equal(validateWebappWatchPayload({ classroomId: '  ' }), null);
  assert.equal(validateWebappWatchPayload(null), null);
  assert.equal(validateWebappWatchPayload(['c1']), null);
});

// ══════════════════════════════════════════════════════════════════════════
// 预审 1 的回归：staleTeacherRooms 必须保留当前课堂的**两种**房间
// ══════════════════════════════════════════════════════════════════════════

test('staleTeacherRooms：当前课堂的看板房间与监控房间都保留，别的课堂的两种都清掉', () => {
  const rooms = [
    'socket-1',
    'teacher:classroom-a',
    'teacher:classroom-a:webapp',
    'teacher:classroom-b',
    'teacher:classroom-b:webapp',
    'status:classroom-a',
  ];
  assert.deepEqual(staleTeacherRooms(rooms, 'classroom-a'), ['teacher:classroom-b', 'teacher:classroom-b:webapp']);
  // 反过来同样成立（不是「恰好保留第一个」这种偶然）
  assert.deepEqual(staleTeacherRooms(rooms, 'classroom-b'), ['teacher:classroom-a', 'teacher:classroom-a:webapp']);
  // 阴性：已经在当前课堂的两种房间里时一条都不该 leave
  assert.deepEqual(staleTeacherRooms(['teacher:classroom-a', 'teacher:classroom-a:webapp'], 'classroom-a'), []);
  // status: 房间不归这个函数管，不能被顺手清掉
  assert.equal(staleTeacherRooms(rooms, 'classroom-a').includes('status:classroom-a'), false);
});

test('预审 1 的真实失败场景：join-teacher-board 之后监控房间必须还活着（否则图墙会静默冻住）', async () => {
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });

  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true, '订阅后应当有订阅者');

  // 这一行就是预审 1 说的「任何重新触发 join-teacher-board 的动作」（effect 依赖变化、断线重连）
  await teacher.call('join-teacher-board', 'classroom-a');

  assert.deepEqual(teacher.members('teacher:classroom-a'), [teacher.id], '看板房间必须存活');
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [teacher.id], '监控房间必须存活 —— 被扫掉就是「冻住的图墙且无任何报错」');
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 1);

  // 而换到另一个课堂的看板时，两个房间都要被清掉（否则旧课堂的订阅永远留着）
  await teacher.call('join-teacher-board', 'classroom-b');
  assert.deepEqual(teacher.members('teacher:classroom-a'), []);
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), []);
  assert.deepEqual(teacher.members('teacher:classroom-b'), [teacher.id]);
});

// ══════════════════════════════════════════════════════════════════════════
// 按需推流（Ruling 9）
// ══════════════════════════════════════════════════════════════════════════

test('教师订阅前，学生上报不产生任何转发；订阅后同一份上报确实被转发到 teacher:<id>:webapp', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const payload = { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click', selector: 'button#go' }] };

  // ── 订阅前
  await student.call('webapp-event', payload);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.deepEqual(harness.events('webapp-student-event'), [], '没有教师订阅时不得转发事件');
  assert.deepEqual(harness.events('webapp-student-frame'), [], '没有教师订阅时不得转发帧');

  // ── 订阅后，**同一份载荷**必须被转发（这一半是必需的：少了它，「整条链路没接上」也会让上面全过）
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await student.call('webapp-event', payload);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  const forwarded = harness.events('webapp-student-event');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].room, 'teacher:classroom-a:webapp');
  assert.deepEqual(forwarded[0].payload, {
    studentId: PARTICIPANT_ID,
    webappId: 'webapp-1',
    events: [{ kind: 'click', selector: 'button#go', inputType: '', length: 0, depth: 0, to: '', at: 0 }],
  });
  const frames = harness.events('webapp-student-frame');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].room, 'teacher:classroom-a:webapp', '帧只能进监控房间，不能进 teacher:<id>（那样每个开着看板的教师都会收到）');
  assert.equal((frames[0].payload as { dataUrl: string }).dataUrl, 'data:image/jpeg;base64,AA');
  assert.equal(typeof (frames[0].payload as { at: number }).at, 'number');
});

test('没有教师在看时上报：仍然不转发，但数据照记（课后汇总不因「没人开看板」整块为空）', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  await student.call('webapp-event', {
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    events: [{ kind: 'click' }, { kind: 'input', length: 5 }, { kind: 'scroll', depth: 40 }],
  });
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-event'), [], '没人看时一个字节都不转发');
  assert.deepEqual(harness.events('webapp-student-frame'), []);
  const { frame, counter } = peekWebappMonitor('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(counter?.clicks, 1, '计数必须照记：否则教师没开看板的那节课，唯一的落盘汇总会是空的');
  assert.equal(counter?.inputs, 1);
  assert.equal(counter?.maxDepth, 40);
  assert.equal(frame?.dataUrl, 'data:image/jpeg;base64,AA');

  // 阳性对照：此时再让教师订阅，**已经记下的**数据要能被 drain 出来
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  const rows = drainWebappMonitor('classroom-a');
  assert.equal(rows.length, 1, '没人看时记下的数据必须仍然在内存里、能被汇总取到');
  assert.equal(rows[0].clicks, 1);
  assert.equal(rows[0].frameCount, 1);
});

test('按需推流的判据是「监控房间」而不是「教师看板房间」', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });

  // 只开看板（教师看作业、没点开探究助手视图）⇒ 不算有订阅者
  await teacher.call('join-teacher-board', 'classroom-a');
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.deepEqual(harness.events('webapp-student-frame'), [], '教师只是开着看板不该触发学生推流');

  // 点开探究助手视图 ⇒ 才算
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [teacher.id]);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.equal(harness.events('webapp-student-frame').length, 1);
});

test('学生加入课堂时立刻收到一次当前需求状态（否则「教师先开、学生后进」时图墙永远空着）', async () => {
  resetMonitor();
  // 场景一：没人在看 ⇒ watching:false
  const idle = createHarness();
  const idleStudent = await joinAsStudent(idle, 'classroom-a');
  const idleDemand = idle.events('webapp-monitor-demand').filter(item => item.room === idleStudent.id);
  assert.deepEqual(idleDemand.map(item => item.payload), [{ watching: false }]);

  // 场景二：教师已经在看 ⇒ watching:true（阳性对照：否则上一条在「这条消息根本没发」时也过）
  const busy = createHarness();
  const teacher = busy.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-b');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-b' });
  const busyStudent = await joinAsStudent(busy, 'classroom-b');
  const busyDemand = busy.events('webapp-monitor-demand').filter(item => item.room === busyStudent.id);
  assert.deepEqual(busyDemand.map(item => item.payload), [{ watching: true }]);
});

test('教师订阅时向课堂广播 watching:true', async () => {
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const demand = harness.events('webapp-monitor-demand');
  assert.deepEqual(demand, [{ room: 'classroom:classroom-a', event: 'webapp-monitor-demand', payload: { watching: true } }]);
});

// ══════════════════════════════════════════════════════════════════════════
// 防抖（Ruling 9 第 2 条）—— 本任务最容易做错的地方
// ══════════════════════════════════════════════════════════════════════════

test('教师刷新页面（0→1→0 抖动）不得立刻通知学生停推，且重新订阅后那次停止通知永不发出', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  // 刷新开始：视图卸载 ⇒ unwatch
  await teacher.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false, '订阅数确实归零了（否则这条用例什么都没构造出来）');

  // ① 立刻：不得有任何 watching:false
  assert.deepEqual(harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false), []);

  // ② 抖动期间（1 秒后，仍远小于 15 秒）：仍然不得有
  t.mock.timers.tick(1000);
  assert.deepEqual(harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false), []);

  // ③ 刷新完成：视图重新挂载 ⇒ watch（这一下必须取消掉那个待触发的定时器）
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);

  // ④ 把时间推过 15 秒：那次「停止推流」永远不该出现
  t.mock.timers.tick(60_000);
  assert.deepEqual(
    harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false),
    [],
    '重新订阅之后，之前那次归零的停止通知必须被取消',
  );
  // 阳性对照：这一路确实产生了 watching:true 的广播（否则「没有任何 watching:false」
  // 可能只是因为 watch 这条路径整个没生效，什么都没发）
  assert.deepEqual(
    harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === true).length,
    2,
  );
});

test('教师从 X 的看板切到 Y 的看板：X 的监控订阅被清掉，且 X 的学生最终收到停止推流', async (t) => {
  // 这条守的是 staleTeacherRooms **代劳退房**那条路径（不是 unwatch、也不是 disconnect）：
  // 退了房间却不发通知，X 的学生就会一直推 —— 静默的泄漏。
  t.mock.timers.enable({ apis: ['setTimeout'] });
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);

  await teacher.call('join-teacher-board', 'classroom-b');

  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [], 'X 的监控房间必须退掉');
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0, '记账也要跟着清');

  t.mock.timers.tick(15_000);
  assert.deepEqual(
    harness.events('webapp-monitor-demand').filter(item => item.room === 'classroom:classroom-a').map(item => item.payload),
    [{ watching: true }, { watching: false }],
    'X 的学生必须收到停推通知（只退房间不发通知 = 学生一直推）',
  );
});

test('教师真的走光了：15 秒后学生确实收到 watching:false（防抖不能变成永久不通知）', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await teacher.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });
  t.mock.timers.tick(14_999);
  assert.deepEqual(harness.events('webapp-monitor-demand').filter(item => item.room === 'classroom:classroom-a').slice(1), [], '14.999 秒时还不该通知');

  t.mock.timers.tick(1);
  const after = harness.events('webapp-monitor-demand').filter(item => item.room === 'classroom:classroom-a');
  assert.deepEqual(after, [
    { room: 'classroom:classroom-a', event: 'webapp-monitor-demand', payload: { watching: true } },
    { room: 'classroom:classroom-a', event: 'webapp-monitor-demand', payload: { watching: false } },
  ]);
});

test('教师连接断开与 unwatch 同路：先摘记账，再走防抖', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await teacher.disconnect();

  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0, 'watchers 这个账本必须跟着断开清掉，否则它会无界增长');
  assert.deepEqual(harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false), []);

  t.mock.timers.tick(15_000);
  assert.equal(harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false).length, 1);
});

test('hasWatchers（房间）与 watchers（记账 Map）必须一致 —— 两处口径不许漂移', async () => {
  resetMonitor();
  const harness = createHarness();
  const first = harness.connect({ cookie: teacherCookie() });
  const second = harness.connect({ cookie: teacherCookie() });
  const io = harness.io as unknown as Server;

  assert.equal(hasWatchers(io, 'classroom-a'), false);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0);

  await first.call('join-teacher-board', 'classroom-a');
  await first.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await second.call('join-teacher-board', 'classroom-a');
  await second.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(io, 'classroom-a'), true);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 2);

  await first.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(io, 'classroom-a'), true, '还有一个人在看，就不能算归零');
  assert.equal(webappMonitorSizes('classroom-a').watchers, 1);

  await second.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(io, 'classroom-a'), false);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0);
});

test('未鉴权的连接不能订阅（否则任何人都能骗学生开始推流）', async () => {
  resetMonitor();
  const harness = createHarness();
  const anon = harness.connect();
  await anon.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  assert.deepEqual(anon.members('teacher:classroom-a:webapp'), []);
  assert.deepEqual(harness.events('teacher-auth-error').map(item => item.room), [anon.id]);
  // 阳性对照：同一个连接拿到教师 cookie 后必须能订阅
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);
});

test('教师不能订阅别的课堂（会话里的课堂与载荷不符即拒）', async () => {
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-b' });

  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-b'), false);
  assert.deepEqual(teacher.members('teacher:classroom-b:webapp'), []);
  // 自己的课堂仍然可订阅
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);
});

// ══════════════════════════════════════════════════════════════════════════
// 归属校验（学生只能上报自己的课堂与真正关联的网页）
// ══════════════════════════════════════════════════════════════════════════

test('学生上报别的课堂的 classroomId：不转发、不写内存', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-event', { classroomId: 'classroom-b', webappId: 'webapp-1', events: [{ kind: 'click' }] });

  assert.deepEqual(harness.events('webapp-student-event'), []);
  assert.deepEqual(webappMonitorSizes('classroom-b'), { frames: 0, counters: 0, watchers: 0 });
  // 阳性对照：换成自己的课堂就必须进来
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }] });
  assert.equal(harness.events('webapp-student-event').length, 1);
});

test('学生上报本课堂没关联的 webappId：不转发、不写内存（否则能污染别的网页的统计）', async () => {
  resetMonitor();
  const harness = createHarness({ linkedWebapp: false });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-OTHER', events: [{ kind: 'click' }] });
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-OTHER', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-event'), []);
  assert.deepEqual(harness.events('webapp-student-frame'), []);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, counters: 0, watchers: 1 });
});

test('已被移出课堂的学生（成员复查失败）不能再上报', async () => {
  resetMonitor();
  const harness = createHarness({ membership: false });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }] });

  assert.deepEqual(harness.events('webapp-student-event'), []);
  assert.deepEqual(webappMonitorSizes('classroom-a').counters, 0);
});

test('没走 join-classroom 的连接（不在 classroom:<id> 房间里）上报无效', async () => {
  resetMonitor();
  const harness = createHarness();
  const stranger = harness.connect();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  // 手动伪造 socket.data（模拟「只有一个裸连接，会话是编的」）
  stranger.socket.data.classroomId = 'classroom-a';
  stranger.socket.data.studentId = PARTICIPANT_ID;
  await stranger.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }] });

  assert.deepEqual(harness.events('webapp-student-event'), []);
  assert.deepEqual(webappMonitorSizes('classroom-a').counters, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// 内存模型：帧覆盖 + 事件计数（Ruling 8 的有界化）
// ══════════════════════════════════════════════════════════════════════════

test('帧只留最新一帧：连发三帧后内存里仍然只有 1 条，而且是最后一帧', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  for (const tag of ['first', 'second', 'third']) {
    await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: `data:image/jpeg;base64,${tag}` });
  }

  assert.equal(webappMonitorSizes('classroom-a').frames, 1, '三帧之后内存里必须仍然只有 1 条');
  const { frame, counter } = peekWebappMonitor('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(frame?.dataUrl, 'data:image/jpeg;base64,third', '留下的必须是**最后一帧**（覆盖，不是追加也不是保留第一帧）');
  assert.equal(counter?.frames, 3, '收到的**总数**记在计数里（内存只留 1 条，数量不丢）');
});

test('事件是累计计数而不是流水账：内存条目不随事件条数增长', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const total = 120;
  for (let i = 0; i < total; i += 1) {
    await student.call('webapp-event', {
      classroomId: 'classroom-a',
      webappId: 'webapp-1',
      events: [{ kind: 'click', selector: `button:nth-of-type(${i})` }],
    });
  }

  const sizes = webappMonitorSizes('classroom-a');
  assert.equal(sizes.counters, 1, '120 条事件之后内存里仍然只有 1 条计数 —— 存流水账会让它变成 120');
  assert.equal(sizes.frames, 0);
  const { counter } = peekWebappMonitor('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(counter?.clicks, total, '累计值必须一条不漏');
  // 阳性对照：这 120 条确实**被转发过**（否则上面那个计数可能来自别的东西，
  // 或者事件根本没进 handler）
  assert.equal(harness.events('webapp-student-event').length, total);
});

test('滚动取最大深度、report 单独计数', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  for (const depth of [30, 90, 10, 70]) {
    await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'scroll', depth }] });
  }
  await student.call('webapp-event', {
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    events: [{ kind: 'report', selector: '{"score":3}' }, { kind: 'navigate', length: 12 }],
  });

  const { counter } = peekWebappMonitor('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(counter?.maxDepth, 90, '滚动报的是「到过第几个十分位」，取最大值而不是最后一条');
  assert.equal(counter?.reports, 1);
  // navigate 只转发不计数：汇总要的是「时长 + 交互次数」，跳转不是交互次数
  assert.equal(counter?.clicks, 0);
  assert.equal(counter?.inputs, 0);
});

test('输入只记长度不记内容 —— 载荷里根本没有装内容的地方', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-event', {
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    // 客户端硬塞一个 value —— 契约里没有这个字段的位置，服务端必须把它丢掉而不是转发
    events: [{ kind: 'input', selector: 'input#answer', inputType: 'text', length: 7, value: '学生的答案' }],
  });

  const payload = harness.events('webapp-student-event')[0].payload as { events: Record<string, unknown>[] };
  assert.equal(payload.events[0].length, 7);
  assert.equal('value' in payload.events[0], false, '客户端硬塞的 value 不得穿过服务端');
  assert.equal(JSON.stringify(payload).includes('学生的答案'), false);
});

// ══════════════════════════════════════════════════════════════════════════
// drain：取走数据 + 清空三个 Map（规格 §5.5「课堂结束释放」）
// ══════════════════════════════════════════════════════════════════════════

test('drain 返回每个参与者每个网页一行、时长按首帧→末帧算，并清空本课堂的三个 Map', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.timers.setTime(1_700_000_000_000);
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,one' });
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }, { kind: 'input', length: 3 }] });
  t.mock.timers.tick(60_000);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,two' });
  // 另一个网页，只有事件没有帧（时长必须退化成 0，而不是让这一行消失）
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-2', events: [{ kind: 'report' }] });

  const rows = drainWebappMonitor('classroom-a');

  assert.equal(rows.length, 2);
  const first = rows.find(row => row.webappId === 'webapp-1');
  assert.deepEqual(first, {
    studentId: PARTICIPANT_ID,
    webappId: 'webapp-1',
    durationMs: 60_000,
    clicks: 1,
    inputs: 1,
    maxDepth: 0,
    reports: 0,
    frameCount: 2,
  });
  const second = rows.find(row => row.webappId === 'webapp-2');
  assert.deepEqual(second, {
    studentId: PARTICIPANT_ID,
    webappId: 'webapp-2',
    durationMs: 0,
    clicks: 0,
    inputs: 0,
    maxDepth: 0,
    reports: 1,
    frameCount: 0,
  });

  // 三个 Map 都被清空（本课堂的部分）
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, counters: 0, watchers: 0 });
  assert.deepEqual(drainWebappMonitor('classroom-a'), [], '再 drain 一次必须什么都没有（已经取走了）');

  // 别的课堂的数据一条都不能被顺手带走
  const other = createHarness();
  const otherStudent = await joinAsStudent(other, 'classroom-b');
  await otherStudent.call('webapp-event', { classroomId: 'classroom-b', webappId: 'webapp-1', events: [{ kind: 'click' }] });
  assert.deepEqual(webappMonitorSizes('classroom-b').counters, 1);
  assert.deepEqual(drainWebappMonitor('classroom-a'), []);
  assert.equal(webappMonitorSizes('classroom-b').counters, 1, 'drain 只能清自己那个课堂');
});

test('drain 会取消待触发的停止推流定时器（不给已结束的课堂广播）', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await teacher.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });

  drainWebappMonitor('classroom-a');
  t.mock.timers.tick(60_000);

  assert.deepEqual(
    harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false),
    [],
  );
});

test('recordWebappSummary 落盘：一行一个（参与者的 studentId 用的是参与记录 ID）', async () => {
  const writes: { data: Record<string, unknown>[] }[] = [];
  const prisma = { webappUsage: { createMany: async (args: { data: Record<string, unknown>[] }) => { writes.push(args); return { count: args.data.length }; } } };
  const rows = [
    { studentId: 'p1', webappId: 'w1', durationMs: 1000, clicks: 2, inputs: 1, maxDepth: 80, reports: 0, frameCount: 3 },
    { studentId: 'p2', webappId: 'w1', durationMs: 0, clicks: 0, inputs: 0, maxDepth: 0, reports: 0, frameCount: 0 },
  ];

  const written = await recordWebappSummary(prisma as unknown as PrismaClient, 'classroom-a', rows);

  assert.equal(written, 2);
  assert.deepEqual(writes, [{
    data: [
      { classroomId: 'classroom-a', webappId: 'w1', studentId: 'p1', durationMs: 1000, clicks: 2, inputs: 1, maxDepth: 80, reports: 0, frameCount: 3 },
      { classroomId: 'classroom-a', webappId: 'w1', studentId: 'p2', durationMs: 0, clicks: 0, inputs: 0, maxDepth: 0, reports: 0, frameCount: 0 },
    ],
  }]);
});

test('recordWebappSummary：没有数据时不写库（不产生空行）', async () => {
  const writes: unknown[] = [];
  const prisma = { webappUsage: { createMany: async (args: unknown) => { writes.push(args); return { count: 0 }; } } };

  assert.equal(await recordWebappSummary(prisma as unknown as PrismaClient, 'classroom-a', []), 0);
  assert.deepEqual(writes, []);
});

test('TTL：课堂永不结束（教师直接关掉浏览器）时内存最终也会被回收', async (t) => {
  // 预审 5：只有「课堂结束释放」是不够的 —— 课堂可以不结束，而 index.ts 是桌面端
  // 长期驻留的进程。这条用例驱动的是**真实的定时器路径**（setupSocketHandlers 里
  // 那个 10 分钟一次的 setInterval → pruneSocketCaches → pruneWebappMonitor）。
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  t.mock.timers.setTime(1_700_000_000_000);
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }] });
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 1, counters: 1, watchers: 0 });

  // 阳性对照一：TTL 之内（推 5 小时 + 一次定时器）不得被清掉 ——
  // 少了这一条，「6 小时 TTL」实现成「10 分钟 TTL」也会让下面那条通过
  t.mock.timers.tick(5 * 60 * 60 * 1000);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 1, counters: 1, watchers: 0 }, 'TTL 之内不许裁剪');

  // 超过 TTL：下一次定时器到点时必须清掉
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, counters: 0, watchers: 0 }, '超过 TTL 必须被回收');

  // 阳性对照二：清掉之后再有新上报，数据要能重新进来（不是「清一次就永久坏了」）
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }] });
  assert.deepEqual(webappMonitorSizes('classroom-a').counters, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// 端到端：课堂结束那条真实路径（POST /:id/end）—— 唯一落盘项 + 内存释放
// ══════════════════════════════════════════════════════════════════════════

/** 结束课堂这条路径用到的 prisma 表面（只实现它真会调到的方法）。 */
function endRoutePrisma() {
  const usageWrites: { data: Record<string, unknown>[] }[] = [];
  const classroomRow = { id: 'classroom-a', status: 'ended' };
  const tx = {
    classroom: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => classroomRow,
    },
  };
  return {
    usageWrites,
    prisma: {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      webappUsage: {
        createMany: async (args: { data: Record<string, unknown>[] }) => { usageWrites.push(args); return { count: args.data.length }; },
      },
    },
  };
}

test('走真实的 POST /:id/end：汇总写了一条，且该课堂的三个 Map 被清空', async (t) => {
  resetMonitor();
  // 1) 先用真实的 socket handler 造出内存数据（教师在看、学生在上报）
  const monitorHarness = createHarness();
  const student = await joinAsStudent(monitorHarness, 'classroom-a');
  const teacher = monitorHarness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,one' });
  await student.call('webapp-event', {
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    events: [{ kind: 'click' }, { kind: 'click' }, { kind: 'input', length: 4 }, { kind: 'scroll', depth: 60 }],
  });
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 1, counters: 1, watchers: 1 }, '前置条件：内存里必须真的有数据，否则这条用例什么都没验证');

  // 2) 起真实的 express 路由，把本模块的真实 drain / record 经 app.set 接进去
  const routePrisma = endRoutePrisma();
  const app = express();
  app.use(express.json());
  app.set('prisma', routePrisma.prisma);
  app.set('io', {
    to: () => ({ emit: () => {} }),
  });
  app.set('webappMonitor', { drain: drainWebappMonitor, record: recordWebappSummary });
  app.use(classroomRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/classroom-a/end`, { method: 'POST' });

  assert.equal(response.status, 200);
  assert.equal(routePrisma.usageWrites.length, 1, '课堂结束必须写**恰好一条**汇总（createMany 调用一次）');
  assert.deepEqual(routePrisma.usageWrites[0].data, [{
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    studentId: PARTICIPANT_ID,
    durationMs: 0,
    clicks: 2,
    inputs: 1,
    maxDepth: 60,
    reports: 0,
    frameCount: 1,
  }]);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, counters: 0, watchers: 0 }, '落盘的同一处必须清空本课堂的三个 Map');
});

test('汇总落盘失败不能让「结束课堂」这个请求失败（课堂已经结束，不可回滚）', async (t) => {
  resetMonitor();
  const monitorHarness = createHarness();
  const student = await joinAsStudent(monitorHarness, 'classroom-a');
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'click' }] });

  const routePrisma = endRoutePrisma();
  const app = express();
  app.use(express.json());
  app.set('prisma', routePrisma.prisma);
  app.set('io', { to: () => ({ emit: () => {} }) });
  app.set('webappMonitor', {
    drain: drainWebappMonitor,
    record: async () => { throw new Error('database is locked'); },
  });
  app.use(classroomRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/classroom-a/end`, { method: 'POST' });

  assert.equal(response.status, 200, '落盘失败必须是「记日志继续」，不是 500');
  // 内存仍然被取走了（drain 在 record 之前）——这是**有意的**：宁可丢汇总，
  // 也不能让一个已结束课堂的内存永远留着。这里把它钉住，免得以后有人「顺手」调换顺序。
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, counters: 0, watchers: 0 });
});

test('没有经 app.set 暴露监控时，结束课堂照常工作（老进程 / 精简环境下的降级）', async (t) => {
  const routePrisma = endRoutePrisma();
  const app = express();
  app.use(express.json());
  app.set('prisma', routePrisma.prisma);
  app.set('io', { to: () => ({ emit: () => {} }) });
  app.use(classroomRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/classroom-a/end`, { method: 'POST' });

  assert.equal(response.status, 200);
  assert.deepEqual(routePrisma.usageWrites, []);
});
