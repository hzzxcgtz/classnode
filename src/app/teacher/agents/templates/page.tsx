'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ANALYSIS_PROMPT_TEMPLATES } from '@/lib/analysis-prompt-templates';
import { TeacherPageHeader, Toast } from '@/lib/components';
import { Markdown } from '@/lib/markdown';
import { copyTemplate } from './copy-template';
import { api } from '@/lib/api';
import { analysisTemplateParts } from '@/lib/analysis-template-content';
import styles from './templates.module.css';

export default function AnalysisTemplatesPage() {
  const [raw, setRaw] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; text: string; version: string } | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [copying, setCopying] = useState(false);
  const selected = ANALYSIS_PROMPT_TEMPLATES[0];
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
    <TeacherPageHeader title="作答分析通用提示词" description="一份适用于不同学段与学科的参考模板，也可以使用你自己的专业教学智能体。" actions={
      <Link className="btn btn-secondary" href="/teacher/agents/">返回 AI 智能体</Link>
    } />
    <section className={styles.panel}>
      <div className={styles.filters}>
        <button type="button" className="btn btn-primary" disabled={!text || copying} onClick={() => { void copy(); }}>{copying ? '复制中…' : '复制通用提示词'}</button>
        <button type="button" className="btn btn-secondary" disabled={!text || copying} onClick={() => {
          const url = URL.createObjectURL(new Blob([parts.prompt], { type: 'text/markdown;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = `${selected.id}.md`;
          document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>下载 MD</button>
      </div>
      <p className={styles.hint}>{text ? `内置通用模板 v${loaded?.version}` : '通用模板随应用提供'}，无需按学段、学科选择。ClassNode 会在每次调用时提供本题要求、教师评价标准、学生材料和返回格式；具体的评价要求仍在学习单中填写。</p>
      <div className={styles.guidance}>
        <h2>也可以使用你自己的专业教学智能体</h2>
        <p>这份模板是可选参考。你完全可以接入自己设计的智能体，或已试用过的学科辅助教学智能体。它们积累的学科知识、教学方法和知识库，可能更贴合你的课堂，取得更好的效果。</p>
        <p>建议先用少量真实作答测试，确认能正确对应学生、理解文字或附件，并按本题要求返回评价、分数与班级分析，再用于全班。实际效果以试用为准。</p>
        <p>替换旧提示词前请先备份。可以保留有效的学科特色，但应调整与本题要求冲突的固定评分条件或返回格式；系统不会自动修改外部智能体配置。</p>
      </div>
    </section>
    <section className={styles.panel} aria-busy={!text && !error}>
      <div className={styles.heading}><h2>{selected.title}</h2><div className={styles.tabs} aria-label="模板显示方式">
        <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>在线查看</button>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>原文</button>
      </div></div>
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>重试加载</button></div>
        : !text ? <p>正在加载模板…</p>
          : raw ? <textarea className={styles.raw} aria-label={`${selected.title}提示词原文`} value={parts.prompt} readOnly />
            : <div className={styles.content}><Markdown allowImages={false}>{parts.prompt.replace(/^\s*<!--[\s\S]*?-->\s*/, '')}</Markdown></div>}
    </section>
  </div>;
}
