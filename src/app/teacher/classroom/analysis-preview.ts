/**
 * ★ M7b：**「本次将发什么」那几行** —— 用户 2026-09-25 裁定 3 的实现。
 *
 * 🔴 它是**承重的**：教师据此决定发不发，而发出去的是**学生的作业**。所以它住在纯模块里、
 * 有回归网，而不是散在 JSX 里（本仓没有 jsdom ⇒ 散进 JSX 的判据**没有任何回归网**）。
 *
 * 🔴 **为什么它在前端而不是服务端**（计划里为这件事单独写过一段）：
 * ① 它要用 `moduleCountUnit(mode)` 定量词，而那个函数是**前端**的
 *    （`worksheet-tile-state.ts:263`）—— 放服务端就得再抄一把尺子，而「参与者单位」
 *    这个坑本项目**已被咬过两次**（M5a 与 M6c）；
 * ② 前端 runner 跑得到 `src/**` 里的纯模块 ⇒ 它测得到。
 * ⇒ **判断在服务端**（`analysisGateOf` 与「有没有指定智能体」都在那一侧有数据），
 * **措辞在这里**，两者由 `blockedReason` 串起来：服务端说「不能发、因为 X」，
 * 这里把 X 逐字混进那几行里说出来。
 *
 * ⚠️ 本文件**不 import 任何东西**（`moduleCountUnit` 由调用方算好传进来）——
 * 与 `src/lib/http-error.ts` 同一条纪律。
 */

/** 服务端那份载荷里、预览要用到的几样（只列用得上的）。 */
export interface AnalysisSendable {
  covered: number;
  total: number;
  payloadKind: 'text' | 'image' | 'mixed';
  /** 联系表的张数（`payloadKind === 'text'` 时是 0）。 */
  sheetCount: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

/**
 * 那几行。**顺序是刻意的**：先「发给谁」，再「发什么」，再「覆盖面」，最后才是那两句提醒 ——
 * 教师扫一眼就能决定。
 */
export function analysisPreviewLines(input: {
  agentName: string;
  platform: string;
  sendable: AnalysisSendable;
  /** 「人」/「组」—— 由调用方用 `moduleCountUnit(mode)` 算好传进来。 */
  unit: string;
  /** 服务端 `canSend` 那一格：不能发时 `reason` 逐字说明（会被逐字显示）。 */
  blockedReason?: string | null;
}): string[] {
  const { agentName, platform, sendable, unit, blockedReason } = input;
  const lines = [
    `发给：${agentName}（${platform}）`,
    sendable.payloadKind === 'text'
      ? '本次内容：一份聚合文档（全部是文字作答）'
      : `本次内容：${sendable.sheetCount} 张联系表`
        + `（${sendable.columns} 列 × 每格 ${sendable.cellWidth}×${sendable.cellHeight} 像素）`,
    // ⚠️ 量词来自 `unit`，**不写死**。
    `已交 ${sendable.covered}/${sendable.total} ${unit}`,
    '内容里一律是代号（User_001…），不含学生真实姓名',
    // 🔴 这一句**始终**在（哪怕这次不能发）—— `coze.chat()` 硬编了 `auto_save_history: true`
    // （`coze-bot/index.ts:122`），所以**平台侧会留存**。知情同意的实质是「知道」。
    '⚠️ 第三方平台会留存这次对话（这是它的默认行为，本版没有关掉它）',
  ];
  if (sendable.payloadKind === 'mixed') {
    // 教师最容易只想到文档那半 —— 而联系表也一起发出去。
    lines.push('⚠️ 本题有两种作答方式：文档与联系表各是一部分，**两样都会发出去**');
  }
  if (blockedReason) lines.push(`⚠️ ${blockedReason}`);
  return lines;
}
