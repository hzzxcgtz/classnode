import type { AnalysisPayload } from './analysis-payload.js';

/**
 * ★ M7b：分析型的**编排层**。**不碰网络** —— 真正发出去的那一次在 `ai-proxy.ts` 的
 * `proxyAnalysisRequest`（**全仓唯一一处 `fetch` 到第三方**，见规格 §3.3）。
 *
 * ⚠️ 预览那几行**不在这里** —— 它们在前端的 `analysis-preview.ts`。两条理由：
 * ① 那几行要用 `moduleCountUnit(mode)` 定「人 / 组」的量词，而那个函数是**前端**的
 * （`worksheet-tile-state.ts:263`）—— 放这边就得再抄一把尺子，而「参与者单位」这个坑
 * 本项目已被咬过两次（M5a 与 M6c）；
 * ② 它是**隐私闸门的实质文本**（用户裁定 3），必须有测试，而前端 runner 跑得到
 * `src/**` 里的纯模块。
 * ⇒ **判断在这边**（`analysisGateOf`），**措辞在那边**，两者由端点响应里的
 * `canSend.reason` 串起来：这边说「不能发、因为 X」，那边把 X 混进那几行里说出来。
 */

/** 一份**能收图**的平台清单。实测依据写在规格 §2.1（每一条都有逐字出处）。 */
export const IMAGE_CAPABLE_PLATFORMS: readonly string[] = ['coze'];

/** 解读的长度上限。与 M7a 的 `ANSWER_TEXT_MAX` 同一条纪律：截断要**说出来**。 */
export const NARRATIVE_MAX = 4000;

/**
 * 归一化模型的返回。**空白与坏值一律回空串** —— 而调用方见到空串就**不写库**。
 *
 * 🔴 把 `narrative` 写成空串的后果是「界面上原本那段解读消失了」，而**没有任何报错**。
 * 模型返回废话（而不是报错）是最常见的一种失败，而本机验不了它 —— 所以这条判据
 * 必须在这里、必须有测试。
 */
export function normalizeNarrative(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed.length <= NARRATIVE_MAX) return trimmed;
  return `${trimmed.slice(0, NARRATIVE_MAX)}\n（已截断：原文共 ${trimmed.length} 字，只保留前 ${NARRATIVE_MAX} 字）`;
}

/**
 * 发之前的两道闸里的**第一道**（第二道在 `proxyAnalysisRequest` 里）。
 *
 * ⚠️ 它只判**两件事**：「有没有内容可发」与「这个平台收不收得了这份载荷的形态」。
 * 「有没有指定智能体」「智能体启没启用」不在这里 —— 那两件是端点在读库时才知道的
 * （`SETTINGS.analysisAgentId` 与 `agent.enabled`），它们的 `reason` 由端点自己拼。
 */
export function analysisGateOf(
  payload: { covered: number; payloadKind: 'text' | 'image' | 'mixed' },
  platform: string,
): { ok: true } | { ok: false; reason: string } {
  if (payload.covered === 0) {
    return { ok: false, reason: '这道题还没有已提交的作答 —— 发一个空载荷只会得到一段编造的解读。' };
  }
  const hasImage = payload.payloadKind === 'image' || payload.payloadKind === 'mixed';
  if (hasImage && !IMAGE_CAPABLE_PLATFORMS.includes(platform)) {
    return {
      ok: false,
      reason: `当前平台的智能体（${platform}）**收不了图** —— 这份载荷里有手写/绘图内容。`
        + '请在学习单里改用一个 **Coze** 平台的分析型智能体。',
    };
  }
  return { ok: true };
}

/** 固定引导语（**进代码**）。具体要什么口径由教师写在平台的提示词里（规格 §3.7）。 */
const LEAD = '请分析下面这份全班作答，指出典型错误与共同困难。';

/**
 * 载荷 → 发给模型的那段文本。
 *
 * 🔴 **它已经是伪名**（M7a 的 `buildAnalysisPayload` 给的）—— 这里不许再去查真名，
 * 也**不经过 `anonymizer`**（规格 §2.3：分析是班级级的、没有「那个学生」，
 * 而往映射表里塞一条不是学生的记录会加快它重置，重置会换掉**正在进行的一段聊天**里
 * 同一个学生的伪名）。
 */
export function buildAnalysisMessage(payload: AnalysisPayload, labeled = true): string {
  const head = [
    LEAD,
    '',
    `【题目】${payload.questionLabel} · ${payload.typeLabel}`,
    `题干：${payload.prompt || '（题干为空）'}`,
    `已交 ${payload.covered}/${payload.total}`,
    '',
  ].join('\n');
  if (payload.payloadKind === 'text') {
    return `${head}【全班作答（均为代号）】\n${payload.text ?? ''}`;
  }
  const shapes = payload.knobs;
  const note = [
    `【附带】${payload.sheetLayouts.length} 张联系表（手写/绘图作答拼成的图），`
      + `每张 ${shapes.columns} 列、每格 ${shapes.cellWidth}×${shapes.cellHeight} 像素。`,
    '⚠️ 图上凡有「（空白）」的格子表示那一份没有笔画；「（形状认不出）」表示那一份本版解析不了；'
      + '（若有「（文字作答，见文档）」）表示那一份是用键盘答的，内容在同一次的文档里。',
    // 🔴 标签**可能没画出来**（M7a 的运行期探针：打包环境缺 fontconfig 时 sharp 画不出
    // `<text>`，而图本身仍是好的）。那时若还写「每格上方标着代号」，这句话就是**假的**，
    // 而模型会照着它去猜 —— 后果是**分析结果整体错位**。
    // ⇒ 探针说没画出来时，把编号对照**以文本形式附上**（格子顺序 = `entries` 顺序，
    //    M7a 的 `layoutSheets` 保证的）。
    labeled
      ? '每格上方标着该学生的代号（`User_001` 这样）。'
      : '⚠️ **这张图上没有标签**（本机渲染不出文字）—— 请按下面的对照把格子与代号对上，'
        + '格子按行从左到右、每张从第 1 格起连续编号：'
        + payload.entries.map((entry, index) => `第${index + 1}格=${entry.anonLabel}`).join('、'),
  ].join('\n');
  // `mixed` 时文档与图**都要给**（文字那几条只存在于文档里）
  return payload.text
    ? `${head}${note}\n\n【文字作答（均为代号）】\n${payload.text}`
    : `${head}${note}`;
}
