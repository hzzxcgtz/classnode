'use client';

import { WRONG_ANSWER_STYLE } from '@/lib/worksheet-prompt-marks';
import { TRUE_FALSE_OPTIONS, correctAnswerLabel, optionBadge, readOptions, wrongSelectedKeys } from '@/lib/worksheet-questions';
import { CorrectAnswerNote } from './correct-answer-note';
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
  /**
   * ★ 2026-09-27（教师）：「选择和判断学生错误后也要与填空一样给出叉叉符号并给出正确答案。」
   *
   * **这道题的正确答案**（选项 key）。由服务端在**判过分、且学生没全对**时下发
   *（`wrongChoiceAnswers` 那条窄口的注释写了完整理由：`stripAnswers` 刻意不下发整张答案键）。
   *
   * 🔴 **不给 = 不打叉、不写答案**（不是「全错」）。教师端的「学生端预览」走的是同一个
   * 组件、永远不给这个 prop —— 那里**一处都不许出现**（那会让教师以为学生也看得到答案）。
   * 学生端那一条路也只在已提交的题上有值，所以「还没提交 ⇒ 一个叉都没有」是靠这条闸成立的。
   */
  correctKeys?: string[];
}

export function ChoiceBody({ node, draft, onChange, disabled, correctKeys }: ChoiceBodyProps) {
  const options = node.type === 'true-false' ? TRUE_FALSE_OPTIONS : readOptions(node);
  const multiple = node.type === 'multi-choice' || node.data.choiceMode === 'multiple';
  // ⚠️ 判据在 `@/lib/worksheet-questions`（有用例）：`correctKeys` 为空 ⇒ 一个叉都不打。
  //    在这里现写 `draft.selected.filter(k => !correctKeys.includes(k))` 会在**未判分**的题上
  //    把学生勾过的每一个选项都打上叉 —— 而那正是「界面在说假话」。
  const answerKeys = correctKeys ?? [];
  const wrongKeys = wrongSelectedKeys(draft.selected, answerKeys);

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
    <>
    <div className={styles.options}>
      {options.map((option) => {
        const checked = draft.selected.includes(option.key);
        const wrong = wrongKeys.includes(option.key);
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
            {/* ★ 2026-09-27（教师）：「学生页面中两个选项不要使用 T 和 F，只勾勾和叉叉。」
                🔴 变的是**画出来的记号**，`value`/`key` 仍是 `T` / `F`（那是判分协议，
                   见 `optionBadge`）—— 所以这里**不能**写成 `option.key`。
                ⚠️ 判据在 `src/lib/worksheet-questions.ts` 里（`node --test` 有用例）。 */}
            <span className={styles.optionKey}>{optionBadge(node.type, option.key)}</span>
            {/* ★ 2026-09-29（教师）：「选择题那个红叉也改掉吧」⇒ 与填空**同一条规则**：
                他选中而答错的那一项，**文字**改成暗红 + 删除线，不再在旁边画一枚红叉。
                🔴 样式只有一份（`WRONG_ANSWER_STYLE`，在 `@/lib/worksheet-prompt-marks`）——
                与填空那四个渲染点同源，改一处两处一起变。
                ⚠️ 这一格**没有** `blankAnswerStyle` 那种打底（选项文字本来没有行内色），
                   所以直接展开即可，不必过 `blankValueStyle`（那个函数存在的理由是**顺序**）。
                ⚠️ 删除线划的是**这个选项**（教师写的字）——与填空划掉学生写的字略有不同，
                   但两者说的是同一句话：「这一项不对」。教师这次明确要它跟着改。
                ⊘ ★ 2026-09-29：这一处是那枚红叉**最后一个**使用者 ⇒
                   `@/components/worksheet-wrong-mark`（`WrongMark`）**随之删除**。
                   它带着的那条教训（「标记不许盖住内容」：那个叉曾绝对定位在填空框右上角，
                   答案一长就压住字）**没有丢** —— 记在 `worksheet-prompt-text.test.ts` 的文件头
                   与 `@/lib/worksheet-prompt-marks` 那两处，而且那条「这几个文件里一个定位都不许有」
                   的网仍然在跑（只是不再包括那个已删的文件）。 */}
            <span className={styles.optionText} style={wrong ? WRONG_ANSWER_STYLE : undefined}>
              {option.text.trim()
                ? option.text
                : !option.imageUrl && <span className={styles.placeholder}>（选项 {option.key} 还没写）</span>}
              {option.imageUrl && <img className={styles.optionImage} src={worksheetAssetUrl(option.imageUrl)} alt={`选项 ${option.key} 配图`} />}
            </span>
          </label>
        );
      })}
    </div>

    {/* ★ 2026-09-27（教师）：「…并给出正确答案」。与填空**同一块提示**、同一句措辞结构
        （`CorrectAnswerNote`）。⚠️ 只在服务端给了答案时出现 —— 没给（还没判分 / 全对 /
        这题没配答案）时整块不渲染，不会写出「正确答案」这种半句话。 */}
    {answerKeys.length > 0 && (
      // ★ 2026-09-27（教师）：「答案文字加粗」。判断 / 选择这里**整句就是答案**（「B」「对」），
      // 没有「第 N 空填」那种框话 ⇒ 整段加粗。
      <CorrectAnswerNote><strong>{correctAnswerLabel(node.type, answerKeys)}</strong></CorrectAnswerNote>
    )}
    </>
  );
}
