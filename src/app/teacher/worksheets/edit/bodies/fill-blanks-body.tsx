'use client';

import { useEffect, useState } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import { blankLabelAt, blankLayout } from '@/lib/worksheet-table';
import { readBlankCount } from '@/lib/worksheet-questions';
import { blankSlots, fillSettingsFor, sharedPoolChoices, splitChoiceText, writeFillSettings, type FillAnswerMode } from '@/lib/worksheet-fill-modes';
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
 * 🔴 **为什么自己存一份正在输入的文本**：每次按键都立刻 `split(text).join(joinWith)`
 * 回填的话，教师刚打完的那个分隔符会在同一瞬间被吃掉（「阳光、」→ 变回「阳光」）
 * ⇒ **第二个词根本打不进去**。⇒ 打字时只更新自己那一份，`onBlur` 才规范化显示。
 * ⚠️ 依赖是那个**字符串**（不是数组）：解析结果没变时 canonical 不变 ⇒ effect 不跑
 * ⇒ draft 里那个尾巴留得住。
 *
 * ⚠️ **分隔符由调用方给**（`split` / `joinWith`），判据在 `@/lib/worksheet-fill-modes`：
 *   两种输入都认常见的那些（顿号/逗号/分号/斜杠/竖线/换行）—— 见 `splitChoiceText`
 *   的文件头，那里记着「代价是什么」与教师为什么这么选。
 * ⚠️ 三处共用一个组件是刻意的：同屏三个同类输入框各写一份，改一处只改一处，
 *   而教师看到的是「三个长得不一样的框」。
 */
function SymbolListInput({ values, split, joinWith, placeholder, onChange }: {
  values: string[];
  split: (raw: string) => string[];
  joinWith: string;
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const canonical = values.join(joinWith);
  const [draft, setDraft] = useState(canonical);

  useEffect(() => {
    setDraft(canonical);
  }, [canonical]);

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
      onBlur={() => setDraft(split(draft).join(joinWith))}
    />
  );
}

/**
 * 填空题与选择填空题的答案区。
 *
 * 空的数量只有一个来源：题干 `promptRuns` 中带稳定 blank id 的占位符。这里不再提供
 * “增加/删除答案框”，避免题干有两个空、下方却有三个答案框的双真源。教师在题干中
 * 插入或整体删除 `{填空域}`，答案框随即按 blank id 联动；已有答案不会因前面插空而串位。
 * ★ 2026-09-28（教师）：输入框从多行 textarea 改成**单行**（多个答案用分号分隔，
 * 见 `SymbolListInput`），而**存储形状一个字没变** —— 仍然是「每空一份字符串数组」，
 * 由 `sanitizeContentForSave` 在出网前清掉空项。
 */
export function FillBlanksBody({ node, onDataChange, showAnswer = true, fullPoints = 0 }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ 答案控件不渲染（题面照常）。 */
  showAnswer?: boolean;
  /** ★ 2026-09-28（表格填空，裁定④甲）：这一题「全对」值几分（逐题或继承学习单级）。 */
  fullPoints?: number;
}) {
  const answerSets = readBlankAnswers(node);
  // 🔴 空数必须读 `readBlankCount`（题干里的空 + **表格里的空**）。
  // 原来这里数的是 `blankCount(promptRuns)` —— 表格题会**一个答案框都不渲染**
  // （教师填不了答案，而屏幕上只是「这道题没有空」）。
  const slots = readBlankCount(node);
  const { textCount } = blankLayout(node);

  return (
    <>
      {showAnswer && slots > 0 && (
        <div className="worksheet-editor-blank-answer-grid">
          {Array.from({ length: slots }, (_, index) => (
            <label className="worksheet-editor-blank-answer" key={index}>
              <span>
                {/* ★ 2026-09-28（表格填空）：位置**说实话**。
                    题干里的空说「第 2 空」；表格里的空说「第 2 行第 2 格」——
                    后者要是也说「第 N 空」，教师改答案时对着屏幕找不到那一格。
                    ⚠️ 判据在 `blankLabelAt`（有用例），这里不自己算行列。 */}
                <strong>{blankLabelAt(node, index) ?? `第 ${index + 1} 空`}</strong>
                <em>{index < textCount ? `对应题干中第 ${index + 1} 个填空域` : '在表格里'}</em>
              </span>
              <SymbolListInput
                values={answerSets[index] ?? []}
                split={splitChoiceText}
                joinWith="；"
                placeholder="填写标准答案"
                onChange={items => onDataChange({
                  blanks: undefined,
                  answers: Array.from(
                    { length: slots },
                    (_, answerIndex) => answerIndex === index
                      ? writeFillAnswers(items.join('\n'))
                      : (answerSets[answerIndex] ?? []),
                  ),
                })}
              />

            </label>
          ))}
        </div>
      )}

      {showAnswer && slots === 0 && (
        <div className="worksheet-editor-blank-empty">
          <strong>还没有填空位置</strong>
          <span>把光标放到题干的目标位置，再点击工具栏中的“{'{填空域}'}”；或者在上面加一张表格、把某几格标成「填空」。</span>
        </div>
      )}

      {showAnswer && slots > 0 && (
        <p className="worksheet-editor-compact-note">
          已根据题干与表格自动生成 {slots} 个答案框；调整填空域或表格时，这里会同步更新。
          {/* ★ 2026-09-28（表格填空，裁定④甲）：逐空给分时**把这笔账算给教师看**。
              服务端对 `fillScoring: 'per-blank'` 的给分是「命中空数 × 本题满分」
              ⇒ 6 个空的题、每空 1 分，学生全对拿的是 6 分。
              ⚠️ 这句话与「自动评分」卡里那个「最高 N」徽章是同一个数
                 （两处都走 `maximumPointsFor` 那一条判据），只是这里把它拆开写，
                 因为教师是在**这里**填答案的。 */}
          {node.data.fillScoring === 'per-blank' && fullPoints > 0 && (
            <> 逐空给分：每个空 {fullPoints} 分 × {slots} 空 ⇒ 全对最多 <strong>{fullPoints * slots}</strong> 分。</>
          )}
        </p>
      )}
    </>
  );
}

/**
 * 「每个空的作答方式」——★ 2026-09-28（教师反馈）：它管的是**这道题全部的空**
 *（题干里的 + 表格里的），不再只认题干里那几个。表格里的空 v1 固定手工填写，
 * 所以那几张卡只报位置、不摆单选。
 *
 * 它属于学生看到的题目内容，不属于答案键，因此由题目卡固定放在题干编辑之后、
 * 评分方式之前。关闭自动评分时，这一段仍可编辑。
 */
export function ChoiceBlankSetup({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const runs = readPromptRunsFor(node);
  // ★ 2026-09-28（教师反馈）：清单走 `blankSlots` —— **题干里的空与表格里的空是同一批**。
  // 原来只遍历 `promptRuns` ⇒ 一道表格题在这里显示「题干中还没有填空域」，
  // 而上面明明有一张表标着空（两块互相打脸 —— 教师：「一头雾水，东跳跳西跳跳」）。
  const slots = blankSlots(node, runs);
  const settings = fillSettingsFor(node, runs);
  const poolChoices = sharedPoolChoices(node);
  const setMode = (index: number, mode: FillAnswerMode) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index ? { ...setting, mode } : setting);
    onDataChange({ fillBlankSettings: writeFillSettings(node, runs, next) });
  };
  // ★ 2026-09-28：直接收词表 —— 原来收一个字符串再 `splitChoiceLines` 解析一遍，
  // 而单行输入那一侧已经解析过了（多一次往返就多一处会分叉的地方）。
  const setInlineChoices = (index: number, words: string[]) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, choices: words }
      : setting);
    onDataChange({ fillBlankSettings: writeFillSettings(node, runs, next) });
  };

  return (
    <div className="worksheet-editor-choice-blank-setup">
      {slots.length === 0 ? (
        <div className="worksheet-editor-blank-empty">
          <strong>还没有填空的位置</strong>
          <span>把光标放到题干的目标位置再点“{'{填空域}'}”；或者在上面加一张表格、把某几格标成「填空」。</span>
        </div>
      ) : (
        <div className="worksheet-editor-fill-mode-list">
          {slots.map((slot, index) => (
            // key 用空的身份（不是下标）：题干里插一个空时，后面那些卡不会整排重挂载
            <section className="worksheet-editor-fill-mode-card" key={slot.id}>
              <div className="worksheet-editor-fill-mode-head">
                {/* ★ 位置**说实话**：题干里的空说「第 2 空」，表格里的空说「第 2 行第 2 格」 */}
                <strong>{slot.label}</strong>
                {slot.kind === 'table' ? (
                  // ⚠️ 表格里的空 v1 固定手工填写 ⇒ **不摆一排点了没用的单选**
                  //（点了也存不下服务端认得的形状，而教师会以为它生效了）
                  <span className="worksheet-editor-blank-hint">在表格里 · 学生在这一格填字</span>
                ) : (
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
                )}
              </div>
              {slot.kind === 'text' && settings[index].mode === 'inline' && (
                <label className="worksheet-editor-field worksheet-editor-inline-word-field">
                  <span>这一空右侧的词</span>
                  <SymbolListInput
                    values={settings[index].choices}
                    split={splitChoiceText}
                    joinWith="、"
                    placeholder="例如：唐、宋、元"
                    onChange={words => setInlineChoices(index, words)}
                  />
                </label>
              )}
            </section>
          ))}
        </div>
      )}

      {settings.some(setting => setting.mode === 'pool') && (
        <label className="worksheet-editor-field worksheet-editor-choice-words">
          <span>下方共用词池</span>
          <SymbolListInput
            values={poolChoices}
            split={splitChoiceText}
            joinWith="、"
            placeholder="例如：阳光、水分、空气"
            onChange={words => onDataChange({ fillChoicePool: words })}
          />
        </label>
      )}
    </div>
  );
}
