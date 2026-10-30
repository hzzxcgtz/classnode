import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_TEMPLATE_IDS, readAnalysisTemplate } from '../services/analysis-template-source.js';
const template = '<!-- ClassNode Worksheet Analysis Prompts v4.3.0 -->\n# 角色：测试\n## 工作流：\n实际规则\n## 限制：\n安全限制';

test('remote templates use exactly twelve fixed HTTPS paths without user credentials and pick version from remote text', async () => {
  assert.equal(ANALYSIS_TEMPLATE_IDS.size, 13);
  for (const id of [...ANALYSIS_TEMPLATE_IDS].filter(id => id !== 'universal')) {
    const fetcher: typeof fetch = async (url, options) => {
      assert.equal(url, `https://www.aicls.xyz/prompt-templates/analysis/${id}.md`);
      assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
      assert.equal(new Headers(options?.headers).has('authorization'), false);
      assert.equal(new Headers(options?.headers).get('cache-control'), 'no-cache');
      return new Response(template.replace('v4.3.0', 'v4.3.1'));
    };
    assert.deepEqual(await readAnalysisTemplate(id, fetcher), {text:template.replace('v4.3.0','v4.3.1'), version:'4.3.1'});
  }
});
test('reject arbitrary URLs, traversal and unknown templates before network access', async () => {
  for (const id of ['https://localhost/', '../primary-math', 'primary-nope', 'primary-math?url=foo']) {
    await assert.rejects(readAnalysisTemplate(id, async () => {throw new Error('must not fetch');}), /未知/);
  }
});
test('reject error pages, HTML and incomplete or oversized files with understandable messages', async () => {
  for (const response of [new Response('missing', {status:404}), new Response('<html>not a template</html>'), new Response('# 角色：only')]) {
    await assert.rejects(readAnalysisTemplate('primary-math', async () => response), /官网/);
  }
  await assert.rejects(readAnalysisTemplate('primary-math', async () => new Response('x'.repeat(256*1024+1))), /文件过大/);
  await assert.rejects(readAnalysisTemplate('primary-math', async () => {throw new Error('private transport details');}), /暂时无法连接官网/);
});

test('read compact v5 templates as well as old complete templates',async()=>{
 const fs=await import('node:fs');
 const text=fs.readFileSync(new URL('../../../myportal/prompt-templates/analysis/primary-chinese.md',import.meta.url),'utf8');
 const result=await readAnalysisTemplate('primary-chinese',async()=>new Response(text));assert.equal(result.version,'5.1.0');assert.equal(result.text,text);
});

test('universal template is bundled and available without external network', async () => {
 const result = await readAnalysisTemplate('universal', async () => { throw new Error('must not fetch'); });
 const fs = await import('node:fs');
 const file = fs.readFileSync(new URL('../../../myportal/prompt-templates/analysis/universal.md', import.meta.url), 'utf8');
 assert.equal(result.text, file);
 assert.equal(result.version, '5.1.0');
 assert.match(result.text, /不增加教师未要求的评分项/);
});
