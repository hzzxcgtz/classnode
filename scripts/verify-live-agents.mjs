/** Explicitly authorized live probes: read-only existing config, synthetic prompts only. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = process.env.CLASSNODE_VERIFY_DATABASE || path.join(root, 'server/prisma/dev.db');
const keyFile = process.env.CLASSNODE_VERIFY_KEY_FILE || path.join(root, 'server/.encryption.key');
if (!process.env.ENCRYPTION_KEY) { if (!fs.existsSync(keyFile)) throw new Error('Missing existing encryption key; no key will be generated'); process.env.ENCRYPTION_KEY = fs.readFileSync(keyFile, 'utf8').trim(); }
const rows = JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nc.row_factory=sqlite3.Row\nprint(json.dumps([dict(r) for r in c.execute('SELECT a.*,p.token AS sharedToken FROM Agent a LEFT JOIN PlatformToken p ON a.credentialId=p.id WHERE a.enabled=1')]))`, database], { encoding: 'utf8' }));
const { toAgentConfig } = await import('../server/dist/services/agent-config.js');
const { proxyAIRequest, proxyAIRequestStream } = await import('../server/dist/services/ai-proxy.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-live-probes-'));
process.env.CLASSNODE_DATA_DIR = temp;
fs.mkdirSync(path.join(temp, 'uploads/chat'), { recursive: true });
const require = createRequire(path.join(root, 'server/package.json'));
const sharp = require('sharp');
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/><circle cx="128" cy="100" r="45" fill="red"/><text x="64" y="200" font-size="28">TEST 123</text></svg>')).png().toFile(path.join(temp, 'uploads/chat/acceptance.png'));
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options = {}) => nativeFetch(input, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
const secrets = [];
const redact = value => { let text = String(value || ''); for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]'); return text.slice(0, 400); };
// SDK/proxy diagnostics may contain response bodies. Emit only selected redacted results.
for (const method of ['log','warn','error','debug']) console[method] = () => {};
const results = [];
const selected = [...new Set(rows.map(row => row.platform))].map(platform => rows.find(row => row.platform === platform));
const summary = result => ({ success: Boolean(result.success), characters: result.content?.length || 0, aborted: Boolean(result.aborted), error: redact(result.error) || undefined });
const prompt = '这是 ClassNode 发布前联通测试，内容为虚构。请简短回答：连接正常。';
try {
  for (const row of selected) {
    if (process.env.CLASSNODE_VERIFY_ATTACHMENT_ONLY === '1' && row.platform !== 'coze') continue;
    const config = toAgentConfig(row, row.sharedToken ? { token: row.sharedToken } : null, { sessionId: `classnode_acceptance_${Date.now()}` });
    secrets.push(config.apiKey);
    const entry = { agent: row.name, platform: row.platform };
    process.stdout.write(JSON.stringify({ testing: entry.agent, platform: entry.platform }) + '\n');
    if (process.env.CLASSNODE_VERIFY_ATTACHMENT_ONLY === '1') {
      entry.attachment = summary(await proxyAIRequest(config, '发布验收：附件是人工生成的测试图，请说明图中颜色和字符。', '验收虚构学生', undefined, ['/uploads/chat/acceptance.png']));
      results.push(entry); process.stdout.write(JSON.stringify(entry) + '\n'); continue;
    }
    entry.sync = summary(await proxyAIRequest(config, prompt, '验收虚构学生'));
    if (entry.sync.success) {
      let chunks = 0;
      entry.stream = summary(await proxyAIRequestStream(config, prompt, '验收虚构学生', () => { chunks++; }));
      entry.stream.chunks = chunks;
      const controller = new AbortController();
      entry.stop = summary(await proxyAIRequestStream(config, '虚构测试：请列举二十个课堂观察例子。', '验收虚构学生', () => controller.abort(), undefined, undefined, controller.signal));
      if (row.platform === 'coze') entry.attachment = summary(await proxyAIRequest(config, '发布验收：附件是人工生成的测试图片，只需回复已收到。', '验收虚构学生', undefined, ['/uploads/chat/acceptance.png']));
      else entry.attachment = { tested: false, reason: '当前代理不向此平台提供文件识别接口' };
    } else entry.remaining = '连接失败，未继续消耗额度测试流式、停止和附件';
    results.push(entry);
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
  process.stdout.write(JSON.stringify({ liveProbe: true, syntheticOnly: true, localDatabaseWrites: false, results, unavailablePlatforms: ['coze-agent','zhipuai'].filter(platform => !rows.some(row => row.platform === platform)) }, null, 2) + '\n');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
