import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ChatAPI as WenxinChat } from '../services/wenxin/chat.js';
import { WenxinHttpClient } from '../services/wenxin/client.js';
import { ChatAPI as ZhipuaiChat } from '../services/zhipuai/chat.js';
import { ZhipuaiHttpClient } from '../services/zhipuai/client.js';

/**
 * ★ 2026-10-09 审计：**学生点「停止生成」在文心 / 智谱上不生效，半截回答被当成完整回答落库**。
 *
 * 机制：两个平台的 `ChatAPI` 在 `reader.read()` 抛 `AbortError` 时**吞掉它**、
 * 并把已累积的文本当作**正常返回**。于是：
 *   · `ai-proxy.ts` 的 `proxyWenxinStream` / `proxyZhipuaiStream` 拿到非空 `fullContent`
 *     ⇒ 回 `{success:true}` 而**永远不是 `aborted:true`** ⇒ 那两处
 *     `if (AbortError) return {success:false, aborted:true}` 成了**死代码**；
 *   · `socket/index.ts:2047` 只认 `result.aborted` 才丢弃 ⇒ `:2070` 把半截文本**写进 Message**、
 *     推给教师看板、并让它成为下一轮 history。
 *   ⚠️ 对照组是 coze（`coze-bot/chat.ts` 一直 rethrow）—— 四个平台里只有这两个不一致。
 *   ⚠️ 这条中止链路（`activeStreams`）是 2.0 才接通的 ⇒ 是 2.0 把这段老代码从死代码变成了活缺陷。
 *
 * ── 为什么这个测试要起一个**本机假上游** ──────────────────────────────────
 * 这个 bug 只在「**流已经开始了**」时才发生：`postStream` 那一句在 `try` 之外，
 * 所以中止发生在响应头到达**之前**时本来就会正确抛出（那条路没问题）。
 * 因此夹具必须真的推出一帧 SSE 再挂着不结束，等客户端进入读流循环之后才中止 ——
 * 只喂一个已中止的 signal 是**测不到**这条路的。
 *
 * 🔴 有一条**前置断言**是防止本文件假绿的关键：必须确认请求真的到过上游。
 *    否则「连不上」也会让 promise 拒绝，而这条用例会为**错误的理由**变绿。
 */

interface FakeUpstream {
  baseUrl: string;
  /** 上游已推出 SSE 响应头与首帧、且客户端**已进入读流循环**（留了余量）。 */
  streaming: Promise<void>;
  /** 到过上游的请求路径。 */
  requests: string[];
}

async function startFakeUpstream(t: { after: (fn: () => void) => void }): Promise<FakeUpstream> {
  const requests: string[] = [];
  let signalStreaming!: () => void;
  const streaming = new Promise<void>((resolve) => { signalStreaming = resolve; });

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(url);

    // 智谱会先要一个 access_token（`ZhipuaiAgentConfig` 没有现成 token 字段）。
    if (url.includes('/get_token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 0, result: { access_token: 'tok', expires_in: 3600 } }));
      return;
    }

    // SSE：推出响应头 + 一帧，然后**挂着不结束**，把中止的时机交给客户端。
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': keep-alive\n\n');
    // 150ms 的余量：本机回环上足够让首帧到达、并让客户端走到 `reader.read()`。
    // ⚠️ 这个时间**不是**「等一等应该就好了」——它由下面那条变异验证兜着：
    //    把吞中止的分支放回去，这条用例必须变红；不变红就说明中止落在了 `postStream` 之前。
    setTimeout(signalStreaming, 150);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { baseUrl: `http://127.0.0.1:${port}`, streaming, requests };
}

test('★ 文心：流进行中被中止 ⇒ 必须抛出 AbortError（不许回一份「成功的半截回答」）', async (t) => {
  const upstream = await startFakeUpstream(t);
  const controller = new AbortController();
  const chat = new WenxinChat(new WenxinHttpClient({
    appId: 'test-app', secretKey: 'test-secret', baseUrl: upstream.baseUrl,
  }));

  const pending = chat.conversation('你好', { userName: '测试学生' }, {}, controller.signal);
  await upstream.streaming;

  // 🔴 前置：请求真的到过上游。少了它，「连不上」也会让 promise 拒绝 ⇒ 假绿。
  assert.ok(upstream.requests.length > 0, '前置：请求必须真的到过假上游');

  controller.abort();
  await assert.rejects(
    pending,
    (error: Error) => error.name === 'AbortError',
    '中止必须传播出去 —— 否则 ai-proxy 的 `aborted:true` 分支是死代码，半截回答会被落库',
  );
});

test('★ 智谱：流进行中被中止 ⇒ 必须抛出 AbortError（同上）', async (t) => {
  const upstream = await startFakeUpstream(t);
  const controller = new AbortController();
  const chat = new ZhipuaiChat(new ZhipuaiHttpClient({
    assistantId: 'test-assistant', apiKey: 'test-key', apiSecret: 'test-secret', baseUrl: upstream.baseUrl,
  }));

  const pending = chat.sendStream('你好', { assistantId: 'test-assistant' }, {}, controller.signal);
  await upstream.streaming;
  assert.ok(upstream.requests.length > 0, '前置：请求必须真的到过假上游');

  controller.abort();
  await assert.rejects(
    pending,
    (error: Error) => error.name === 'AbortError',
    '智谱与文心是同一处修法，回归网也各有一条 —— 两边不许只修一个',
  );
});

test('阴性对照：中止发生在**响应头到达之前**时本来就抛（这条路从来没坏过）', async (t) => {
  const upstream = await startFakeUpstream(t);
  const controller = new AbortController();
  const chat = new WenxinChat(new WenxinHttpClient({
    appId: 'test-app', secretKey: 'test-secret', baseUrl: upstream.baseUrl,
  }));

  // 先中止再调用：`postStream` 在 `try` 之外 ⇒ 这条本来就会抛。
  // 留着它是为了证明上面两条红的**不是**这条路（否则两次修法看起来会一样有效）。
  controller.abort();
  await assert.rejects(
    chat.conversation('你好', { userName: '测试学生' }, {}, controller.signal),
    (error: Error) => error.name === 'AbortError',
  );
  assert.deepEqual(upstream.requests, [], '还没发出请求就被中止 ⇒ 上游一个请求都不该收到');
});
