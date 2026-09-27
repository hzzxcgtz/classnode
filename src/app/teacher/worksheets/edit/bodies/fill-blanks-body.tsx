'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { blankCount } from '@/lib/worksheet-prompt-marks';
import { fillSettingsFor, sharedPoolChoices, splitChoiceLines, writeFillSettings, type FillAnswerMode } from '@/lib/worksheet-fill-modes';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import {
  readBlankAnswers,
  writeFillAnswers,
} from '../worksheet-editor-core';

/**
 * 填空题与选择填空题的答案区。
 *
 * 空的数量只有一个来源：题干 `promptRuns` 中带稳定 blank id 的占位符。这里不再提供
 * “增加/删除答案框”，避免题干有两个空、下方却有三个答案框的双真源。教师在题干中
 * 插入或整体删除 `{填空域}`，答案框随即按 blank id 联动；已有答案不会因前面插空而串位。
 * 每个 textarea 仍是一行一个可接受答案，保存前由 `sanitizeContentForSave` 清理空行。
 */
export function FillBlanksBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ 答案控件不渲染（题面照常）。 */
  showAnswer?: boolean;
}) {
  const answerSets = readBlankAnswers(node);
  const slots = blankCount(readPromptRunsFor(node));

  return (
    <>
      {showAnswer && slots > 0 && (
        <div className="worksheet-editor-blank-answer-grid">
          {Array.from({ length: slots }, (_, index) => (
            <label className="worksheet-editor-blank-answer" key={index}>
              <span>
                <strong>第 {index + 1} 空</strong>
                <em>对应题干中第 {index + 1} 个填空域</em>
              </span>
              <textarea
                className="input"
                rows={2}
                value={(answerSets[index] ?? []).join('\n')}
                onChange={event => onDataChange({
                  blanks: undefined,
                  answers: Array.from(
                    { length: slots },
                    (_, answerIndex) => answerIndex === index
                      ? writeFillAnswers(event.target.value)
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
          <strong>题干中还没有填空域</strong>
          <span>把光标放到题干的目标位置，再点击工具栏中的“{'{填空域}'}”。</span>
        </div>
      )}

      {showAnswer && slots > 0 && (
        <p className="worksheet-editor-compact-note">
          已根据题干自动生成 {slots} 个答案框；调整题干中的填空域时，这里会同步更新。
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
  const setInlineChoices = (index: number, text: string) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, choices: splitChoiceLines(text) }
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
              <div className="worksheet-editor-fill-mode-head"><strong>第 {index + 1} 空</strong><span>{setting.mode === 'text' ? '学生手工填写' : setting.mode === 'inline' ? '右侧独立选词' : '下方共用词池'}</span></div>
              <div className="worksheet-editor-fill-mode-tabs" role="radiogroup" aria-label={`第 ${index + 1} 空作答方式`}>
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
              {setting.mode === 'inline' && (
                <label className="worksheet-editor-field worksheet-editor-inline-word-field">
                  <span>这一空右侧的词</span>
                  <textarea className="input" rows={2} value={setting.choices.join('\n')} onChange={event => setInlineChoices(index, event.target.value)} placeholder={'一行一个词，例如：\n阳光\n灯光'} />
                </label>
              )}
            </section>
          ))}
        </div>
      )}

      {settings.some(setting => setting.mode === 'pool') && (
        <label className="worksheet-editor-field worksheet-editor-choice-words">
          <span>下方共用词池</span>
          <textarea className="input" rows={3} value={poolChoices.join('\n')} onChange={event => onDataChange({ fillChoicePool: splitChoiceLines(event.target.value) })} placeholder={'一行一个词，例如：\n阳光\n水分\n空气'} />
          <span className="worksheet-editor-blank-hint">所有设为“下方选词”的空共用这一组词；已使用的词会暂时离开词池。</span>
        </label>
      )}
    </div>
  );
}
