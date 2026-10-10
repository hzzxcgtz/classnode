'use client';

import { useCallback, useEffect, useState } from 'react';
import { ANALYSIS_PROMPT_TEMPLATES, ANALYSIS_TEMPLATE_STAGES, ANALYSIS_TEMPLATE_SUBJECTS } from '@/lib/analysis-prompt-templates';
import { TeacherPageHeader, Toast } from '@/lib/components';
import { Markdown } from '@/lib/markdown';
import { copyTemplate } from './copy-template';
import { analysisTemplateParts } from '@/lib/analysis-template-content';
import styles from './templates.module.css';

export default function AnalysisTemplatesPage() {
  const [stage, setStage] = useState<string>('primary');
  const [subject, setSubject] = useState<string>('math');
  const [raw, setRaw] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [copying, setCopying] = useState(false);
  const selected = ANALYSIS_PROMPT_TEMPLATES.find(row => row.stage === stage && row.subject === subject)!;
  const text = loaded?.id === selected.id ? loaded.text : '';
  const parts = analysisTemplateParts(text);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null); setError(''); setToast(null);
    void fetch(selected.file, { signal: controller.signal, cache: 'no-cache', credentials: 'omit' })
      .then(async response => {
        if (!response.ok) throw new Error('模板加载失败，请重试。');
        const content = await response.text();
        if (!content.trim() || /^\s*<!doctype|^\s*<html/i.test(content)) throw new Error('模板文件缺失，请检查分发包或重试。');
        if (!controller.signal.aborted) setLoaded({ id: selected.id, text: content });
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '模板加载失败'); });
    return () => controller.abort();
  }, [selected.id, selected.file, retry]);

  const copy = async () => {
    setCopying(true); setToast(null);
    try { await copyTemplate(parts.prompt); setToast({ msg: `已复制${selected.title}提示词`, type: 'success' }); }
    catch (error) { setToast({ msg: error instanceof Error ? error.message : '复制失败，请在原文中手动复制。', type: 'error' }); }
    finally { setCopying(false); }
  };

  return <div>
    {toast && <Toast msg={toast.msg} type={toast.type} onClose={closeToast} />}
    <TeacherPageHeader title="评分提示词模板库" description="按学段和学科选择，复制完整提示词到外部分析智能体的系统提示词中。" actions={
      <a className="btn btn-secondary" href="/teacher/agents/">返回 AI 智能体</a>
    } />
    <section className={styles.panel}>
      <div className={styles.filters}>
        <label>学段<select value={stage} onChange={event => { setStage(event.target.value); setToast(null); }} disabled={copying}>
          {ANALYSIS_TEMPLATE_STAGES.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select></label>
        <label>学科<select value={subject} onChange={event => { setSubject(event.target.value); setToast(null); }} disabled={copying}>
          {ANALYSIS_TEMPLATE_SUBJECTS.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select></label>
        <button type="button" className="btn btn-primary" disabled={!text || copying} onClick={() => { void copy(); }}>{copying ? '复制中…' : '一键复制完整提示词'}</button>
        <a className="btn btn-secondary" href={selected.file} download={`${selected.id}.md`}>下载 MD</a>
      </div>
      <p className={styles.hint}>模板默认可用，无需拼接或指定年级。前半部分“可优化区”可按教学需要调整；后半部分“固定区”请保留。复制时不会带入分区说明。题目评分标准和奖励数量在学习单中设置。</p>
    </section>
    <section className={styles.panel} aria-busy={!text && !error}>
      <div className={styles.heading}><h2>{selected.title}</h2><div className={styles.tabs} aria-label="模板显示方式">
        <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>在线查看</button>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>原文</button>
      </div></div>
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>重试加载</button></div>
        : !text ? <p>正在加载模板…</p>
          : raw ? <textarea className={styles.raw} aria-label={`${selected.title}提示词原文`} value={parts.prompt} readOnly />
            : <div className={styles.content}>{parts.editable ? <>
              <section className={styles.editableRegion}><div className={styles.regionHeading}><strong>可优化区</strong><span>可直接使用，也可调整角色、目标、学科重点和建议口吻</span></div><Markdown allowImages={false}>{parts.editable}</Markdown></section>
              <section className={styles.fixedRegion}><div className={styles.regionHeading}><strong>固定区 · 请保留</strong><span>保证学生对应、评分与系统返回格式准确</span></div><Markdown allowImages={false}>{parts.fixed}</Markdown></section>
            </> : <Markdown allowImages={false}>{text}</Markdown>}</div>}
    </section>
  </div>;
}
