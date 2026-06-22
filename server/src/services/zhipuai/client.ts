// ============================================================
// 智谱清言 — HTTP 客户端
// 两步鉴权：apiKey + apiSecret → access_token（带缓存）
// ============================================================
import type { ZhipuaiAgentConfig, TokenResponse } from './types.js';
import { ZHIPUAI_BASE_URL } from './types.js';

const FETCH_TIMEOUT_MS = 30_000;

/** 带超时的 fetch */
async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const { timeout = FETCH_TIMEOUT_MS, signal: externalSignal, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (externalSignal) {
    if (externalSignal.aborted) { controller.abort(); }
    else { externalSignal.addEventListener('abort', () => { clearTimeout(timer); controller.abort(); }); }
  }
  try {
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 自定义错误类 */
export class ZhipuaiClientError extends Error {
  constructor(
    message: string,
    public code?: number,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ZhipuaiClientError';
  }
}

export class ZhipuaiHttpClient {
  readonly baseUrl: string;
  private _apiKey: string;
  private _apiSecret: string;
  private _accessToken: string | null = null;
  private _tokenExpiry: number = 0; // 过期时间戳（秒）
  private _tokenPromise: Promise<string> | null = null; // 防止并发重复获取

  constructor(config: ZhipuaiAgentConfig) {
    this.baseUrl = (config.baseUrl || ZHIPUAI_BASE_URL).replace(/\/+$/, '');
    this._apiKey = config.apiKey;
    this._apiSecret = config.apiSecret;
  }

  /**
   * 获取 access_token
   * 带缓存和自动续期，支持并发去重
   */
  async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // 缓存有效（提前 60 秒续期）
    if (this._accessToken && this._tokenExpiry > now + 60) {
      return this._accessToken;
    }

    // 并发保护：同一时刻多个请求共享一个 token 获取
    if (this._tokenPromise) {
      return this._tokenPromise;
    }

    this._tokenPromise = this._refreshToken().finally(() => {
      this._tokenPromise = null;
    });

    return this._tokenPromise;
  }

  private async _refreshToken(): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/get_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this._apiKey, api_secret: this._apiSecret }),
    });

    if (!response.ok) {
      throw new ZhipuaiClientError(
        `获取 access_token 失败 (HTTP ${response.status})`,
        undefined,
        response.status
      );
    }

    const data: TokenResponse = await response.json();
    if (data.status !== 0 || !data.result?.access_token) {
      throw new ZhipuaiClientError(
        data.message || '获取 access_token 失败，请检查 API Key 和 API Secret'
      );
    }

    this._accessToken = data.result.access_token;
    this._tokenExpiry = now() + data.result.expires_in; // 兜底 1 小时

    return this._accessToken!;
  }

  /** 强制清除缓存的 token */
  clearToken(): void {
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  /**
   * POST JSON 请求（带 token 鉴权，自动续期）
   */
  async post<T>(
    path: string,
    body: Record<string, any>,
    retried?: boolean
  ): Promise<T> {
    const token = await this.getAccessToken();

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // token 过期时自动续期重试一次
      if (response.status === 401 && !retried) {
        this.clearToken();
        return this.post<T>(path, body, true);
      }
      throw new ZhipuaiClientError(
        `API 错误 (${response.status}): ${errText}`,
        undefined,
        response.status
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * POST 流式请求（返回 ReadableStream）
   */
  async postStream(
    path: string,
    body: Record<string, any>,
    signal?: AbortSignal,
    retried?: boolean
  ): Promise<Response> {
    const token = await this.getAccessToken();

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 401 && !retried) {
        this.clearToken();
        return this.postStream(path, body, signal, true);
      }
      throw new ZhipuaiClientError(
        `API 错误 (${response.status}): ${errText}`,
        undefined,
        response.status
      );
    }

    return response;
  }

  /**
   * 上传文件
   * POST /file_upload (multipart/form-data)
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<string | null> {
    try {
      const token = await this.getAccessToken();
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: mimeType });
      formData.append('file', blob, fileName);

      const response = await fetchWithTimeout(`${this.baseUrl}/file_upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[ZhipuaiUpload] Error:', response.status, errText);
        return null;
      }

      const data = await response.json();
      return data.result?.file_id || null;
    } catch (error) {
      console.error('[ZhipuaiUpload] Exception:', error);
      return null;
    }
  }
}

/** 当前 Unix 时间戳（秒） */
function now(): number {
  return Math.floor(Date.now() / 1000);
}
