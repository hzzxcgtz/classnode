// ============================================================
// Coze Bot API — HTTP 客户端
// 封装：fetch + 超时 + 限流 + 通用错误处理 + logid 追踪
// ============================================================

const FETCH_TIMEOUT_MS = 30_000;

export interface ClientOptions {
  baseUrl?: string;   // 默认 https://api.coze.cn
  timeout?: number;
}

export class CozeClientError extends Error {
  constructor(
    public statusCode: number,
    public code: number,
    public msg: string,
    public logid?: string
  ) {
    super(`Coze API Error: code=${code} msg=${msg}`);
    this.name = 'CozeClientError';
  }
}

/** 带超时的 fetch，避免上游 AI API 挂起时连接永不释放 */
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

export class CozeHttpClient {
  private baseUrl: string;
  private timeout: number;

  constructor(
    private apiKey: string,
    options?: ClientOptions
  ) {
    this.baseUrl = (options?.baseUrl || 'https://api.coze.cn').replace(/\/+$/, '');
    this.timeout = options?.timeout ?? FETCH_TIMEOUT_MS;
  }

  /** 获取完整请求地址 */
  private url(path: string): string {
    // path 以 / 开头，如 /v3/chat
    return `${this.baseUrl}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /** GET 请求，参数在 URL query 中 */
  async get<T = any>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    let url = this.url(path);
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      timeout: this.timeout,
    });

    return this.handleResponse<T>(response);
  }

  /** POST JSON 请求 */
  async post<T = any>(
    path: string,
    body?: any,
    extraHeaders?: Record<string, string>,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    let url = this.url(path);
    if (queryParams) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(queryParams)) {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      timeout: this.timeout,
    });

    return this.handleResponse<T>(response);
  }

  /** PUT JSON 请求 */
  async put<T = any>(path: string, body?: any): Promise<T> {
    const response = await fetchWithTimeout(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      timeout: this.timeout,
    });

    return this.handleResponse<T>(response);
  }

  /** DELETE 请求 */
  async delete<T = any>(path: string): Promise<T> {
    const response = await fetchWithTimeout(this.url(path), {
      method: 'DELETE',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      timeout: this.timeout,
    });

    return this.handleResponse<T>(response);
  }

  /** multipart/form-data 上传 */
  async upload<T = any>(path: string, formData: FormData): Promise<T> {
    const response = await fetchWithTimeout(this.url(path), {
      method: 'POST',
      headers: {
        ...this.headers(),
        // 不设 Content-Type，让浏览器自动设置 multipart boundary
      },
      body: formData,
      timeout: 60000, // 上传超时 60s
    });

    return this.handleResponse<T>(response);
  }

  /** 流式 POST 请求，返回 Response 供调用者读取 body stream */
  async postStream(
    path: string,
    body?: any,
    signal?: AbortSignal,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<Response> {
    let url = this.url(path);
    if (queryParams) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(queryParams)) {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      timeout: this.timeout,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new CozeClientError(
        response.status,
        response.status,
        `HTTP ${response.status}: ${errText.slice(0, 500)}`
      );
    }

    return response;
  }

  /** 统一处理响应：检查 HTTP 状态 + 解析 JSON + 检查业务 code */
  private async handleResponse<T>(response: Response): Promise<T> {
    const logid = response.headers.get('x-tt-logid') || response.headers.get('x-coze-logid') || undefined;

    if (!response.ok) {
      let errText = '';
      try { errText = await response.text(); } catch {}
      throw new CozeClientError(
        response.status,
        response.status,
        `HTTP ${response.status}: ${errText.slice(0, 500)}`,
        logid
      );
    }

    const text = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CozeClientError(
        response.status,
        -1,
        `非 JSON 响应: ${text.slice(0, 300)}`,
        logid
      );
    }

    // Coze API 返回规范：code === 0 为成功
    if (parsed.code !== undefined && parsed.code !== 0) {
      throw new CozeClientError(
        response.status,
        parsed.code,
        parsed.msg || '未知错误',
        parsed.detail?.logid || logid
      );
    }

    return parsed as T;
  }
}
