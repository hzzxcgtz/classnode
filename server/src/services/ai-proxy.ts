import { anonymizer } from './anonymizer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FETCH_TIMEOUT_MS = 30_000;

/** 带超时的 fetch，避免上游 AI API 挂起时连接永不释放 */
async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = FETCH_TIMEOUT_MS, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** 安全解析 JSON，解析失败返回默认值 */
function safeParseJSON<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/** 清理 AI 响应的多余内容 */
function cleanResponse(text: string): string {
  let result = text;
  // 去除推理模型的 <think> 标签及其内容
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '');
  // 去除推理模型的思考过程（如 哦不、重新来、不对 等自纠对话）
  result = result.replace(/——?\s*(哦不?|不对|等等|重新来|让我重新|我再想想|嗯.*?不对|等等.*?不对)[\s\S]*?(?=得分|总分|【|$)/g, '');
  // 去除多余的空行（保留最多一个连续换行）
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

interface AgentConfig {
  platform: string;
  apiUrl?: string;
  apiKey: string;
  botId?: string;
  extra?: string;
  conversationId?: string;
}

interface ProxyResult {
  success: boolean;
  content?: string;
  error?: string;
  conversationId?: string;
}

/**
 * AI API 代理服务
 * 支持 Coze、Dify、OpenAI 兼容接口
 * 发送前脱敏，接收后还原
 */
export async function proxyAIRequest(
  agent: AgentConfig,
  message: string,
  studentName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const anonName = anonymizer.anonymize(studentName);
  const anonMessage = anonymizer.anonymizeMessage(message, studentName);

  try {
    switch (agent.platform) {
      case 'coze':
        return await proxyCoze(agent, anonMessage, anonName, history, fileUrls);
      case 'coze-agent':
        return await proxyCozeAgent(agent, anonMessage, anonName, history, fileUrls);
      case 'dify':
        return await proxyDify(agent, anonMessage, anonName, history, fileUrls);
      case 'zhipuai':
        return await proxyZhipuai(agent, anonMessage, anonName, history, fileUrls);
      case 'wenxin':
        return await proxyWenxin(agent, anonMessage, anonName, history, fileUrls);
      case 'openai':
        return await proxyOpenAI(agent, anonMessage, anonName, history, fileUrls);
      default:
        return { success: false, error: `不支持的平台: ${agent.platform}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'AI 请求失败' };
  }
}

/**
 * 流式 AI 代理请求（支持 Coze SSE 流式输出）
 */
export async function proxyAIRequestStream(
  agent: AgentConfig,
  message: string,
  studentName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const anonName = anonymizer.anonymize(studentName);
  const anonMessage = anonymizer.anonymizeMessage(message, studentName);

  try {
    switch (agent.platform) {
      case 'coze':
        return await proxyCozeStream(agent, anonMessage, anonName, onChunk, history, fileUrls);
      case 'coze-agent':
        return await proxyCozeAgentStream(agent, anonMessage, anonName, onChunk, history, fileUrls);
      case 'dify':
        return await proxyDifyStream(agent, anonMessage, anonName, onChunk, history, fileUrls);
      case 'zhipuai':
        return await proxyZhipuaiStream(agent, anonMessage, anonName, onChunk, history, fileUrls);
      case 'wenxin':
        return await proxyWenxinStream(agent, anonMessage, anonName, onChunk, history, fileUrls);
      case 'openai':
        return await proxyOpenAIStream(agent, anonMessage, anonName, onChunk, history, fileUrls);
      default:
        return { success: false, error: `不支持的平台: ${agent.platform}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'AI 请求失败' };
  }
}

async function proxyCoze(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const baseUrl = agent.apiUrl || 'https://api.coze.cn';

  // 历史消息 + 当前消息（有图片时不能带文本历史，Coze 限制）
  const additionalMessages: any[] = [];
  if (!fileUrls || fileUrls.length === 0) {
    for (const h of history || []) {
      additionalMessages.push({ role: h.role, content: h.content, content_type: 'text' });
    }
  }

  // 有文件时：上传图片到 Coze 并构造标准多模态消息
  const fileIds: string[] = [];
  if (fileUrls && fileUrls.length > 0) {
    for (const url of fileUrls) {
      const fid = await uploadFileToCoze(baseUrl, agent.apiKey, url);
      if (fid) fileIds.push(fid);
    }
  }
  if (fileIds.length > 0) {
    additionalMessages.push({
      role: 'user',
      content: JSON.stringify([
        { type: 'image', file_id: fileIds[0] },
        { type: 'text', text: message },
      ]),
      content_type: 'object_string',
    });
  } else {
    additionalMessages.push({
      role: 'user', content: message, content_type: 'text',
    });
  }

  const requestBody: any = {
    bot_id: agent.botId,
    user_id: userName,
    additional_messages: additionalMessages,
    auto_save_history: true,
    stream: false,
  };
  if (agent.conversationId) {
    requestBody.conversation_id = agent.conversationId;
  }
  console.log('[Coze] Chat request:', additionalMessages.length, 'msgs, image:', additionalMessages.some((m: any) => m.content_type === 'object_string'));

  const response = await fetchWithTimeout(
    `${baseUrl}/v3/chat`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agent.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Coze API 错误 (${response.status}): ${err}` };
  }

  const data = await response.json();

  if (data.code !== 0 && data.code !== undefined) {
    return { success: false, error: `Coze API 返回错误: code=${data.code} msg=${data.msg || '未知错误'}` };
  }

  const chatData = data.data || data;
  const chatId = chatData.id;
  const conversationId = chatData.conversation_id;

  if (!chatId) {
    return { success: false, error: 'Coze API 未返回 chat_id' };
  }

  const messages = await pollCozeMessages(baseUrl, agent.apiKey, chatId, conversationId);
  if (messages.length === 0) {
    return { success: false, error: 'Coze 未返回消息内容' };
  }

  // 过滤出最终回答（排除 knowledge_recall, verbose 等中间事件）
  const answerMsg = messages.find((m: any) => m.type === 'answer' && m.role === 'assistant');
  if (!answerMsg) {
    console.error('[Coze] Available messages:', JSON.stringify(messages, null, 2));
    return { success: false, error: 'Coze 未返回助手回复' };
  }

  const content = answerMsg.content || '';
  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(content));

  return {
    success: true,
    content: deanonymized,
    conversationId,
  };
}

async function pollCozeMessages(
  baseUrl: string,
  apiKey: string,
  chatId: string,
  conversationId: string,
  maxRetries = 15
): Promise<any[]> {
  // 轮询等待聊天完成 (Coze 使用 GET + query params)
  for (let i = 0; i < maxRetries; i++) {
    const statusUrl = `${baseUrl}/v3/chat/retrieve?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(conversationId)}`;
    const statusRes = await fetchWithTimeout(statusUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (statusRes.ok) {
      const statusData = await statusRes.json();
      const chatStatus = statusData.data?.status;

      if (chatStatus === 'completed') {
        break;
      }
      if (chatStatus === 'failed') {
        const lastErr = statusData.data?.last_error;
        console.error('[Coze] Chat failed:', lastErr);
        return [];
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 获取消息列表 (GET)
  const msgUrl = `${baseUrl}/v3/chat/message/list?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(conversationId)}`;
  const msgRes = await fetchWithTimeout(msgUrl, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!msgRes.ok) {
    const err = await msgRes.text();
    console.error('[Coze] Message list error:', err);
    return [];
  }

  const msgData = await msgRes.json();
  return msgData.data || [];
}

async function proxyDify(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  // 上传文件到 Dify
  const fileIds: string[] = [];
  if (fileUrls && fileUrls.length > 0) {
    for (const url of fileUrls) {
      if (isLocalFileUrl(url)) {
        const fid = await uploadFileToDify(agent.apiUrl || '', agent.apiKey, url);
        if (fid) fileIds.push(fid);
      }
    }
  }

  const body: any = {
    query: message,
    user: userName,
    response_mode: 'blocking',
    inputs: {},
  };

  // 有文件时添加 files 参数
  if (fileIds.length > 0) {
    body.files = fileIds.map(id => ({
      type: 'image',
      transfer_method: 'local_file',
      upload_file_id: id,
    }));
  }

  const response = await fetchWithTimeout(
    `${agent.apiUrl}/chat-messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agent.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Dify API 错误: ${response.status} ${err}` };
  }

  const data = await response.json();
  const content = data.answer || '';
  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(content));

  return {
    success: true,
    content: deanonymized,
  };
}

async function proxyOpenAI(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const messages: any[] = history
    ? history.map(h => ({ role: h.role, content: h.content }))
    : [];

  // 有文件时使用 Vision API 格式（content 为数组）
  if (fileUrls && fileUrls.length > 0) {
    const contentParts: any[] = [{ type: 'text', text: message }];
    for (const url of fileUrls) {
      if (isLocalFileUrl(url)) {
        const dataUrl = await fileUrlToBase64DataUrl(url);
        if (dataUrl) {
          contentParts.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } });
        }
      } else {
        // 远程 URL 直接使用
        contentParts.push({ type: 'image_url', image_url: { url, detail: 'low' } });
      }
    }
    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({ role: 'user', content: message });
  }

  const response = await fetchWithTimeout(
    agent.apiUrl || 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agent.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        user: userName,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `OpenAI API 错误: ${response.status} ${err}` };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(content));

  return {
    success: true,
    content: deanonymized,
  };
}

/**
 * 使用 Coze 账号的 PAT 发现工作区中的智能体
 * 用于 Coze Agent 类型（自身无 PAT，借用已有 Coze 智能体的 Token）
 */
export async function discoverCozeBotWithPat(pat: string, matchName?: string): Promise<{
  botId: string;
  name?: string;
  iconUrl?: string;
} | null> {
  try {
    const baseUrl = 'https://api.coze.cn';

    // 获取工作区列表
    const wsRes = await fetchWithTimeout(`${baseUrl}/v1/workspaces`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${pat}` },
    });
    if (!wsRes.ok) return null;
    const wsData = await wsRes.json();
    const workspaces = wsData?.data?.workspaces || [];

    // 遍历所有工作区查找机器人
    for (const ws of workspaces) {
      const botRes = await fetchWithTimeout(`${baseUrl}/v1/bots?workspace_id=${ws.id}&page_size=50`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${pat}` },
      });
      if (!botRes.ok) continue;
      const botData = await botRes.json();
      const bots = botData?.data?.items || [];

      // 有名称时只返回精确匹配的机器人
      if (matchName) {
        const matched = bots.find((b: any) => b.name === matchName);
        if (matched) return { botId: matched.id, name: matched.name, iconUrl: matched.icon_url };
        continue; // 跳过没有匹配的工作区
      }

      // 无名称匹配时，只有一个机器人则直接返回
      if (bots.length === 1) {
        return { botId: bots[0].id, name: bots[0].name, iconUrl: bots[0].icon_url };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 获取 AI 智能体的开场白（从平台 API）
 */
export async function fetchAgentGreeting(agent: AgentConfig): Promise<string | null> {
  try {
    switch (agent.platform) {
      case 'coze': {
        const baseUrl = agent.apiUrl || 'https://api.coze.cn';
        // GET /v1/bot/get_online_info 返回 OnboardingInfoV2 含 prologue
        const url = `${baseUrl}/v1/bot/get_online_info?bot_id=${agent.botId}`;
        const response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${agent.apiKey}` },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.data?.onboarding_info?.prologue) {
          return data.data.onboarding_info.prologue;
        }
        if (data?.data?.onboarding_info_v2?.prologue) {
          return data.data.onboarding_info_v2.prologue;
        }
        return null;
      }
      case 'coze-agent': {
        if (!agent.botId) return null;
        const baseUrl = 'https://api.coze.cn';
        const res = await fetchWithTimeout(`${baseUrl}/v1/bot/get_online_info?bot_id=${agent.botId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${agent.apiKey}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.data?.onboarding_info?.prologue) {
          return data.data.onboarding_info.prologue;
        }
        if (data?.data?.onboarding_info_v2?.prologue) {
          return data.data.onboarding_info_v2.prologue;
        }
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * 从平台 API 获取智能体完整信息（名称、头像 URL、开场白）
 */
export async function fetchAgentInfo(agent: AgentConfig): Promise<{
  name?: string;
  iconUrl?: string;
  greeting?: string;
} | null> {
  try {
    switch (agent.platform) {
      case 'coze': {
        const baseUrl = agent.apiUrl || 'https://api.coze.cn';
        const url = `${baseUrl}/v1/bot/get_online_info?bot_id=${agent.botId}`;
        const response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${agent.apiKey}` },
        });
        if (!response.ok) return null;
        const data = await response.json();
        const result: { name?: string; iconUrl?: string; greeting?: string } = {};
        if (data?.data?.name) result.name = data.data.name;
        if (data?.data?.icon_url) result.iconUrl = data.data.icon_url;
        if (data?.data?.onboarding_info?.prologue) {
          result.greeting = data.data.onboarding_info.prologue;
        } else if (data?.data?.onboarding_info_v2?.prologue) {
          result.greeting = data.data.onboarding_info_v2.prologue;
        }
        return Object.keys(result).length > 0 ? result : null;
      }
      case 'coze-agent': {
        if (!agent.botId) return null;
        const baseUrl = 'https://api.coze.cn';
        const result: { name?: string; iconUrl?: string; greeting?: string } = {};

        const infoRes = await fetchWithTimeout(`${baseUrl}/v1/bot/get_online_info?bot_id=${agent.botId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${agent.apiKey}` },
        });
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          if (infoData?.data?.onboarding_info?.prologue) {
            result.greeting = infoData.data.onboarding_info.prologue;
          } else if (infoData?.data?.onboarding_info_v2?.prologue) {
            result.greeting = infoData.data.onboarding_info_v2.prologue;
          }
        }

        return Object.keys(result).length > 0 ? result : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * 测试 AI 智能体连通性
 */
export async function testAgentConnection(agent: AgentConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await proxyAIRequest(agent, '你好，请回复"连接成功"', '测试用户');
    if (result.success) return { success: true };
    return { success: false, error: result.error || '连接失败' };
  } catch (error: any) {
    return { success: false, error: error.message || '测试请求异常' };
  }
}

/**
 * 将本地文件路径转换为 base64 data URL（用于 OpenAI Vision API）
 */
async function fileUrlToBase64DataUrl(fileUrl: string): Promise<string | null> {
  try {
    const filePath = resolveLocalPath(fileUrl);

    if (!fs.existsSync(filePath)) {
      console.error('[FileToBase64] File not found:', filePath);
      return null;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeMap[ext];
    if (!mimeType) {
      console.error('[FileToBase64] Unsupported file type for image:', ext);
      return null;
    }

    const fileBuffer = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  } catch (error) {
    console.error('[FileToBase64] Error:', error);
    return null;
  }
}

/**
 * 上传本地文件到 Dify，返回文件 ID
 */
async function uploadFileToDify(apiUrl: string, apiKey: string, fileUrl: string): Promise<string | null> {
  try {
    const filePath = resolveLocalPath(fileUrl);

    if (!fs.existsSync(filePath)) {
      console.error('[DifyUpload] File not found:', filePath);
      return null;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(fileUrl);
    const ext = path.extname(fileName).toLowerCase();

    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('type', 'image');

    const response = await fetchWithTimeout(`${apiUrl.replace(/\/+$/, '')}/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[DifyUpload] HTTP Error:', response.status, err);
      return null;
    }

    const data = await response.json();
    console.log('[DifyUpload] Success, file_id:', data.id, 'file:', fileName);
    return data.id || null;
  } catch (error) {
    console.error('[DifyUpload] Exception:', error);
    return null;
  }
}

/** 将本地文件 URL 解析为绝对路径（兼容 CLASSNODE_DATA_DIR） */
function resolveLocalPath(fileUrl: string): string {
  const relativePath = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
  // 生产模式下文件存在 CLASSNODE_DATA_DIR 中
  if (process.env.CLASSNODE_DATA_DIR) {
    return path.join(process.env.CLASSNODE_DATA_DIR, relativePath);
  }
  return path.join(__dirname, '../..', relativePath);
}

/** 将本地图片文件转为 Markdown 图片标签（base64 嵌入） */
async function fileUrlToMarkdownImage(fileUrl: string): Promise<string | null> {
  try {
    const filePath = resolveLocalPath(fileUrl);
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    if (!imgExts.includes(ext)) return null;
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    };
    const buf = fs.readFileSync(filePath);
    const b64 = buf.toString('base64');
    return `![image](data:${mimeMap[ext] || 'image/png'};base64,${b64})`;
  } catch { return null; }
}

/** 检查文件 URL 是否为本地路径 */
function isLocalFileUrl(url: string): boolean {
  return url.startsWith('/');
}

/**
 * 上传本地文件到 Coze，返回 file_id
 */
async function uploadFileToCoze(baseUrl: string, apiKey: string, fileUrl: string): Promise<string | null> {
  try {
    const filePath = resolveLocalPath(fileUrl);
    console.log('[CozeUpload] File:', path.basename(fileUrl), `(${fs.existsSync(filePath) ? fs.statSync(filePath).size + 'B' : 'NOT FOUND'})`);

    if (!fs.existsSync(filePath)) {
      console.error('[CozeUpload] File not found:', filePath);
      return null;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(fileUrl);

    // 根据扩展名设置正确的 MIME 类型
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const response = await fetchWithTimeout(`${baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const respText = await response.text();
    console.log('[CozeUpload] HTTP', response.status, ':', respText.slice(0, 300));

    if (!response.ok) {
      console.error('[CozeUpload] HTTP Error:', response.status, respText);
      return null;
    }

    let data;
    try { data = JSON.parse(respText); } catch { data = {}; }

    if (data.code !== 0 && data.code !== undefined) {
      console.error('[CozeUpload] API error:', data.msg || 'unknown');
      return null;
    }

    const fileId = data.data?.id || data.data?.file_id || data.id;
    if (fileId) {
      console.log('[CozeUpload] Success, file_id:', fileId, 'file:', fileName);
      return fileId;
    }

    console.error('[CozeUpload] No file_id in response, data:', JSON.stringify(data));
    return null;
  } catch (error) {
    console.error('[CozeUpload] Exception:', error);
    return null;
  }
}

/** 从 Coze Agent SSE 事件的 content 字段安全地提取文本 */
function extractContent(val: any): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    if (Array.isArray(val)) return val.map(v => extractContent(v)).join('');
    // 尝试常见的嵌套结构: { text: "..." } 或 { content: { text: "..." } } 或 { content: [...] }
    if (val.text) return extractContent(val.text);
    if (val.content) return extractContent(val.content);
    // 兜底：忽略对象（如 type 等元数据）
    return '';
  }
  return '';
}

// ---- Coze Agent (stream_run API, 扣子编程) ----

async function proxyCozeAgent(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  // 有附件时提示不支持（stream_run 自定义接口无统一上传标准）
  if (fileUrls && fileUrls.length > 0) {
    message = message + '（用户发送了附件，但当前接入方式不支持附件识别）';
  }

  const baseUrl = agent.apiUrl || '';
  if (!baseUrl) return { success: false, error: 'Coze Agent 需要 API URL' };

  const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
  const projectId = extra.projectId || '';
  if (!projectId) return { success: false, error: 'Coze Agent 需要 Project ID' };

  const sessionId = `student_${userName}`;

  const body: any = {
    project_id: Number(projectId),
    content: {
      query: {
        prompt: [
          {
            type: 'text',
            content: {
              text: message,
            },
          },
        ],
      },
    },
    type: 'query',
    session_id: sessionId,
  };

  // 支持用户填写完整 URL 或仅填 base URL
  const streamUrl = baseUrl.includes('/stream_run') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/stream_run`;
  const response = await fetchWithTimeout(streamUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Coze Agent API 错误 (${response.status}): ${err}` };
  }

  // 读取原始响应体
  const rawText = await response.text();

  let fullContent = '';
  let debugEvents: any[] = [];
  const sseLines = rawText.split('\n');
  for (const rawLine of sseLines) {
    const line = rawLine.trim();
    if (line && debugEvents.length < 20) {
      debugEvents.push({ raw: line.slice(0, 300) });
    }
    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]' || dataStr === '"[DONE]"') continue;
      try {
        const parsed = JSON.parse(dataStr);
        // SSE 格式: { type: "answer", content: { answer: "文本片段", thinking: null, ... } }
        const contentVal = parsed.content?.answer ?? parsed.answer ?? parsed.text ?? parsed.output ?? parsed.message ?? parsed.delta ?? parsed.response ?? null;
        if (contentVal !== null) {
          fullContent += extractContent(contentVal);
        } else if (typeof parsed === 'object' && debugEvents.length < 20) {
          debugEvents.push(parsed);
        }
      } catch {
        if (debugEvents.length < 20) {
          debugEvents.push({ rawData: dataStr.slice(0, 300) });
        }
      }
    }
  }

  if (!fullContent) {
    if (debugEvents.length === 0 && rawText.length > 0) {
      // 没有 data: 事件或格式异常，返回原始内容片段
      return { success: false, error: `Coze Agent 响应格式异常(${rawText.length}字节): ${rawText.slice(0, 500)}` };
    }
    return { success: false, error: `Coze Agent 响应为空，调试: ${JSON.stringify(debugEvents)}` };
  }

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized };
}

// ---- 流式输出实现 ----

async function proxyCozeStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  // 有图片时回退到非流式（流式对 object_string 支持不稳定）
  if (fileUrls && fileUrls.length > 0) {
    const result = await proxyCoze(agent, message, userName, history, fileUrls);
    if (result.success && result.content) {
      const chunkSize = 20;
      for (let i = 0; i < result.content.length; i += chunkSize) {
        onChunk(result.content.slice(i, i + chunkSize));
      }
    }
    return result;
  }

  // ---- 文字消息走流式 ----
  const baseUrl = agent.apiUrl || 'https://api.coze.cn';
  const additionalMessages: any[] = [];
  // 始终通过 additional_messages 传完整历史，确保 bot 能感知上下文
  if (history) {
    for (const h of history) {
      additionalMessages.push({ role: h.role, content: h.content, content_type: 'text' });
    }
  }
  additionalMessages.push({ role: 'user', content: message, content_type: 'text' });

  const body: any = {
    bot_id: agent.botId,
    user_id: userName,
    additional_messages: additionalMessages,
    auto_save_history: true,
    stream: true,
  };
  if (agent.conversationId) {
    body.conversation_id = agent.conversationId;
  }

  const response = await fetchWithTimeout(`${baseUrl}/v3/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Coze API 错误 (${response.status}): ${err}` };
  }

  const reader = response.body?.getReader();
  if (!reader) return { success: false, error: '无法读取响应流' };

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let currentEvent = '';
  let streamConvId = agent.conversationId || '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) { currentEvent = line.slice(6).trim(); continue; }
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          // 捕获 conversation_id（在 conversation.chat.created 等初始事件中）
          if (!streamConvId && parsed.conversation_id) {
            streamConvId = parsed.conversation_id;
          }
          if (parsed.content_type === 'thinking') continue;
          if (parsed.type === 'verbose') continue;
          if (currentEvent === 'conversation.message.delta' && parsed.type === 'answer' && parsed.role === 'assistant') {
            const delta = parsed.content || '';
            if (delta) { fullContent += delta; onChunk(delta); }
          }
        } catch {}
      }
    }
  }

  if (!fullContent) return { success: false, error: 'Coze 流式响应为空' };
  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized, conversationId: streamConvId || undefined };
}

async function proxyDifyStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  // 上传文件到 Dify
  const fileIds: string[] = [];
  if (fileUrls && fileUrls.length > 0) {
    for (const url of fileUrls) {
      if (isLocalFileUrl(url)) {
        const fid = await uploadFileToDify(agent.apiUrl || '', agent.apiKey, url);
        if (fid) fileIds.push(fid);
      }
    }
  }

  const body: any = {
    query: message,
    user: userName,
    response_mode: 'streaming',
    inputs: {},
  };

  if (fileIds.length > 0) {
    body.files = fileIds.map(id => ({
      type: 'image',
      transfer_method: 'local_file',
      upload_file_id: id,
    }));
  }

  const response = await fetchWithTimeout(`${agent.apiUrl}/chat-messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Dify API 错误: ${response.status} ${err}` };
  }

  const reader = response.body?.getReader();
  if (!reader) return { success: false, error: '无法读取响应流' };

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]' || dataStr === '"[DONE]"') continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.event === 'message') {
            const delta = parsed.answer || '';
            fullContent += delta;
            onChunk(delta);
          }
        } catch {}
      }
    }
  }

  if (!fullContent) return { success: false, error: 'Dify 流式响应为空' };

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized };
}

async function proxyOpenAIStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const messages: any[] = history
    ? history.map(h => ({ role: h.role, content: h.content }))
    : [];

  // 有文件时使用 Vision API 格式
  if (fileUrls && fileUrls.length > 0) {
    const contentParts: any[] = [{ type: 'text', text: message }];
    for (const url of fileUrls) {
      if (isLocalFileUrl(url)) {
        const dataUrl = await fileUrlToBase64DataUrl(url);
        if (dataUrl) {
          contentParts.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } });
        }
      } else {
        contentParts.push({ type: 'image_url', image_url: { url, detail: 'low' } });
      }
    }
    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({ role: 'user', content: message });
  }

  const response = await fetchWithTimeout(agent.apiUrl || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, user: userName, stream: true }),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `OpenAI API 错误: ${response.status} ${err}` };
  }

  const reader = response.body?.getReader();
  if (!reader) return { success: false, error: '无法读取响应流' };

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]' || dataStr === '"[DONE]"') continue;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
            onChunk(delta);
          }
        } catch {}
      }
    }
  }

  if (!fullContent) return { success: false, error: 'OpenAI 流式响应为空' };

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized };
}

async function proxyCozeAgentStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  // 有附件时提示不支持（stream_run 自定义接口无统一上传标准）
  if (fileUrls && fileUrls.length > 0) {
    message = message + '（用户发送了附件，但当前接入方式不支持附件识别）';
  }

  const baseUrl = agent.apiUrl || '';
  if (!baseUrl) return { success: false, error: 'Coze Agent 需要 API URL' };

  const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
  const projectId = extra.projectId || '';
  if (!projectId) return { success: false, error: 'Coze Agent 需要 Project ID' };

  const sessionId = `student_${userName}`;

  const body: any = {
    project_id: Number(projectId),
    content: {
      query: {
        prompt: [
          {
            type: 'text',
            content: {
              text: message,
            },
          },
        ],
      },
    },
    type: 'query',
    session_id: sessionId,
  };

  const streamUrl = baseUrl.includes('/stream_run') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/stream_run`;
  const response = await fetchWithTimeout(streamUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Coze Agent API 错误 (${response.status}): ${err}` };
  }

  const reader = response.body?.getReader();
  if (!reader) return { success: false, error: '无法读取响应流' };

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let debugEvents: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim() && debugEvents.length < 20) {
        debugEvents.push({ raw: line.slice(0, 300) });
      }
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          // SSE 格式: { type: "answer", content: { answer: "文本片段", thinking: null, ... } }
          const contentVal = parsed.content?.answer ?? parsed.answer ?? parsed.text ?? parsed.output ?? parsed.message ?? parsed.delta ?? null;
          if (contentVal !== null) {
            const extracted = extractContent(contentVal);
            fullContent += extracted;
            onChunk(extracted);
          } else if (debugEvents.length < 20) {
            debugEvents.push(parsed);
          }
        } catch {
          if (debugEvents.length < 20) {
            debugEvents.push({ rawData: dataStr.slice(0, 300) });
          }
        }
      }
    }
  }

  if (!fullContent) {
    return { success: false, error: `Coze Agent 流式响应为空，调试: ${JSON.stringify(debugEvents)}` };
  }

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized };
}

// ---- 智谱清言 Assistant API ----

/** 获取智谱清言 access_token（两步鉴权） */
async function getZhipuaiToken(baseUrl: string, apiKey: string, apiSecret: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/get_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status === 0 && data.result?.access_token) {
      return data.result.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

async function proxyZhipuai(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const baseUrl = agent.apiUrl || 'https://chatglm.cn/chatglm/assistant-api/v1';
  const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
  const apiSecret = extra.apiSecret || '';

  if (!agent.botId) return { success: false, error: '智谱清言需要 assistant_id' };
  if (!apiSecret) return { success: false, error: '智谱清言需要 API Secret' };

  const token = await getZhipuaiToken(baseUrl, agent.apiKey, apiSecret);
  if (!token) return { success: false, error: '获取智谱清言 access_token 失败，请检查 API Key 和 API Secret' };

  // 上传文件并获取 file_id
  const fileIds: string[] = [];
  if (fileUrls && fileUrls.length > 0) {
    for (const url of fileUrls) {
      if (isLocalFileUrl(url)) {
        const fid = await uploadFileToZhipuai(baseUrl, token, url);
        if (fid) fileIds.push(fid);
      }
    }
  }
  const body: any = { assistant_id: agent.botId, prompt: message };
  if (agent.conversationId) body.conversation_id = agent.conversationId;
  if (fileIds.length > 0) body.file_list = fileIds.map(id => ({ file_id: id }));

  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/stream_sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `智谱清言 API 错误 (${response.status}): ${err}` };
  }

  const data = await response.json();
  if (data.status !== 0) {
    return { success: false, error: `智谱清言返回错误: ${data.message || '未知错误'}` };
  }

  // 提取文本输出
  let fullContent = '';
  const output = data.result?.output || [];
  for (const part of output) {
    const contents = part.content || [];
    for (const item of (Array.isArray(contents) ? contents : [contents])) {
      if (item.type === 'text' && item.text) {
        fullContent += item.text;
      }
    }
  }

  if (!fullContent) {
    const snippet = JSON.stringify(data).slice(0, 300);
    return { success: false, error: `智谱清言返回为空，响应: ${snippet}` };
  }

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  const convId = data.result?.conversation_id || agent.conversationId;
  return { success: true, content: deanonymized, conversationId: convId };
}

async function proxyZhipuaiStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  const baseUrl = agent.apiUrl || 'https://chatglm.cn/chatglm/assistant-api/v1';
  const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
  const apiSecret = extra.apiSecret || '';

  if (!agent.botId) return { success: false, error: '智谱清言需要 assistant_id' };
  if (!apiSecret) return { success: false, error: '智谱清言需要 API Secret' };

  const token = await getZhipuaiToken(baseUrl, agent.apiKey, apiSecret);
  if (!token) return { success: false, error: '获取智谱清言 access_token 失败，请检查 API Key 和 API Secret' };

  const fileIds: string[] = [];
  if (fileUrls && fileUrls.length > 0) {
    for (const url of fileUrls) {
      if (isLocalFileUrl(url)) {
        const fid = await uploadFileToZhipuai(baseUrl, token, url);
        if (fid) fileIds.push(fid);
      }
    }
  }
  let streamConvId = agent.conversationId || '';
  const body: any = { assistant_id: agent.botId, prompt: message };
  if (agent.conversationId) body.conversation_id = agent.conversationId;
  if (fileIds.length > 0) body.file_list = fileIds.map(id => ({ file_id: id }));

  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/stream`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `智谱清言 API 错误 (${response.status}): ${err}` };
  }

  const reader = response.body?.getReader();
  if (!reader) return { success: false, error: '无法读取响应流' };

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          // 提取 conversation_id
          if (!streamConvId && parsed.conversation_id) streamConvId = parsed.conversation_id;
          // Result: { history_id, conversation_id, message: { role, content: { type, text }, status }, status }
          if (parsed.message?.content?.type === 'text' && parsed.message.content.text) {
            const text = parsed.message.content.text;
            // SSE 事件可能发累积文本，取增量部分
            const delta = text.startsWith(fullContent) ? text.slice(fullContent.length) : text;
            if (delta) {
              fullContent += delta;
              onChunk(delta);
            }
          }
        } catch {}
      }
    }
  }

  if (!fullContent) return { success: false, error: '智谱清言流式响应为空' };

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized, conversationId: streamConvId || undefined };
}

// ---- 文心智能体平台（百度） ----

/** 文件扩展名到 type 映射 */
const wenxinFileType: Record<string, string> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.webp': 'image', '.gif': 'image', '.svg': 'image',
};
const WENXIN_PORT = parseInt(process.env.PORT || '3001', 10);

/** 构建文心 API 请求 body */
function buildWenxinBody(message: string, userName: string, fileUrls?: string[], threadId?: string) {
  // 文心 API 不支持文件上传和本地图片 URL，有附件时仍以文本发送
  const finalMessage = (fileUrls && fileUrls.length > 0)
    ? `${message}（用户发送了附件，但当前平台不支持附件识别）`
    : message;
  let contentType = 'text';
  let contentValue: any = { showText: finalMessage };

  const body: any = {
    message: {
      content: { type: contentType, value: contentValue },
    },
    source: '',
    from: 'openapi',
    openId: userName,
  };
  if (threadId) body.threadId = threadId;
  return body;
}

/** 从文心 API 响应中提取文本内容 */
function extractWenxinContent(data: any): string {
  const contents = data?.content || [];
  let text = '';
  for (const item of contents) {
    // 实际 dataType 可能是 'text' / 'markdown' / 'txt' 等
    if (item.data && typeof item.data === 'string') {
      text += item.data;
    } else if (item.data?.text) {
      text += item.data.text;
    } else if (item.data?.content) {
      text += item.data.content;
    }
  }
  return text;
}

/** 获取文心 API 基础 URL（含 appId + secretKey 认证） */
function wenxinUrl(agent: AgentConfig): string {
  const baseUrl = agent.apiUrl || 'https://agentapi.baidu.com';
  const appId = agent.botId || '';
  const secretKey = agent.apiKey;
  return `${baseUrl.replace(/\/+$/, '')}/assistant/getAnswer?appId=${encodeURIComponent(appId)}&secretKey=${encodeURIComponent(secretKey)}`;
}

function wenxinConversationUrl(agent: AgentConfig): string {
  const baseUrl = agent.apiUrl || 'https://agentapi.baidu.com';
  const appId = agent.botId || '';
  const secretKey = agent.apiKey;
  return `${baseUrl.replace(/\/+$/, '')}/assistant/conversation?appId=${encodeURIComponent(appId)}&secretKey=${encodeURIComponent(secretKey)}`;
}

async function proxyWenxin(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  try {
    if (!agent.botId) return { success: false, error: '文心智能体需要填写 App ID' };

    const body = buildWenxinBody(message, userName, fileUrls, agent.conversationId || undefined);
    body.source = agent.botId;

    const url = wenxinUrl(agent);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `文心 API 错误 (${response.status}): ${err}` };
    }

    const data = await response.json();

    if (data.status !== 0) {
      return { success: false, error: `文心 API 返回错误: ${data.message || '未知错误'} (code=${data.status})` };
    }

    const content = extractWenxinContent(data.data);
    if (!content) return { success: false, error: '文心智能体返回为空' };

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(content));
    const threadId = data.data?.threadId || agent.conversationId;
    return { success: true, content: deanonymized, conversationId: threadId };
  } catch (error: any) {
    return { success: false, error: error.message || '文心 API 请求失败' };
  }
}

async function proxyWenxinStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  try {
    if (!agent.botId) return { success: false, error: '文心智能体需要填写 App ID' };

    const body = buildWenxinBody(message, userName, fileUrls, agent.conversationId || undefined);
    body.source = agent.botId;

    const url = wenxinConversationUrl(agent);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `文心 API 错误 (${response.status}): ${err}` };
    }

    // 流式响应：SSE 格式
    const reader = response.body?.getReader();
    if (!reader) return { success: false, error: '无法读取响应流' };

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '[DONE]') continue;

        // SSE 格式: event: type\ndata: {...}
        if (trimmed.startsWith('event:')) continue; // 跳过 event 行
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);
          // 文心流式 SSE 响应格式
          const raw = parsed.content || parsed.text || parsed.data || '';
          const delta = typeof raw === 'string' ? raw : (raw?.text || raw?.content || '');
          if (delta) {
            fullContent += delta;
            onChunk(delta);
          }
        } catch {
          // 非 JSON 数据行跳过
        }
      }
    }

    if (!fullContent) {
      // 流式不通时回退到非流式
      console.log('[WenxinStream] Empty, falling back to non-streaming');
      return await proxyWenxin(agent, message, userName, history, fileUrls);
    }

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
    return { success: true, content: deanonymized, conversationId: agent.conversationId || undefined };
  } catch (error: any) {
    return { success: false, error: error.message || '文心 API 请求失败' };
  }
}

/** 上传本地文件到智谱清言，返回 file_id */
async function uploadFileToZhipuai(baseUrl: string, token: string, fileUrl: string): Promise<string | null> {
  try {
    const filePath = resolveLocalPath(fileUrl);
    if (!fs.existsSync(filePath)) {
      console.error('[ZhipuaiUpload] File not found:', filePath);
      return null;
    }
    const fileName = path.basename(fileUrl);
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif',
      '.pdf': 'application/pdf', '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.md': 'text/markdown',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/file_upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('[ZhipuaiUpload] Error:', response.status, err);
      return null;
    }
    const data = await response.json();
    return data.result?.file_id || null;
  } catch (error) {
    console.error('[ZhipuaiUpload] Exception:', error);
    return null;
  }
}

/** 测试文心智能体连通性 */
export async function testWenxinConnection(agent: AgentConfig): Promise<{ success: boolean; error?: string }> {
  try {
    if (!agent.botId) return { success: false, error: '缺少 App ID' };
    const result = await proxyWenxin(agent, '你好，请回复"连接成功"', 'test');
    if (result.success) return { success: true };
    return { success: false, error: result.error || '连接失败' };
  } catch (error: any) {
    return { success: false, error: error.message || '测试请求异常' };
  }
}
