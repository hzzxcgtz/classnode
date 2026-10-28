/** Remote template reads never include classroom data, cookies or API credentials. */
const TEMPLATE_ROOT = 'https://www.aicls.xyz/prompt-templates/analysis/';
const STAGES = ['primary', 'middle'];
const SUBJECTS = ['chinese', 'math', 'english', 'science', 'information-technology', 'general'];
export const ANALYSIS_TEMPLATE_IDS = new Set(STAGES.flatMap(stage => SUBJECTS.map(subject => `${stage}-${subject}`)));
const MAX_BYTES = 256 * 1024;

export async function readAnalysisTemplate(id: string, fetcher: typeof fetch = fetch): Promise<{text: string; version: string}> {
  if (!ANALYSIS_TEMPLATE_IDS.has(id)) throw new Error('未知的分析提示词模板');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(`${TEMPLATE_ROOT}${id}.md`, {
      signal: controller.signal, redirect: 'error', credentials: 'omit',
      headers: { Accept: 'text/markdown, text/plain;q=0.9', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error('官网模板暂时无法读取，请稍后重试');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new Error('官网模板文件过大，请联系维护者');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_BYTES) throw new Error('官网模板文件过大，请联系维护者');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (/^\s*</.test(text.replace(/^\s*<!--[\s\S]*?-->\s*/, '')) || !text.includes('# 角色：') || !text.includes('## 工作流：') || !text.includes('## 限制：')) {
      throw new Error('官网返回的模板内容不完整，请联系维护者');
    }
    const version = /Worksheet Analysis Prompts v(\d+\.\d+\.\d+)/.exec(text)?.[1] || '未标注';
    return { text, version };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('读取官网模板超时，请检查网络后重试');
    if (error instanceof Error && error.message.startsWith('官网')) throw error;
    throw new Error('暂时无法连接官网模板服务，请检查网络后重试');
  } finally { clearTimeout(timer); }
}
