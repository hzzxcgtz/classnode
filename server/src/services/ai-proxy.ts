import { anonymizer } from './anonymizer.js';
import { CozeBot } from './coze-bot/index.js';
import type { EnterMessage, StreamCallbacks, MessageData } from './coze-bot/index.js';
import { WenxinBot } from './wenxin/index.js';
import { ZhipuaiBot } from './zhipuai/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FETCH_TIMEOUT_MS = 30_000;

/** 带超时的 fetch，避免上游 AI API 挂起时连接永不释放 */
async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number, signal?: AbortSignal } = {}): Promise<Response> {
  const { timeout = FETCH_TIMEOUT_MS, signal: externalSignal, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => { clearTimeout(timer); controller.abort(); });
    }
  }
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
  // 去除清言等平台的引用标记（如 【0†source】）
  result = result.replace(/【\d+†source】/g, '');
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
  aborted?: boolean;
  followUps?: string[];
}

/**
 * AI API 代理服务
 * 支持 Coze、Coze Agent、智谱清言、文心智能体
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
      case 'zhipuai':
        return await proxyZhipuai(agent, anonMessage, anonName, history, fileUrls);
      case 'wenxin':
        return await proxyWenxin(agent, anonMessage, anonName, history, fileUrls);
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
  fileUrls?: string[],
  signal?: AbortSignal,
  onThinking?: (thinking: string) => void
): Promise<ProxyResult> {
  const anonName = anonymizer.anonymize(studentName);
  const anonMessage = anonymizer.anonymizeMessage(message, studentName);

  try {
    switch (agent.platform) {
      case 'coze':
        return await proxyCozeStream(agent, anonMessage, anonName, onChunk, history, fileUrls, signal, onThinking);
      case 'coze-agent':
        return await proxyCozeAgentStream(agent, anonMessage, anonName, onChunk, history, fileUrls, signal);
      case 'zhipuai':
        return await proxyZhipuaiStream(agent, anonMessage, anonName, onChunk, history, fileUrls, signal);
      case 'wenxin':
        return await proxyWenxinStream(agent, anonMessage, anonName, onChunk, history, fileUrls, signal);
      default:
        return { success: false, error: `不支持的平台: ${agent.platform}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'AI 请求失败' };
  }
}

/** 创建 CozeBot 实例的辅助函数 */
function createCozeBot(agent: AgentConfig): CozeBot {
  return new CozeBot({
    apiKey: agent.apiKey,
    botId: agent.botId || '',
    baseUrl: agent.apiUrl || undefined,
    conversationId: agent.conversationId,
  });
}

/** 上传本地文件到 Coze 并返回 file_id（供多模态消息使用） */
async function uploadFileToCoze(imageUrl: string, coze: CozeBot): Promise<string | null> {
  try {
    const filePath = resolveLocalPath(imageUrl);
    if (!fs.existsSync(filePath)) {
      console.error('[CozeUpload] File not found:', filePath);
      return null;
    }
    const fileData = await coze.file.upload(filePath);
    console.log(`[CozeUpload] Success: file_id=${fileData.id}, name=${fileData.file_name}, size=${fileData.bytes}`);
    return fileData.id;
  } catch (error: any) {
    console.error(`[CozeUpload] Exception for ${imageUrl}:`, error.message || error);
    return null;
  }
}

async function proxyCoze(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[],
  onThinking?: (thinking: string) => void
): Promise<ProxyResult> {
  try {
    const coze = createCozeBot(agent);

    // 构造历史消息 + 当前问题
    // 始终从本地数据库传历史，不依赖 Coze 服务端的对话记忆
    const messages: EnterMessage[] = [];

    if (history) {
      for (const h of history) {
        messages.push({
          role: h.role as 'user' | 'assistant',
          type: h.role === 'assistant' ? 'answer' : 'question',
          content: h.content,
          content_type: 'text',
        });
      }
    }

    // 当前消息（支持多模态）
    if (fileUrls && fileUrls.length > 0) {
      // 上传图片到 Coze
      const fileIds: string[] = [];
      for (const url of fileUrls) {
        const fid = await uploadFileToCoze(url, coze);
        if (fid) fileIds.push(fid);
      }
      const textItems: any[] = [{ type: 'text', text: message }];
      for (const fid of fileIds) {
        textItems.push({ type: 'image', file_id: fid });
      }
      messages.push({
        role: 'user',
        content: JSON.stringify(textItems),
        content_type: 'object_string',
      });
    } else {
      messages.push({
        role: 'user',
        content: message,
        content_type: 'text',
      });
    }

    const result = await coze.chat(message, {
      userName,
      history: messages,
    });

    let content = result.content;

    // 提取深度思考内容
    if (onThinking) {
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        onThinking(anonymizer.deanonymizeMessage(thinkMatch[1]));
      }
    }

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(content));

    return {
      success: true,
      content: deanonymized,
      conversationId: result.conversationId,
    };
  } catch (error: any) {
    console.error('[Coze] Error:', error.message);
    return {
      success: false,
      error: error.message || 'Coze 请求失败',
    };
  }
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
 * 测试 AI 智能体可用性
 * 发送真实消息验证智能体能否正常响应，确保 API 密钥、参数、联网均正常
 */
export async function testAgentAvailability(agent: AgentConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await proxyAIRequest(agent, '你好，请回复"连接成功"', '测试用户');
    if (result.success) return { success: true };
    return { success: false, error: result.error || '可用性测试失败' };
  } catch (error: any) {
    return { success: false, error: error.message || '测试请求异常' };
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

  const sessionId = `student_${userName}`;

  const body: any = {
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

  // project_id：文档标注为 int 类型，但 JS Number 会精度丢失，且 Coze 可能不接受字符串。
  // 对于 *.coze.site 项目专属 URL，Coze 靠域名路由，不传 project_id
  // 对于非 *.coze.site 的自定义 API URL，才需要传 project_id
  // 注：project_id 用占位符替换手法在 JSON 中保持原始精确整数字面量
  const exactProjectId = !baseUrl.includes('.coze.site') ? projectId : '';
  if (exactProjectId) {
    body.project_id = '__EXACT_PROJECT_ID__';
  }

  // 支持用户填写完整 URL 或仅填 base URL
  const streamUrl = baseUrl.includes('/stream_run') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/stream_run`;
  let bodyStr = JSON.stringify(body);
  if (exactProjectId) {
    bodyStr = bodyStr.replace('"__EXACT_PROJECT_ID__"', exactProjectId);
  }
  const response = await fetchWithTimeout(streamUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: bodyStr,
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
      return { success: false, error: `Coze Agent 响应格式异常(${rawText.length}字节): ${rawText.slice(0, 500)}` };
    }
    // 尝试从检测到的 SSE 事件提取更具体的错误信息
    for (const evt of debugEvents) {
      // 优先使用已解析的完整对象（原始行可能被截断）
      const parsed = typeof evt === 'object' && !Array.isArray(evt) && !('raw' in evt) ? evt : null;
      if (parsed?.type === 'message_end' && parsed.content?.message_end) {
        const end = parsed.content.message_end;
        // 文档表明 token_cost.total_tokens 为 0 是正常情况，仅检查 code
        if (end.code && end.code !== '0') {
          return { success: false, error: `Coze Agent 返回错误: code=${end.code} ${end.message || ''}` };
        }
        console.warn('[CozeAgent] message_end 无回答内容:', JSON.stringify(end));
      }
      // 原始行兜底解析（可能被截断，仅做补充）
      const raw = typeof evt === 'string' ? evt : (evt.raw || '');
      if (raw.startsWith('data:')) {
        try {
          const p = JSON.parse(raw.slice(5).trim());
          if (p.code && p.code !== 0 && p.code !== undefined) {
            return { success: false, error: `Coze Agent 返回错误: code=${p.code} ${p.msg || ''}` };
          }
        } catch {}
      }
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
  fileUrls?: string[],
  signal?: AbortSignal,
  onThinking?: (thinking: string) => void
): Promise<ProxyResult> {
  try {
    const coze = createCozeBot(agent);

    // 构造历史消息 + 当前问题
    // 始终从本地数据库传历史，不依赖 Coze 服务端的对话记忆（后者不可靠，易丢失上下文）
    const messages: EnterMessage[] = [];

    if (history) {
      for (const h of history) {
        messages.push({
          role: h.role as 'user' | 'assistant',
          type: h.role === 'assistant' ? 'answer' : 'question',
          content: h.content,
          content_type: 'text',
        });
      }
    }

    // 当前消息（支持多模态）
    if (fileUrls && fileUrls.length > 0) {
      // 新 API 支持流式多模态，不再回退到非流式
      const fileIds: string[] = [];
      for (const url of fileUrls) {
        const fid = await uploadFileToCoze(url, coze);
        if (fid) fileIds.push(fid);
      }
      console.log(`[CozeStream] Uploaded ${fileIds.length}/${fileUrls.length} files, ids:`, fileIds);
      const textItems: any[] = [{ type: 'text', text: message }];
      for (const fid of fileIds) {
        textItems.push({ type: 'image', file_id: fid });
      }
      messages.push({
        role: 'user',
        content: JSON.stringify(textItems),
        content_type: 'object_string',
      });
    } else {
      messages.push({
        role: 'user',
        content: message,
        content_type: 'text',
      });
    }

    let fullContent = '';
    let streamConvId = agent.conversationId || '';
    let streamChatId = '';
    const followUps: string[] = [];

    const callbacks: StreamCallbacks = {
      onMessageCompleted(msg) {
        // 收集深度思考内容
        if (onThinking && msg.reasoning_content) {
          onThinking(msg.reasoning_content);
        }
      },
      onFollowUp(question) {
        followUps.push(question);
      },
      onDelta(chunk, _messageId) {
        fullContent += chunk;
        onChunk(chunk);
      },
      onChatCompleted(chat) {
        streamConvId = chat.conversation_id || streamConvId;
        streamChatId = chat.id || streamChatId;
      },
    };

    // 图片已由上方处理并放入 history，不再传 fileUrls（避免 chatStream 二次构造多模态消息）
    // 不传 conversationId——上下文通过 additional_messages 的 history 提供，避免 Coze 服务端重复加载
    const result = await coze.chatStream(
      message,
      {
        userName,
        history: messages,
      },
      callbacks,
      signal
    );

    streamConvId = result.conversationId || streamConvId;

    if (!fullContent) {
      return { success: false, error: 'Coze 流式响应为空' };
    }

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
    if (followUps.length > 0) {
      console.log(`[CozeStream] followUps: ${JSON.stringify(followUps)}`);
    }
    return {
      success: true,
      content: deanonymized,
      conversationId: streamConvId || undefined,
      followUps: followUps.length > 0 ? followUps : undefined,
    };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      // 被取消时，返回已收集到的内容
      return { success: false, aborted: true };
    }
    console.error('[CozeStream] Error:', e.message);
    return { success: false, error: e.message || 'Coze 流式请求失败' };
  }
}

async function proxyCozeAgentStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[],
  signal?: AbortSignal
): Promise<ProxyResult> {
  // 有附件时提示不支持（stream_run 自定义接口无统一上传标准）
  if (fileUrls && fileUrls.length > 0) {
    message = message + '（用户发送了附件，但当前接入方式不支持附件识别）';
  }

  const baseUrl = agent.apiUrl || '';
  if (!baseUrl) return { success: false, error: 'Coze Agent 需要 API URL' };

  const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
  const projectId = extra.projectId || '';

  const sessionId = `student_${userName}`;

  const body: any = {
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

  // project_id 用占位符替换手法在 JSON 中保持原始精确整数字面量
  const exactProjectId = projectId;
  if (exactProjectId) {
    body.project_id = '__EXACT_PROJECT_ID__';
  }

  const streamUrl = baseUrl.includes('/stream_run') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/stream_run`;
  let bodyStr = JSON.stringify(body);
  if (exactProjectId) {
    bodyStr = bodyStr.replace('"__EXACT_PROJECT_ID__"', exactProjectId);
  }
  const response = await fetchWithTimeout(streamUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: bodyStr,
    signal,
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

  try {
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
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return { success: !!(fullContent || fullContent.trim()), content: fullContent || undefined, aborted: true };
    }
    throw e;
  }

  if (!fullContent) {
    for (const evt of debugEvents) {
      try {
        if (evt.type === 'message_end' && evt.content?.message_end) {
          const end = evt.content.message_end;
          // 文档表明 token_cost.total_tokens 为 0 是正常情况，仅检查 code
          if (end.code && end.code !== '0') {
            return { success: false, error: `Coze Agent 返回错误: code=${end.code} ${end.message || ''}` };
          }
          console.warn('[CozeAgentStream] message_end 无回答内容:', JSON.stringify(end));
        }
      } catch {}
    }
    return { success: false, error: `Coze Agent 流式响应为空，调试: ${JSON.stringify(debugEvents)}` };
  }

  const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
  return { success: true, content: deanonymized };
}

// ---- 智谱清言 Assistant API ----

async function proxyZhipuai(
  agent: AgentConfig,
  message: string,
  userName: string,
  history?: { role: string; content: string }[],
  fileUrls?: string[]
): Promise<ProxyResult> {
  try {
    const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
    const apiSecret = extra.apiSecret || '';

    if (!agent.botId) return { success: false, error: '智谱清言需要 assistant_id' };
    if (!apiSecret) return { success: false, error: '智谱清言需要 API Secret' };

    const bot = new ZhipuaiBot({
      assistantId: agent.botId,
      apiKey: agent.apiKey,
      apiSecret,
      baseUrl: agent.apiUrl || undefined,
      conversationId: agent.conversationId,
    });

    // 上传文件
    const fileIds: string[] = [];
    if (fileUrls && fileUrls.length > 0) {
      for (const url of fileUrls) {
        if (isLocalFileUrl(url)) {
          const filePath = resolveLocalPath(url);
          if (fs.existsSync(filePath)) {
            const fileName = path.basename(url);
            const mimeType = getFileMimeType(fileName);
            const fid = await bot.uploadFile(filePath, fileName, mimeType);
            if (fid) fileIds.push(fid);
          }
        }
      }
    }

    const result = await bot.sendMessage(message, {
      conversationId: agent.conversationId,
      fileIds: fileIds.length > 0 ? fileIds : undefined,
    });

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(result.content));
    return {
      success: true,
      content: deanonymized,
      conversationId: result.conversationId,
    };
  } catch (error: any) {
    return { success: false, error: error.message || '智谱清言请求失败' };
  }
}

async function proxyZhipuaiStream(
  agent: AgentConfig,
  message: string,
  userName: string,
  onChunk: (chunk: string) => void,
  history?: { role: string; content: string }[],
  fileUrls?: string[],
  signal?: AbortSignal
): Promise<ProxyResult> {
  try {
    const extra = agent.extra ? safeParseJSON<any>(agent.extra, {}) : {};
    const apiSecret = extra.apiSecret || '';

    if (!agent.botId) return { success: false, error: '智谱清言需要 assistant_id' };
    if (!apiSecret) return { success: false, error: '智谱清言需要 API Secret' };

    const bot = new ZhipuaiBot({
      assistantId: agent.botId,
      apiKey: agent.apiKey,
      apiSecret,
      baseUrl: agent.apiUrl || undefined,
      conversationId: agent.conversationId,
    });

    // 上传文件
    const fileIds: string[] = [];
    if (fileUrls && fileUrls.length > 0) {
      for (const url of fileUrls) {
        if (isLocalFileUrl(url)) {
          const filePath = resolveLocalPath(url);
          if (fs.existsSync(filePath)) {
            const fileName = path.basename(url);
            const mimeType = getFileMimeType(fileName);
            const fid = await bot.uploadFile(filePath, fileName, mimeType);
            if (fid) fileIds.push(fid);
          }
        }
      }
    }

    let fullContent = '';

    const result = await bot.sendMessageStream(
      message,
      {
        conversationId: agent.conversationId,
        fileIds: fileIds.length > 0 ? fileIds : undefined,
      },
      {
        onDelta(chunk) {
          fullContent += chunk;
          onChunk(chunk);
        },
      },
      signal
    );

    if (!fullContent) {
      return { success: false, error: '智谱清言流式响应为空' };
    }

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));

    // 追问建议生成
    const followUps = await generateZhipuaiFollowUps(bot, result.conversationId);

    return {
      success: true,
      content: deanonymized,
      conversationId: result.conversationId || undefined,
      followUps: followUps.length > 0 ? followUps : undefined,
    };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return { success: false, aborted: true };
    }
    return { success: false, error: e.message || '智谱清言请求失败' };
  }
}

/**
 * 使用清言原生 suggest/prompts API 生成追问建议
 *
 * 文档：POST /suggest/prompts → { conversation_id } → { status, result: { list: string[] } }
 * log_id 的语义是获取"某条历史记录的缓存结果"，新对话的追问尚未生成过，不该传
 */
async function generateZhipuaiFollowUps(
  bot: ZhipuaiBot,
  conversationId: string
): Promise<string[]> {
  if (!conversationId) return [];

  return await bot.suggestPrompts(conversationId);
}

// ---- 文心智能体平台（百度） ----

/** 创建 WenxinBot 实例的辅助函数 */
function createWenxinBot(agent: AgentConfig): WenxinBot {
  return new WenxinBot({
    appId: agent.botId || '',
    secretKey: agent.apiKey,
    baseUrl: agent.apiUrl || undefined,
    threadId: agent.conversationId,
  });
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

    // 文心 API 暂不支持图片/文件识别，有附件时追加文字说明
    const finalMessage = (fileUrls && fileUrls.length > 0)
      ? `${message}\n\n（用户上传了图片附件，请查看聊天记录中的图片）`
      : message;

    const bot = createWenxinBot(agent);

    const result = await bot.sendMessage(finalMessage, {
      userName,
      threadId: agent.conversationId || undefined,
    });


    if (!result.content) {
      return { success: false, error: "文心智能体返回为空" };
    }

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(result.content));

    return {
      success: true,
      content: deanonymized,
      conversationId: result.threadId,
    };
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
  fileUrls?: string[],
  signal?: AbortSignal
): Promise<ProxyResult> {
  try {
    if (!agent.botId) return { success: false, error: '文心智能体需要填写 App ID' };

    // 文心 API 暂不支持图片/文件识别，有附件时追加文字说明
    const finalMessage = (fileUrls && fileUrls.length > 0)
      ? `${message}\n\n（用户上传了图片附件，请查看聊天记录中的图片）`
      : message;

    const bot = createWenxinBot(agent);

    let fullContent = '';
    let streamError: string | null = null;

    const result = await bot.sendMessageStream(
      finalMessage,
      {
        userName,
        threadId: agent.conversationId || undefined,
      },
      {
        onDelta(chunk) {
          fullContent += chunk;
          onChunk(chunk);
        },
        onError(err) {
          streamError = err.message;
          console.error('[WenxinStream] SSE 错误:', err.code, err.message);
        },
      },
      signal
    );

    if (!fullContent) {
      // 流为空：优先返回 SSE 中的错误信息，再回退到非流式
      if (streamError) {
        return { success: false, error: streamError };
      }
      const fallback = await proxyWenxin(agent, message, userName, history, fileUrls);
      if (fallback.success && fallback.content) {
        onChunk(fallback.content);
        return {
          ...fallback,
          content: fallback.content,
        };
      }
      return fallback;
    }

    const deanonymized = cleanResponse(anonymizer.deanonymizeMessage(fullContent));
    return {
      success: true,
      content: deanonymized,
      conversationId: result.threadId || undefined,
    };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return { success: false, aborted: true };
    }
    return { success: false, error: e.message || '文心 API 请求失败' };
  }
}
/** 根据文件名获取 MIME 类型 */
function getFileMimeType(fileName: string): string {
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
  return mimeMap[ext] || 'application/octet-stream';
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
