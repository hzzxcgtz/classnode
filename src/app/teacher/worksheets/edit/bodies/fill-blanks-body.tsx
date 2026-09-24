'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  addBlank,
  fillShape,
  readBlankAnswers,
  readBlankText,
  removeBlank,
  writeBlankText,
} from '../worksheet-editor-core';

/**
 * 填空题：一个题干 + N 个空，**每个空一个 textarea（一行一个可接受答案）**。
 *
 * ── 两种形状（规格 §12）────────────────────────────────────────────────
 *   · **单空**：`data.answers: string[]`（M3 的形状，**不动**）—— 一道题一个空；
 *   · **多空**：`data.blanks: Array<{ answers: string[] }>` —— 一个题干下多个空。
 * 服务端两种都收（判据是 `Array.isArray(data.blanks)`），**单空与多空的判分不一样**：
 * 单空只有对/错，多空是「全对 / 有对有错=半对 / 全错」。
 *
 * ★ 新建的填空题是**单空**形状（`newQuestion`），这里画成**一个空**；
 * 教师点「＋ 增加一个空」时才升级成多空（`addBlank`）。升级之后**不再退回** ——
 * 理由写在 `addBlank` 上（退回是一条会静默改形状的路径，而它换不来任何好处）。
 *
 * ── textarea 的往返是无损的 ────────────────────────────────────────────
 * 文本与答案数组之间只按 `\n` 切分、**不丢空行**（`writeFillAnswers`），所以这里不需要
 * 本地缓冲：`value` 由节点算出来即可，撤销 / 恢复草稿 / 换题都能立刻反映到光标那一行上。
 * 出网之前那份空行由 `sanitizeContentForSave` 去掉（否则 `answers: ['']` 会把学生的
 * **空作答**判成正确，看板上显示「全班都对」）——**多空那条路的清理也在同一个函数里**。
 *
 * 🔴 **空的个数是位置协议的一部分，改它会让已收上来的作答与空错位。**
 * 与其他五个题型不同，服务端读填空题的作答值是 `texts: string[]`（**按位置对应**这些空，
 * 见 D1/D2 的 `fill-multi/v1`），而不是按 id —— 所以在课堂进行中删掉中间的一个空，
 * 学生已经交上来的「第 3 个空的答案」会落到原来的第 4 个空上。**这不是本页面引入的**
 *（协议如此），但它是「删一个空」这个按钮真实的代价：**课堂开始之前**调好空的数量。
 */
export function FillBlanksBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const blanks = readBlankAnswers(node);
  const shape = fillShape(node);

  return (
    <>
      {blanks.map((_, index) => (
        // ⚠️ key 只能是**下标**：空没有 id（服务端按位置读 `texts`），而「删掉第 2 个空」
        // 本来就意味着后面的空整体前移 —— 用下标当 key 与那份协议是同一个语义。
        <div className="worksheet-editor-blank" key={index}>
          <label className="worksheet-editor-field">
            <span>{blanks.length > 1 ? `第 ${index + 1} 个空的答案` : '答案'}</span>
            <textarea
              className="input"
              rows={2}
              value={readBlankText(node, index)}
              onChange={event => onDataChange(writeBlankText(node, index, event.target.value))}
              placeholder={'一行一个可接受答案，例如：\n光合作用\n碳氧平衡'}
            />
          </label>
          {blanks.length > 1 && (
            <button
              type="button"
              className="btn btn-secondary worksheet-editor-blank-remove"
              onClick={() => onDataChange(removeBlank(node, index))}
            >
              🗑 删掉这个空
            </button>
          )}
        </div>
      ))}

      <div className="worksheet-editor-inline-actions">
        <button type="button" className="btn btn-secondary" onClick={() => onDataChange(addBlank(node))}>
          ＋ 增加一个空
        </button>
        {blanks.length === 0 && (
          <span className="worksheet-editor-warn-hint">
            这道题一个空都没有（库里的数据被改过）—— 点「＋ 增加一个空」补一个。
          </span>
        )}
      </div>

      <p className="worksheet-editor-hint">
        学生的答案与某个空里任意一行一致，就算这个空答对（忽略多余空格与全角/半角差异，
        <strong>区分大小写</strong> —— 英文题请把大小写不同的写法各写一行）。
        {shape === 'multi'
          ? '全部空都答对=全对，答对一部分=半对，一个都没答对=全错。'
          : '只有一个空时只有对错，没有半对 —— 要分档请点「＋ 增加一个空」。'}
      </p>
    </>
  );
}
