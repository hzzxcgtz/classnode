import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { worksheetRoutes } from '../routes/worksheets.js';

/**
 * ★ 2026-09-30（教师）：「学习单的管理列表中，**不要按最近修改过的顺序排**，
 * 就按**创建**的顺序排，最晚创建的排在最前面。」
 *
 * 🔴 这里断言的是**路由交给数据库的那条排序**，而不是「我喂进去两行、它按我喂的顺序
 * 吐出来」—— 排序是数据库做的（`findMany` 的 `orderBy`），路由这一层的职责就是
 * 把「按什么排」说对。用假 prisma 时**只有这一条是能验的**，而它正是这次改的东西。
 * ⚠️ 真库那一条（真排序）由 `worksheet-realtime.test.ts` 那套临时 SQLite 基建覆盖；
 *    这里刻意**不**起真库：为一条 `orderBy` 拉一次 `prisma db push` 不划算。
 *
 * ⚠️ 为什么不只钉「主键是 `createdAt`」：`createdAt` 撞在同一毫秒时，
 *    只按它排**分页会漏行或重行**（第 2 页少一份，谁也不报错）。次键 `id` 是那件事的
 *    唯一保障，所以下面有一条专门钉它。
 */

interface Harness {
  get: (pathname: string) => Promise<globalThis.Response>;
  /** 路由实际发给 `findMany` 的参数（本次要验的就是它）。 */
  findManyArgs: () => Record<string, unknown>;
}

async function startServer(
  /** 🔴 **必须收尾**：起了 express 不关，`node --test` 会一直等事件循环 —— 实测挂死。 */
  t: { after: (fn: () => void) => void },
  rows: unknown[],
): Promise<Harness> {
  let captured: Record<string, unknown> = {};
  const prisma = {
    worksheet: {
      count: async () => rows.length,
      findMany: async (args: Record<string, unknown>) => {
        captured = args;
        return rows;
      },
    },
    // `classroomCounts` 会 union 这两张表（只数课堂级会让高级模式的课堂整个消失）。
    classroomWorksheet: { findMany: async () => [] },
    classroomGroupMaterial: { findMany: async () => [] },
  };
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', { to: () => ({ emit: () => {} }) });
  // ⚠️ 只挂路由、**不挂鉴权闸门**：教师鉴权是在 `index.ts` 注册时加的
  //（本仓的纪律：router 自己不 gate），这里要验的是列表本身。
  app.use('/api/worksheets', worksheetRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // ⚠️ 照 `classroom-module-state-route.test.ts` 的既有写法收尾。少了它，
  //    这条用例**不会失败、只会挂住**（我第一版就这么挂死的）。
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  return {
    get: (pathname) => fetch(`http://127.0.0.1:${port}${pathname}`),
    findManyArgs: () => captured,
  };
}

/** 一行够用的学习单（列表只读这几列 + content 用来数题数）。 */
function row(id: string, title: string) {
  return {
    id, title, description: null, schemaVersion: 1,
    content: { schemaVersion: 1, nodes: [] },
    createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-30T00:00:00Z'),
  };
}

test('🔴 列表按**创建时间**倒序取（不是最近修改）', async (t) => {
  const harness = await startServer(t, [row('w1', '甲'), row('w2', '乙')]);
  const res = await harness.get('/api/worksheets');
  assert.equal(res.status, 200);

  const orderBy = harness.findManyArgs().orderBy;
  assert.ok(Array.isArray(orderBy), `orderBy 应当是数组（带次键），实际是 ${JSON.stringify(orderBy)}`);
  assert.deepEqual(
    (orderBy as Array<Record<string, string>>)[0],
    { createdAt: 'desc' },
    '主键不是 createdAt 倒序 —— 教师改一道老题，它就会跳到列表最前面',
  );
});

test('🔴 次键是 `id`：`createdAt` 撞在同一毫秒时分页才不会漏行 / 重行', async (t) => {
  // ⚠️ 这一条防的是**静默**的那种错：两份学习单的 `createdAt` 相同（连着建、或批量
  //    导入）时，只按 `createdAt` 排的话数据库可以任意决定这两行的先后 —— 而
  //    **翻页**（`skip`/`take`）会把其中一份漏掉、或者把另一份显示两遍。
  //    屏幕上只是「第 2 页少了一份」，谁也不报错。
  const harness = await startServer(t, [row('w1', '甲')]);
  await harness.get('/api/worksheets');
  const orderBy = harness.findManyArgs().orderBy as Array<Record<string, string>>;
  assert.equal(orderBy.length, 2, '没有次键 —— createdAt 相同的两行在翻页时会漂');
  assert.equal(orderBy[1].id, 'asc');
});

test('🔴 搜索条件照旧下发（改排序不许碰 where）', async (t) => {
  // 阳性对照式的邻居：这次只该动 `orderBy`，`where` 一个字都不该变
  // （搜索是服务端分页的，少了 `where` 就会把全部学习单当成搜索结果发出去）。
  const harness = await startServer(t, [row('w1', '甲')]);
  await harness.get('/api/worksheets?search=%E7%94%B2&page=2&pageSize=5');
  const args = harness.findManyArgs();
  assert.deepEqual(args.where, { title: { contains: '甲' } });
  assert.equal(args.skip, 5);
  assert.equal(args.take, 5);
});
