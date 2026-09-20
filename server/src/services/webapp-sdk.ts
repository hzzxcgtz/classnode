export const SDK_PATH = '/__classnode/sdk.js';

/**
 * 在返回给学生的 HTML 里注入 SDK。
 *
 * ⚠️ **本文件是 T1 与 T4 的唯一接缝。** T1 只建这个「原样返回」的桩，让托管服务
 * 有一个具名的调用点；T4 实现真正的注入。**T4 只改这个文件，不得改 webapp-host.ts。**
 *
 * 这么做是因为 T1 与 T4 都要动「返回 HTML」这条路径：若 T1 什么都不留、T4 再去
 * webapp-host.ts 里加，两个任务就会改同一个文件的同一段（派发前冲突扫描已识别）。
 */
export function injectSdk(html: string, _opts: { sdkPath: string }): string {
  return html; // T4 替换本行
}
