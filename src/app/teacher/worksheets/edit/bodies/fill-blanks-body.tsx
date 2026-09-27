'use client';

import { useEffect, useState } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import { blankLabelAt, blankLayout } from '@/lib/worksheet-table';
import { readBlankCount } from '@/lib/worksheet-questions';
import { fillSettingsFor, sharedPoolChoices, splitChoiceLines, splitChoiceText, writeFillSettings, type FillAnswerMode } from '@/lib/worksheet-fill-modes';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import {
  readBlankAnswers,
  writeFillAnswers,
} from '../worksheet-editor-core';

/**
 * 一行一项的编辑框需要保留教师正在输入的末尾换行。
 * 直接把 `splitChoiceLines(text)` 的结果立刻回填给 textarea，会马上删掉空行，表现为 Enter 失效。
 */
function LineListTextarea({
  values,
  rows,
  placeholder,
  onLinesChange,
}: {
  values: string[];
  rows: number;
  placeholder: string;
  onLinesChange: (lines: string[]) => void;
}) {
  const canonical = values.join('\n');
  const [draft, setDraft] = useState(canonical);

  useEffect(() => {
    setDraft(canonical);
  }, [canonical]);

  return (
    <textarea
      className="input"
      rows={rows}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onLinesChange(splitChoiceLines(next));
      }}
      onBlur={() => setDraft(current => splitChoiceLines(current).join('\n'))}
      placeholder={placeholder}
    />
  );
}

/**
 * **单行**的词表输入（★ 2026-09-28，教师）。
 *
 * 教师原话：「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示使用
 * 常见的符号分隔即可。」⇒ 待选词从多行 textarea 换成单行输入框。
 *
 * 🔴 **为什么自己存一份正在输入的文本**：与 `LineListTextarea` 逐字同一条理由 ——
 * 每次按键都立刻 `splitChoiceText(text).join('、')` 回填的话，教师刚打完的那个分隔符
 * 会在同一瞬间被吃掉（「阳光、」→ 变回「阳光」）⇒ **第二个词根本打不进去**。
 * ⇒ 打字时只更新自己那一份，`onBlur` 才规范化显示。
 * ⚠️ 依赖是那个**字符串**（不是数组）：解析结果没变时 canonical 不变 ⇒ effect 不跑
 * ⇒ draft 里那个尾巴留得住。这一条与 `LineListTextarea` 完全一样。
 *
 * ⚠️ 分隔符由 `splitChoiceText` 认（顿号 / 逗号 / 分号 / 换行），**判据不在组件里**。
 * ⚠️ 显示时用顿号 join：教师看到的就是他们自己会打的那个符号。
 */
function ChoiceWordsInput({ values, placeholder, onChange }: {
  values: string[];
  placeholder: string;
  onChange: (words: string[]) => void;
}) {
  const canonical = values.join('、');
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
        onChange(splitChoiceText(next));
      }}
      onBlur={() => setDraft(splitChoiceText(draft).join('、'))}
    />
  );
}

/**
 * 填空题与选择填空题的答案区。
 *
 * 空的数量只有一个来源：题干 `promptRuns` 中带稳定 blank id 的占位符。这里不再提供
 * “增加/删除答案框”，避免题干有两个空、下方却有三个答案框的双真源。教师在题干中
 * 插入或整体删除 `{填空域}`，答案框随即按 blank id 联动；已有答案不会因前面插空而串位。
 * 每个 textarea 仍是一行一个可接受答案，保存前由 `sanitizeContentForSave` 清理空行。
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
              <LineListTextarea
                rows={2}
                values={answerSets[index] ?? []}
                onLinesChange={lines => onDataChange({
                  blanks: undefined,
                  answers: Array.from(
                    { length: slots },
                    (_, answerIndex) => answerIndex === index
                      ? writeFillAnswers(lines.join('\n'))
                      : (answerSets[answerIndex] ?? []),
                  ),
                })}
                placeholder={'填写标准答案；多个可接受答案请分行输入'}
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
 * 选择填空的题面设置。它属于学生看到的题目内容，不属于答案键，因此由题目卡固定放在
 * 题干编辑之后、评分方式之前。关闭自动评分时，这一段仍可编辑。
 */
export function ChoiceBlankSetup({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const runs = readPromptRunsFor(node);
  const settings = fillSettingsFor(node, runs);
  const poolChoices = sharedPoolChoices(node);
  const setMode = (index: number, mode: FillAnswerMode) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index ? { ...setting, mode } : setting);
    onDataChange({ fillBlankSettings: writeFillSettings(runs, next) });
  };
  // ★ 2026-09-28：直接收词表 —— 原来收一个字符串再 `splitChoiceLines` 解析一遍，
  // 而单行输入那一侧已经解析过了（多一次往返就多一处会分叉的地方）。
  const setInlineChoices = (index: number, words: string[]) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, choices: words }
      : setting);
    onDataChange({ fillBlankSettings: writeFillSettings(runs, next) });
  };

  return (
    <div className="worksheet-editor-choice-blank-setup">
      {settings.length === 0 ? (
        <div className="worksheet-editor-blank-empty"><strong>题干中还没有填空域</strong><span>先在题干中插入“{'{填空域}'}”，这里会自动出现对应设置。</span></div>
      ) : (
        <div className="worksheet-editor-fill-mode-list">
          {settings.map((setting, index) => (
            <section className="worksheet-editor-fill-mode-card" key={index}>
              <div className="worksheet-editor-fill-mode-head">
                <strong>第 {index + 1} 空</strong>
                <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label={`第 ${index + 1} 空作答方式`}>
                  {([
                    ['text', '手工填写'],
                    ['inline', '右侧选词'],
                    ['pool', '下方选词'],
                  ] as const).map(([mode, label]) => (
                    <label className={setting.mode === mode ? 'is-selected' : ''} key={mode}>
                      <input type="radio" name={`fill-mode-${node.id}-${index}`} checked={setting.mode === mode} onChange={() => setMode(index, mode)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {setting.mode === 'inline' && (
                <label className="worksheet-editor-field worksheet-editor-inline-word-field">
                  <span>这一空右侧的词</span>
                  <ChoiceWordsInput values={setting.choices} onChange={words => setInlineChoices(index, words)} placeholder="用顿号或逗号分隔，例如：唐、宋、元" />
                </label>
              )}
            </section>
          ))}
        </div>
      )}

      {settings.some(setting => setting.mode === 'pool') && (
        <label className="worksheet-editor-field worksheet-editor-choice-words">
          <span>下方共用词池</span>
          <ChoiceWordsInput values={poolChoices} onChange={words => onDataChange({ fillChoicePool: words })} placeholder="用顿号或逗号分隔，例如：阳光、水分、空气" />
          <span className="worksheet-editor-blank-hint">所有设为“下方选词”的空共用这一组词；已使用的词会暂时离开词池。</span>
        </label>
      )}
    </div>
  );
}
