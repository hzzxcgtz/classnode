'use client';

import { IconArrowBackUp } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
import { blankSlots, fillSettingsFor, sharedPoolChoices, writeFillSettings, splitChoiceText, choiceBreakEditorText, choiceBreakValueText } from '@/lib/worksheet-fill-modes';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import { isCombinationBlank, readFillAnswerCombinations, MAX_FILL_ANSWER_COMBINATIONS, type FillAnswerCombination } from '@/lib/worksheet-fill-combinations';
import { readBlankAnswers } from '../worksheet-editor-core';
import styles from './fill-combinations-editor.module.css';

function AnswerCell({ answers, label, onChange }: { answers: string[]; label: string; onChange: (answers: string[]) => void }) {
  const canonical = choiceBreakEditorText(answers.join(' | '));
  const [text, setText] = useState(canonical);
  const current = useRef(text);
  current.current = text;
  useEffect(() => {
    if (JSON.stringify(splitChoiceText(choiceBreakValueText(current.current))) !== JSON.stringify(answers)) setText(canonical);
  }, [canonical, answers]);
  return <textarea className={styles.answer} rows={2} aria-label={label} placeholder="填写答案" value={text}
    onKeyDown={event => {
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        const input = event.currentTarget;
        const next = text.slice(0, input.selectionStart) + '↵' + text.slice(input.selectionEnd);
        setText(next); onChange(splitChoiceText(choiceBreakValueText(next)));
      }
    }}
    onChange={event => { setText(event.target.value); onChange(splitChoiceText(choiceBreakValueText(event.target.value))); }} />;
}

function ChoiceAnswerCell({ answers, choices, label, onChange }: {
  answers: string[]; choices: string[]; label: string; onChange: (answers: string[]) => void;
}) {
  const values = answers.length ? answers : [''];
  return <div className={styles.choiceCell}>
    {values.map((value, index) => <div key={index} className={styles.choiceRow}>
      <select className={styles.answer} aria-label={index ? `${label} 可接受答案 ${index + 1}` : label}
        value={value} disabled={!choices.length} onChange={event => {
          const next = [...values]; next[index] = event.target.value;
          onChange([...new Set(next.filter(Boolean))]);
        }}>
        <option value="">{choices.length ? '请选择正确答案' : '请先设置选词'}</option>
        {value && !choices.includes(value) && <option value={value} disabled>{choiceBreakEditorText(value)}（已不在选词中）</option>}
        {choices.filter(choice => choice === value || !answers.includes(choice)).map(choice => <option key={choice} value={choice}>{choiceBreakEditorText(choice)}</option>)}
      </select>
      {values.length > 1 && <button type="button" className={styles.remove} aria-label={`移除${label} 可接受答案 ${index + 1}`}
        onClick={() => onChange(answers.filter((_, i) => i !== index))}>×</button>}
    </div>)}
    {choices.some(choice => !answers.includes(choice)) && answers.length > 0 && !answers.includes('') &&
      <button type="button" className={styles.addAlternative} onClick={() => onChange([...answers, ''])}>＋ 其它可接受答案</button>}
  </div>;
}

export function FillCombinationsEditor({ node, onDataChange }: { node: WorksheetQuestionNode; onDataChange: (patch: Record<string, unknown>) => void }) {
  const runs = readPromptRunsFor(node);
  const slots = blankSlots(node, runs);
  const settings = fillSettingsFor(node, runs);
  const rows = slots.map((slot, index) => ({ ...slot, index })).filter(row => isCombinationBlank(settings[row.index]));
  const extra = readFillAnswerCombinations(node.data.fillAnswerCombinations);
  const enabled = Array.isArray(node.data.fillAnswerCombinations);
  const base = readBlankAnswers(node);
  const poolChoices = sharedPoolChoices(node);
  const hasManualBlanks = rows.some(row => settings[row.index].mode === 'text');
  if (!rows.length || (rows.length < 2 && !enabled)) return null;
  const primary = { id: 'base', answers: Object.fromEntries(slots.map((slot, i) => [slot.id, base[i] ?? []])) };
  const columns = [primary, ...extra];
  const capacity = columns.length < MAX_FILL_ANSWER_COMBINATIONS;
  const save = (items: FillAnswerCombination[]) => {
    onDataChange({ fillAnswerCombinations: items });
  };
  const enable = () => {
    const next = settings.map(setting => ({ ...setting, conditionalAnswer: undefined }));
    onDataChange({ answers: slots.map((slot, i) => base[i] ?? []), blanks: undefined,
      fillBlankSettings: writeFillSettings(node, runs, next),
      fillAnswerCombinations: [],
    });
  };
  return <section className={styles.panel} id={`fill-combinations-${node.id}`} aria-label="正确答案组合">
    <header className={styles.header}>
      <div><h4>正确答案组合 {enabled && <span>{columns.length} 组</span>}</h4>
        <p>{enabled ? '每列一组答案，按最匹配的一组判分。' : '同一道题支持多组正确答案。'}</p></div>
      {enabled ? <button type="button" className={styles.modeSwitch} onClick={() => { onDataChange({ fillAnswerCombinations: undefined }); }}><IconArrowBackUp size={17} aria-hidden="true" />{extra.length ? '仅保留组合 1' : '返回逐空设置'}</button>
        : <button type="button" className={styles.primary} onClick={enable}>设置多组答案</button>}
    </header>
    {!enabled && settings.some(setting => setting.conditionalAnswer) && <p className={styles.note}>启用后将替代“根据另一空判分”，请在表格中补全每套答案。</p>}
    {enabled && <>
      <div className={styles.toolbar}>
        <button type="button" disabled={!capacity} onClick={() => save([...extra, {
          id: crypto.randomUUID(), answers: Object.fromEntries(rows.map(row => [row.id, []])),
        }])}>＋ 添加组合</button>
        {hasManualBlanks && <small>手工填写：多个答案用 | 分隔</small>}
      </div>
      <div className={styles.scroll} tabIndex={0} aria-label="答案组合表，可左右滚动"><table className={styles.table}>
        <thead><tr><th scope="col">填空域</th>{columns.map((column, i) => <th key={column.id} scope="col"><div><span>组合 {i + 1}</span>{i === 0 ? <small>基础答案</small> : <button type="button" aria-label={`删除组合 ${i + 1}`} className={styles.remove} onClick={() => save(extra.filter(item => item.id !== column.id))}>×</button>}</div></th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row"><span>第 {row.index + 1} 空</span></th>
          {columns.map((column, i) => {
            const setting = settings[row.index];
            const choices = setting.mode === 'pool' ? poolChoices : setting.mode === 'inline' ? setting.choices : undefined;
            const label = `组合 ${i + 1} 第 ${row.index + 1} 空答案`;
            const answers = column.answers[row.id] ?? [];
            const update = (answers: string[]) => {
              if (i === 0) onDataChange({ answers: slots.map((_, index) => index === row.index ? answers : base[index] ?? []), blanks: undefined });
              else save(extra.map(item => item.id === column.id ? { ...item, answers: { ...item.answers, [row.id]: answers } } : item));
            };
            return <td key={column.id}>{choices !== undefined
              ? <ChoiceAnswerCell answers={answers} choices={choices} label={label} onChange={update} />
              : <AnswerCell answers={answers} label={label} onChange={update} />}</td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
