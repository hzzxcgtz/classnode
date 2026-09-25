import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import classroomRoutes from '../routes/classroom.js';
import { captureFieldsFromInput, detailIntervalFor, normalizeCaptureConfig } from '../services/webapp-capture.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';
import {
  createWebappMonitorFacade,
  drainWebappMonitor,
  hasWatchers,
  peekWebappFrame,
  peekWebappPresence,
  recordWebappSummary,
  sanitizeWebappEvent,
  staleTeacherRooms,
  validateWebappDiagPayload,
  validateWebappEventPayload,
  validateWebappFramePayload,
  validateWebappWatchPayload,
  webappMonitorSizes,
  setupSocketHandlers,
} from '../socket/index.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * 这个文件守的是**真实 handler**，不是纯函数 —— 探究空间实时链路的每一个失败模式
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

/**
 * P2.2 之后 `webapp-monitor-demand` 的**完整**载荷（五个字段，一个不少）。
 *
 * 类型写在这里是为了让「载荷长大了」这件事在编译期就撞上：任何一个字段改名/消失，
 * 下面所有用 `demand()` 造期望值的用例都会一起报错，而不是悄悄比少一个字段。
 */
type Demand = {
  watching: boolean;
  detail: boolean;
  captureEnabled: boolean;
  width: number;
  frameIntervalMs: number;
};

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

/**
 * 第二 / 第三个参与者 ID。逐 socket 下发**靠 studentId 认人**（`broadcastWebappDemand`
 * 与 join 时的初值都拿它比对），所以「只影响甲、不影响乙」这类用例必须让两条连接
 * 真的有不同的 studentId —— 否则甲和乙会被折叠成同一个学生。
 */
const PARTICIPANT_2_ID = 'participant-2';
const PARTICIPANT_3_ID = 'participant-3';

function teacherCookie(): string {
  const setCookies: string[] = [];
  const res = { setHeader: (_name: string, value: string) => { setCookies.push(value); } };
  createTeacherSession(res as unknown as Response);
  return setCookies[0].split(';')[0];
}

/**
 * `createHarness` / `socketPrisma` 的覆盖项。
 *
 * `captureEnabled` / `captureWidth` / `captureFrameIntervalMs` 是 P2.2 新增的三列
 * （课堂级采集设置）。默认值 **与生产默认值逐字一致**（开 / 320 / 10000）——
 * 大部分用例不关心它们，但假 prisma 必须**真的把它们返回**，否则生产代码里
 * `normalizeCaptureConfig(await prisma.classroom.findUnique(...))` 拿到的是缺字段的行，
 * 于是「默认值」这件事在这份测试里根本没被走到。
 */
type HarnessOptions = {
  membership?: boolean;
  classroomStatus?: string;
  captureEnabled?: boolean;
  captureWidth?: number;
  captureFrameIntervalMs?: number;
  /** 课堂模式。`advanced` 下网页的权威来源是「每组一份」，课堂级那张表**恒为空**。 */
  mode?: string;
  /** 该参与者所属的组（`ClassroomStudent.groupId`）。 */
  studentGroupId?: string | null;
  /** 本课堂各组的材料行（`ClassroomGroupMaterial`）。 */
  groupWebapps?: { groupId: string; kind: string; targetId: string }[];
  /**
   * 课堂级那一份网页（`ClassroomWebapp`）。不传默认是 `'webapp-1'`（既有用例都按这个 id 上报）；
   * 传 `null` 表示**本课堂课堂级一行都没有** —— 这正是高级模式的真实状态。
   */
  linkedWebappId?: string | null;
};

/**
 * socket 侧用到的 prisma 表面。`membership: false` 让课堂成员复查失败，
 * `linkedWebappId: null` 让「课堂级关联」为空 —— 两者都是归属校验的阴性对照。
 *
 * ⚠️ **本节只模拟单个课堂**：`classroomGroupMaterial.findMany` 认 `where.kind`，
 *    但**不**认 `where.group.classroomId`（没有第二个课堂可区分）。跨课堂隔离由
 *    `group-material-participant-webapp.test.ts` 用真 SQLite 守（那份才是证明）。
 *
 * `classroomId()` 是**可变**的：join-classroom 会拿令牌里的 classroomId 与
 * `classroom.findUnique` 的结果比对，两处不一致就会静默走到 student-auth-error
 * （什么都不发生）—— 所以这里必须能跟着用例里的课堂 id 走。
 */
function socketPrisma(classroomId: () => string, options: HarnessOptions = {}) {
  return {
    classroom: {
      // ⚠️ 这一个 findUnique 有**三个**调用方：生产代码的 broadcastWebappDemand、
      //    join-classroom 的初值分支，以及 `resolveWebappReporter` 里的课堂状态复查
      //    （「已结束的课堂不再收上报」那条判据，它只读 `status`）。
      //    这些字段**一个都不能删** —— join-classroom 拿它们做归属校验。
      findUnique: async () => ({
        id: classroomId(),
        code: '1234',
        status: options.classroomStatus ?? 'active',
        mode: options.mode ?? 'standard',
        allowStudentStop: true,
        classroomAgents: [],
        groups: [],
        webappCaptureEnabled: options.captureEnabled ?? true,
        webappThumbnailWidth: options.captureWidth ?? 320,
        webappFrameIntervalMs: options.captureFrameIntervalMs ?? 10_000,
      }),
    },
    classroomStudent: {
      // ⚠️ 必须**回显 where.id**，不能永远返回 PARTICIPANT_ID：join-classroom 把这里的
      // 返回值写进 `socket.data.studentId`，而那正是逐 socket 下发时用来认人的字段。
      // 固定返回同一个 id 会把「两个不同学生」折叠成同一条连接，于是「只让甲转高频」
      // 的用例无论生产代码对不对都会过（阴性对照整个消失）。
      // `groupId` 是 `resolveParticipantWebappId` 要的那一列（高级模式按组解析）。
      findFirst: async (args?: { where?: { id?: string } }) =>
        (options.membership === false
          ? null
          : { id: args?.where?.id ?? PARTICIPANT_ID, blacklisted: false, groupId: options.studentGroupId ?? null }),
      updateMany: async () => ({ count: 1 }),
    },
    // 组的材料行（`resolveParticipantWebappId` 在高级模式下读这一份）。
    // 与生产代码同形：`where.kind` 真的会过滤 —— 用例若只配了 agent，这里就得回空。
    classroomGroupMaterial: {
      findMany: async (args?: { where?: { kind?: string } }) =>
        (options.groupWebapps ?? []).filter((row) => !args?.where?.kind || row.kind === args.where.kind),
    },
    classroomWebapp: {
      // 与生产代码同形：按 `orderBy: [{createdAt:'asc'},{id:'asc'}]` 取**第一行**的
      // `webappId`（这里是单行，次序对断言没有影响；次序本身由
      // `group-material-participant-webapp.test.ts` 用真 SQLite 与读路径对照）。
      //
      // ⚠️ 这里**同时**模拟旧判据问的那个问题（「(classroomId, webappId) 有没有关联行」）
      //    并**如实回答**：`where.webappId` 对不上就是 `null`，课堂级为空也是 `null`。
      //    少了这份如实，把判定临时改回旧口径那条**反证**就会红在别的理由上
      //    （替身缺字段），而不是红在「高级模式下那张表恒为空」这个真实理由上 ——
      //    反证也就不成立了。多返回的 `id` 是旧代码 `select` 的另一个字段，无害。
      findFirst: async (args?: { where?: { webappId?: string } }) => {
        const linked = options.linkedWebappId === null ? null : (options.linkedWebappId ?? 'webapp-1');
        const asked = args?.where?.webappId;
        if (linked === null) return null;
        if (asked !== undefined && asked !== linked) return null;
        return { id: 'link-1', webappId: linked, classroom: { status: options.classroomStatus ?? 'active' } };
      },
    },
  };
}

/**
 * 一个假 io：`to(room).emit` 记进 emits；`sockets.adapter.rooms` 是**真的会随
 * socket.join / socket.leave 变化**的房间表 —— 按需推流的判据（hasWatchers）读的就是它，
 * 用一份不随 join 变化的假表会让那条断言变成恒真。
 */
function createHarness(options: HarnessOptions = {}) {
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
    /** 与真实 Socket.IO 同效果：把该房间的成员全部踢出去（成员表与 socket.rooms 一起改）。 */
    in() {
      return {
        socketsLeave(target: string) {
          for (const socketId of [...(roomMembers.get(target) ?? [])]) {
            roomMembers.get(target)?.delete(socketId);
            sockets.get(socketId)?.rooms.delete(target);
          }
        },
      };
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

/**
 * 学生身份：走真实的 join-classroom（令牌是真的，verifyStudentToken 会验签）。
 *
 * `studentId` 可选：默认 PARTICIPANT_ID（既有调用点一个都不用改）。需要**两个不同学生**
 * 的用例（逐 socket 下发要按 studentId 区分收件人）才传它。
 */
async function joinAsStudent(
  harness: ReturnType<typeof createHarness>,
  classroomId: string,
  studentId: string = PARTICIPANT_ID,
) {
  harness.setClassroomId(classroomId);
  const student = harness.connect();
  await student.call('join-classroom', {
    classroomCode: '1234',
    studentId,
    token: createStudentToken(classroomId, studentId),
  });
  return student;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * `demand()` —— 需求载荷的**期望值构造器**（下面所有用例都用它）
 *
 * 它存在的**唯一**理由是：P2.2 之后载荷是五个字段，逐条手写会把「这条用例到底在测
 * 什么」淹没在五字段噪音里。
 *
 * 🔴 它**不是**用来放宽比对的。每个用到它的用例仍然把**整份载荷**交给
 * `assert.deepEqual` 逐字段比对；这个助手只是把五个字段**显式列全**（默认值写死在
 * 函数体里，见下）。于是：
 *   - 生产代码少发一个字段 → 期望值里有、实际值里没有 → 红；
 *   - 生产代码多发一个没人审查的字段 → 实际值里有、期望值里没有 → 红；
 *   - 两个字段串味（width 塞进 frameIntervalMs）→ 值对不上 → 红。
 *
 * ⚠️ 因此**不许**把它改写成 `expect.objectContaining` 那种「只挑几个字段比」，
 *    也不许在这里用展开运算把「没提到的字段」糊过去 —— 那正是上述三种失效
 *    再也抓不住的那一刻。`overrides` 只允许逐字段覆盖。
 * ══════════════════════════════════════════════════════════════════════════
 */
function demand(
  watching: boolean,
  detail: boolean,
  overrides: { captureEnabled?: boolean; width?: number; frameIntervalMs?: number } = {},
): Demand {
  return {
    watching,
    detail,
    captureEnabled: overrides.captureEnabled ?? true,
    width: overrides.width ?? 320,
    // ⚠️ 这里是**图墙基准**（生产默认 10000）。detail 档的周期由服务端算成
    //    `max(1000, round(基准/5))`，所以 detail 的用例必须**显式**写出那个数字
    //    （如 `{ frameIntervalMs: 2000 }`），不能在这里用生产公式推 —— 用被测代码
    //    算期望值，等于把公式写错这件事从测试里删掉。
    frameIntervalMs: overrides.frameIntervalMs ?? 10_000,
  };
}

/**
 * 某个学生那条连接收到的全部 demand 载荷。
 *
 * 需求是**逐 socket 下发**的（不是广播到 classroom 房间），所以「收件人」就是
 * `room === socket.id`。⚠️ 过滤出来的可能是空数组 —— 空数组在「不得有 watching:false」
 * 这类断言下**天然为真**，所以每条用到它的用例都另外配了阳性对照（断言确实收到过
 * watching:true 或确实收到过 detail:true），否则整条链路没接上也会绿。
 */
function demandsFor(harness: ReturnType<typeof createHarness>, student: { id: string }): Demand[] {
  return harness.events('webapp-monitor-demand')
    .filter(item => item.room === student.id)
    .map(item => item.payload as Demand);
}

/**
 * 内存态在 socket 模块里是**模块级**的（与 activeStreams / teacherNotificationCache 同款），
 * 所以用例之间共享。每个会写状态的用例开头调一次它。
 *
 * ⚠️ 用的是**生产代码里的 drain**，不是测试专用的后门 —— 于是「drain 能把这个课堂清干净」
 * 这件事被每个用例顺带验证一次；而漏调它只会造成跨用例的**多**数据，
 * 撞上这里那些精确断言（`frames === 0` 之类）会立刻变红，不会变成假绿。
 */
function resetMonitor(): void {
  drainWebappMonitor(NOOP_IO, 'classroom-a');
  drainWebappMonitor(NOOP_IO, 'classroom-b');
}

/**
 * drain 现在还要负责把订阅者踢出房间（裁定 3），所以需要一个 io。
 * 只做内存清理时用这个 noop；「踢房间」本身在专门的用例里用假的真实 io 验。
 */
const NOOP_IO = { in: () => ({ socketsLeave: () => {} }) } as unknown as Server;

/**
 * 让「**定时器回调里**发起的异步广播」跑完（P2.2 之后必需）。
 *
 * ⚠️ `broadcastWebappDemand` 是 async —— 它要读一次课堂配置。于是
 * `t.mock.timers.tick(15_000)` 只把定时器**触发**掉，回调里那次 `await` 之后的
 * `emit` 要等微任务队列排空才发生。不等这一步，断言会在「广播还没发出去」时
 * 读到空数组：**「收到了停推」会变红，而「没收到停推」会假绿** ——
 * 后者正是本文件处处提防的那种失败形态。
 *
 * 用 setImmediate 而不是 `Promise.resolve()`：一次 setImmediate 保证微任务队列
 * **全部**排空，而单个 Promise 只让出一轮。mock timers 只打桩了 setTimeout/setInterval/Date，
 * setImmediate 仍是真实的。
 */
function flushAsyncBroadcast(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// ══════════════════════════════════════════════════════════════════════════
// 纯函数：学生上报载荷的形状校验
//
// ⚠️ 这里曾经有**四条**关于**事件**载荷的用例，随整条事件链路一起删除；P2.2 的 T5
// 按**更窄的契约**（只有 visibility / scroll，四字段、无自由文本）恢复了这条入站路径，
// 于是它们**按新契约重写了**（不是把旧的搬回来）：
//   · 白名单式重建 —— 保留，而且现在**额外断言旧的三项字段进不来**；
//   · 未知 kind 被丢弃 —— 保留，白名单换成了 ['visibility','scroll']；
//   · 自由字符串被截到上界 —— **删掉**：新契约里不再有任何自由字符串
//     （to 是短枚举字面量的白名单判据，不是 slice），没有东西可以截；
//   · 外层形状整条丢弃 —— 保留。
// 有一条**新增**：`to` 与 `depth` 必须与 kind 自洽（visibility 不带深度、
// scroll 不带 to）—— 这是新契约里唯一一处「字段之间有关系」的地方。
//
// 帧的校验（`validateWebappFramePayload`）也还在链路上，用例在下面。
// ══════════════════════════════════════════════════════════════════════════

test('事件载荷是白名单式重建：契约之外的字段进不来，旧的三项尤其进不来', () => {
  // JSON.parse 造出来的 __proto__ 是**真 own 属性**（对象字面量里的 __proto__ 会去改原型，
  // 那不是这里要测的东西）。用来确认重建过程不会顺手把它带进结果或污染原型。
  const hostile = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const sanitized = sanitizeWebappEvent({
    kind: 'visibility',
    to: 'hidden',
    depth: 30,
    at: 1700000000000,
    // 旧契约的三个字段：它们正是「点了哪个元素」「输入框里有多少字符」的载体。
    selector: 'input#answer',
    inputType: 'text',
    length: 12,
    // 客户端硬塞的自由文本与嵌套对象
    value: '学生的真实输入内容',
    nested: { deep: true },
    ...hostile,
  });
  assert.deepEqual(sanitized, {
    kind: 'visibility',
    to: 'hidden',
    // visibility 的 depth 恒为 0 —— 客户端塞进来的 30 被丢掉（见下面那条自洽性用例）
    depth: 0,
    at: 1700000000000,
  });
  assert.equal(Object.keys(sanitized ?? {}).length, 4, '结果必须**恰好**是契约的 4 个字段');
  assert.equal(({} as Record<string, unknown>).polluted, undefined, '不得出现原型污染');
  assert.equal(JSON.stringify(sanitized).includes('学生的真实输入内容'), false);
  assert.equal(JSON.stringify(sanitized).includes('input#answer'), false, 'selector 不得进入结果');
  // 阴性：上面那条「恰好 4 个字段」不能因为 sanitize 返回 null 而空过。
  assert.notEqual(sanitized, null);
});

test('未知 kind 被丢弃（白名单，而不是「不在黑名单里就放行」）', () => {
  // 旧契约里的四个 kind 一个都不许通过 —— 它们是「内容」的载体。
  for (const gone of ['click', 'input', 'navigate', 'report']) {
    assert.equal(sanitizeWebappEvent({ kind: gone, to: 'visible', depth: 0 }), null, `${gone} 不得回来`);
  }
  assert.equal(sanitizeWebappEvent({ kind: 'screenshot', to: 'visible' }), null);
  assert.equal(sanitizeWebappEvent({ kind: '' }), null);
  // 阳性对照：同一形状、只把 kind 换成白名单里的，就必须通过 ——
  // 否则上面那几条在「sanitize 对什么都返回 null」时也成立。
  assert.notEqual(sanitizeWebappEvent({ kind: 'scroll', depth: 10 }), null);
  assert.notEqual(sanitizeWebappEvent({ kind: 'visibility', to: 'visible' }), null);
});

test('to / depth 必须与 kind 自洽：认不出的组合整条丢弃', () => {
  // visibility 的 to 只有两个字面量；别的一律丢弃（不是"兜成 visible"）。
  assert.equal(sanitizeWebappEvent({ kind: 'visibility', to: 'VISIBLE' }), null);
  assert.equal(sanitizeWebappEvent({ kind: 'visibility', to: '' }), null);
  assert.equal(sanitizeWebappEvent({ kind: 'visibility' }), null);
  // visibility 的 depth 恒为 0，客户端说什么都不算。
  const vis = sanitizeWebappEvent({ kind: 'visibility', to: 'visible', depth: 999 });
  assert.equal(vis?.depth, 0);
  // scroll 的 to 恒为空串、depth 被夹到 0…100 的十分位上。
  const scroll = sanitizeWebappEvent({ kind: 'scroll', to: 'visible', depth: 37 });
  assert.equal(scroll?.to, '');
  assert.equal(scroll?.depth, 40, '37 落到最近的十分位');
  assert.equal(sanitizeWebappEvent({ kind: 'scroll', depth: 9999 })?.depth, 100);
  assert.equal(sanitizeWebappEvent({ kind: 'scroll', depth: -5 })?.depth, 0);
  assert.equal(sanitizeWebappEvent({ kind: 'scroll', depth: Number.NaN })?.depth, 0);
  assert.equal(sanitizeWebappEvent({ kind: 'scroll', depth: Number.POSITIVE_INFINITY })?.depth, 0);
  // at 是数字字段，坏值当 0（不是 NaN 进内存）。
  assert.equal(sanitizeWebappEvent({ kind: 'scroll', at: 'x' })?.at, 0);
});

test('外层形状：非数组 / 空数组 / 超量 / 字段缺失都整条丢弃', () => {
  const base = { classroomId: 'classroom-x', webappId: 'webapp-1' };
  assert.equal(validateWebappEventPayload(null), null);
  assert.equal(validateWebappEventPayload({ ...base, events: 'not-an-array' }), null);
  assert.equal(validateWebappEventPayload({ ...base, events: [] }), null);
  assert.equal(validateWebappEventPayload({ classroomId: '', webappId: 'webapp-1', events: [{ kind: 'scroll', depth: 0 }] }), null);
  assert.equal(validateWebappEventPayload({ classroomId: 'classroom-x', events: [{ kind: 'scroll', depth: 0 }] }), null);
  // 51 条 → 超过单条消息的上界（50），整条丢弃而不是截断
  const many = Array.from({ length: 51 }, () => ({ kind: 'scroll', depth: 10 }));
  assert.equal(validateWebappEventPayload({ ...base, events: many }), null);
  // 数组里全是非法事件 ⇒ 过滤后为空 ⇒ 丢弃（不是「返回一个空 events 的载荷」）
  assert.equal(validateWebappEventPayload({ ...base, events: [{ kind: 'click' }] }), null);
  // 阳性对照：合法的一条必须通过，且长度恰好 1
  const ok = validateWebappEventPayload({ ...base, events: [{ kind: 'scroll', depth: 10 }, { kind: 'nope' }] });
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

test('帧载荷是**白名单式重建**：契约之外的字段进不来', () => {
  // ⚠️ 判定的是「重建」，不是「过滤」：客户端塞进来的东西**到不了**校验结果里。
  // （事件载荷那条同款的重建在 `sanitizeWebappEvent`，上面已单独覆盖 ——
  //   两条入站路径**各有一层**，互不代替。）
  const base = { classroomId: 'classroom-x', webappId: 'webapp-1' };
  // JSON.parse 造出来的 __proto__ 是**真 own 属性**（对象字面量里的 __proto__ 会去改原型，
  // 那不是这里要测的东西）。用来确认重建过程不会顺手把它带进结果或污染原型。
  const hostile = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const rebuilt = validateWebappFramePayload({
    ...base,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    // 客户端硬塞的几个字段：事件的形状、一个自由文本、嵌套对象
    events: [{ kind: 'scroll', depth: 10 }],
    value: '学生的答案',
    nested: { deep: true },
    ...hostile,
  });
  assert.ok(rebuilt, '合法的一张帧必须通过 —— 否则下面那两条在「什么都不通过」时也成立');
  assert.deepEqual(rebuilt, {
    classroomId: 'classroom-x',
    webappId: 'webapp-1',
    dataUrl: 'data:image/jpeg;base64,AAAA',
  });
  assert.equal(Object.keys(rebuilt).length, 3, '结果必须**恰好**是契约的 3 个字段');
  assert.equal(({} as Record<string, unknown>).polluted, undefined, '不得出现原型污染');
  assert.equal(JSON.stringify(rebuilt).includes('学生的答案'), false);
});

test('订阅载荷只认非空 classroomId', () => {
  assert.equal(validateWebappWatchPayload({ classroomId: 'c1' }), 'c1');
  assert.equal(validateWebappWatchPayload({ classroomId: '  ' }), null);
  assert.equal(validateWebappWatchPayload(null), null);
  assert.equal(validateWebappWatchPayload(['c1']), null);
});

// ══════════════════════════════════════════════════════════════════════════
// P2.2 采集设置的归一化（`services/webapp-capture.ts`）
//
// 归一化**只发生在服务端**，客户端拿到的永远是已经合法的值。所以这一层是「老师
// 手滑填了 99999」与「学生设备被要求每 100ms 截一张图」之间唯一的那道闸。
// ══════════════════════════════════════════════════════════════════════════

test('normalizeCaptureConfig：越界的宽度与周期被夹进合法范围，范围内的原样保留', () => {
  // 上界 / 下界
  assert.equal(normalizeCaptureConfig({ webappThumbnailWidth: 9999 }).width, 640);
  assert.equal(normalizeCaptureConfig({ webappThumbnailWidth: 10 }).width, 160);
  assert.equal(normalizeCaptureConfig({ webappFrameIntervalMs: 100 }).frameIntervalMs, 5000);
  assert.equal(normalizeCaptureConfig({ webappFrameIntervalMs: 999_999 }).frameIntervalMs, 60_000);
  // 阳性对照：范围内的值必须原样留下 —— 少了这一半，「无论输入什么都返回边界值」
  // 那种实现也会让上面四条通过
  assert.equal(normalizeCaptureConfig({ webappThumbnailWidth: 480 }).width, 480);
  assert.equal(normalizeCaptureConfig({ webappFrameIntervalMs: 20_000 }).frameIntervalMs, 20_000);
  // 刚好落在边界上的两个值也属于「范围内」，不得被推走
  assert.equal(normalizeCaptureConfig({ webappThumbnailWidth: 640 }).width, 640);
  assert.equal(normalizeCaptureConfig({ webappFrameIntervalMs: 5000 }).frameIntervalMs, 5000);
});

test('🔴 normalizeCaptureConfig：认不出就当**开** —— undefined 绝不能变成 enabled:false', () => {
  // 这条钉的是**方向**，不是某个具体数字：`webappCaptureEnabled` 用的是 `!== false`
  // 而不是 `Boolean(...)`。老库加列之前这个字段是 `undefined`，`Boolean(undefined)`
  // 会把「默认开」变成「关」⇒ **所有老课堂静默停止截图**，而且没有任何报错。
  assert.equal(normalizeCaptureConfig({}).enabled, true, '整行缺字段 = 老数据，必须当开');
  assert.equal(normalizeCaptureConfig({ webappCaptureEnabled: undefined }).enabled, true, 'undefined 必须当开');
  assert.equal(normalizeCaptureConfig(null).enabled, true, 'null 整行必须当开');
  assert.equal(normalizeCaptureConfig(undefined).enabled, true);
  // 阳性对照：**显式**的 false 必须真的变成 false（否则上面四条在「enabled 恒真」时也成立）
  assert.equal(normalizeCaptureConfig({ webappCaptureEnabled: false }).enabled, false);
});

test('normalizeCaptureConfig：整行 null / undefined 时返回整份默认值', () => {
  // ★ 2026-09-25：多了 `detailIntervalMs`，默认 **`null`**（= 没调过 ⇒ 按基准派生）。
  const defaults = { enabled: true, width: 320, frameIntervalMs: 10_000, detailIntervalMs: null };
  assert.deepEqual(normalizeCaptureConfig(null), defaults);
  assert.deepEqual(normalizeCaptureConfig(undefined), defaults);
  // 阳性对照：给了一行的（哪怕是空的）走的是另一条分支，但三列同样落到默认值 ——
  // 与上面两条**逐字段相同**，区别只在「有没有那一行」，所以这里把两者放在一起比。
  assert.deepEqual(normalizeCaptureConfig({}), defaults);
});

test('★ 详情档周期：默认**派生**（基准 ÷ 5），教师调过就固定成他那个值', () => {
  // ── 派生那条路（P2.2 的原行为，一个字没改）
  assert.equal(detailIntervalFor(10_000), 2000, '基准 10 秒 ⇒ 详情 2 秒');
  assert.equal(detailIntervalFor(15_000), 3000);
  assert.equal(detailIntervalFor(20_000), 4000);
  assert.equal(detailIntervalFor(30_000), 6000,
    '基准 30 秒 ⇒ 6 秒：**超出 1~5 秒那五档**，所以界面上必须补一档，否则一个选中项都没有');
  // 🔴 下界 2026-09-25 由 2000 降到 1000。依据是**这条档只作用于被聚焦的那一个学生**
  //    （两处下发都判 `focused === studentId`），不是全班 —— 与基准那条 5000 的下界不同。
  assert.equal(detailIntervalFor(5_000), 1000, '基准 5 秒 ⇒ 1000（旧下界 2000 会把它推回去）');
  // ── 覆盖那条路
  assert.equal(detailIntervalFor(30_000, 3000), 3000, '教师调过 ⇒ 覆盖优先，**不再跟随基准**');
  assert.equal(detailIntervalFor(10_000, 1000), 1000);
  // ── 覆盖值同样要夹：库里可能是手改过的行、或上一版写进来的
  assert.equal(detailIntervalFor(10_000, 99), 1000, '低于下界 ⇒ 夹到 1000');
  assert.equal(detailIntervalFor(10_000, 99_999), 5000, '高于上界 ⇒ 夹到 5000');
  // ── 「没调过」的几种形态一律回**派生**，不是回一个固定值
  assert.equal(detailIntervalFor(30_000, null), 6000);
  assert.equal(detailIntervalFor(30_000, undefined), 6000);
  assert.equal(detailIntervalFor(30_000, Number.NaN), 6000);
  assert.equal(detailIntervalFor(30_000, 'abc' as unknown as number), 6000, '垃圾值 = 没调过');
  // 🔴 真正**能碰到下界**的那一条。⚠️ 光写 `detailIntervalFor(5000)` 是碰不到的：
  //    基准的下界就是 5000 ⇒ 5000/5 = 1000 = 新下界，两者恰好相等 ⇒ 把
  //    `Math.max(WEBAPP_DETAIL_MIN_MS, …)` 整句删掉那条断言**照样绿**（假绿）。
  //    要让它真的生效，得给一个**比基准下界还低**的基准 —— 只有手改过的行才有。
  assert.equal(detailIntervalFor(1_000), 1000, '基准 1000（手改过的行）⇒ 200 被抬到下界');
  assert.equal(detailIntervalFor(0), 1000);
});

test('★ 详情档覆盖值：`null` 是**有意义的值**（清掉覆盖），缺字段才是「这次不改」', () => {
  assert.deepEqual(captureFieldsFromInput({ detailIntervalMs: 3000 }), { webappDetailIntervalMs: 3000 });
  assert.deepEqual(captureFieldsFromInput({ detailIntervalMs: 99 }), { webappDetailIntervalMs: 1000 });
  assert.deepEqual(captureFieldsFromInput({ detailIntervalMs: 99_999 }), { webappDetailIntervalMs: 5000 });
  // 🔴 与上面那三列**方向相反**：这里的 `null` 不是「没填」，而是「清掉覆盖、回到跟随基准」。
  //    写成 `isProvidedNumber` 那一套（`null` ⇒ 这次不改）的后果是**这一列永远清不掉** ——
  //    一个只会往一个方向走的设置。
  assert.deepEqual(captureFieldsFromInput({ detailIntervalMs: null }), { webappDetailIntervalMs: null });
  // ⚠️ 而「压根没提这个字段」仍然是**这次不改**；两者不能混。
  assert.deepEqual(captureFieldsFromInput({}), {});
  assert.deepEqual(captureFieldsFromInput({ enabled: true }), { webappCaptureEnabled: true });
  assert.deepEqual(captureFieldsFromInput({ detailIntervalMs: undefined }), {}, 'undefined = 没给');
  assert.deepEqual(captureFieldsFromInput({ detailIntervalMs: 'abc' }), {}, '垃圾值 = 没给，不能落列');
});

test('🔴 老课堂（没有这一列）的详情档必须**跟随基准**，不许被兜成固定 2000', () => {
  // 方向的守卫：`webappDetailIntervalMs` 是**可空**列，`null` / 缺字段都是「没调过」。
  // 写成 `row.webappDetailIntervalMs ?? 2000`（或给列加 `DEFAULT 2000`）会让基准 30 秒的
  // 慢设备课堂从 6 秒被**静默提速到 2 秒** —— 而那正是教师当初把基准调大要避开的事，
  // 且全程没有任何报错。
  assert.equal(normalizeCaptureConfig({}).detailIntervalMs, null);
  assert.equal(normalizeCaptureConfig({ webappDetailIntervalMs: null }).detailIntervalMs, null);
  assert.equal(normalizeCaptureConfig(null).detailIntervalMs, null);
  // 阳性对照：真的写了值就真的读出来（否则上面三条在「恒回 null」时也成立）
  assert.equal(normalizeCaptureConfig({ webappDetailIntervalMs: 3000 }).detailIntervalMs, 3000);
  assert.equal(normalizeCaptureConfig({ webappDetailIntervalMs: 99 }).detailIntervalMs, 1000, '读库也要夹');
});

test('captureFieldsFromInput：只产出**真的提到了**的列，且同样夹范围', () => {
  // {} → 空对象：这次什么都不改。⚠️ 不是「改回默认值」—— 那会把教师没碰过的两列一起重置。
  assert.deepEqual(captureFieldsFromInput({}), {});
  // 只给一列 ⇒ 结果里**只有**那一列
  assert.deepEqual(captureFieldsFromInput({ enabled: false }), { webappCaptureEnabled: false });
  assert.deepEqual(captureFieldsFromInput({ width: 9999 }), { webappThumbnailWidth: 640 });
  assert.deepEqual(captureFieldsFromInput({ width: 10 }), { webappThumbnailWidth: 160 });
  assert.deepEqual(captureFieldsFromInput({ frameIntervalMs: 100 }), { webappFrameIntervalMs: 5000 });
  assert.deepEqual(captureFieldsFromInput({ frameIntervalMs: 999_999 }), { webappFrameIntervalMs: 60_000 });
  // 三列一起给：三列都在，各自合法（且**没有**多余的列）
  assert.deepEqual(captureFieldsFromInput({ enabled: true, width: 480, frameIntervalMs: 20_000 }), {
    webappCaptureEnabled: true,
    webappThumbnailWidth: 480,
    webappFrameIntervalMs: 20_000,
  });
  // 垃圾类型：非布尔的 enabled、非数值的 width/interval 都不落列（不能把 NaN 写进库）
  assert.deepEqual(captureFieldsFromInput({ enabled: 'yes', width: 'abc', frameIntervalMs: 'abc' }), {});
  // 🔴 「没给」的三种形态都必须是**这次不改**，不能落列。
  //    `null` 曾经是**真 bug**：`Number(null)` 是 0（有限），于是 `{"width": null}` 被当成
  //    「给了数值 0」→ 夹到 160 写进库 —— 教师端一个空输入框序列化成 null，
  //    就会把这个课堂的缩略图宽度**悄悄改成最小档**，而界面上看不出任何异常。
  //    同类的还有空字符串（表单常见）。判据见 webapp-capture.ts 的 isProvidedNumber()。
  assert.deepEqual(captureFieldsFromInput({ width: null }), {}, 'null = 这次不改');
  assert.deepEqual(captureFieldsFromInput({ width: '' }), {}, '空字符串 = 这次不改');
  assert.deepEqual(captureFieldsFromInput({ frameIntervalMs: null }), {}, 'null = 这次不改');
  // 阳性对照：真给了数值时**必须**落列 —— 否则上面三条在「这条路整个不工作」时也会过。
  assert.deepEqual(captureFieldsFromInput({ width: '320' }), { webappThumbnailWidth: 320 }, '数字字符串要认');
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

test('同一 tick 连发「加入看板 + 订阅监控」：订阅必须生效，不得回 teacher-auth-error', async () => {
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });

  // ⚠️ **不 await 第一条**：`call` 是 async，但它在第一个 await 之前就**同步调用**了
  // handler（`await handler(payload)` 里 handler 是先被调用的）。所以这两行就是
  // 「同一个 tick 里先后到达两个包」，与服务端 Socket.IO 的同步派发同构
  // （真实 socket.io 服务端 + 真实客户端的实测见 task-7 报告：同一 tick 连发两条时
  //   join-teacher-board 的 handler 已经跑完）。
  const joining = teacher.call('join-teacher-board', 'classroom-a');
  const watching = teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await Promise.all([joining, watching]);

  assert.deepEqual(
    harness.events('teacher-auth-error'), [],
    '同一 tick 连发不得产生任何鉴权错误 —— 这条依赖一旦存在，表现是「图墙一直是空的」且无报错',
  );
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true, '订阅必须真的生效');
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [teacher.id], '必须真的进了监控房间');

  // ── 阴性对照：证明上面不是恒真 ─────────────────────────────────────────
  // 少了这两条，「鉴权整个被删掉」也会让上面全过。两条各挡一个判据：
  //   ① 没有教师 cookie 的连接 → 第 1 条判据（身份）
  //   ② 已经绑在**别的课堂**的教师连接 → 第 2 条判据（课堂归属）
  const anon = harness.connect();
  await anon.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(anon.members('teacher:classroom-a:webapp').includes(anon.id), false, '无教师 cookie 的连接不得进监控房间');

  const elsewhere = harness.connect({ cookie: teacherCookie() });
  await elsewhere.call('join-teacher-board', 'classroom-b');
  await elsewhere.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(elsewhere.members('teacher:classroom-a:webapp').includes(elsewhere.id), false, '绑在别的课堂的连接不得订阅本课堂');

  // 失败**只**发给这两条越权连接，成功那条一条错误都不该收到。
  const errorRooms = harness.events('teacher-auth-error').map(item => item.room).sort();
  assert.deepEqual(errorRooms, [anon.id, elsewhere.id].sort());
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
  const payload = { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' };

  // ── 订阅前
  await student.call('webapp-frame', payload);
  assert.deepEqual(harness.events('webapp-student-frame'), [], '没有教师订阅时不得转发帧');

  // ── 订阅后，**同一份载荷**必须被转发（这一半是必需的：少了它，「整条链路没接上」也会让上面全过）
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await student.call('webapp-frame', payload);

  const frames = harness.events('webapp-student-frame');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].room, 'teacher:classroom-a:webapp', '帧只能进监控房间，不能进 teacher:<id>（那样每个开着看板的教师都会收到）');
  const forwarded = frames[0].payload as { studentId: string; webappId: string; dataUrl: string; at: number };
  assert.equal(forwarded.studentId, PARTICIPANT_ID);
  assert.equal(forwarded.webappId, 'webapp-1');
  assert.equal(forwarded.dataUrl, 'data:image/jpeg;base64,AA');
  // at 由**服务端**盖（学生机器的时间戳不参与），所以这里只断言它的类型。
  // 另外：载荷**恰好**这四项 —— 事件字段（events）一个都不该有。
  assert.deepEqual(Object.keys(forwarded).sort(), ['at', 'dataUrl', 'studentId', 'webappId']);
  assert.equal(typeof forwarded.at, 'number');
});

test('没有教师在看时上报：仍然不转发，但数据照记（课后汇总不因「没人开看板」整块为空）', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), []);
  const frame = peekWebappFrame('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(frame?.dataUrl, 'data:image/jpeg;base64,AA', '帧必须照存：否则教师没开看板的那节课，唯一的落盘汇总会是空的');
  assert.equal(frame?.count, 1, '收到的**总数**也要记（汇总的 frameCount 取它）');

  // 阳性对照：此时再让教师订阅，**已经记下的**数据要能被 drain 出来
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  const rows = drainWebappMonitor(harness.io as unknown as Server, 'classroom-a');
  assert.equal(rows.length, 1, '没人看时记下的数据必须仍然在内存里、能被汇总取到');
  assert.equal(rows[0].frameCount, 1);
});

test('按需推流的判据是「监控房间」而不是「教师看板房间」', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });

  // 只开看板（教师看作业、没点开探究空间视图）⇒ 不算有订阅者
  await teacher.call('join-teacher-board', 'classroom-a');
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.deepEqual(harness.events('webapp-student-frame'), [], '教师只是开着看板不该触发学生推流');

  // 点开探究空间视图 ⇒ 才算
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [teacher.id]);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.equal(harness.events('webapp-student-frame').length, 1);
});

test('学生加入课堂时立刻收到一次当前需求状态（否则「教师先开、学生后进」时图墙永远空着）', async () => {
  resetMonitor();
  // 场景一：没人在看 ⇒ watching:false（此时 detail 必须也是假 —— 「没人看却是高频档」
  // 是客户端最容易照着推导错的一种非法组合）
  const idle = createHarness();
  const idleStudent = await joinAsStudent(idle, 'classroom-a');
  const idleDemand = idle.events('webapp-monitor-demand').filter(item => item.room === idleStudent.id);
  assert.deepEqual(idleDemand.map(item => item.payload), [demand(false, false)]);

  // 场景二：教师已经在看 ⇒ watching:true（阳性对照：否则上一条在「这条消息根本没发」时也过）
  //        但教师没点开任何人的详情 ⇒ detail 仍然是假
  const busy = createHarness();
  const teacher = busy.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-b');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-b' });
  const busyStudent = await joinAsStudent(busy, 'classroom-b');
  const busyDemand = busy.events('webapp-monitor-demand').filter(item => item.room === busyStudent.id);
  assert.deepEqual(busyDemand.map(item => item.payload), [demand(true, false)]);
});

test('教师订阅后，课堂里的学生立刻收到 watching:true（订阅路径必须真的推到学生那条连接）', async () => {
  resetMonitor();
  const harness = createHarness();
  // 先放学生进来：这样「订阅」这一步才是**唯一**能产生第二条 demand 的原因，
  // 订阅路径整条没接上就会立刻变红（若学生后进，订阅期间根本没有收件人，
  // 这条用例就会退化成「学生加入时收到初值」—— 那是上一条已经守过的东西）。
  const student = await joinAsStudent(harness, 'classroom-a');
  assert.deepEqual(demandsFor(harness, student), [demand(false, false)], '前置：订阅之前学生只该收到初值 watching:false');

  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  assert.deepEqual(
    demandsFor(harness, student),
    [demand(false, false), demand(true, false)],
    '订阅必须逐 socket 推到学生那条连接，且 detail 为假（教师还没点开任何人的详情）',
  );
});

test('教师点开某个学生的详情：只有那个学生转高频，其他学生不受影响', async () => {
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  // ⚠️ 顺序：两个学生都在**订阅之后**加入，初值才是 watching:true。
  //    学生若在订阅前加入，初值就是 watching:false —— 那与这里的 detail 无关，
  //    却会让下面「乙不得转高频」的断言被一条无关的 false 混过去。
  const focused = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_2_ID);
  const other = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_3_ID);

  // 前提（阴性对照的地基）：两条连接都**真的**收到了 demand，而且是各自的档位。
  // 少了这一句，「乙的 detail 是假」在「乙根本没收到任何东西」时也会通过。
  assert.deepEqual(demandsFor(harness, focused), [demand(true, false)], '前提：甲收到了初值');
  assert.deepEqual(demandsFor(harness, other), [demand(true, false)], '前提：乙收到了初值');

  await teacher.call('focus-webapp-student', { classroomId: 'classroom-a', studentId: PARTICIPANT_2_ID });

  // ⚠️ 基准是默认的 10000 ⇒ detail 档 = max(1000, round(10000/5)) = 2000。这个数字
  //    **显式写在这里**（不用生产公式推），否则公式改了测试会跟着一起改。
  assert.deepEqual(
    demandsFor(harness, focused),
    [demand(true, false), demand(true, true, { frameIntervalMs: 2000 })],
    '被点开的学生必须转高频',
  );
  assert.deepEqual(
    demandsFor(harness, other),
    [demand(true, false), demand(true, false)],
    '没被点开的学生不得跟着转高频（否则教师点一个人，全班的设备一起烧）',
  );

  // 关掉详情（studentId: null）：甲必须回到 wall 档
  await teacher.call('focus-webapp-student', { classroomId: 'classroom-a', studentId: null });

  assert.deepEqual(
    demandsFor(harness, focused),
    [demand(true, false), demand(true, true, { frameIntervalMs: 2000 }), demand(true, false)],
    '关掉详情之后甲必须回到 wall 档',
  );
  // 乙这边：焦点事件会向房间里**每个学生**重发一次 demand（每个人都得按新焦点重算自己的档位），
  // 所以「只影响甲」指的不是**条数**，而是**档位** —— 乙三次收到的 detail 必须始终为假。
  // 这条断言不空过：乙确有 3 条 demand，且第 2 条正是「教师点开甲」那一下发的。
  assert.deepEqual(
    demandsFor(harness, other),
    [demand(true, false), demand(true, false), demand(true, false)],
    '没被点开的学生不得跟着转高频（否则教师点一个人，全班的设备一起烧）',
  );
});

test('教师先点开详情、学生后加入：那条连接一进来就是高频档（初值必须带上 detail）', async () => {
  // ⚠️ **这条补的是一个实测出来的覆盖空洞**（由实施者的变异测试发现，见
  // task-t3b-tests-report.md 的「变异 B」）：把 join-classroom 里初值的 detail 改成恒
  // false（也就是让这条路径失效），**原来的 41 条用例全绿**。
  //
  // 它守的是「教师先开看板、点开某个学生的详情，然后那个学生才扫码进课堂」这个顺序
  // —— 生产代码 `socket/index.ts` 的 join 分支专门为它写了注释：若只给 watching，
  // 那个学生一进来就是 wall 档，直到教师**重新**点一次详情才会转高频，
  // 而教师根本不知道要再点一次，**两边都不报错**。
  resetMonitor();
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  // 焦点**先于**学生到达。生产代码明写这条路径不能 gate 在「此刻有没有 watcher」上，
  // 所以这里连 watch 都还没发就先发焦点 —— 正是要构造那个顺序。
  await teacher.call('focus-webapp-student', { classroomId: 'classroom-a', studentId: PARTICIPANT_2_ID });
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const student = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_2_ID);

  assert.deepEqual(
    demandsFor(harness, student),
    [demand(true, true, { frameIntervalMs: 2000 })],
    '教师已经点开了他，他一进来就该是 detail 档 —— 恒 false 的实现会在这里红',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// P2.2：课堂级采集设置（要不要采画面 / 多清楚 / 多久一次）真的走到了学生那条连接
//
// 上面那些纯函数用例守的是「归一化算得对」；这里守的是**这三个值真的上了载荷**。
// 两者缺一不可：归一化再对，只要 broadcast 那一步没把它们填进去，教师调完设置
// 也一样什么都不发生 —— 而且**没有任何报错**。
// ══════════════════════════════════════════════════════════════════════════

test('课堂设置里关掉了画面：学生收到的 captureEnabled 是 false（并配阳性对照）', async () => {
  resetMonitor();
  // 阴性侧：本课堂明确不采画面（`classroom.findUnique` 返回 webappCaptureEnabled:false）
  const off = createHarness({ captureEnabled: false });
  const offStudent = await joinAsStudent(off, 'classroom-a');
  assert.deepEqual(demandsFor(off, offStudent), [demand(false, false, { captureEnabled: false })],
    '初值就必须带上 false —— 学生端靠这一条决定要不要开始截图');

  // 订阅那条路径同样要带上 false（不只是 join 的初值那一条）
  const offTeacher = off.connect({ cookie: teacherCookie() });
  await offTeacher.call('join-teacher-board', 'classroom-a');
  await offTeacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.deepEqual(demandsFor(off, offStudent), [
    demand(false, false, { captureEnabled: false }),
    demand(true, false, { captureEnabled: false }),
  ], '订阅时重新下发的档位也必须带 false（否则教师一进视图，画面又回来了）');

  // ── 阳性对照：不覆盖时必须是 true ────────────────────────────────────────
  // 少了它，「false 生效」在「这条路径根本没跑 / 载荷里压根没这个字段」时也会过
  // （`undefined === false` 为假，但那种情况下三条断言里两条会同时失效，
  //   而这里明确要求另一台设备上确实拿到 true）。
  const on = createHarness();
  const onStudent = await joinAsStudent(on, 'classroom-b');
  assert.deepEqual(demandsFor(on, onStudent), [demand(false, false)],
    '默认（未覆盖）必须仍是采集开着');

  // 另外两列也真的走到了学生那条连接，而且**没有串味**：把宽度与周期同时改掉，
  // 载荷里两个数字必须各就各位（把 width 填进 frameIntervalMs 会在这里红）。
  const tuned = createHarness({ captureWidth: 640, captureFrameIntervalMs: 20_000 });
  const tunedStudent = await joinAsStudent(tuned, 'classroom-c');
  assert.deepEqual(
    demandsFor(tuned, tunedStudent),
    [demand(false, false, { width: 640, frameIntervalMs: 20_000 })],
  );
});

test('detail 档的周期是 round(基准/5)（下界 1000），没被点开的学生仍是基准值', async () => {
  resetMonitor();
  // 基准设成 30000 ⇒ detail = max(1000, 6000) = **6000**。两个数字差得够远，
  // 「没跟着变」或「全班一起变」都能一眼看出来。
  const harness = createHarness({ captureFrameIntervalMs: 30_000 });
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  // ⚠️ 顺序：两个学生都在**订阅之后**加入，初值才是 watching:true（同「点开详情」那条的口径）
  const focused = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_2_ID);
  const other = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_3_ID);

  // 前提（阴性对照的地基）：两条连接都**真的**收到了基准档。少了这一句，
  // 「乙没跟着变」在「乙根本没收到任何东西」时也会通过。
  assert.deepEqual(demandsFor(harness, focused), [demand(true, false, { frameIntervalMs: 30_000 })],
    '前提：甲收到了基准档的初值');
  assert.deepEqual(demandsFor(harness, other), [demand(true, false, { frameIntervalMs: 30_000 })],
    '前提：乙收到了基准档的初值');

  await teacher.call('focus-webapp-student', { classroomId: 'classroom-a', studentId: PARTICIPANT_2_ID });

  assert.deepEqual(
    demandsFor(harness, focused),
    [demand(true, false, { frameIntervalMs: 30_000 }), demand(true, true, { frameIntervalMs: 6000 })],
    '被点开的学生必须转成 detail 档的周期（基准的 1/5，这里 30000 → 6000）',
  );
  assert.deepEqual(
    demandsFor(harness, other),
    [demand(true, false, { frameIntervalMs: 30_000 }), demand(true, false, { frameIntervalMs: 30_000 })],
    '没被点开的学生必须仍然是**基准**周期，不许跟着转高频',
  );
});

test('detail 档：基准很密（5000）时就是 1000（下界 2026-09-25 由 2000 降下来）', async () => {
  // ⊘ 2026-09-25（教师要求详情面板可选 1~5 秒）：下界由 **2000 降到 1000**，
  //    所以基准 5000 现在**原样**得到 1000，不再被抬。
  //
  // 🔴 **这条用例不再是那道下界的守卫** —— 降界之后 `5000/5 === 1000 === 下界`，
  //    把 `Math.max(WEBAPP_DETAIL_MIN_MS, …)` 整句删掉它**照样绿**。
  //    真正守那道闸的用例在**单元层**：`detailIntervalFor(1_000) === 1000`
  //    （基准比基准下界还低 ⇒ 只有手改过的行才到得了那条路）。
  //    留着这一条是因为它守的是**另一件事**：基准 5000 时学生端拿到的确实是 1000。
  resetMonitor();
  const harness = createHarness({ captureFrameIntervalMs: 5000 });
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const student = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_2_ID);
  assert.deepEqual(demandsFor(harness, student), [demand(true, false, { frameIntervalMs: 5000 })],
    '前提：学生拿到了基准档 5000（不是 detail 档）');

  await teacher.call('focus-webapp-student', { classroomId: 'classroom-a', studentId: PARTICIPANT_2_ID });

  assert.deepEqual(
    demandsFor(harness, student),
    [demand(true, false, { frameIntervalMs: 5000 }), demand(true, true, { frameIntervalMs: 1000 })],
    '5000/5 = 1000 ⇒ 就是 1000（下界已由 2000 降到 1000）',
  );
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

  // ⚠️ 顺序：学生必须在**订阅之后**加入。需求是逐 socket 下发的，「只有教师、没有学生」
  //    时 filter 出来是空数组 —— 「没有任何 watching:false」会变成恒真的假绿；
  //    而学生若在订阅**之前**加入，那条初值恰好就是 watching:false（与防抖无关），
  //    同样会混进下面的断言里。
  const student = await joinAsStudent(harness, 'classroom-a');
  assert.deepEqual(demandsFor(harness, student), [demand(true, false)],
    '前置：教师已经在看，学生的初值必须是 watching:true（否则下面那条「不得有 false」是空过的）');

  // 刷新开始：视图卸载 ⇒ unwatch
  await teacher.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false, '订阅数确实归零了（否则这条用例什么都没构造出来）');

  // ① 立刻：不得有任何 watching:false
  assert.deepEqual(demandsFor(harness, student).filter(item => item.watching === false), []);

  // ② 抖动期间（1 秒后，仍远小于 15 秒）：仍然不得有
  t.mock.timers.tick(1000);
  assert.deepEqual(demandsFor(harness, student).filter(item => item.watching === false), []);

  // ③ 刷新完成：视图重新挂载 ⇒ watch（这一下必须取消掉那个待触发的定时器）
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), true);

  // ④ 把时间推过 15 秒：那次「停止推流」永远不该出现
  t.mock.timers.tick(60_000);
  // ⚠️ 必须先让定时器回调里那次异步广播跑完，这条断言才**不是空过**：
  //    不 flush 的话，「停止通知确实被取消了」与「广播压根还没发出去」看起来一模一样。
  await flushAsyncBroadcast();
  assert.deepEqual(
    demandsFor(harness, student).filter(item => item.watching === false),
    [],
    '重新订阅之后，之前那次归零的停止通知必须被取消',
  );
  // 阳性对照：这一路确实向学生推了 watching:true（否则「没有任何 watching:false」
  // 可能只是因为 watch 这条路径整个没生效，什么都没发）。两条：学生加入时的初值 + 重新订阅那一次。
  assert.deepEqual(
    demandsFor(harness, student).filter(item => item.watching === true),
    [demand(true, false), demand(true, false)],
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

  // ⚠️ 顺序：学生在订阅之后加入（见上一条的顺序说明）
  const student = await joinAsStudent(harness, 'classroom-a');
  assert.deepEqual(demandsFor(harness, student), [demand(true, false)],
    '前置：X 的学生此刻确实在按需推流（否则下面的「收到停推」无从谈起）');

  await teacher.call('join-teacher-board', 'classroom-b');

  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [], 'X 的监控房间必须退掉');
  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0, '记账也要跟着清');

  t.mock.timers.tick(15_000);
  await flushAsyncBroadcast();
  assert.deepEqual(
    demandsFor(harness, student),
    [demand(true, false), demand(false, false)],
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

  // ⚠️ 顺序：学生在订阅之后加入（见「刷新抖动」那条的顺序说明）
  const student = await joinAsStudent(harness, 'classroom-a');
  assert.deepEqual(demandsFor(harness, student), [demand(true, false)],
    '前置：学生已经收到过一条 watching:true —— 少了它，下面「还没有 false」只是空过');

  await teacher.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });
  t.mock.timers.tick(14_999);
  await flushAsyncBroadcast();
  assert.deepEqual(demandsFor(harness, student).slice(1), [], '14.999 秒时还不该通知');

  t.mock.timers.tick(1);
  await flushAsyncBroadcast();
  assert.deepEqual(demandsFor(harness, student), [
    demand(true, false),
    demand(false, false),
  ]);
});

test('教师连接断开与 unwatch 同路：先摘记账，再走防抖', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  // ⚠️ 顺序：学生在订阅之后加入（见「刷新抖动」那条的顺序说明）
  const student = await joinAsStudent(harness, 'classroom-a');
  assert.deepEqual(demandsFor(harness, student), [demand(true, false)],
    '前置：学生已经收到过一条 watching:true —— 少了它，下面「还没有 false」只是空过');

  await teacher.disconnect();

  assert.equal(hasWatchers(harness.io as unknown as Server, 'classroom-a'), false);
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0, 'watchers 这个账本必须跟着断开清掉，否则它会无界增长');
  assert.deepEqual(demandsFor(harness, student).filter(item => item.watching === false), []);

  t.mock.timers.tick(15_000);
  await flushAsyncBroadcast();
  assert.deepEqual(
    demandsFor(harness, student).filter(item => item.watching === false),
    [demand(false, false)],
  );
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

  await student.call('webapp-frame', { classroomId: 'classroom-b', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), []);
  assert.deepEqual(webappMonitorSizes('classroom-b'), { frames: 0, presence: 0, watchers: 0 });
  // 阳性对照：换成自己的课堂就必须进来
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.equal(harness.events('webapp-student-frame').length, 1);
});

test('学生上报本课堂没关联的 webappId：不转发、不写内存（否则能污染别的网页的统计）', async () => {
  resetMonitor();
  // 课堂级关联的是 `webapp-1`（默认值），学生报的是**另一个**网页 ⇒ 必须被拒。
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-OTHER', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), []);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, presence: 0, watchers: 1 });
  // 阳性对照：同一个 socket 报**有效**的那个网页必须进来 —— 否则上一条在
  // 「上报路径整个坏了」时也成立。
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.equal(harness.events('webapp-student-frame').length, 1);
});

test('课堂级一行都没有（本课堂没配网页）⇒ 帧被拒', async () => {
  resetMonitor();
  const harness = createHarness({ linkedWebappId: null });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), []);
  assert.equal(webappMonitorSizes('classroom-a').frames, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 高级模式：网页的权威来源是「每组一份」，**不是**课堂级关联
//
// 2026-09-23 用户报「探究空间的快照完全不显示」——电脑端与性能良好的 iPad 都一样。
// 根因：归属校验问的是「本课堂的 `ClassroomWebapp` 关联过这个网页吗」，而高级模式下
// **那张表恒为空**（`POST /create-advanced` 刻意不写课堂级行，那个模式下网页的权威
// 来源是「每组一份」）⇒ 学生端每一帧都在这里被拒。学生端一直是好的，它正常上报。
//
// 下面两条是那个形状的正反对照：**同一个处理器、同一份假 prisma 表面**，
// 差别只在「网页配在哪个组名下」。
// ══════════════════════════════════════════════════════════════════════════

test('🔴 高级模式：本组配了网页、课堂级关联为空 ⇒ 帧必须被接收', async () => {
  resetMonitor();
  const harness = createHarness({
    mode: 'advanced',
    studentGroupId: 'group-a',
    linkedWebappId: null,                 // 高级模式下课堂级那张表就是空的
    groupWebapps: [{ groupId: 'group-a', kind: 'webapp', targetId: 'webapp-1' }],
  });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.equal(harness.events('webapp-student-frame').length, 1,
    '本组配了网页 ⇒ 这一帧必须转发给教师看板（线上症状就是这里被拒）');
  assert.equal(webappMonitorSizes('classroom-a').frames, 1,
    '也必须写进内存 —— 那是课后汇总的唯一来源');
});

test('🔴 高级模式：本组没配、别的组配了 ⇒ 帧被拒（不得替别的组上报）', async () => {
  resetMonitor();
  const harness = createHarness({
    mode: 'advanced',
    studentGroupId: 'group-a',
    linkedWebappId: null,
    groupWebapps: [{ groupId: 'group-b', kind: 'webapp', targetId: 'webapp-OTHER' }],
  });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-OTHER', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), [],
    '乙组配的网页不是甲组学生的有效网页 —— 送帧进来会污染另一个网页的统计');
  assert.equal(webappMonitorSizes('classroom-a').frames, 0);
});

test('已被移出课堂的学生（成员复查失败）不能再上报', async () => {
  resetMonitor();
  const harness = createHarness({ membership: false });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), []);
  assert.deepEqual(webappMonitorSizes('classroom-a').frames, 0);
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
  await stranger.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  assert.deepEqual(harness.events('webapp-student-frame'), []);
  assert.deepEqual(webappMonitorSizes('classroom-a').frames, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// 内存模型：帧覆盖（Ruling 8 的有界化）+ 文字档的**当前状态**（P2.2 的 T5）
//
// ⚠️ 这里曾经有**三条**用例守事件的累计计数：`事件是累计计数而不是流水账`
// （120 条事件只占 1 条内存）、`滚动取最大深度、report 单独计数`、
// `输入只记长度不记内容`。P2.2 的 T5 把文字档按**更窄的契约**恢复了（只有
// visibility / scroll，四字段），那三条**按新语义重写**（见下面 `文字档…` 那几条）：
//   · 「不是流水账」—— 保留，而且现在是**更强的**：旧版留的是四个计数、
//     新版留的是**当前状态**（visible / depth / at / switches），键恒为 1 条；
//   · 「滚动取最大深度」—— **语义改了**：现在存的是**当前**深度，不是历史最大值
//     （教师图墙要回答的是「现在滚到哪」，不是「最远滚到哪」）。用例按新语义写；
//   · 「输入只记长度不记内容」—— **删掉**：输入这条通道根本不存在，
//     新契约里连一个能装内容的字段都没有（纯函数用例守着形状）。
// **帧那条一条没少**（见下面这条）。
// ══════════════════════════════════════════════════════════════════════════

test('帧只留最新一帧：连发三帧后内存里仍然只有 1 条，而且是最后一帧', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  for (const tag of ['first', 'second', 'third']) {
    await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: `data:image/jpeg;base64,${tag}` });
  }

  assert.equal(webappMonitorSizes('classroom-a').frames, 1, '三帧之后内存里必须仍然只有 1 条');
  const frame = peekWebappFrame('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(frame?.dataUrl, 'data:image/jpeg;base64,third', '留下的必须是**最后一帧**（覆盖，不是追加也不是保留第一帧）');
  assert.equal(frame?.count, 3, '收到的**总数**记在条目里（内存只留 1 条，数量不丢 —— 汇总的 frameCount 取它）');
  // 非空过自检：上面那条「只有 1 条」与这条 count=3 是**一起**成立的 ——
  // 三帧全都没进来的话 frames 会是 0 而不是 1，frames 变成 3 条的话 count 也不会是 3。
});

test('文字档：120 条事件之后内存里仍然只有 1 条**当前状态**（不是流水账）', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const total = 120;
  for (let i = 0; i < total; i += 1) {
    // 模拟「学生一下滚了好几下」：深度在几个十分位之间来回。
    await student.call('webapp-event', {
      classroomId: 'classroom-a',
      webappId: 'webapp-1',
      events: [{ kind: 'scroll', depth: (i % 11) * 10, at: 1_700_000_000_000 + i }],
    });
  }

  assert.equal(
    webappMonitorSizes('classroom-a').presence, 1,
    '120 条事件之后内存里仍然只有 1 条 —— 存流水账会让它变成 120（规格 §5.5 的硬要求）',
  );
  const presence = peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1');
  // i=119 时 (119 % 11) = 9 ⇒ 最后一条报的是 90。
  assert.equal(presence?.depth, 90, '深度是**最后一条**说的那个（当前深度），不是历史最大值');
  assert.equal(presence?.switches, 0, '一次可见性都没报过 ⇒ 切换次数是 0，不是"没这个字段"');
  // 阳性对照：这 120 条确实**被转发过**（否则上面那些数字可能来自别的东西）
  assert.equal(harness.events('webapp-student-presence').length, total);
  // 转发的是**当前状态**，不是刚收到的那条事件。逐字段比，**不整体 deepEqual**：
  // `at` 是服务端收到的时刻（刻意不用客户端时间戳），那个值在这里不可预测 ——
  // 把它写成期望值等于让这条用例依赖墙上时钟。
  const forwarded = harness.events('webapp-student-presence');
  const last = forwarded[forwarded.length - 1]?.payload as Record<string, unknown>;
  assert.equal(last.studentId, PARTICIPANT_ID);
  assert.equal(last.webappId, 'webapp-1');
  assert.equal(last.visible, false);
  assert.equal(last.depth, 90);
  assert.equal(last.switches, 0);
  assert.equal(typeof last.at, 'number', 'at 必须是数字（服务端时刻）');
  assert.deepEqual(Object.keys(last).sort(), ['at', 'depth', 'studentId', 'switches', 'visible', 'webappId'],
    '转发的形状是**封闭的六项** —— 多一个字段就是多一条没人审查过的通道');
});

test('文字档：可见性状态与切换次数（切走 → 切回 → 再切走 是 3 次）', async () => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const send = (to: string) =>
    student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'visibility', to, at: 1 }] });

  // 加载时那一次 presence：'visible'（初值 visible=false ⇒ 这算第一次切换）
  await send('visible');
  const afterFirst = peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(afterFirst?.visible, true);
  assert.equal(afterFirst?.depth, 0);
  assert.equal(afterFirst?.switches, 1);
  assert.equal(typeof afterFirst?.at, 'number', 'at 是服务端时刻，必须是个数字');
  // ⚠️ 这条断言是**契约**，不是实现细节的快照：它钉住的是「内存里装不下任何页面内容」。
  // 第 5 个字段 `framelessLoggedAt` 是「有文字档却一帧都没有」这条诊断的**已报过**标记，
  // 取值只有「服务端时间戳 / 不存在」两种，**没有 selector / inputType / length 的位置**。
  // ⇒ 实质保证没有被放宽；字段表变了就必须显式改这里，这正是这条断言存在的意义。
  assert.deepEqual(
    Object.keys(afterFirst ?? {}).sort(),
    ['at', 'depth', 'framelessLoggedAt', 'switches', 'visible'],
    '内存里的形状是**封闭的五项** —— 没有 selector / inputType / length 的位置',
  );
  await send('visible');
  assert.equal(peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1')?.switches, 1, '同样的状态再来一次不算切换');
  await send('hidden');
  assert.equal(peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1')?.visible, false);
  await send('visible');
  assert.equal(peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1')?.switches, 3);

  // 一批里同时带 visibility 与 scroll：两者都落到同一条状态上（顺序即语义）
  await student.call('webapp-event', {
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    events: [
      { kind: 'scroll', depth: 20, at: 2 },
      { kind: 'visibility', to: 'hidden', at: 3 },
      { kind: 'scroll', depth: 60, at: 4 },
    ],
  });
  const final = peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1');
  assert.equal(final?.visible, false);
  assert.equal(final?.depth, 60, '同一批里的最后一条 scroll 决定深度');
  assert.equal(webappMonitorSizes('classroom-a').presence, 1, '一批三条也仍然只有 1 条状态');
});

test('🔴 关掉画面的课堂里，文字档**照样**收发（那正是它的用武之地）', async () => {
  // 回归门：谁要是给事件这条路加一道 captureEnabled 闸，这条会红。
  // 服务端**没有**那道闸是刻意的 —— 闸在发送端的 SDK 里，而且它只管帧。
  resetMonitor();
  const harness = createHarness({ captureEnabled: false });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });

  assert.equal(webappMonitorSizes('classroom-a').presence, 1, '关掉画面不得影响文字档的入站');
  assert.equal(harness.events('webapp-student-presence').length, 1, '关掉画面不得影响文字档的转发');
  // 阳性对照：同一份上报在「没有教师在看」时**不转发**（按需推流仍然管着这条路）
  const quiet = createHarness({ captureEnabled: false });
  const quietStudent = await joinAsStudent(quiet, 'classroom-b');
  await quietStudent.call('webapp-event', { classroomId: 'classroom-b', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });
  assert.deepEqual(quiet.events('webapp-student-presence'), [], '没人看时一个字节都不转发（Ruling 9）');
  assert.equal(webappMonitorSizes('classroom-b').presence, 1, '但状态照记 —— 教师打开看板时才有一条现成的可读');
});

test('文字档的归属校验与帧同款：别的课堂 / 没关联的网页 / 没加入课堂一律不收', async () => {
  const events = [{ kind: 'visibility', to: 'visible', at: 1 }];

  // ① 上报**别的课堂**的 classroomId
  resetMonitor();
  const wrongClassroom = createHarness();
  const s1 = await joinAsStudent(wrongClassroom, 'classroom-a');
  const t1 = wrongClassroom.connect({ cookie: teacherCookie() });
  await t1.call('join-teacher-board', 'classroom-a');
  await t1.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await s1.call('webapp-event', { classroomId: 'classroom-b', webappId: 'webapp-1', events });
  assert.equal(webappMonitorSizes('classroom-b').presence, 0, '别的课堂一个字都不该进内存');
  assert.deepEqual(wrongClassroom.events('webapp-student-presence'), []);

  // ② 上报本课堂**没有网页**时的任意 webappId（假 prisma 的 linkedWebappId:null 就是这个意思）
  const unlinked = createHarness({ linkedWebappId: null });
  const s2 = await joinAsStudent(unlinked, 'classroom-a');
  const t2 = unlinked.connect({ cookie: teacherCookie() });
  await t2.call('join-teacher-board', 'classroom-a');
  await t2.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await s2.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-OTHER', events });
  assert.equal(webappMonitorSizes('classroom-a').presence, 0, '没关联的网页不该被写进来（否则能污染别的网页的状态）');
  assert.deepEqual(unlinked.events('webapp-student-presence'), []);

  // ③ 没走 join-classroom 的连接（不在 classroom:<id> 房间里）
  const strangerHarness = createHarness();
  await joinAsStudent(strangerHarness, 'classroom-a');
  const stranger = strangerHarness.connect();
  stranger.socket.data.classroomId = 'classroom-a';
  stranger.socket.data.studentId = PARTICIPANT_ID;
  await stranger.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events });
  assert.equal(webappMonitorSizes('classroom-a').presence, 0, '没加入课堂的连接不该被采信');

  // 阳性对照：同样的一条上报在**合法**的连接上必须收下 ——
  // 否则上面三条在「事件路径整个坏了」时也成立。
  resetMonitor();
  const ok = createHarness();
  const student = await joinAsStudent(ok, 'classroom-a');
  const teacher = ok.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events });
  assert.equal(webappMonitorSizes('classroom-a').presence, 1);
  assert.equal(ok.events('webapp-student-presence').length, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// drain：取走数据 + 清空三个 Map（规格 §5.5「课堂结束释放」）
// ══════════════════════════════════════════════════════════════════════════

test('drain 每个参与者一行、时长按首帧→末帧算，并清空本课堂的三个 Map', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.timers.setTime(1_700_000_000_000);
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  // ⚠️ 第二个参与者（不是同一个人报第二个网页）。
  //    这条用例从前是「同一个学生报 webapp-1 与 webapp-2」—— 那是**旧口径**下才成立的：
  //    归属校验问的是「本课堂关联过这个网页吗」，而假 prisma 会替那一问放行任意 webappId。
  //    2026-09-23 起校验问的是「**这是你自己的**网页吗」（一个参与者只有一个有效网页），
  //    所以「同一个学生报两个网页」在生产里已经是**被拒**的形状，用例照旧写就是自欺。
  //    改成两个参与者后，这条用例真正守的东西（一行一个参与者、单帧时长退化 0、
  //    行的形状恰好四项、drain 只清自己那个课堂）一条都没少。
  const second = await joinAsStudent(harness, 'classroom-a', PARTICIPANT_2_ID);
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,one' });
  t.mock.timers.tick(60_000);
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,two' });
  // 第二个参与者：只**发过一帧**。他同样必须成行，而且时长退化成 0（首帧=末帧）。
  await second.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,three' });

  const rows = drainWebappMonitor(harness.io as unknown as Server, 'classroom-a');

  assert.equal(rows.length, 2);
  const first = rows.find(row => row.studentId === PARTICIPANT_ID);
  assert.deepEqual(first, {
    studentId: PARTICIPANT_ID,
    webappId: 'webapp-1',
    durationMs: 60_000,
    frameCount: 2,
  });
  const secondRow = rows.find(row => row.studentId === PARTICIPANT_2_ID);
  assert.deepEqual(secondRow, {
    studentId: PARTICIPANT_2_ID,
    webappId: 'webapp-1',
    durationMs: 0,
    frameCount: 1,
  });
  // 行的形状**恰好**这四项 —— 操作行为的四个计数（clicks / inputs / maxDepth / reports）
  // 不再产出。这一条写死，免得它们悄悄回来。
  // ⚠️ 文字档恢复之后这里**仍然**是四项：文字档存的是"此刻的状态"（可见性 / 深度），
  //    它不是一项可以汇总的课外统计 —— 见 drainWebappMonitor 里那段注释。
  assert.deepEqual(Object.keys(first ?? {}).sort(), ['durationMs', 'frameCount', 'studentId', 'webappId']);

  // 三个 Map 都被清空（本课堂的部分）
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, presence: 0, watchers: 0 });
  assert.deepEqual(drainWebappMonitor(harness.io as unknown as Server, 'classroom-a'), [], '再 drain 一次必须什么都没有（已经取走了）');

  // 别的课堂的数据一条都不能被顺手带走
  const other = createHarness();
  const otherStudent = await joinAsStudent(other, 'classroom-b');
  await otherStudent.call('webapp-frame', { classroomId: 'classroom-b', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.deepEqual(webappMonitorSizes('classroom-b').frames, 1);
  assert.deepEqual(drainWebappMonitor(harness.io as unknown as Server, 'classroom-a'), []);
  assert.equal(webappMonitorSizes('classroom-b').frames, 1, 'drain 只能清自己那个课堂');
});

test('drain 也清空文字档的当前状态，而且同样只清自己那个课堂', async () => {
  // ⚠️ 这条**必须是独立的一条**：上面那条 drain 用例里一个字的事件都没发过，
  // 于是它对 presence 的 `presence: 0` 断言是**空过**的（0 是因为从来没有过，
  // 不是因为被清掉了）。这条先把状态建起来，再 drain。
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const other = createHarness();
  const otherStudent = await joinAsStudent(other, 'classroom-b');

  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });
  await otherStudent.call('webapp-event', { classroomId: 'classroom-b', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });
  // 前置条件：两边都真的有状态，否则下面两条断言在「事件路径整个坏了」时也成立
  assert.equal(webappMonitorSizes('classroom-a').presence, 1);
  assert.equal(webappMonitorSizes('classroom-b').presence, 1);

  drainWebappMonitor(harness.io as unknown as Server, 'classroom-a');

  assert.equal(webappMonitorSizes('classroom-a').presence, 0, 'drain 必须把文字档的当前状态一起释放');
  assert.equal(peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1'), null);
  assert.equal(webappMonitorSizes('classroom-b').presence, 1, 'drain 只能清自己那个课堂（整本 clear 会抹掉别的课堂）');
  assert.notEqual(peekWebappPresence('classroom-b', PARTICIPANT_ID, 'webapp-1'), null);
});

test('drain 会取消待触发的停止推流定时器（不给已结束的课堂广播）', async (t) => {
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await teacher.call('unwatch-webapp-monitor', { classroomId: 'classroom-a' });

  drainWebappMonitor(harness.io as unknown as Server, 'classroom-a');
  t.mock.timers.tick(60_000);

  assert.deepEqual(
    harness.events('webapp-monitor-demand').filter(item => item.payload && (item.payload as { watching: boolean }).watching === false),
    [],
  );
});

/**
 * recordWebappSummary 的假 prisma：必须实现**数组形式**的 $transaction
 * （生产代码用的是 `prisma.$transaction([deleteMany, createMany])` —— 原子替换）。
 * 把「删了什么 / 写了什么 / 几个操作在一个事务里」都记下来。
 */
function summaryPrisma() {
  const deletes: { where: unknown }[] = [];
  const writes: { data: Record<string, unknown>[] }[] = [];
  const batches: number[] = [];
  const prisma = {
    $transaction: async (operations: Promise<unknown>[]) => {
      batches.push(operations.length);
      return Promise.all(operations);
    },
    webappUsage: {
      deleteMany: async (args: { where: unknown }) => { deletes.push(args); return { count: 0 }; },
      createMany: async (args: { data: Record<string, unknown>[] }) => { writes.push(args); return { count: args.data.length }; },
    },
  };
  return { prisma, deletes, writes, batches };
}

test('recordWebappSummary 落盘：在同一事务里「先删该课堂的旧汇总、再写新的」', async () => {
  const { prisma, deletes, writes, batches } = summaryPrisma();
  const rows = [
    { studentId: 'p1', webappId: 'w1', durationMs: 1000, frameCount: 3 },
    { studentId: 'p2', webappId: 'w1', durationMs: 0, frameCount: 0 },
  ];

  const written = await recordWebappSummary(prisma as unknown as PrismaClient, 'classroom-a', rows);

  assert.equal(written, 2);
  // 删除的是**这个课堂**的全部旧汇总（不是按学生逐条删，退课的学生才不会留下残行）
  assert.deepEqual(deletes, [{ where: { classroomId: 'classroom-a' } }]);
  // ⚠️ 写下去**恰好这五列**：clicks / inputs / maxDepth / reports 不再产出，
  // 落库时走它们在 schema 上的 @default(0)（表结构一行没改，也没有 db push）。
  assert.deepEqual(writes, [{
    data: [
      { classroomId: 'classroom-a', webappId: 'w1', studentId: 'p1', durationMs: 1000, frameCount: 3 },
      { classroomId: 'classroom-a', webappId: 'w1', studentId: 'p2', durationMs: 0, frameCount: 0 },
    ],
  }]);
  // 两件事必须在**同一个** $transaction 里（否则删完失败就把旧数据丢了）
  assert.deepEqual(batches, [2], '删 + 写必须在同一个事务里');
});

test('recordWebappSummary 的替换语义：第二次结束是替换而不是追加（撞唯一键会让整批失败）', async () => {
  const { prisma, deletes, writes } = summaryPrisma();
  const firstClass = [
    { studentId: 'p1', webappId: 'w1', durationMs: 100, frameCount: 1 },
    { studentId: 'p2', webappId: 'w1', durationMs: 100, frameCount: 1 },
  ];
  const secondClass = [
    { studentId: 'p1', webappId: 'w1', durationMs: 999, frameCount: 42 },
  ];

  await recordWebappSummary(prisma as unknown as PrismaClient, 'classroom-a', firstClass);
  await recordWebappSummary(prisma as unknown as PrismaClient, 'classroom-a', secondClass);

  // 每次写入前都先删掉该课堂的旧行 ⇒ 第二次不会撞 @@unique([classroomId, studentId, webappId])
  assert.deepEqual(deletes, [{ where: { classroomId: 'classroom-a' } }, { where: { classroomId: 'classroom-a' } }]);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].data, [{
    classroomId: 'classroom-a', webappId: 'w1', studentId: 'p1',
    durationMs: 999, frameCount: 42,
  }], '第二节课写下去的必须是第二节课的数值');
  // 第二节课里 p2 没上报 ⇒ 它上一节课的行必须被删掉（替换语义，不是叠加）
  assert.equal(writes[1].data.length, 1);
});

test('recordWebappSummary：空 drain 既不写也不删（成因不可区分时的保守方向）', async () => {
  const { prisma, deletes, writes, batches } = summaryPrisma();

  assert.equal(await recordWebappSummary(prisma as unknown as PrismaClient, 'classroom-a', []), 0);
  assert.deepEqual(writes, []);
  assert.deepEqual(deletes, [], '空 drain 可能是「没人打开看板」而不是「没人用」，不能据此删掉上一节课的真实汇总');
  assert.deepEqual(batches, [], '空 drain 不该开事务');
});

test('drain 之后「结束即释放」是终态：订阅者被踢出房间，hasWatchers 为假', async () => {
  // 审查者在真实适配器上实测：drain 只清了记账 Map，没踢人 ⇒ webapp 房间 size 仍是 1
  // ⇒ hasWatchers 为真 ⇒ 教师那块图墙继续收一个**已经结束**的课堂的数据。
  resetMonitor();
  const harness = createHarness();
  const io = harness.io as unknown as Server;
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.equal(hasWatchers(io, 'classroom-a'), true);
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), [teacher.id]);

  drainWebappMonitor(io, 'classroom-a');

  assert.equal(hasWatchers(io, 'classroom-a'), false, '只清记账不踢人 ⇒ 房间还在，hasWatchers 仍然为真');
  assert.deepEqual(teacher.members('teacher:classroom-a:webapp'), []);
  assert.equal(teacher.socket.rooms.has('teacher:classroom-a:webapp'), false, 'socket 自己也必须真的离开房间');
  assert.equal(webappMonitorSizes('classroom-a').watchers, 0);
  // 阳性对照：踢的只是**监控**房间 —— 教师还在课堂看板房间里，别把看板也踢了
  assert.equal(teacher.socket.rooms.has('teacher:classroom-a'), true);
});

test('课堂已结束后，学生再上报既不转发也不重新占内存（否则 drain 白做）', async () => {
  // 学生这条连接是在课堂结束**之前**建立的（join-classroom 只挡新连接），
  // 所以「结束之后还没跳走的学生继续上报」是真实存在的路径。
  resetMonitor();
  const harness = createHarness({ classroomStatus: 'ended' });
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });

  assert.deepEqual(harness.events('webapp-student-frame'), [], '已结束的课堂不该再有转发');
  assert.deepEqual(harness.events('webapp-student-presence'), [], '文字档同样不该再有转发');
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, presence: 0, watchers: 1 },
    '内存不能在这里重新长回来 —— 那些数据要等 6 小时 TTL 或下一次 drain 才释放');

  // 阳性对照：**同样的上报**在一个 active 的课堂里必须被收下（否则上一条在
  // 「上报路径整个坏了」时也成立）
  const active = createHarness({ classroomStatus: 'active' });
  const activeStudent = await joinAsStudent(active, 'classroom-b');
  await activeStudent.call('webapp-frame', { classroomId: 'classroom-b', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  await activeStudent.call('webapp-event', { classroomId: 'classroom-b', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });
  assert.deepEqual(webappMonitorSizes('classroom-b'), { frames: 1, presence: 1, watchers: 0 });
});

test('TTL：课堂永不结束（教师直接关掉浏览器）时内存最终也会被回收', async (t) => {
  // 预审 5：只有「课堂结束释放」是不够的 —— 课堂可以不结束，而 index.ts 是桌面端
  // 长期驻留的进程。这条用例驱动的是**真实的定时器路径**（setupSocketHandlers 里
  // 那个 10 分钟一次的 setInterval → pruneSocketCaches → pruneWebappMonitor）。
  resetMonitor();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  t.mock.timers.setTime(1_700_000_000_000);
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  // 文字档也留一条：TTL 必须把**三个 Map** 都回收，不能只顾着帧那本。
  await student.call('webapp-event', { classroomId: 'classroom-a', webappId: 'webapp-1', events: [{ kind: 'visibility', to: 'visible', at: 1 }] });
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 1, presence: 1, watchers: 0 });

  // 阳性对照一：TTL 之内（推 5 小时 + 一次定时器）不得被清掉 ——
  // 少了这一条，「6 小时 TTL」实现成「10 分钟 TTL」也会让下面那条通过
  t.mock.timers.tick(5 * 60 * 60 * 1000);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 1, presence: 1, watchers: 0 }, 'TTL 之内不许裁剪');

  // 超过 TTL：下一次定时器到点时必须清掉
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, presence: 0, watchers: 0 }, '超过 TTL 必须被回收');

  // 阳性对照二：清掉之后再有新上报，数据要能重新进来（不是「清一次就永久坏了」）
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });
  assert.deepEqual(webappMonitorSizes('classroom-a').frames, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// 端到端：课堂结束那条真实路径（POST /:id/end）—— 唯一落盘项 + 内存释放
// ══════════════════════════════════════════════════════════════════════════

/**
 * 结束课堂这条路径用到的 prisma 表面（只实现它真会调到的方法）。
 *
 * ⚠️ `$transaction` 有两种形态，**都要实现**：路由自己的状态流转用的是回调形式
 * （`$transaction(async tx => …)`），而 recordWebappSummary 用的是数组形式
 * （`$transaction([deleteMany, createMany])`）。只实现一种，另一条路会静默走到
 * 「不是函数」的 TypeError 上。
 */
function endRoutePrisma() {
  const usageWrites: { data: Record<string, unknown>[] }[] = [];
  const usageDeletes: { where: unknown }[] = [];
  const classroomRow = { id: 'classroom-a', status: 'ended' };
  const tx = {
    classroom: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => classroomRow,
    },
  };
  return {
    usageWrites,
    usageDeletes,
    prisma: {
      $transaction: async (input: unknown) => {
        if (typeof input === 'function') return (input as (client: typeof tx) => Promise<unknown>)(tx);
        return Promise.all(input as Promise<unknown>[]);
      },
      webappUsage: {
        deleteMany: async (args: { where: unknown }) => { usageDeletes.push(args); return { count: 0 }; },
        createMany: async (args: { data: Record<string, unknown>[] }) => { usageWrites.push(args); return { count: args.data.length }; },
      },
    },
  };
}

test('走真实的 POST /:id/end：汇总写了一条，且该课堂的三个 Map 被清空', async (t) => {
  resetMonitor();
  // 1) 先用真实的 socket handler 造出内存数据（教师在看、学生在推帧）
  const monitorHarness = createHarness();
  const student = await joinAsStudent(monitorHarness, 'classroom-a');
  const teacher = monitorHarness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,one' });
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 1, presence: 0, watchers: 1 }, '前置条件：内存里必须真的有数据，否则这条用例什么都没验证');

  // 2) 起真实的 express 路由，把本模块的真实 drain / record 经 app.set 接进去
  const routePrisma = endRoutePrisma();
  const app = express();
  app.use(express.json());
  app.set('prisma', routePrisma.prisma);
  app.set('io', {
    to: () => ({ emit: () => {} }),
  });
  // 用生产代码的**同一个工厂**（把 io 绑在 drain 上），不要在这里手拼闭包
  app.set('webappMonitor', createWebappMonitorFacade(monitorHarness.io as unknown as Server));
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
    frameCount: 1,
  }]);
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, presence: 0, watchers: 0 }, '落盘的同一处必须清空本课堂的三个 Map');
});

test('汇总落盘失败不能让「结束课堂」这个请求失败（课堂已经结束，不可回滚）', async (t) => {
  resetMonitor();
  const monitorHarness = createHarness();
  const student = await joinAsStudent(monitorHarness, 'classroom-a');
  await student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AA' });

  const routePrisma = endRoutePrisma();
  const app = express();
  app.use(express.json());
  app.set('prisma', routePrisma.prisma);
  app.set('io', { to: () => ({ emit: () => {} }) });
  app.set('webappMonitor', {
    ...createWebappMonitorFacade(monitorHarness.io as unknown as Server),
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
  assert.deepEqual(webappMonitorSizes('classroom-a'), { frames: 0, presence: 0, watchers: 0 });
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

// ---------------------------------------------------------------------------
// `webapp-frameless` 诊断
//
// 背景：老 iPad 上报「教师端只看得到浏览位置、看不到图片」。这种形状此前**一个字都不说**
// —— 失败只写进 iframe 的 console，而 iPad 上没有开发者工具，于是只能靠猜。
// 这条告警把「学生报了文字档却一帧都没有」变成服务端日志里的一行。
//
// ⚠️ 这两条用例必须成对存在：只测「会出现」证明不了它**没有**在正常情形下乱报，
// 而一条总在响的告警等于没有告警。
// ---------------------------------------------------------------------------

/**
 * 临时接管 `console.warn` 与 `console.log`，收集一段时间内的行。
 *
 * ⚠️ **两者都要收**：诊断行的级别本身是有语义的 —— `webapp-frameless` 是「出问题了」
 * 所以走 `warn`，`webapp-frame-first` 是「成功了」所以走 `log`。只截获其中一种，
 * 会让「实现用了另一个级别」表现成「这条日志没打出来」，而那是最容易看错的一类失败。
 */
function captureServerLogs() {
  const lines: string[] = [];
  const originalWarn = console.warn;
  const originalLog = console.log;
  const record = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.warn = record;
  console.log = record;
  return {
    lines,
    restore: () => { console.warn = originalWarn; console.log = originalLog; },
    matching: (needle: string) => lines.filter(line => line.includes(needle)),
  };
}

/**
 * 只数**本用例那个学生**的告警。
 *
 * ⚠️ 不能只按 `webapp-frameless` 这个字符串数：本文件里不少既有用例（别的课堂、别的
 * 学生）同样满足这条告警的条件，它们会落进同一个 console 窗口。按 `needle` 裸数会把
 * 别人的行算成自己的 —— 那种断言在并行或重排之下时绿时红，而失败信息还指不到原因。
 */
function framelessFor(captured: ReturnType<typeof captureServerLogs>, classroomId: string, studentId: string) {
  return captured.matching('webapp-frameless').filter(
    line => line.includes(`classroom=${classroomId}`) && line.includes(`student=${studentId}`),
  );
}

test('🔴 诊断：有文字档却一帧都没有 ⇒ 报一次 webapp-frameless，且**只报一次**', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const captured = captureServerLogs();
  t.after(captured.restore);

  const sendPresence = (to: string, depth: number) => student.call('webapp-event', {
    classroomId: 'classroom-a',
    webappId: 'webapp-1',
    events: [{ kind: 'visibility', to, at: 1 }, { kind: 'scroll', depth, at: 1 }],
  });

  // 三批文字档，一帧都不发。
  await sendPresence('visible', 10);
  await sendPresence('hidden', 20);
  await sendPresence('visible', 30);

  assert.equal(
    framelessFor(captured, 'classroom-a', PARTICIPANT_ID).length,
    1,
    '必须且只报一次 —— 文字档是 ≥400ms 一批的，每批都报就是刷屏，而刷屏等于没有诊断。'
    + `实际收到的行：${JSON.stringify(framelessFor(captured, 'classroom-a', PARTICIPANT_ID))}`,
  );

  // 前置确认：这个学生**确实**有 presence（否则上面那次告警可能来自别的路径）。
  assert.ok(peekWebappPresence('classroom-a', PARTICIPANT_ID, 'webapp-1'), '前置：presence 真的存下来了');
  // 前置确认：这一路真的没有帧（告警的判据成立，不是碰巧）。
  assert.equal(peekWebappFrame('classroom-a', PARTICIPANT_ID, 'webapp-1'), null, '前置：确实一帧都没有');

  // 补一帧之后，这个学生不再是 frameless ⇒ 不该再有新的告警。
  await student.call('webapp-frame', {
    classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AAAA',
  });
  await sendPresence('hidden', 40);
  assert.equal(framelessFor(captured, 'classroom-a', PARTICIPANT_ID).length, 1, '发过帧之后条件已不成立');
});

test('阴性对照：先发过帧的学生，文字档再多也不触发 webapp-frameless', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const captured = captureServerLogs();
  t.after(captured.restore);

  // ⚠️ 顺序是先帧后文字档 —— 这条要证明的正是「有帧就不报」，
  // 反过来的话它可能与第一条用例测到的是同一件事。
  await student.call('webapp-frame', {
    classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AAAA',
  });
  assert.ok(peekWebappFrame('classroom-a', PARTICIPANT_ID, 'webapp-1'), '前置：帧真的存下来了');

  for (const depth of [10, 20, 30]) {
    await student.call('webapp-event', {
      classroomId: 'classroom-a',
      webappId: 'webapp-1',
      events: [{ kind: 'scroll', depth, at: 1 }],
    });
  }

  assert.deepEqual(
    framelessFor(captured, 'classroom-a', PARTICIPANT_ID),
    [],
    '有帧的学生不该触发这条告警 —— 一条总在响的告警等于没有告警',
  );
});

test('诊断：形状不合规的帧不再静默丢弃，而是留下一行**原因**', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const captured = captureServerLogs();
  t.after(captured.restore);

  const sendFrame = (dataUrl: unknown) =>
    student.call('webapp-frame', { classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl });

  // 三种拒因各来一次。它们走的是 `validateWebappFramePayload` 的三条不同分支 ——
  // 这一条用例要证明的是**日志能说出是哪一条**，而不是只证明「被拒了」。
  await sendFrame('not-an-image');                       // 前缀不合规
  await sendFrame(123);                                  // 类型不合规
  await sendFrame('data:image/png;base64,' + 'A'.repeat(40 * 1024)); // 超长

  const lines = captured.matching('webapp-frame 被拒');
  assert.equal(lines.length, 3, `三条不合规的帧各该留一行：${JSON.stringify(lines)}`);
  assert.ok(lines.some(line => line.includes('前缀不是')), `要能看出是前缀问题：${JSON.stringify(lines)}`);
  assert.ok(lines.some(line => line.includes('不是字符串')), `要能看出是类型问题：${JSON.stringify(lines)}`);
  assert.ok(lines.some(line => line.includes('超长')), `要能看出是超长：${JSON.stringify(lines)}`);

  // 阴性对照：合规的帧**一行都不该**产生「被拒」日志 ——
  // 否则上面那三条可能只是「这条路径总在打日志」，而不是真的在区分类别。
  await sendFrame('data:image/jpeg;base64,AAAA');
  assert.equal(captured.matching('webapp-frame 被拒').length, 3, '合规的帧不该被记成"被拒"');
});

test('诊断：先 frameless、后第一帧，两行合起来才讲得出完整故事', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const captured = captureServerLogs();
  t.after(captured.restore);

  const frameFirst = () => captured.matching('webapp-frame-first');
  const sendFrame = () => student.call('webapp-frame', {
    classroomId: 'classroom-a', webappId: 'webapp-1', dataUrl: 'data:image/jpeg;base64,AAAA',
  });

  // 先来一批文字档：此时确实一帧都没有 ⇒ frameless 那条应该响。
  await student.call('webapp-event', {
    classroomId: 'classroom-a', webappId: 'webapp-1',
    events: [{ kind: 'scroll', depth: 10, at: 1 }],
  });
  assert.equal(captured.matching('webapp-frameless').length, 1, '前置：无帧时 frameless 确实报了');
  assert.deepEqual(frameFirst(), [], '前置：此时还没有帧');

  await sendFrame();
  assert.equal(frameFirst().length, 1, `第一帧必须留一行：${JSON.stringify(frameFirst())}`);

  // 只报第一帧：之后每 10 秒一张地报下去就是刷屏。
  await sendFrame();
  await sendFrame();
  assert.equal(frameFirst().length, 1, '后续帧不该再报 —— 这条日志回答的是「有没有成功过」');
  assert.equal(peekWebappFrame('classroom-a', PARTICIPANT_ID, 'webapp-1')?.count, 3, '前置：三帧确实都存下来了');

  // 读日志的配方就长这样：`frameless` + `frame-first` 两条一起看。
  // **只有 frameless、没有 frame-first** 才是一帧都没成功过的确证 ——
  // 单看 frameless 得不出结论（首帧有 0~3s 抖动，告警可能早于被观测的截图档启动）。
});

// ---------------------------------------------------------------------------
// `webapp-diag`（第 5 条通道）
//
// 存在的唯一理由：Safari 在 iOS 上不把跨源 iframe 单列成可检查目标，SDK 在 iframe 里的
// console 日志**结构上取不到**。所以这条通道的**实质保证**是它不能变成内容后门 ——
// 下面这一组断言就是那条保证的执行点。
// ---------------------------------------------------------------------------

test('webapp-diag：只认白名单里的码，其余一律丢', () => {
  const base = { classroomId: 'c1', webappId: 'w1' };

  // 阳性：码表里的都放行，且形状被**重建**成固定四项。
  const ok = validateWebappDiagPayload({ ...base, code: 'empty-canvas', n: 3, w: 20, h: 30 });
  assert.deepEqual(ok, { classroomId: 'c1', webappId: 'w1', code: 'empty-canvas', n: 3, w: 20, h: 30 });

  // 🔴 阴性：不在表里的码一律丢 —— 这条是「白名单」而非「黑名单」的判据。
  assert.equal(validateWebappDiagPayload({ ...base, code: 'made-up' }), null);
  assert.equal(validateWebappDiagPayload({ ...base, code: '' }), null);
  assert.equal(validateWebappDiagPayload({ ...base, code: 42 }), null);

  // 🔴 阴性：**多带的字段不会被转发** —— 「这条通道不能变成内容后门」的执行点。
  const withExtra = validateWebappDiagPayload({
    ...base, code: 'timeout', n: 1,
    // 客户端硬塞的自由文本与嵌套对象（模拟「SDK 被改坏 / 被替换」）
    message: '学生的真实输入内容', nested: { deep: true }, selector: 'input#answer',
  });
  assert.deepEqual(Object.keys(withExtra ?? {}).sort(), ['classroomId', 'code', 'h', 'n', 'w', 'webappId']);
  assert.equal(JSON.stringify(withExtra).includes('学生的真实输入内容'), false, '自由文本绝不能被带出去');

  // 数字一律夹成非负整数：NaN / Infinity / 负数 / 小数都不许原样过。
  const clamped = validateWebappDiagPayload({ ...base, code: 'capture-error', n: Number.NaN, w: -5, h: 12.7 });
  assert.equal(clamped?.n, 0);
  assert.equal(clamped?.w, 0);
  assert.equal(clamped?.h, 13);

  // 形状不合规（非对象 / 缺 id）
  assert.equal(validateWebappDiagPayload(null), null);
  assert.equal(validateWebappDiagPayload([]), null);
  assert.equal(validateWebappDiagPayload({ ...base, classroomId: '', code: 'timeout' }), null);
});

test('webapp-diag：走 socket 到服务端日志（含归属判定，且**不因归属失败而丢**）', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const captured = captureServerLogs();
  t.after(captured.restore);

  const diagLines = () => captured.matching('webapp-diag code=');

  // ① 合法归属：诊断照记，并带上学生 id。
  await student.call('webapp-diag', {
    classroomId: 'classroom-a', webappId: 'webapp-1', code: 'empty-canvas', n: 0, w: 0, h: 0,
  });
  assert.equal(diagLines().length, 1, `合法归属的诊断要记下来：${JSON.stringify(diagLines())}`);
  assert.ok(diagLines()[0].includes('empty-canvas'), diagLines()[0]);
  assert.ok(diagLines()[0].includes(PARTICIPANT_ID), `归属要带上学生 id：${diagLines()[0]}`);

  // ② 🔴 **归属不成立时也必须记**：诊断的价值在于「为什么失败」，而失败很可能正是
  //    归属不通过（重连未重新 join 之类）。若这里也要求是有效学生，
  //    最需要的那一类诊断恰好会被丢掉 —— 这正是这条用例守的东西。
  await student.call('webapp-diag', {
    classroomId: 'classroom-b', webappId: 'webapp-1', code: 'timeout', n: 15000, w: 0, h: 0,
  });
  const afterForeign = diagLines();
  assert.equal(afterForeign.length, 2, `归属不通过的诊断同样要记：${JSON.stringify(afterForeign)}`);
  assert.ok(afterForeign[1].includes('timeout'), afterForeign[1]);
  assert.ok(afterForeign[1].includes('无（'), `要写明归属为何不成立：${afterForeign[1]}`);

  // ③ 阴性对照：形状不合规的一条**不该**留下诊断日志（只留一条形状告警）。
  await student.call('webapp-diag', {
    classroomId: 'classroom-a', webappId: 'webapp-1', code: 'not-a-real-code', n: 0, w: 0, h: 0,
  });
  assert.equal(diagLines().length, 2, '不合规的码不得被记成一条诊断');
  assert.equal(captured.matching('webapp-diag 形状不合规').length, 1, '但要留下一条形状告警');
});



// ---------------------------------------------------------------------------
// 「这个学生的设备拍不出画面」（`dom-tier-gave-up` → 教师端）
//
// 实测背景（2026-09-22）：老 iPad 上的纯 DOM 网页，snapdom 生成的那张 SVG 在 Safari 15
// 上解码不出来 ⇒ 永远没有缩略图。这是**平台限制**，不是待修的 bug（见
// server/vendor/README.md 的「本地补丁」一节）。教师端必须能把它与「等待画面…」分开 ——
// 后者说的是「第一帧还在路上」，会自愈；这条不会。
// ---------------------------------------------------------------------------

test('拍不出画面：dom-tier-gave-up 会**存下来**并推给教师看板', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  await student.call('webapp-diag', {
    classroomId: 'classroom-a', webappId: 'webapp-1', code: 'dom-tier-gave-up', n: 2, w: 0, h: 0,
  });

  const pushed = harness.events('webapp-student-capture-blocked');
  assert.equal(pushed.length, 1, `要推一条给教师：${JSON.stringify(pushed)}`);
  assert.equal((pushed[0].payload as { studentId: string }).studentId, PARTICIPANT_ID);
  assert.equal((pushed[0].payload as { webappId: string }).webappId, 'webapp-1');

  // 阴性对照：**别的**诊断码不得置起这个标记 —— 否则「等待画面…」会被它盖住，
  // 而那正是这两句话要分开的理由。
  await student.call('webapp-diag', {
    classroomId: 'classroom-a', webappId: 'webapp-1', code: 'capture-error', n: 200, w: 100, h: 100,
  });
  assert.equal(harness.events('webapp-student-capture-blocked').length, 1, 'capture-error 不该置这个标记');
});

test('拍不出画面：教师**事后**才订阅也会收到回放（这一条是粘性事件，不是在流的）', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');

  // ① 先发生：学生设备放弃采集，此时**没有**教师在看。
  await student.call('webapp-diag', {
    classroomId: 'classroom-a', webappId: 'webapp-1', code: 'dom-tier-gave-up', n: 2, w: 0, h: 0,
  });
  assert.deepEqual(harness.events('webapp-student-capture-blocked'), [], '前置：此刻还没人订阅，不该有推送');

  // ② 教师随后才打开看板 ⇒ 必须**回放**那条标记。
  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });

  const replayed = harness.events('webapp-student-capture-blocked');
  assert.equal(replayed.length, 1, `教师事后订阅要收到回放：${JSON.stringify(replayed)}`);
  assert.equal((replayed[0].payload as { studentId: string }).studentId, PARTICIPANT_ID);
});

test('拍不出画面：drain 之后不再回放（标记随课堂一起释放）', async (t) => {
  resetMonitor();
  const harness = createHarness();
  const student = await joinAsStudent(harness, 'classroom-a');
  await student.call('webapp-diag', {
    classroomId: 'classroom-a', webappId: 'webapp-1', code: 'dom-tier-gave-up', n: 2, w: 0, h: 0,
  });

  drainWebappMonitor(harness.io as unknown as Server, 'classroom-a');

  const teacher = harness.connect({ cookie: teacherCookie() });
  await teacher.call('join-teacher-board', 'classroom-a');
  await teacher.call('watch-webapp-monitor', { classroomId: 'classroom-a' });
  assert.deepEqual(
    harness.events('webapp-student-capture-blocked'), [],
    'drain 之后那本 Map 里不该还留着这个课堂的键 —— 它是"此刻"的设备状态，课堂结束就没有意义',
  );
});
