/**
 * ★ M7（独立审查抓到）：区分「**404 = 这种东西还没有**」与「真失败」的那一点判断。
 *
 * 🔴 **本文件一个 import 都没有，这是硬要求** —— 与 `server/src/services/analysis-gate.ts`
 * 同一条理由（那个文件被 `src/lib/analysis-gate-parity.test.ts` 跨工程加载）：
 * 前端用例用 `node --test` **直接跑 TS 源**，
 * 而 `api.ts` 里全是无扩展名的 import（`./api-base` 等），Node 解析不了
 * （`Cannot find module '…/src/lib/api-base'`）⇒ **凡是需要被用例加载的模块，自己不能有 import**。
 *
 * 为什么这件事值得单独一个模块 + 用例：浮层原先写的是 `catch {}` ——
 * 把**一切**异常都当成「还没算过」，于是网络断 / 500 / 库坏都会**触发一次 POST**（会写库），
 * 而教师看到的是第二次调用的错误、第一次的真因被丢掉。
 * 「是不是 404」就是那个判断，所以它值得离开 JSX 与 `api.ts` 住到这里来。
 */

/**
 * 请求失败。**带上状态码** —— 调用方常需要区分「404 = 还没有」与「真失败」，
 * 而只靠 `message` 里的文案去分辨是脆的（文案会改）。
 *
 * ⚠️ 它是 `Error` 的子类，所以既有那些 `e instanceof Error` 的 catch 一条都不受影响。
 *
 * ⚠️ **不能写成 TS 的「参数属性」**（`constructor(message: string, readonly status: number)`）：
 * 本仓的前端用例直接跑 TS 源，而 Node 的类型擦除**不支持参数属性**
 * （`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。`tsc` 与 Next 的构建都吃得下，
 * 所以这个坑**只在用例里现形** —— 而那时整个文件都加载不了。
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** 这个错误是不是「服务端说没有这种东西」。**只有它**该被当成「还没算过，去算一次」。 */
export function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
