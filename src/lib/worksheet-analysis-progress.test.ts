import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ANALYSIS_STUCK_AFTER_SECONDS, worksheetAnalysisProgressLabel } from './worksheet-analysis-progress.ts';

test('分析按钮依次说明整理、发送、分析与保存四个真实阶段', () => {
  assert.equal(worksheetAnalysisProgressLabel('preparing', 0), '整理数据…');
  assert.equal(worksheetAnalysisProgressLabel('sending', 1), '正在发送…');
  /* ⚠️ 「分析中」那一档现在**还会跟一句参照**（★ 2026-10-07）⇒ 钉前缀，不钉整串；
     它跟的那句话本身由下面那条用例管。 */
  assert.match(worksheetAnalysisProgressLabel('analyzing', 8), /^AI 分析中 8s/, '四档里少了「分析中」这一档');
  assert.equal(worksheetAnalysisProgressLabel('finalizing', 9), '保存结果…');
});

test('分析耗时只显示非负整数', () => {
  assert.match(worksheetAnalysisProgressLabel('analyzing', -3), /^AI 分析中 0s/, '负数要收成 0');
  assert.match(worksheetAnalysisProgressLabel('analyzing', 2.9), /^AI 分析中 2s/, '小数要向下取整');
});

/*
  ★ 2026-10-07（教师：「一次分析要三分钟」「我分不清**还在跑**和**坏了**」）——
  原来只有 `AI 分析中 42s` 一行：教师**没有任何参照**，不知道 42 秒算正常还是要出事。
  ✅ 两件事一起说清楚：**正常要多久**（给一个量级），以及**超过多久算异常**（明说「比平时久」）。
  ⚠️ 这条判据只钉**文案里有没有那两层意思**，不钉措辞 —— 措辞以后还会改。
*/
test('★ 跑到一半要给出「正常多久」，跑过头要明说「比平时久」', () => {
  const normal = worksheetAnalysisProgressLabel('analyzing', 42);
  assert.match(normal, /42s/, '先要有已经跑了多久');
  assert.match(normal, /分钟/, '还要给出正常的量级 —— 否则教师无法判断 42 秒算不算正常');

  const late = worksheetAnalysisProgressLabel('analyzing', ANALYSIS_STUCK_AFTER_SECONDS + 30);
  assert.match(late, /比平时久/, '超过上限还不提示，教师只能干等（分不清「还在跑」和「坏了」就是这件事）');
  assert.ok(!/比平时久/.test(normal), '正常范围内不许吓人');
});

/*
  ★ 2026-10-07：**客户端那条超时不能比服务端先到**。
  服务端自己的上限是 `ANALYSIS_POLL_TIMEOUT_SECONDS`（Coze 轮询，180 秒）；客户端的
  `ANALYSIS_REQUEST_TIMEOUT_MS` 要是比它小，就会在服务端**还在正常等待**时把请求掐断 ——
  教师看到「超时」，而服务端其实马上要成功。两边各在一个包里，只能读源码对拍。
*/
test('★ 客户端超时必须**大于**服务端的轮询上限（否则会掐断还在正常等待的分析）', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const client = fs.readFileSync(path.join(here, 'api.ts'), 'utf8');
  const server = fs.readFileSync(path.resolve(here, '../../server/src/services/ai-proxy.ts'), 'utf8');
  const clientMs = Number((client.match(/ANALYSIS_REQUEST_TIMEOUT_MS = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ''));
  const serverSec = Number((server.match(/ANALYSIS_POLL_TIMEOUT_SECONDS = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ''));
  assert.ok(Number.isFinite(clientMs) && Number.isFinite(serverSec), '两侧的常量没读到 —— 先修这条判据');
  assert.ok(
    clientMs > serverSec * 1000,
    `客户端 ${clientMs}ms 不大于服务端的 ${serverSec}s —— 会把还在正常等待的分析掐断`,
  );
});
