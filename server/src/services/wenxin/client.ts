// ============================================================
// 文心智能体 API — HTTP 客户端
// 封装：认证方式选择 + URL 构建 + 超时 + 错误码映射
// ============================================================
import type { WenxinAgentConfig, AccessTokenResponse } from './types.js';
import { WENXIN_BASE_URL, getWenxinErrorMessage } from './types.js';

const FETCH_TIMEOUT_MS = 30_000;

/** 文心 API 客户端错误 */
export class WenxinClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly bizCode: number,
    public readonly bizMessage: string,
    public readonly logid?: string
  ) {
    // 优先显示原始业务消息，便于诊断
    super(bizMessage || `文心 API 错误: ${getWenxinErrorMessage(bizCode)} (${bizCode})`);
    this.name = 'WenxinClientError';
  }
}

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number; signal?: AbortSignal } = {}
): Promise<Response> {
  const { timeout = FETCH_TIMEOUT_MS, signal: externalSignal, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort();
      });
    }
  }
  try {
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WenxinHttpClient
 *
 * 支持两种认证方式：
 * 1. appId + secretKey（QueryString 参数，默认方式，对应 getAnswer/conversation API）
 * 2. Bearer Token（OAuth AccessToken，可选）
 */
export class WenxinHttpClient {
  private baseUrl: string;
  private timeout: number;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private config: WenxinAgentConfig) {
    this.baseUrl = (config.baseUrl || WENXIN_BASE_URL).replace(/\/+$/, '');
    this.timeout = FETCH_TIMEOUT_MS;
  }

  /**
   * 获取 Access Token
   * GET /oauth/2.0/token?grant_type=client_credentials&client_id=xxx&client_secret=xxx
   *
   * Token 有效期为 1 个月（2592000 秒），内部自动缓存，过期自动刷新
   */
  async getAccessToken(): Promise<string> {
    // 如果已有未过期的 token，直接返回
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const clientId = this.config.clientId || this.config.appId;
    const clientSecret = this.config.clientSecret || this.config.secretKey;

    if (!clientId || !clientSecret) {
      throw new WenxinClientError(400, -1, '缺少 client_id 或 client_secret');
    }

    const url = `https://openapi.baidu.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      timeout: this.timeout,
    });

    if (!response.ok) {
      throw new WenxinClientError(
        response.status,
        -1,
        `获取 AccessToken HTTP 失败: ${await response.text()}`
      );
    }

    const data: AccessTokenResponse & { error?: string } = await response.json();

    if (data.error || !data.access_token) {
      throw new WenxinClientError(
        400,
        -1,
        `获取 AccessToken 失败: ${data.error_description || data.error || '未知错误'}`
      );
    }

    this.token = data.access_token;
    // expires_in 单位：秒，提前 5 分钟刷新
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

    return this.token!;
  }

  /**
   * 构建 API 请求 URL
   * 根据认证方式决定是 QueryString 还是 Header
   */
  private buildUrl(path: string, useToken: boolean = false): { url: string; headers: Record<string, string> } {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let url = `${this.baseUrl}${path}`;

    if (useToken && this.token) {
      // Token 认证：Bearer Header（文档未明确，保留扩展）
      headers['Authorization'] = `Bearer ${this.token}`;
    } else {
      // 默认：appId + secretKey 作为 QueryString
      const separator = path.includes('?') ? '&' : '?';
      url += `${separator}appId=${encodeURIComponent(this.config.appId)}&secretKey=${encodeURIComponent(this.config.secretKey)}`;
    }

    return { url, headers };
  }

  /**
   * POST JSON 请求并返回解析后的结果
   * 自动处理 HTTP 错误和 Wenxin 业务错误
   */
  async post<T>(
    path: string,
    body: any,
    options?: { signal?: AbortSignal; useToken?: boolean }
  ): Promise<{ data: T; logid: string }> {
    const { url, headers } = this.buildUrl(path, options?.useToken);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: this.timeout,
      signal: options?.signal,
    });

    const raw = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new WenxinClientError(
        response.status,
        -1,
        `非 JSON 响应: ${raw.slice(0, 300)}`
      );
    }

    // Wenxin 通过 status 表示业务成功/失败
    if (parsed.status !== undefined && parsed.status !== 0) {
      throw new WenxinClientError(
        response.status,
        parsed.status,
        parsed.message || '未知错误',
        parsed.logid
      );
    }

    if (!response.ok) {
      throw new WenxinClientError(
        response.status,
        parsed.status || -1,
        `HTTP ${response.status}: ${parsed.message || raw.slice(0, 300)}`,
        parsed.logid
      );
    }

    return {
      data: parsed.data as T,
      logid: parsed.logid,
    };
  }

  /**
   * POST 并返回原始 Response（用于流式 SSE 读取）
   */
  async postStream(
    path: string,
    body: any,
    signal?: AbortSignal
  ): Promise<Response> {
    const { url, headers } = this.buildUrl(path);
    headers['Accept'] = 'text/event-stream';

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: this.timeout,
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new WenxinClientError(
        response.status,
        -1,
        `HTTP ${response.status}: ${errText.slice(0, 500)}`
      );
    }

    return response;
  }
}
