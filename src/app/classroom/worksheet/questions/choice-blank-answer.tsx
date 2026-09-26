'use client';

import { useState } from 'react';

import { availableChoices, type AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { PromptText } from '@/lib/worksheet-prompt-text';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import { usePointerDrag } from '../use-pointer-drag';
import styles from '../worksheet.module.css';

/**
 * 「选择填空」的**整块作答区**（★ 2026-09-26，教师裁定）。
 *
 * 教师原话：「题干跟普通填空题类似，但是题干下方会出现几个**待选词**，学生可以**拖拽**
 * 它们到正确的填空区域来完成答题。」
 *
 * ── 为什么这一个组件把题干**也**渲染了 ────────────────────────────────────
 * 🔴 拖拽那条路要求「待选词」与「题干里的空」在**同一个组件**里 ——
 * `usePointerDrag` 的手势状态（`draggingId` / `hoverTargetId`）是**每个实例**的，
 * 而落点是用 `document.elementFromPoint` 找的（跨组件没问题），**起手**却必须在同一个
 * 实例里。两个组件各挂一个 hook 的话，从待选词拖到空里**不会有任何反应**。
 * ⇒ 本组件自己渲染题干（复用 `PromptText`，切分逻辑仍然是那一份）+ 待选区。
 * ⚠️ 所以**面板那一侧对 `choice-blank` 必须跳过它通用的「题干 + 作答体」两个块**
 * —— 否则题干会画两遍（`worksheet-panel.tsx` 里那一条分支）。
 *
 * ── 两条路都要有（本仓裁定：「点选为主 + 拖拽增强」）────────────────────────
 *   · **点**：点一个词 ⇒ 它亮起来（`picked`）；再点一个空 ⇒ 放进去；
 *   · **拖**：从词上按住拖到空里 ⇒ 放下。
 * ⚠️ 两条路共用同一份 `draft.texts`（顺序那两个字段名也一样），所以不存在
 * 「拖进去的和点进去的对不上」。
 *
 * ── 「每个词只能用一次」────────────────────────────────────────────────────
 * 学生裁定：用掉的词**从待选区消失**。它是**派生**的（`availableChoices`，那半边有用例），
 * 不是一份「已用」的清单 —— 存清单就会与撤销 / 读回对不上。
 */
export interface ChoiceBlankAnswerProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'fill' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

/** 落点 id 的前缀。⚠️ 与「待选词 id」区分开：拖拽那一层只看得出字符串。 */
const BLANK_PREFIX = 'blank:';
const WORD_PREFIX = 'word:';

/** `data.choices`：待选词。读不出来就是空表（学生没词可拖 ⇒ 界面要说实话）。 */
function readChoices(node: WorksheetQuestionNode): string[] {
  const raw = node.data.choices;
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

export function ChoiceBlankAnswer({ node, draft, onChange, disabled }: ChoiceBlankAnswerProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const runs = readPromptRunsFor(node);
  const choices = readChoices(node);
  const available = availableChoices(choices, draft.texts);

  /** 把 `word` 放进第 `index` 个空（两条路最终都走这里）。 */
  const place = (index: number, word: string) => {
    // ⚠️ 长度以**题目里的空数**为准（教师加了空、学生屏幕还没刷新时旧草稿会短一格）。
    const count = Math.max(draft.texts.length, index + 1);
    const texts = Array.from({ length: count }, (_, i) => (i === index ? word : (draft.texts[i] || '')));
    setPicked(null);
    onChange({ kind: 'fill', texts });
  };

  /** 点一个空：手里有词就放进去；手里没词就把它**清空**（学生要有退路）。 */
  const tapBlank = (index: number) => {
    if (picked) {
      place(index, picked);
      return;
    }
    if (!draft.texts[index]) return;
    const texts = draft.texts.slice();
    texts[index] = '';
    onChange({ kind: 'fill', texts });
  };

  const drag = usePointerDrag({
    disabled,
    onTap: (id) => {
      // 落点那一侧的点由 `PromptText` 的 `onPlace` 接走，这里只会收到待选词。
      if (!id.startsWith(WORD_PREFIX)) return;
      const word = id.slice(WORD_PREFIX.length);
      setPicked((current) => (current === word ? null : word));
    },
    onDrop: (sourceId, targetId) => {
      if (!sourceId.startsWith(WORD_PREFIX) || !targetId || !targetId.startsWith(BLANK_PREFIX)) return;
      const index = Number(targetId.slice(BLANK_PREFIX.length));
      if (!Number.isInteger(index) || index < 0) return;
      place(index, sourceId.slice(WORD_PREFIX.length));
    },
  });

  return (
    <>
      <div className={styles.prompt}>
        <PromptText
          text={node.prompt}
          runs={runs}
          placeholder={<span className={styles.placeholder}>（这道题的题干还没写）</span>}
          blanks={{
            values: draft.texts,
            // ⚠️ 落点模式下**永远不会**被调用（那些空不是输入框）—— 给一个空实现，
            // 因为 `PromptText` 的接口对两种模式是同一个。
            onChange: () => {},
            disabled,
            drop: {
              idOf: (index) => `${BLANK_PREFIX}${index}`,
              onPlace: disabled ? () => {} : tapBlank,
              pending: picked,
            },
          }}
        />
      </div>
      {choices.length === 0 ? (
        <p className={styles.cardNote}>（这道题还没有待选词）</p>
      ) : (
        <div className={styles.choicePool} aria-label="待选词">
          {available.map((word, index) => (
            <div
              // ⚠️ `key` 带下标：待选词**允许重复**（教师可以写两个「阳光」当干扰项），
              // 而用词本身当 key 会让那两个撞在一起。
              key={`${word}-${index}`}
              className={[
                styles.choiceWord,
                // 🔴 `dragSource` 给的是**静态**的 `touch-action: none` —— 拖拽能不能起作用
                // 全看它（`use-pointer-drag.ts` 文件头第 ② 条：浏览器在手势开始的那一刻就定了
                // 这条手势归谁，`pointerdown` 里再设已经晚了）。少了它，iPad 上一按就变成滚动，
                // 学生看到的只是「拖不动」。
                styles.dragSource,
                picked === word ? styles.choiceWordPicked : '',
              ].filter(Boolean).join(' ')}
              // 🔴 id 用**词本身**（不是下标）：两个同名词在待选区里是**可互换**的
              //（拖哪一个都一样），所以它们共用一个 id 是对的 —— 而用下标的话，
              // `onTap` 拿到的那个下标还得再查一次表才能换回词，多一处能算错的地方。
              // ⚠️ 它们是**拖拽源**不是落点，所以共用 id 不会撞车（落点才要求唯一）。
              {...drag.sourceProps(`${WORD_PREFIX}${word}`)}
              title={picked === word ? '再点一下取消选择' : '点一下选中，再点题干里的空；也可以直接拖过去'}
            >
              {word}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
