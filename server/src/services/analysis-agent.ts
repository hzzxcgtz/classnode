import type { AnalysisPayload } from './analysis-payload.js';

/**
 * ★ M7b：分析型的**编排层**。**不碰网络** —— 真正发出去的那一次在 `ai-proxy.ts` 的
 * `proxyAnalysisRequest`（**全仓唯一一处 `fetch` 到第三方**，见规格 §3.3）。
 *
 * 能否发送由这里的 `analysisGateOf` 与端点共同判断，并通过 `canSend.reason` 返回前端。
 * 前端的后台任务在真正外发前读取这道闸；不满足时直接提示原因，不调用第三方平台。
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
  // 🔴 **不能只判 `trim() === ''`**：`trim()` 不认识 U+200B（零宽空格）与 U+FEFF（BOM）
  // ⇒ 模型只回一个零宽字符时，`narrative` 会变成「有值但看不见」，而界面那块「AI 解读」
  // 渲染出来是**空白**的 —— 教师以为分析过了。判据是「去掉所有空白**与格式类字符**
  // （`\p{Cf}`）之后是否为空」，而**返回的仍是原文本**（只做首尾 trim，不改中间的内容）。
  if (trimmed.replace(/[\s\p{Cf}]/gu, '') === '') return '';
  if (trimmed.length <= NARRATIVE_MAX) return trimmed;
  // ⚠️ 一个 emoji 是**代理对**（2 个 code unit）。切在中间会留下半个 —— 它会一路进库，
  // 而某些渲染路径遇到孤立代理会显示成「�」。⇒ 末尾是**高代理**时多退一个。
  let cut = trimmed.slice(0, NARRATIVE_MAX);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}\n（已截断：原文共 ${trimmed.length} 字，只保留前 ${NARRATIVE_MAX} 字）`;
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
  // 🔴 **本版只接 coze，不分有没有图**（独立审查 I1 修的口径）。
  //
  // 原先这里只挡「有图 + 非 coze」，而 `proxyAnalysisRequest` 对**任何**非 coze 都直接回失败
  // ⇒ 纯文字载荷上**两道闸说的不是一件事**：`canSend` 说「可以发」（预览于是邀请教师确认），
  // 点下去必 502。而 `canSend` 是**界面唯一**的依据 ⇒ 教师被邀请去点一个必然失败的操作，
  // 失败之后也分不清是平台的问题还是功能坏了。
  //
  // ⚠️ 要放开这一条，得先在 `ai-proxy.ts` 里补非 coze 的分支（那要先把 `anonymizer`
  // 从 `proxyWenxin/Zhipu` 里拆出来）—— 那时**这里与第二道闸要一起改**。
  if (!IMAGE_CAPABLE_PLATFORMS.includes(platform)) {
    const why = payload.payloadKind === 'text'
      ? '本版的分析**只接了 Coze**'
      : '这份载荷里有手写/绘图内容，而它只有 Coze 收得了图';
    return {
      ok: false,
      reason: `当前平台的智能体（${platform}）用不了 —— ${why}。`
        + '请在学习单里改用一个 **Coze** 平台的分析型智能体。',
    };
  }
  return { ok: true };
}

/** 固定引导语（**进代码**）。具体要什么口径由教师写在平台的提示词里（规格 §3.7）。 */
const LEAD = '请分析下面这道小题的全班作答。不要重复简单统计，重点发现统计无法直接呈现的理解方式、共同困难、思维差异或合理异解，并给教师一个简短的反馈切入点。';

/**
 * 载荷 → 发给模型的那段文本。
 *
 * 🔴 **它已经是伪名**（M7a 的 `buildAnalysisPayload` 给的）—— 这里不许再去查真名，
 * 也**不经过 `anonymizer`**（规格 §2.3：分析是班级级的、没有「那个学生」，
 * 而往映射表里塞一条不是学生的记录会加快它重置，重置会换掉**正在进行的一段聊天**里
 * 同一个学生的伪名）。
 */
export function buildAnalysisMessage(payload: AnalysisPayload, labeled = true): string {
  const stats = payload.localStats;
  const head = [
    LEAD,
    '',
    `【题目】${payload.questionLabel} · ${payload.typeLabel}`,
    `题干：${payload.prompt || '（题干为空）'}`,
    `题目材料：${payload.questionDetails}`,
    `参考答案：${payload.referenceAnswer}`,
    `已交 ${payload.covered}/${payload.total}`,
    `本地统计：全对 ${stats.correct}；部分正确 ${stats.partial}；答错 ${stats.incorrect}；未自动判分 ${stats.ungraded}`,
    '',
  ].join('\n');
  if (payload.payloadKind === 'text') {
    return `${LEAD}\n\n${payload.text ?? head}`;
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
  // `mixed` 时文档与图**都要给**（文字那几条只存在于文档里）。文档自身已经包含完整题面，
  // 不再把 head 重复一遍；纯图片没有文档，才由 head 承担题面与参考答案。
  return payload.text
    ? `${LEAD}\n\n${payload.text}\n【附带联系表】\n${note}`
    : `${head}${note}`;
}
