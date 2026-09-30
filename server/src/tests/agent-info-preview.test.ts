import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import agentRoutes from '../routes/agents.js';
import { encrypt } from '../services/crypto.js';

test('info-preview 可用共享令牌 ID 获取 Coze 资料，且明文只在服务端解密', async (t) => {
  const sharedToken = 'pat_shared_for_preview';
  const prisma = {
    platformToken: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === 'credential-1'
        ? { token: encrypt(sharedToken) }
        : null,
    },
  };

  const nativeFetch = globalThis.fetch;
  let authorization = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.coze.cn/')) {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({
        data: { name: '课堂分析助手', onboarding_info: { prologue: '你好' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return nativeFetch(input, init);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });

  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/agents', agentRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await nativeFetch(`http://127.0.0.1:${port}/api/agents/info-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'coze', botId: '7691197735609221174', credentialId: 'credential-1', apiKey: '' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: '课堂分析助手', greeting: '你好' });
  assert.equal(authorization, `Bearer ${sharedToken}`);
});
