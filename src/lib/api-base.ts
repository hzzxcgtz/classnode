// 获取 API 基础地址
// 开发环境（pnpm dev）：返回 Express 后端地址
// 生产环境（Tauri 分发版）：前端和 API 同源 → 返回空字符串
//
// 后端端口通过 .env.development 中的 NEXT_PUBLIC_API_PORT 配置（默认 3001）
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  // @ts-expect-error Next.js 在构建时替换 NEXT_PUBLIC_ 环境变量
  const apiPort = process.env.NEXT_PUBLIC_API_PORT;
  if (apiPort && window.location.port !== apiPort) {
    return `http://${window.location.hostname}:${apiPort}`;
  }
  return '';
}

// 获取学生端访问地址的端口部分
// 开发模式使用 NEXT_PUBLIC_API_PORT（Express 端口），生产模式同源
export function getClassroomPort(): string {
  if (typeof window === 'undefined') return '3001';
  // @ts-expect-error Next.js 在构建时替换 NEXT_PUBLIC_ 环境变量
  const apiPort = process.env.NEXT_PUBLIC_API_PORT;
  if (apiPort && window.location.port !== apiPort) {
    return apiPort;
  }
  return window.location.port;
}
