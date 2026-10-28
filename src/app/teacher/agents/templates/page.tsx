'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ANALYSIS_PROMPT_TEMPLATES, ANALYSIS_TEMPLATE_STAGES, ANALYSIS_TEMPLATE_SUBJECTS } from '@/lib/analysis-prompt-templates';
import { TeacherPageHeader, Toast } from '@/lib/components';
import { Markdown } from '@/lib/markdown';
import { copyTemplate } from './copy-template';
import { api } from '@/lib/api';
import { analysisTemplateParts } from '@/lib/analysis-template-content';
import styles from './templates.module.css';

export default function AnalysisTemplatesPage() {
  const [stage, setStage] = useState<string>('primary');
  const [subject, setSubject] = useState<string>('math');
  const [raw, setRaw] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; text: string; version: string } | null>(null);
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
    void api.getAnalysisTemplate(selected.id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLoaded({ id: selected.id, ...result }); })
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
    <TeacherPageHeader title="作答分析提示词模板库" description="从官网读取最新模板，在这里选择、查看并复制到外部分析智能体。" actions={
      <Link className="btn btn-secondary" href="/teacher/agents/">返回 AI 智能体</Link>
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
        <button type="button" className="btn btn-secondary" disabled={!text || copying} onClick={() => {
          const url = URL.createObjectURL(new Blob([parts.prompt], { type: 'text/markdown;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = `${selected.id}.md`;
          document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>下载 MD</button>
      </div>
      <p className={styles.hint}>{text ? `远程模板 v${loaded?.version}` : '官网模板'} 按学科和学段分别提供具体评价方法，选择一份配置即可。日常在学习单填写 AI 评价要求（文字与图片），无需逐项修改模板。新版需复制到外部分析智能体后生效；不会自动更新平台已有配置。复制时不会带入分区说明。</p>
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
              <section className={styles.editableRegion}><div className={styles.regionHeading}><strong>可优化区</strong><span>包含本学科、学段的具体评价方法，可直接使用或按长期教学需要调整</span></div><Markdown allowImages={false}>{parts.editable}</Markdown></section>
              <section className={styles.fixedRegion}><div className={styles.regionHeading}><strong>固定区 · 请保留</strong><span>保证学生对应、评分与系统返回格式准确</span></div><Markdown allowImages={false}>{parts.fixed}</Markdown></section>
            </> : <Markdown allowImages={false}>{text}</Markdown>}</div>}
    </section>
  </div>;
}
