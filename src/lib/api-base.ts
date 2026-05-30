// 获取 API 基础地址
export function getApiBaseUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:3001`;
}
