// 获取 API 基础地址
// 生产环境（Tauri 分发版）：前端和 API 同源 → 返回空字符串
// 开发环境（pnpm dev）：前端在 3000，API 在 3001 → 返回 http://localhost:3001
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const port = window.location.port;
    if (port === '3000') return `http://localhost:3001`;
    return '';
  }
  return '';
}
