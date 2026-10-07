/**
 * ★ 2026-10-07（教师：「查一下第 11 题为什么会重复保存」）—— **流程图画板的发布闸**。
 *
 * 🔴 这道闸是为了断开一个**自激环**（构造上成立，已在源码里逐条追过）：
 *   ① 画板的发布 effect 依赖里有 `onChange`；
 *   ② `onChange`（`drawing-tool-body.tsx` 的 `update`）的身份取决于 `drawingDocument.image`；
 *   ③ 抓图**每次都上传一个新文件、拿一个新 URL**（`uploadDrawingRaster` 不去重）⇒ `image` 变
 *      ⇒ `onChange` 换身份 ⇒ **effect 重跑**；
 *   ④ 而 effect 里**无条件**调 `onChange(...)`（一次保存）**和** `scheduleRaster()`（又一次抓图）。
 *   ⇒ 每约 1 秒：一次保存 + 一次上传。而学生端**所有题目同时挂载**
 *     （`worksheet-panel.tsx` 把整列题都渲染出来）⇒ **每一块挂着的流程图都在跑这个环**，
 *     与学生在哪一题上画**无关** —— 教师看到的就是「学生在第 12 题上画，第 11 题一直保存」。
 *
 * ⚠️ 思维导图那一档**不犯**这个毛病：它的发布挂在库的事件上（`operation` /
 *   `changeDirection` / `expandNode`），只在学生动手时发生 —— 事件驱动，不是「每次渲染都发」。
 *
 * 🔴 于是判据是「**内容真的变了吗**」，而不是「effect 跑了吗」：
 *   内容没变就不许发、也不许抓图 —— 那两件事都是这次渲染的**副作用**，
 *   而这次渲染可能只是「快照回来了」引起的。
 */

/**
 * 一份流程图内容的**签名**。
 *
 * ⚠️ 用 `JSON.stringify` 而不是对象比较：`nodes` / `edges` 每次渲染都可能换新对象，
 *   而我们要的是「内容一样就不发」。键序由我们的构造顺序决定（`toFlowPayload` 是唯一入口），
 *   所以同一份内容两次得到的串逐字相同。
 */
export function flowPayloadSignature(payload: unknown): string {
  return JSON.stringify(payload ?? null);
}

/**
 * 这一次要不要发布（以及顺带抓一张快照）。
 *
 * `previousSignature` 为 `null` = 还没有发过 = **首帧** ⇒ 要发（首帧要抓快照：
 * 教师设了底稿时，底稿正是靠那张快照进教师那一格的）。
 */
export function shouldPublishFlow(previousSignature: string | null, signature: string): boolean {
  return signature !== previousSignature;
}
