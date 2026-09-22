import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import classroomRoutes from '../routes/classroom.js';

/**
 * `POST /:id/webapp-capture`（P2.2）—— 教师按课堂设置「要不要采画面、多清楚、多久一次」。
 *
 * 这个文件走的是**真实路由**（express + 真实 handler），只把 prisma 与 io 换成替身
 * （同 `classroom-module-state-route.test.ts` 的模式）。
 *
 * 守两件事，缺一不可：
 *   1. 越界/垃圾输入被**服务端**夹住 —— 客户端拿到的永远是合法值；
 *   2. 改完**确实重新下发了档位** —— 学生端不会主动来问，它只在收到
 *      `webapp-monitor-demand` 时才换档。少了这一步，教师调完之后要等到下一次
 *      订阅/退订才生效，而那时他很可能已经离开这个视图了 ⇒「设置没生效」且**没有任何报错**。
 */

type Emitted = { room: string; event: string; payload: unknown };

/** 课堂上采集设置那三列（fake prisma 里可变的**一行**）。 */
type CaptureRow = {
  id: string;
  webappCaptureEnabled: unknown;
  webappThumbnailWidth: unknown;
  webappFrameIntervalMs: unknown;
};

/**
 * 假 prisma + 假 io。
 *
 * ⚠️ `findUnique` 与 `update` 共用**同一行可变状态**，这是刻意的：路由改完会立刻调用
 * `broadcastWebappDemand`，而那个函数**会再读一次库**。如果 update 不真的落在那行上，
 * 重新下发出去的还是旧档位 —— 「改完确实重新下发了」那条断言就会退化成恒真。
 */
function createHarness(options: { row?: Partial<CaptureRow> | null; students?: string[] } = {}) {
  const emits: Emitted[] = [];
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  // ⚠️ `const`：这一行**只被赋值一次**。它在 update 里被 `Object.assign` **就地改写**
  //    （改的是对象内容，不是这个绑定），所以 const 与「可变的一行状态」并不矛盾。
  const row: CaptureRow | null = options.row === null
    ? null
    : {
      id: 'classroom-1',
      // 与生产默认值逐字一致
      webappCaptureEnabled: true,
      webappThumbnailWidth: 320,
      webappFrameIntervalMs: 10_000,
      ...(options.row ?? {}),
    };
  const prisma = {
    classroom: {
      findUnique: async () => (row ? { ...row } : null),
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        Object.assign(row as object, args.data);
        return { ...(row as CaptureRow) };
      },
    },
  };

  // 学生 socket：`broadcastWebappDemand` 逐个 socket 发，靠 `socket.data.studentId` 认人，
  // 房间表里 `classroom:<id>` 就是这些 socket。教师端不在这个房间里（也不该收到 demand）。
  const studentIds = options.students ?? ['participant-1', 'participant-2'];
  const sockets = new Map<string, { data: Record<string, unknown>; emit: (event: string, payload?: unknown) => void }>();
  studentIds.forEach((studentId, index) => {
    const id = `student-socket-${index + 1}`;
    sockets.set(id, {
      data: { studentId },
      emit: (event, payload) => { emits.push({ room: id, event, payload }); },
    });
  });
  const rooms = new Map<string, Set<string>>([['classroom:classroom-1', new Set(sockets.keys())]]);

  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', { sockets: { sockets, adapter: { rooms } } });
  app.use('/api/classroom', classroomRoutes);
  return { app, emits, updates, studentRooms: [...sockets.keys()] };
}

async function startServer(
  t: { after: (fn: () => void) => void },
  options: { row?: Partial<CaptureRow> | null; students?: string[] } = {},
) {
  const harness = createHarness(options);
  const server = createServer(harness.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  return {
    ...harness,
    post: (body: unknown) => fetch(`http://127.0.0.1:${port}/api/classroom/classroom-1/webapp-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}

test('越界输入被夹住落库，且改完**确实重新下发**了新档位', async (t) => {
  const h = await startServer(t);
  assert.deepEqual(h.emits, [], '前置：此刻还没有人下发过任何档位（下面那条才不是恒真）');

  const response = await h.post({ width: 9999, frameIntervalMs: 100 });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, width: 640, frameIntervalMs: 5000 });
  // 落库的也得是夹过的值 —— 不能只在响应里夹一下、把 9999 原样写进去
  assert.deepEqual(h.updates, [{
    where: { id: 'classroom-1' },
    data: { webappThumbnailWidth: 640, webappFrameIntervalMs: 5000 },
  }]);
  // 🔴 重新下发：**逐 socket** 发给房间里的每个学生，载荷是五个字段的完整契约
  assert.deepEqual(h.emits, h.studentRooms.map(room => ({
    room,
    event: 'webapp-monitor-demand',
    payload: { watching: false, detail: false, captureEnabled: true, width: 640, frameIntervalMs: 5000 },
  })), '教师改完设置必须立刻重新下发档位 —— 否则「设置没生效」且没有任何报错');
});

test('只改 enabled 时，宽度与周期保持原值，且随新档位一起下发', async (t) => {
  const h = await startServer(t, { row: { webappThumbnailWidth: 480, webappFrameIntervalMs: 20_000 } });

  const response = await h.post({ enabled: false });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, width: 480, frameIntervalMs: 20_000 });
  assert.deepEqual(
    h.updates,
    [{ where: { id: 'classroom-1' }, data: { webappCaptureEnabled: false } }],
    '没提到的两列一个都不许写库 —— 那会把教师没碰过的设置一起重置',
  );
  assert.deepEqual(h.emits.map(item => item.payload), h.studentRooms.map(() => ({
    watching: false, detail: false, captureEnabled: false, width: 480, frameIntervalMs: 20_000,
  })), '关掉画面这件事必须真的走到学生那条连接上');
});

test('没有要改的字段（空 body / 全是垃圾类型）返回 400，且不写库、不下发', async (t) => {
  const h = await startServer(t);

  for (const body of [{}, { width: 'abc' }, { enabled: 'yes', frameIntervalMs: 'abc' }]) {
    const response = await h.post(body);
    assert.equal(response.status, 400, `body=${JSON.stringify(body)} 应当被拒`);
  }

  assert.deepEqual(h.updates, [], '被拒的请求不得写库');
  assert.deepEqual(h.emits, [], '被拒的请求不得下发任何档位');
});

test('课堂不存在返回 404，且不写库、不下发', async (t) => {
  const h = await startServer(t, { row: null });

  const response = await h.post({ width: 480 });

  assert.equal(response.status, 404);
  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.emits, []);
});
