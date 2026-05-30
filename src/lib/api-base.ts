// 后端端口：构建时通过 NEXT_PUBLIC_BACKEND_PORT 传入
const BACKEND_PORT: string = process.env.NEXT_PUBLIC_BACKEND_PORT || '3001';

// 获取 API 基础地址
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured;
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:${BACKEND_PORT}`;
}
