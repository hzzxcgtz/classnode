/**
 * ★ 2026-09-30（教师）：`POST /api/classroom/:id/worksheet-open` —— 逐题开放那条端点。
 *
 * 🔴 为什么要有它（而不只是那个纯函数的用例）：这个端点有**四条会静默做错事**的路：
 *   · 往库里存下**不在这份学习单里**的题 id（教师的标签页停在改题之前）——
 *     库里长出一堆幽灵条目，学生那边少一道题，**没有任何东西报错**；
 *   · 把别的学习单的键覆盖掉（高级模式下有好几份单）；
 *   · 「收回全部」写成空数组而不是删键（两种写法在代码里是同一个分支，但 JSON 会越滚越长）；
 *   · 广播漏掉一个房间（教师端自己那个标签页不刷新、或学生端不生效）。
 * ⇒ 沿用 `classroom-module-state-route.test.ts` 那套**手写 prisma mock**（只实现本端点
 *   会调到的方法，并记下每一次写库与每一次广播）。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import classroomRoutes from '../routes/classroom.js';

/** 收集到的广播调用，用于断言「发给谁、什么事件、什么载荷」。 */
type Emitted = { room: string; event: string; payload: unknown };

/** 一份最小的学习单内容（两道题）—— `flattenAnswerable` 只需要这棵树走得通。 */
const CONTENT = {
  schemaVersion: 1,
  nodes: [
    { id: 'q1', type: 'single-choice', prompt: '第一题', inputMode: 'keyboard', data: {}, children: [] },
    { id: 'q2', type: 'fill-blank', prompt: '第二题', inputMode: 'keyboard', data: {}, children: [] },
  ],
};

function createHarness(options: { classroom: unknown; worksheet?: unknown }) {
  const emits: Emitted[] = [];
  const writes: unknown[] = [];
  const prisma = {
    classroom: {
      findUnique: async () => options.classroom,
      update: async (args: { data: { worksheetOpen?: unknown } }) => {
        writes.push(args);
        return { id: 'c1', worksheetOpen: args.data.worksheetOpen ?? null };
      },
    },
    worksheet: {
      findUnique: async () => options.worksheet ?? null,
    },
  };
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => { emits.push({ room, event, payload }); },
    }),
  });
  app.use(classroomRoutes);
  return { app, emits, writes };
}

async function start(
  t: { after: (fn: () => void) => void },
  options: { classroom: unknown; worksheet?: unknown },
) {
  const harness = createHarness(options);
  const server = createServer(harness.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  return { ...harness, baseUrl: `http://127.0.0.1:${address.port}` };
}

const post = (baseUrl: string, body: unknown) => fetch(`${baseUrl}/c1/worksheet-open`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('🔴 正常一路：写库（整份替换）+ 给两个房间广播（载荷带 worksheetId）', async (t) => {
  const { baseUrl, emits, writes } = await start(t, {
    classroom: { id: 'c1', worksheetOpen: { ws9: ['q9'] } },
    worksheet: { id: 'ws1', content: CONTENT },
  });

  const res = await post(baseUrl, { worksheetId: 'ws1', questionIds: ['q1', 'q2'] });
  assert.equal(res.status, 200);
  const body = await res.json() as { worksheetOpen: Record<string, string[]> };
  assert.deepEqual(body.worksheetOpen, { ws9: ['q9'], ws1: ['q1', 'q2'] }, '别的单的键必须原样留着');
  assert.equal(writes.length, 1, '只写一次库');

  assert.deepEqual(emits.map(e => e.room).sort(), ['classroom:c1', 'teacher:c1'], '两个房间都要通知');
  assert.deepEqual(emits.map(e => e.event), ['worksheet-open-changed', 'worksheet-open-changed']);
  // 🔴 载荷必须带 `worksheetId`：高级模式下有好几份单，收到广播的人得知道是哪一份变了。
  assert.deepEqual(emits[0].payload, { worksheetId: 'ws1', questionIds: ['q1', 'q2'] });
});

test('🔴 「收回全部」= 写空数组 ⇒ 那个键整个消失（不是留一个空数组）', async (t) => {
  const { baseUrl, writes } = await start(t, {
    classroom: { id: 'c1', worksheetOpen: { ws1: ['q1'], ws9: ['q9'] } },
    worksheet: { id: 'ws1', content: CONTENT },
  });

  const res = await post(baseUrl, { worksheetId: 'ws1', questionIds: [] });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json() as { worksheetOpen: unknown }).worksheetOpen, { ws9: ['q9'] });
  assert.deepEqual((writes[0] as { data: unknown }).data, { worksheetOpen: { ws9: ['q9'] } });
});

test('🔴 题 id 不在这份学习单里 ⇒ 400，而且**不写库、不广播**', async (t) => {
  // 教师的标签页停在改题之前时会走到这里。存下去不会报错，只会让学生那边莫名少一道题。
  const { baseUrl, emits, writes } = await start(t, {
    classroom: { id: 'c1', worksheetOpen: null },
    worksheet: { id: 'ws1', content: CONTENT },
  });

  const res = await post(baseUrl, { worksheetId: 'ws1', questionIds: ['q1', 'q_已经删了'] });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /不在这份学习单里/);
  assert.equal(writes.length, 0, '一个字节都不许写');
  assert.equal(emits.length, 0, '也不许广播');
});

test('🔴 课堂 / 学习单不存在：分别 404，都不写库、不广播', async (t) => {
  const missingClassroom = await start(t, { classroom: null, worksheet: { id: 'ws1', content: CONTENT } });
  const r1 = await post(missingClassroom.baseUrl, { worksheetId: 'ws1', questionIds: [] });
  assert.equal(r1.status, 404);
  assert.equal(missingClassroom.writes.length + missingClassroom.emits.length, 0);

  const missingWorksheet = await start(t, { classroom: { id: 'c1', worksheetOpen: null } });
  const r2 = await post(missingWorksheet.baseUrl, { worksheetId: 'ws1', questionIds: [] });
  assert.equal(r2.status, 404);
  assert.equal(missingWorksheet.writes.length + missingWorksheet.emits.length, 0);
});

test('🔴 坏入参（缺 worksheetId / questionIds 不是数组）⇒ 400，不写库', async (t) => {
  const { baseUrl, writes, emits } = await start(t, {
    classroom: { id: 'c1', worksheetOpen: null },
    worksheet: { id: 'ws1', content: CONTENT },
  });

  for (const body of [{ questionIds: [] }, { worksheetId: 'ws1' }, { worksheetId: 'ws1', questionIds: 'q1' }]) {
    const res = await post(baseUrl, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(writes.length, 0);
  assert.equal(emits.length, 0);
});

test('⚠️ 幂等：同一份清单发两次，两次都写、都广播（一次多余的广播是自愈，不是噪音）', async (t) => {
  const { baseUrl, emits, writes } = await start(t, {
    classroom: { id: 'c1', worksheetOpen: { ws1: ['q1'] } },
    worksheet: { id: 'ws1', content: CONTENT },
  });

  const first = await post(baseUrl, { worksheetId: 'ws1', questionIds: ['q1'] });
  const second = await post(baseUrl, { worksheetId: 'ws1', questionIds: ['q1'] });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(writes.length, 2, '两次都写（客户端重连/重试不该被当成异常）');
  assert.equal(emits.length, 4);
});
