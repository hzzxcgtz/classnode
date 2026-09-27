'use client';

import { TRUE_FALSE_OPTIONS, readOptions } from '@/lib/worksheet-questions';
import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import styles from '../worksheet.module.css';

/**
 * 选择题的作答体：**判断 / 单选 / 多选**三个题型共用（规格 §12）。
 *
 * 三者的**作答值与判分逐字相同**（都是 `{ format: 'choice/v1', selected: [...] }`，
 * 同一个 `judgeSingleChoice`），差别只有「画几个复选框」与「能不能多选」：
 *   · 判断题：选项恒为「对 / 错」两个，**不存 `options`**（`TRUE_FALSE_OPTIONS` 是
 *     唯一一份，教师端的判断题编辑体引的也是它）；
 *   · 单选：`radio`，选一个顶掉前一个；
 *   · 多选：`checkbox`，可以选多个。
 *
 * ⚠️ 三个题型分成三个组件是**错的**：那样「选项怎么读、key 怎么标号、选中态怎么画」
 * 会有三份实现，而它们本可以逐字相同（规格 §12 就是把它们合成一个形状的）。
 */
export interface ChoiceBodyProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'choice' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

export function ChoiceBody({ node, draft, onChange, disabled }: ChoiceBodyProps) {
  const options = node.type === 'true-false' ? TRUE_FALSE_OPTIONS : readOptions(node);
  const multiple = node.type === 'multi-choice' || node.data.choiceMode === 'multiple';

  if (options.length === 0) {
    // 单选 / 多选还没有选项（教师在编辑期删光了）。说一句，而不是画一个空的作答区
    // —— 空白的作答区看起来像界面坏了。判断题走不到这里（选项是常量）。
    return <p className={styles.cardNote}>（这道题还没有选项）</p>;
  }

  const toggle = (key: string) => {
    // 🔴 先把**已经不在选项里**的 key 筛掉再加/删。不做的话，一份旧作答里那个
    // 已经不存在的 key 会跟着这次新选择一起被提交上去（教师删掉过一个选项、
    // 而学生当初正选着它）—— 屏幕上它一个像素都不显示，学生无从知道自己「答了两个」。
    const known = draft.selected.filter((item) => options.some((option) => option.key === item));
    if (!multiple) {
      onChange({ kind: 'choice', selected: [key] });
      return;
    }
    onChange({
      kind: 'choice',
      selected: known.includes(key) ? known.filter((item) => item !== key) : [...known, key],
    });
  };

  return (
    <div className={styles.options}>
      {options.map((option) => {
        const checked = draft.selected.includes(option.key);
        return (
          <label
            className={`${styles.option}${checked ? ` ${styles.optionSelected}` : ''}`}
            key={option.key}
          >
            <input
              className={styles.optionInput}
              type={multiple ? 'checkbox' : 'radio'}
              // ⚠️ name 必须带 `node.id`：同卷多题如果共用名字，选了第 1 题会把
              // 第 2 题的选择顶掉 —— 而两份 JSX（学生端 / 预览）也不会同时挂载。
              // （多选用复选框时不依赖 name 分组，但一起带上没有任何坏处：
              //   「同卷多题不许互相干扰」这条判据只有一处写法。）
              name={`worksheet-choice-${node.id}`}
              value={option.key}
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(option.key)}
            />
            <span className={styles.optionKey}>{option.key}</span>
            <span className={styles.optionText}>
              {option.text.trim()
                ? option.text
                : !option.imageUrl && <span className={styles.placeholder}>（选项 {option.key} 还没写）</span>}
              {option.imageUrl && <img className={styles.optionImage} src={worksheetAssetUrl(option.imageUrl)} alt={`选项 ${option.key} 配图`} />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
