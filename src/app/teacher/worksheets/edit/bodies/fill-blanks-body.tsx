'use client';

import { useEffect, useRef, useState } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import { readBlankCount } from '@/lib/worksheet-questions';
import { BLANK_MARK_TEXT } from '@/lib/worksheet-prompt-marks';
import { CHOICE_JOINER, blankSlots, fillGradingTotals, fillSettingsFor, hasExplicitFillGrading, sameChoiceItems, sharedPoolChoices, splitChoiceText, writeFillSettings, type FillAnswerMode, type FillGradingMode } from '@/lib/worksheet-fill-modes';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import {
  readBlankAnswers,
  writeFillAnswers,
} from '../worksheet-editor-core';

/**
 * **单行**的「符号分隔列表」输入 —— 待选词与标准答案**共用这一个**（★ 2026-09-28，教师两轮）。
 *
 * 教师原话：第一轮「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示
 * 使用常见的符号分隔即可。」第二轮「这里也改成单行了，而且可以使用哪些符号间隔，
 * 要提示一下，之前改的地方也是一样。」
 *
 * 🔴 **为什么自己存一份正在输入的文本**：每次按键都立刻 `split(text).join(…)` 回填的话，
 *   教师刚打完的那个分隔符会在同一瞬间被吃掉（「阳光、」→ 变回「阳光」）
 *   ⇒ **第二个词根本打不进去**。所以打字时只更新自己那一份。
 *
 * ★ 2026-09-30（教师第三轮）：「几个地方要统一下，用户在输入的时候可以用各种常见的
 *   分隔符号，**你多想几个，都是支持的**，也**不用刻意地转成某一个特别的符号**。」
 *   ⇒ 两件事：
 *   ① **显示分隔符收到一处**（`CHOICE_JOINER`，`@/lib/worksheet-fill-modes`）——
 *      原来四个调用点各传一个（` / ` / `；` / `、` / `、`），而主观题「参考答案」那处
 *      的占位语写的是顿号、值却用斜杠显示，自己跟自己不一致。
 *   ② **`onBlur` 那次「规范化」整个删掉**，回填改判「解析结果是否逐项相等」——
 *      见下面那个 effect。他打逗号就留逗号，打斜杠就留斜杠。
 *
 * ⚠️ **认哪些分隔符由 `split` 给**（`@/lib/worksheet-fill-modes` 的 `splitChoiceText`：
 *   顿号/逗号/分号/斜杠/竖线/间隔号/制表符/换行，**中英文都认**）—— 那里记着
 *   「代价是什么」（本身含标点的答案会被拆开）与教师为什么这么选。
 * ⚠️ 四处共用一个组件是刻意的：同屏几个同类输入框各写一份，改一处只改一处，
 *   而教师看到的是「几个长得不一样的框」。
 */
export function SymbolListInput({ values, split, placeholder, onChange }: {
  values: string[];
  split: (raw: string) => string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const canonical = values.join(CHOICE_JOINER);
  const [draft, setDraft] = useState(canonical);
  /**
   * 这一帧手里那一份。
   * ⚠️ 它进不了 effect 的依赖（`draft` 每次按键都变 ⇒ 那个 effect 会被自己触发的
   *    一次渲染再跑一遍）。用 ref 读当下值，与 `prompt-editor` 里 `runsRef` 同一套写法。
   */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * 什么时候拿**外面那份值**回填。
   *
   * 🔴 判据是「**手里这份解析出来与外面那份逐项相等，就一个字都不回填**」
   *    （★ 2026-09-30，教师第三轮：「也不用刻意地转成某一个特别的符号」）。
   *    教师打 `阳光,水分` 的那一刻，外面存下的是 `['阳光','水分']`、拼出来是
   *    `阳光、水分` —— **两份说的是同一个列表**，只是写法不同 ⇒ 别动他的稿子。
   *    ⚠️ 少了这条判据（比如只比「拼出来的字符串」），他刚打的逗号会**当场**被换成
   *    顿号；屏幕上看不出是谁改的，像是输入法在捣乱。
   * ⚠️ 真的变了（撤销 / 换题 / 别处改了同一个答案）⇒ 解析结果不同 ⇒ 照旧回填。
   * ⚠️ 依赖里带上 `values` / `split`：它俩每次渲染都是新的 ⇒ 这个 effect 每渲染跑一遍，
   *    但函数体第一句就把绝大多数情况挡回去了（判据只是几个短字符串的比较）。
   */
  useEffect(() => {
    if (sameChoiceItems(split(draftRef.current), values)) return;
    setDraft(values.join(CHOICE_JOINER));
  }, [canonical, values, split]);

  return (
    <input
      className="input"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(split(next));
      }}
    />
  );
}

/**
 * 「每个空的作答方式 + 它的答案」。
 *
 * ★ 2026-09-28（教师反馈）：它管的是**这道题全部的空**（题干里的 + 表格里的），
 * 不再只认题干里那几个。
 *
 * ★ 2026-10-05（教师裁定 A）：「填空题的答案放到这里」——每个空的**答案**从「标准答案」
 * 那一块（住在自动评分区里、**只有打开自动评分才看得见**）搬到了本卡片作答方式行的右侧。
 * 三条连带，都是有意的：
 *   · 空的数量仍然**只有一个来源**：题干 `promptRuns` 里带稳定 blank id 的占位符，
 *     加上表格里标成「填空」的格子。这里不提供「增加/删除答案框」——
 *     题干有两个空、下面却有三个答案框，那种双真源正是原来那个组件的存在理由。
 *   · 答案从此**一直可编辑**（原来关掉「自动评分」它整块消失）：因为每个空都能选
 *     「AI 评分」，那种情况下答案必须能改。题目卡上那句「自动评分已关闭，正确答案暂时隐藏」
 *     因此对填空题不再成立（已按题型排除）。
 *   · 原来那两句说明（「每个空可以填多个可接受答案…」与「逐空给分」的算术）跟着搬到列表下方。
 */
export function ChoiceBlankSetup({ node, onDataChange, onAutoGradeChange, fullPoints = 0 }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  onAutoGradeChange?: (enabled: boolean) => void;
  /** 「全对」值几分（逐题或继承学习单级）—— 只用来把「逐空给分」那笔账算给教师看。 */
  fullPoints?: number;
}) {
  const runs = readPromptRunsFor(node);
  // ★ 2026-09-28（教师反馈）：清单走 `blankSlots` —— **题干里的空与表格里的空是同一批**。
  // 原来只遍历 `promptRuns` ⇒ 一道表格题在这里显示「题干中还没有填空域」，
  // 而上面明明有一张表标着空（两块互相打脸 —— 教师：「一头雾水，东跳跳西跳跳」）。
  const slots = blankSlots(node, runs);
  // ★ 2026-10-05：答案跟着清单走同一个下标空间 —— `blankSlots` 的顺序与
  // `readBlankCount` 是同一套口径（题干标记前的空 → 表格里的空 → 标记后的空），
  // 所以 `answerSets[index]` 就是这张卡那一个空的答案（原来那个网格也是这么对的）。
  const answerSets = readBlankAnswers(node);
  const answerSlots = readBlankCount(node);
  const settings = fillSettingsFor(node, runs);
  const poolChoices = sharedPoolChoices(node);
  const updateSettings = (next: typeof settings) => {
    const totals = fillGradingTotals(next);
    onDataChange({
      fillBlankSettings: writeFillSettings(node, runs, next),
      ...(node.type === 'fill-blank' && hasExplicitFillGrading(next) ? {
        aiScoringEnabled: totals.ai > 0,
      } : {}),
    });
    if (node.type === 'fill-blank' && totals.auto > 0 && node.autoGrade === false) onAutoGradeChange?.(true);
  };
  const explicitSettings = () => settings.map(setting => ({
    ...setting,
    gradingMode: setting.gradingMode ?? (node.autoGrade === false && node.data.aiScoringEnabled === true ? 'ai' as const : 'auto' as const),
    maxScore: setting.maxScore ?? 1,
  }));
  const setMode = (index: number, mode: FillAnswerMode) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, mode, ...(mode !== 'text' && setting.gradingMode === 'ai' ? { gradingMode: 'auto' as const } : {}) }
      : setting);
    updateSettings(next);
  };
  const setGradingMode = (index: number, gradingMode: FillGradingMode) => {
    const next = explicitSettings().map((setting, settingIndex) => settingIndex === index
      ? { ...setting, gradingMode, maxScore: setting.maxScore ?? 1, ...(gradingMode === 'ai' ? { mode: 'text' as const } : {}) }
      : setting);
    updateSettings(next);
  };
  const setMaxScore = (index: number, raw: string) => {
    const maxScore = Number(raw);
    if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 99) return;
    updateSettings(explicitSettings().map((setting, settingIndex) => settingIndex === index ? {
      ...setting,
      maxScore,
    } : setting));
  };
  // ★ 2026-09-28：直接收词表 —— 原来收一个字符串再 `splitChoiceLines` 解析一遍，
  // 而单行输入那一侧已经解析过了（多一次往返就多一处会分叉的地方）。
  const setInlineChoices = (index: number, words: string[]) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, choices: words }
      : setting);
    updateSettings(next);
  };

  return (
    <div className="worksheet-editor-choice-blank-setup">
      {slots.length === 0 ? (
        <div className="worksheet-editor-blank-empty">
          <strong>还没有填空的位置</strong>
          <span>把光标放到题干的目标位置再点“{BLANK_MARK_TEXT}”；或者在上面加一张表格、把某几格标成「填空」。</span>
        </div>
      ) : (
        <div className="worksheet-editor-fill-mode-list">
          {slots.map((slot, index) => (
            // key 用空的身份（不是下标）：题干里插一个空时，后面那些卡不会整排重挂载
            <section className="worksheet-editor-fill-mode-card" key={slot.id}>
              <div className="worksheet-editor-fill-mode-head">
                {/* ★ 位置**说实话**：题干里的空说「第 2 空」，表格里的空说「第 2 行第 2 格」 */}
                <strong>{slot.label}</strong>
                {slot.kind === 'table' && (
                  // 位置之外再说一句「它在表格里」：清单里两种空混着排，光看标签要能一眼分清
                  <span className="worksheet-editor-blank-hint">在表格里</span>
                )}
                {/* ★ 2026-09-28（教师）：「这里也应该可以设置三种方式，跟普通填空域一样：
                    手工填、右侧选、下方选。」⇒ 表格里的空**与题干里的空同一套单选**
                    （上一版只报位置、不摆单选，那是 v1 的临时限制，教师否了）。 */}
                <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label={`${slot.label}的作答方式`}>
                  {([
                    ['text', '手工填写'],
                    ['inline', '右侧选词'],
                    ['pool', '下方选词'],
                  ] as const).map(([mode, label]) => (
                    <label className={settings[index].mode === mode ? 'is-selected' : ''} key={mode}>
                      <input type="radio" name={`fill-mode-${node.id}-${index}`} checked={settings[index].mode === mode} onChange={() => setMode(index, mode)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {/*
                  ★ 2026-10-05（教师裁定 A）：「填空题的答案放到这里」——
                  这个空原来就在这一行右侧。答案**属于这个空**，与它的作答方式摆在一起，
                  教师不必滚到自动评分区里去找（那一块还只有打开自动评分时才看得见）。
                  ⚠️ 外层是 `<label>`，里面**只有一个** `<input>`（`SymbolListInput` 渲染的就是它）
                     —— 标题文字与控件同属一个 label 是安全的；这里**绝不能**再塞按钮进去：
                     `<label>` 的隐式关联对象是它内部第一个可标注元素，而 `<button>` 也是
                     可标注元素 ⇒ 点标签空白会被转发给那个按钮（10-05 那次「点空白也会减」就是这个坑）。
                  ⚠️ 写回形状与原来那一份**逐字一致**（`blanks: undefined` + nested `answers`）。
                */}
                <label
                  className="worksheet-editor-fill-answer-field"
                  title={`${slot.label}：每个空可以填多个可接受答案；学生答出其中一个就算对。`}
                >
                  <span>答案</span>
                  <SymbolListInput
                    values={answerSets[index] ?? []}
                    split={splitChoiceText}
                    placeholder="填写标准答案"
                    onChange={items => onDataChange({
                      blanks: undefined,
                      answers: Array.from(
                        { length: answerSlots },
                        (_, answerIndex) => answerIndex === index
                          ? writeFillAnswers(items.join('\n'))
                          : (answerSets[answerIndex] ?? []),
                      ),
                    })}
                  />
                </label>
              </div>
              {settings[index].mode === 'inline' && (
                <label className="worksheet-editor-field worksheet-editor-inline-word-field">
                  <span>这一空右侧的词</span>
                  <SymbolListInput
                    values={settings[index].choices}
                    split={splitChoiceText}
                    placeholder="例如：唐、宋、元"
                    onChange={words => setInlineChoices(index, words)}
                  />
                </label>
              )}
              {node.type === 'fill-blank' && (
                <div className="worksheet-editor-fill-grading-row">
                  <span>评分方式</span>
                  <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label={`${slot.label}的评分方式`}>
                    {([
                      ['auto', '自动评分'],
                      ['ai', 'AI 评分'],
                      ['none', '不评分'],
                    ] as const).map(([mode, label]) => {
                      const selected = (settings[index].gradingMode ?? (node.autoGrade === false && node.data.aiScoringEnabled === true ? 'ai' : 'auto')) === mode;
                      return (
                        <label className={selected ? 'is-selected' : ''} key={mode}>
                          <input type="radio" name={`fill-grading-${node.id}-${index}`} checked={selected} onChange={() => setGradingMode(index, mode)} />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                  {(settings[index].gradingMode ?? (node.autoGrade === false && node.data.aiScoringEnabled === true ? 'ai' : 'auto')) !== 'none' && (
                    <label className="worksheet-editor-fill-score-input">
                      <span>满额</span>
                      <input type="number" min={1} max={99} value={settings[index].maxScore ?? 1} onChange={event => setMaxScore(index, event.target.value)} />
                    </label>
                  )}
                </div>
              )}
            </section>
          ))}
          {node.type === 'fill-blank' && hasExplicitFillGrading(settings) && (() => {
            const totals = fillGradingTotals(settings);
            return <p className="worksheet-editor-fill-score-summary">本题满额 {totals.total}：自动评分 {totals.auto}，AI 评分 {totals.ai}。</p>;
          })()}
          {/*
            ★ 2026-10-05：下面两句是从删掉的「标准答案」块搬来的 —— 答案本身搬进了上面每张卡片，
            但这两句说的是**整道题**，留在清单下方更合适。
            第二句（逐空给分那笔账）与「自动评分」卡里那个「最高 N」徽章是同一个数
            （两处都走 `maximumPointsFor` 那条判据），只是把它拆开算给教师看。
          */}
          <p className="worksheet-editor-compact-note">
            每个空可以填多个可接受答案；学生答出其中一个就算对。
          </p>
          {node.data.fillScoring === 'per-blank' && fullPoints > 0 && (
            <p className="worksheet-editor-compact-note">
              逐空给分：每个空 {fullPoints} 分 × {slots.length} 空 ⇒ 全对最多 <strong>{fullPoints * slots.length}</strong> 分。
            </p>
          )}
        </div>
      )}

      {/* ★ 2026-10-05（教师，截图标注）：「"下方共用词池" 改为 "共用选词"，并移到右侧，
          左右分栏显示。」
          ⇒ ① 标题改名（就这一处；保存校验那句报错在 `worksheet-questions.ts` 跟着改了，
             那句是同一件事的另一份拷贝）。
             ② 挪到右列**只靠 CSS**（外层那个 grid 现在两列）——这两块在 DOM 里本来就是
             兄弟，列表在前、词池在后，JSX 一行没动。
          ⚠️ 改的只是**编辑页的控制面板**：三个单选里那个「下方选词」**没动** ——
             它说的是学生从哪儿取词，而学生端那个词库仍然印在题干下方
             （`classroom/.../choice-blank-answer.tsx` 的 `choicePoolArea` 排在题干之后，
              提示语原话就是「待选词会显示在题干下方」）。位置对得上就不该改那句。 */}
      {settings.some(setting => setting.mode === 'pool') && (
        <label className="worksheet-editor-field worksheet-editor-choice-words">
          <span>共用选词</span>
          <SymbolListInput
            values={poolChoices}
            split={splitChoiceText}
            placeholder="例如：阳光、水分、空气"
            onChange={words => onDataChange({ fillChoicePool: words })}
          />
        </label>
      )}
    </div>
  );
}
