'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { availableChoices, type AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { PromptText } from '@/lib/worksheet-prompt-text';
import { readPromptImage, readPromptRunsFor, worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { fillSettingsFor, sharedPoolChoices } from '@/lib/worksheet-fill-modes';
import { usePointerDrag, type DragPoint } from '../use-pointer-drag';
import styles from '../worksheet.module.css';

/**
 * 「选择填空」的**整块作答区**（★ 2026-09-26，教师裁定）。
 *
 * 教师原话：「题干跟普通填空题类似，但是题干下方会出现几个**待选词**，学生可以**拖拽**
 * 它们到正确的填空域来完成答题。」
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
  /**
   * ★ 2026-09-27：**这一题**答错的空的正确答案（空下标 → 那一个答案）。
   * ⚠️ 只在已提交的题上有内容 —— 服务端剥掉整张答案键、只放行答错的几个空。
   */
  correctBlanks?: Record<string, string>;
}

/** 落点 id 的前缀。⚠️ 与「待选词 id」区分开：拖拽那一层只看得出字符串。 */
const BLANK_PREFIX = 'blank:';
const WORD_PREFIX = 'word:';

/** `data.choices`：待选词。读不出来就是空表（学生没词可拖 ⇒ 界面要说实话）。 */
export function ChoiceBlankAnswer({ node, draft, onChange, disabled, correctBlanks }: ChoiceBlankAnswerProps) {
  const [picked, setPicked] = useState<{ word: string; target: number | null } | null>(null);
  const runs = useMemo(() => readPromptRunsFor(node), [node]);
  const settings = useMemo(() => fillSettingsFor(node, runs), [node, runs]);
  const poolChoices = useMemo(() => sharedPoolChoices(node), [node]);
  const promptImage = readPromptImage(node);
  const poolValues = useMemo(() => draft.texts.filter((_, index) => settings[index]?.mode === 'pool'), [draft.texts, settings]);
  const available = useMemo(() => availableChoices(poolChoices, poolValues), [poolChoices, poolValues]);
  const sources = useMemo(() => {
    const result = new Map<string, { word: string; target: number | null }>();
    available.forEach((word, index) => result.set(`${WORD_PREFIX}pool:${index}`, { word, target: null }));
    settings.forEach((setting, blankIndex) => setting.choices.forEach((word, choiceIndex) => {
      result.set(`${WORD_PREFIX}inline:${blankIndex}:${choiceIndex}`, { word, target: blankIndex });
    }));
    return result;
  }, [available, settings]);
  const wordEls = useRef<Record<string, HTMLElement | null>>({});

  const clearDragStyles = useCallback(() => {
    Object.values(wordEls.current).forEach((el) => {
      if (!el) return;
      if (el.style.transform) el.style.transform = '';
      if (el.style.zIndex) el.style.zIndex = '';
    });
  }, []);

  const onDragMove = useCallback((point: DragPoint) => {
    const el = wordEls.current[point.id];
    if (!el) return;
    el.style.transform = `translate3d(${Math.round(point.dx)}px, ${Math.round(point.dy)}px, 0)`;
    el.style.zIndex = '2';
  }, []);

  const wordFromId = useCallback((id: string) => {
    return sources.get(id) ?? null;
  }, [sources]);

  const wordButton = (word: string, sourceId: string, compact = false) => {
    const source = sources.get(sourceId);
    return (
      <button
        type="button"
        disabled={disabled}
        key={sourceId}
        className={[
          styles.choiceWord,
          compact ? styles.choiceWordInline : '',
          styles.dragSource,
          picked?.word === word && picked?.target === (source?.target ?? null) ? styles.choiceWordPicked : '',
          drag.draggingId === sourceId ? styles.dragActive : '',
        ].filter(Boolean).join(' ')}
        ref={(el) => { wordEls.current[sourceId] = el; }}
        {...drag.sourceProps(sourceId)}
      >
        <span>{word}</span>
      </button>
    );
  };

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
    if (picked && ((picked.target === null && settings[index]?.mode === 'pool') || picked.target === index)) {
      place(index, picked.word);
      return;
    }
    if (!draft.texts[index]) return;
    const texts = draft.texts.slice();
    texts[index] = '';
    onChange({ kind: 'fill', texts });
  };

  const drag = usePointerDrag({
    disabled,
    onDragMove,
    onTap: (id) => {
      // 落点那一侧的点由 `PromptText` 的 `onPlace` 接走，这里只会收到待选词。
      if (!id.startsWith(WORD_PREFIX)) return;
      const source = wordFromId(id);
      if (source === null) return;
      setPicked((current) => (current?.word === source.word && current.target === source.target ? null : source));
    },
    onDrop: (sourceId, targetId) => {
      if (!sourceId.startsWith(WORD_PREFIX) || !targetId || !targetId.startsWith(BLANK_PREFIX)) return;
      const index = Number(targetId.slice(BLANK_PREFIX.length));
      const source = wordFromId(sourceId);
      if (!Number.isInteger(index) || index < 0 || source === null
          || (source.target === null && settings[index]?.mode !== 'pool')
          || (source.target !== null && source.target !== index)) return;
      clearDragStyles();
      place(index, source.word);
    },
  });

  // pointercancel 不会触发 onDrop；收尾时必须把直接写在 DOM 上的跟手位移清掉。
  useEffect(() => {
    if (!drag.draggingId) clearDragStyles();
  }, [drag.draggingId, clearDragStyles]);

  return (
    <>
      <div className={styles.prompt}>
        <PromptText
          text={node.prompt}
          runs={runs}
          placeholder={<span className={styles.placeholder}>（这道题的题干还没写）</span>}
          blanks={{
            values: draft.texts,
            onChange: (index, value) => {
              const texts = Array.from({ length: Math.max(draft.texts.length, settings.length) }, (_, itemIndex) => itemIndex === index ? value : (draft.texts[itemIndex] ?? ''));
              onChange({ kind: 'fill', texts });
            },
            disabled,
            modeOf: index => settings[index]?.mode === 'text' ? 'input' : 'drop',
            // ★ 2026-09-27：答错的那几个空 ⇒ 正确答案（服务端只在这几格上有值）。
            // ⚠️ 键是**下标字符串**（JSON 的键只能是字符串），与 `wrongBlankIndexes` 同一套下标。
            correctOf: index => correctBlanks?.[String(index)] ?? null,
            drop: {
              idOf: (index) => `${BLANK_PREFIX}${index}`,
              onPlace: disabled ? () => {} : tapBlank,
              pending: picked?.word ?? null,
              activeId: drag.hoverTargetId,
              after: (index) => {
                const setting = settings[index];
                if (setting?.mode !== 'inline') return null;
                return (
                  <span className={styles.inlineChoices} aria-label={`第 ${index + 1} 空的候选词`}>
                    （{setting.choices.map((word, choiceIndex) => wordButton(word, `${WORD_PREFIX}inline:${index}:${choiceIndex}`, true))}）
                  </span>
                );
              },
            },
          }}
        />
      </div>
      {promptImage && <img className={styles.promptImage} src={worksheetAssetUrl(promptImage)} alt="题目配图" />}
      {settings.some(setting => setting.mode === 'pool') ? (
        <div className={styles.choicePoolArea}>
          <p className={styles.choicePoolHint}>
            {disabled ? '待选词会显示在题干下方' : '先选一个词，再点上方的填空域；也可以直接拖进去'}
          </p>
          <div className={styles.choicePool} aria-label="待选词">
            {available.map((word, index) => wordButton(word, `${WORD_PREFIX}pool:${index}`))}
          </div>
        </div>
      ) : null}
    </>
  );
}
