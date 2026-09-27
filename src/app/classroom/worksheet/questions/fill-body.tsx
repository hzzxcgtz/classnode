'use client';

import { blankCount, readPromptRuns } from '@/lib/worksheet-prompt-marks';
import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import styles from '../worksheet.module.css';

/**
 * 填空题的作答体：**单空一个输入框、多空每空一个**（规格 §12）。
 *
 * 「单空 / 多空」的判据**不在这里**：它是题目 `data.blanks` 在不在（`isMultiBlank`），
 * 与服务端 `judgeFillBlank` / `VALIDATORS` 逐字一致，而 `draft.texts` 的长度**已经被
 * `emptyDraftFor` / `draftFromValue` 对齐成那个空数**。所以这里只画
 * `draft.texts.length` 个框 —— 组件里再判一次「该画几个」就是第二份真源，
 * 而它与读回那一侧分叉的表现是**少一个学生填不了的框**（或者多一个填了也没用的框）。
 *
 * ── 🔴 软键盘 / viewport：走**面板级**的共用 hook，本文件一行都不复制 ──────────
 * iPadOS 的 `100vh` **不随键盘变化**（规格 §3-AB / §14.2），而那套处理
 *（`visualViewport` 高度写进 `--module-viewport-height` + 120ms 的 settle 补偿，
 * 见 `shell/use-module-viewport.ts`）**已经在面板上调过一次**：
 * `worksheet-panel.tsx` 的 `useModuleViewport({ active, containerRef, cssVar: '--module-viewport-height' })`。
 *
 * ⚠️ 所以本组件**不自己调那个 hook**，这不是漏了，而是**不能**：那个 hook 会
 * ①把 `document.body` / `documentElement` 的 `overflow` 锁起来、②往容器上写那个变量，
 * 而它的「还回去」逻辑靠一个**每实例独占**的 ref `scrollLockRef` 保证幂等
 *（那段注释写着「只有持有者才还原」）。同一个面板里挂两个实例 ⇒ 两个持有者：
 * 第一个卸载时会把第二个仍然需要的锁还回去（或者反过来），而学生看到的是
 *「键盘弹出来之后页面能滚了 / 高度算错了」—— 两个症状都不报错。
 *
 * ⇒ 键盘输入这件事的**所有者是面板**，本组件只是它里面的一批 `<input>`。
 * 8 个题型里凡是键盘输入的都吃同一个变量，所以它们的表现天然一致。
 */
export interface FillBodyProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'fill' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

export function FillBody({ node, draft, onChange, disabled }: FillBodyProps) {
  // ★ 2026-09-26（教师裁定：「填空是在题目文字中间输入」）：**空住在题干里**时，
  // 这一支**什么都不画** —— 那些框由题干那一份渲染器画（`PromptText` 的 `blanks`）。
  // 🔴 少了这一句就会画出**第二组**输入框（同一份 `draft.texts` 绑在两处），
  // 学生填哪一组都对、而屏幕上多出一排没有对应空的框，**没有任何报错**。
  //
  // ⊘ 2026-09-28 更正：这句原来写着「临时桥（迁移接上之后删掉这一支）……迁移还没跑到的
  // 老题」。两处都是**假话**：① `migrateFillBlankToInline` 早在
  // `server/src/index.ts:587-597` 注册并跑过了；② 🔴 **本组件今天根本走不到** ——
  // 分派器对 `fill-blank` 提前 `return null`（`questions/index.tsx`），
  // 而面板对这两个题型直接渲染 `ChoiceBlankAnswer`（`worksheet-panel.tsx`）。
  // ⇒ **整份文件没有 import**。本次**不删它**（不在表格填空的范围内，也不替别人的
  // 在建工作做决定），但下一个人看到这一段时别再把它当成活代码的依据。
  const inline = blankCount(readPromptRuns(node.data.promptRuns, node.prompt));
  if (inline > 0) return null;
  if (draft.texts.length === 0) {
    // 多空形状但一个空都没有（教师建了题还没填）⇒ 服务端对这道题恒判错。
    // 画一句实话，而不是画一个填了也不会有分的框。
    return <p className={styles.cardNote}>（这道题还没有空）</p>;
  }

  const multiple = draft.texts.length > 1;

  const write = (index: number, text: string) => {
    const texts = draft.texts.slice();
    texts[index] = text;
    onChange({ kind: 'fill', texts });
  };

  return (
    <div className={styles.fillList}>
      {draft.texts.map((text, index) => (
        // ⚠️ `key={index}` 在这里是对的（列表长度只由题目决定）：学生打字不会改长度，
        // 而教师改空数时整份 draft 会被重新读回（`draftFromValue` 对齐过），
        // 受控输入框的值全部来自 props ⇒ 复用 DOM 节点不会留下错位的字。
        <div className={styles.fillRow} key={index}>
          {multiple ? <span className={styles.fillLabel}>{index + 1}</span> : null}
          <input
            className={styles.input}
            type="text"
            value={text}
            disabled={disabled}
            // 多空时把「第几个空」写进占位符：学生一眼看得出自己填的是哪一格
            //（空与空之间可能隔着好几行题干）。
            placeholder={multiple ? `第 ${index + 1} 空` : '在这里填写答案'}
            onChange={(event) => write(index, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
