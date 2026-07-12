'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Pagination } from '@/lib/components';
import type { ClassroomWarning, ClassroomWarningSummary, ShieldWord } from '@/lib/types';

export default function ShieldPage() {
  const [tab, setTab] = useState<'words' | 'records'>('words');
  const [words, setWords] = useState<ShieldWord[]>([]);
  const [newWord, setNewWord] = useState('');
  const [autoBlackCount, setAutoBlackCount] = useState(0);
  const [rateLimit, setRateLimit] = useState(6);
  const [saving, setSaving] = useState(false);
  const [addSaved, setAddSaved] = useState(false);
  const [error, setError] = useState('');
  const [configSaved, setConfigSaved] = useState(false);
  const [configError, setConfigError] = useState('');
  const [builtinMsg, setBuiltinMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [categories, setCategories] = useState<{ name: string; count: number; words: { id: string; word: string }[] }[]>([]);
  // 警告记录
  const [summary, setSummary] = useState<ClassroomWarningSummary[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ClassroomWarning[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingWarnings, setLoadingWarnings] = useState(false);
  const [warningPage, setWarningPage] = useState(1);
  const [wordPage, setWordPage] = useState(1);
  const [warningPageSize, setWarningPageSize] = useState(20);
  const [wordPageSize, setWordPageSize] = useState(50);
  const [shieldAction, setShieldAction] = useState<string | null>(null);
  const shieldActionRef = useRef(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (tab === 'records') loadSummary();
  }, [tab]);

  async function loadData() {
    try {
      const [w, cfg, cats] = await Promise.all([api.getShieldWords(), api.getShieldConfig(), api.getShieldCategories()]);
      setWords(w);
      setAutoBlackCount(cfg.autoBlackCount || 0);
      setRateLimit(cfg.rateLimit ?? 6);
      setCategories(cats || []);
    } catch {}
  }

  async function loadSummary() {
    setLoadingSummary(true);
    try {
      const data = await api.getWarningsSummary();
      setSummary(data);
      if (data.length > 0) {
        const firstId = selectedClassroom || data[0].id;
        setSelectedClassroom(firstId);
        loadWarnings(firstId);
      }
    } catch {}
    setLoadingSummary(false);
  }

  async function loadWarnings(classroomId: string) {
    setSelectedClassroom(classroomId);
    setLoadingWarnings(true);
    try {
      const data = await api.getClassroomWarnings(classroomId);
      setWarnings(data);
      setWarningPage(1);
    } catch {}
    setLoadingWarnings(false);
  }

  const builtinWords = words.filter(w => w.builtin);
  const customWords = words.filter(w => !w.builtin);
  const pagedCustomWords = customWords.slice((wordPage - 1) * wordPageSize, wordPage * wordPageSize);
  const pagedWarnings = warnings.slice((warningPage - 1) * warningPageSize, warningPage * warningPageSize);

  const addWords = async () => {
    const raw = newWord.trim();
    if (!raw) return;
    // 按常见分隔符切分：中文逗号、英文逗号、分号、顿号、空格、换行
    const words = raw.split(/[,，;；、\s\n]+/).map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return;
    if (shieldActionRef.current) return;
    shieldActionRef.current = true;
    setShieldAction('add');
    setSaving(true);
    setError('');
    let lastError = '';
    for (const w of words) {
      try {
        await api.addShieldWord(w);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : `「${w}」添加失败`;
      }
    }
    if (lastError) setError(lastError);
    else { setAddSaved(true); setTimeout(() => setAddSaved(false), 1500); }
    setNewWord('');
    await loadData();
    shieldActionRef.current = false;
    setShieldAction(null);
    setSaving(false);
  };

  const deleteWord = async (id: string) => {
    if (shieldActionRef.current) return;
    shieldActionRef.current = true;
    setShieldAction('delete');
    try {
      await api.deleteShieldWord(id);
      await loadData();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : '删除失败');
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  const saveConfig = async () => {
    if (shieldActionRef.current) return;
    shieldActionRef.current = true;
    setShieldAction('config');
    setConfigSaved(false);
    setConfigError('');
    try {
      await api.updateShieldConfig({ autoBlackCount, rateLimit });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (error: unknown) {
      setConfigError(error instanceof Error ? error.message : '保存失败');
      setTimeout(() => setConfigError(''), 3000);
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  const toggleCustomWords = async () => {
    if (shieldActionRef.current || !customWords.length) return;
    shieldActionRef.current = true;
    setShieldAction('toggle');
    try {
      const ids = customWords.map(word => word.id);
      const enable = customWords.every(word => word.enabled === false);
      await api.batchToggleShieldWords(ids, enable);
      await loadData();
      setBuiltinMsg({ type: 'success', text: enable ? '已启用全部自定义屏蔽词' : '已禁用全部自定义屏蔽词' });
    } catch (error) {
      setBuiltinMsg({ type: 'error', text: `批量更新失败：${error instanceof Error ? error.message : '请求异常'}` });
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  const deleteCustomWords = async () => {
    if (shieldActionRef.current || !customWords.length) return;
    if (!confirm(`确定删除全部 ${customWords.length} 个自定义屏蔽词？`)) return;
    shieldActionRef.current = true;
    setShieldAction('delete');
    try {
      await api.batchDeleteShieldWords(customWords.map(word => word.id));
      await loadData();
      setBuiltinMsg({ type: 'success', text: '已删除全部自定义屏蔽词' });
    } catch (error) {
      setBuiltinMsg({ type: 'error', text: `批量删除失败：${error instanceof Error ? error.message : '请求异常'}` });
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  const clearWarnings = async () => {
    if (!selectedClassroom || shieldActionRef.current) return;
    if (!confirm('确认清空该课堂的所有拦截记录？')) return;
    shieldActionRef.current = true;
    setShieldAction('warnings');
    try {
      await api.clearClassroomWarnings(selectedClassroom);
      await Promise.all([loadWarnings(selectedClassroom), loadSummary()]);
      setBuiltinMsg({ type: 'success', text: '已清空该课堂的拦截记录' });
    } catch (error) {
      setBuiltinMsg({ type: 'error', text: `清空记录失败：${error instanceof Error ? error.message : '请求异常'}` });
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  const toggleBuiltinWords = async () => {
    if (shieldActionRef.current || !builtinWords.length) return;
    shieldActionRef.current = true;
    setShieldAction('toggle');
    try {
      const enable = builtinWords.every(word => word.enabled === false);
      await api.batchToggleShieldWords(builtinWords.map(word => word.id), enable);
      await loadData();
      setBuiltinMsg({ type: 'success', text: enable ? '已启用系统屏蔽词' : '已禁用系统屏蔽词' });
    } catch (error) {
      setBuiltinMsg({ type: 'error', text: `系统屏蔽词更新失败：${error instanceof Error ? error.message : '请求异常'}` });
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  const deleteWarning = async (warningId: string) => {
    if (!selectedClassroom || shieldActionRef.current) return;
    shieldActionRef.current = true;
    setShieldAction('warnings');
    try {
      await api.deleteWarning(warningId);
      await Promise.all([loadWarnings(selectedClassroom), loadSummary()]);
    } catch (error) {
      setBuiltinMsg({ type: 'error', text: `删除记录失败：${error instanceof Error ? error.message : '请求异常'}` });
    } finally {
      shieldActionRef.current = false;
      setShieldAction(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 页面标题 */}
      <div className="teacher-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0 }}>屏蔽管理</h1>
          </div>
          <p style={{ fontSize: "0.813rem", color: '#64748b', margin: '6px 0 0', lineHeight: 1.6, paddingLeft: 42 }}>
            学生发送的消息中包含屏蔽词时将自动替换为 <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: "0.75rem" }}>***</code> 并记录警告。触发警告达到设定次数后自动黑屏。
          </p>
        </div>
      </div>

      {/* 标签切换 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 4, borderBottom: '1px solid #e2e8f0' }}>
        {([
          { key: 'words', label: '词库管理', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8' },
          { key: 'records', label: '拦截记录', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 8v4 M12 16h.01' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); }}
            style={{
              flex: 1, padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit',
              border: 'none', borderBottom: tab === t.key ? '2px solid #007aff' : '2px solid transparent',
              background: tab === t.key ? 'rgba(0,122,255,0.04)' : 'transparent',
              color: tab === t.key ? '#007aff' : '#64748b',
              fontSize: "0.875rem", fontWeight: 600, transition: 'all 0.12s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'words' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 管控设置：自动黑屏 + 提问频率 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>管控设置</h2>
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', gap: 32 }}>
            {/* 自动黑屏 */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.813rem", fontWeight: 600, color: '#0f172a', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                自动黑屏
              </div>
              <p style={{ fontSize: "0.75rem", color: '#94a3b8', margin: '0 0 12px 20px', lineHeight: 1.5 }}>
                触发屏蔽词达到设定次数后，学生端自动黑屏
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 20 }}>
                <input type="number" className="input"
                  value={autoBlackCount}
                  onChange={e => setAutoBlackCount(parseInt(e.target.value) || 0)}
                  min={0} max={99}
                  style={{ width: 72, textAlign: 'center', fontSize: "1rem", fontWeight: 600, padding: '8px 12px' }}
                />
                <span style={{ fontSize: "0.813rem", color: '#64748b' }}>次后自动黑屏</span>
              </div>
            </div>
            {/* 分割线 */}
            <div style={{ width: 1, background: '#eef2f6', flexShrink: 0 }} />
            {/* 频率限制 */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.813rem", fontWeight: 600, color: '#0f172a', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                提问频率限制
              </div>
              <p style={{ fontSize: "0.75rem", color: '#94a3b8', margin: '0 0 12px 20px', lineHeight: 1.5 }}>
                限制每位学生每分钟最多向 AI 提问的次数
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 20 }}>
                <input type="number" className="input"
                  value={rateLimit}
                  onChange={e => setRateLimit(parseInt(e.target.value) || 0)}
                  min={0} max={99}
                  style={{ width: 72, textAlign: 'center', fontSize: "1rem", fontWeight: 600, padding: '8px 12px' }}
                />
                <span style={{ fontSize: "0.813rem", color: '#64748b' }}>次 / 分钟</span>
              </div>
            </div>
          </div>
          <div style={{
            padding: '12px 24px', borderTop: '1px solid #f1f5f9',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
          }}>
            {configError && <span style={{ fontSize: "0.75rem", color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {configError}
            </span>}
            <button className="btn btn-primary" onClick={saveConfig}
              style={{ fontSize: "0.813rem", display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px' }}>
              {configSaved ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>已保存</>
              ) : '保存设置'}
            </button>
          </div>
        </div>

        {/* 添加屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>添加自定义屏蔽词</h2>
          </div>
          <div style={{ padding: '20px 24px' }}>
            <textarea
              className="input"
              value={newWord}
              onChange={e => { setNewWord(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addWords(); } }}
              placeholder="输入需要屏蔽的关键词，多个词可用逗号、空格、换行等分隔"
              rows={3}
              style={{
                width: '100%', padding: '12px 14px', boxSizing: 'border-box', resize: 'vertical',
                fontFamily: 'inherit', lineHeight: 1.6, fontSize: "0.875rem",
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{
                fontSize: "0.688rem", color: '#94a3b8',
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>支持批量添加，用</span>
                {['逗号', '分号', '顿号', '空格', '换行'].map((s, i) => (
                  <code key={i} style={{ background: '#f1f5f9', padding: '0 5px', borderRadius: 3, fontSize: "0.625rem", color: '#64748b' }}>{[' , ', ' ; ', ' 、 ', ' 空格 ', ' 换行 '][i]}</code>
                ))}
                <span>分隔，<code style={{ background: '#f1f5f9', padding: '0 5px', borderRadius: 3, fontSize: "0.625rem", color: '#64748b' }}>Shift+Enter</code> 换行 · <code style={{ background: '#f1f5f9', padding: '0 5px', borderRadius: 3, fontSize: "0.625rem", color: '#64748b' }}>Ctrl+Enter</code> 快速保存</span>
                {newWord.trim() && (
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>
                    · {newWord.trim().split(/[,，;；、\s\n]+/).filter(Boolean).length} 个词
                  </span>
                )}
              </div>
              <button className="btn btn-primary" onClick={addWords} disabled={saving || !newWord.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', fontSize: "0.813rem", flexShrink: 0 }}>
                {addSaved ? (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>已保存</>
                ) : '保存添加'}
              </button>
            </div>
            {error && (
              <div style={{ marginTop: 10, fontSize: "0.75rem", color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4, background: '#fef2f2', padding: '8px 12px', borderRadius: 8, border: '1px solid #fecaca' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}
          </div>
        </div>

        {/* 自定义屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>自定义屏蔽词</h2>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22,
                padding: '0 8px', height: 22, borderRadius: 11,
                background: customWords.length > 0 ? '#fef2f2' : '#f1f5f9',
                color: customWords.length > 0 ? '#dc2626' : '#94a3b8',
                fontSize: "0.688rem", fontWeight: 600,
              }}>
                {customWords.length}
              </span>
            </div>
            {customWords.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => void toggleCustomWords()} disabled={shieldAction !== null}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: 0, border: 'none', background: 'transparent', fontFamily: 'inherit',
                  }}
                  title={customWords.some(w => w.enabled !== false) ? '一键禁用所有自定义屏蔽词' : '一键启用所有自定义屏蔽词'}>
                  <span style={{
                    position: 'relative', width: 40, height: 22,
                    borderRadius: 11, border: 'none',
                    background: customWords.some(w => w.enabled !== false) ? '#22c55e' : '#d1d5db',
                    transition: 'background 0.2s', display: 'inline-block', flexShrink: 0,
                  }}>
                    <span style={{
                      position: 'absolute', top: 2,
                      left: customWords.some(w => w.enabled !== false) ? 20 : 2,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      transition: 'left 0.2s',
                    }} />
                  </span>
                  <span style={{ fontSize: "0.75rem", color: '#64748b' }}>{customWords.some(w => w.enabled !== false) ? '全部禁用' : '全部启用'}</span>
                </button>
                <button onClick={() => void deleteCustomWords()} disabled={shieldAction !== null}
                  style={{
                    fontSize: "0.75rem", padding: '5px 12px', borderRadius: 6, border: '1px solid #fecaca',
                    background: 'white', cursor: 'pointer', fontFamily: 'inherit', color: '#dc2626',
                    display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white'; }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  一键清空
                </button>
              </div>
            )}
          </div>
          {customWords.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#64748b', marginBottom: 2 }}>暂无自定义屏蔽词</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1' }}>在上方输入关键词后点击「批量添加」即可创建</div>
            </div>
          ) : (
            <div style={{ padding: '16px 20px 18px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {pagedCustomWords.map(w => (
                  <div key={w.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 6px 5px 12px', borderRadius: 8,
                    background: w.enabled === false ? '#f1f5f9' : '#fef2f2',
                    color: w.enabled === false ? '#94a3b8' : '#991b1b',
                    fontSize: "0.813rem", fontWeight: 500, lineHeight: 1.4,
                    border: `1px solid ${w.enabled === false ? '#e2e8f0' : '#fecaca'}`,
                    transition: 'all 0.1s',
                  }}>
                    <span style={{ opacity: w.enabled === false ? 0.5 : 1 }}>{w.word}</span>
                    <button onClick={() => deleteWord(w.id)}
                      style={{
                        width: 18, height: 18, border: 'none', borderRadius: 4,
                        background: 'transparent', cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: w.enabled === false ? '#94a3b8' : '#dc2626',
                        fontSize: "0.813rem", lineHeight: 1, opacity: 0.35,
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = w.enabled === false ? '#e2e8f0' : '#fecaca'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.35'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      title="删除">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <Pagination current={wordPage} total={customWords.length} pageSize={wordPageSize} pageSizeOptions={[10, 20, 50, 100]} onChange={setWordPage} onPageSizeChange={setWordPageSize} />
              </div>
            </div>
          )}
        </div>

        {/* 系统屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>
              </svg>
              <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>系统屏蔽词</h2>
              {builtinWords.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22,
                  padding: '0 8px', height: 22, borderRadius: 11,
                  background: '#eef2ff', color: '#6366f1',
                  fontSize: "0.688rem", fontWeight: 600,
                }}>
                  {builtinWords.length}
                </span>
              )}
            </div>
            <button onClick={() => void toggleBuiltinWords()} disabled={shieldAction !== null}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: 0, border: 'none', background: 'transparent', fontFamily: 'inherit',
              }}>
              <span style={{
                position: 'relative', width: 40, height: 22,
                borderRadius: 11, border: 'none', display: 'inline-block', flexShrink: 0,
                background: builtinWords.some(w => w.enabled !== false) ? '#22c55e' : '#d1d5db',
                transition: 'background 0.2s',
              }}>
                <span style={{
                  position: 'absolute', top: 2,
                  left: builtinWords.some(w => w.enabled !== false) ? 20 : 2,
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  transition: 'left 0.2s',
                }} />
              </span>
              <span style={{ fontSize: "0.75rem", color: '#64748b' }}>{builtinWords.some(w => w.enabled !== false) ? '全部禁用' : '全部启用'}</span>
            </button>
          </div>
          {builtinMsg && (
            <div style={{
              padding: '8px 24px', fontSize: "0.75rem",
              color: builtinMsg.type === 'success' ? '#16a34a' : '#ef4444',
              background: builtinMsg.type === 'success' ? '#f0fdf4' : '#fef2f2',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                {builtinMsg.type === 'success' ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>}
              </svg>
              {builtinMsg.text}
            </div>
          )}
          {builtinWords.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: '#94a3b8' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 8 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>
              </svg>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#64748b', marginBottom: 2 }}>系统屏蔽词为空</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1' }}>如需重新加载系统内置屏蔽词，请联系管理员</div>
            </div>
          ) : (
            <div style={{ padding: '18px 24px' }}>
              <div style={{
                padding: '14px 18px',
                background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
                display: 'flex', alignItems: 'flex-start', gap: 10,
                fontSize: "0.813rem", color: '#166534', lineHeight: 1.6,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>系统已自动内置屏蔽词，在学生发送消息时实时拦截不当言论，维护良好的课堂秩序。具体分类与内容不便展示，请放心使用。您可以通过右上角的开关开启或关闭此过滤功能。</span>
              </div>
            </div>
          )}
        </div>

      </div>}

      {tab === 'records' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0 }}>

        {/* 课堂列表 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9', background: '#fafbff',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>课堂列表</h2>
            {summary.length > 0 && (
              <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400 }}>
                — {summary.length} 个课堂有拦截记录
              </span>
            )}
          </div>
          {loadingSummary ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: "0.813rem" }}>加载中...</div>
            </div>
          ) : summary.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 8 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#64748b', marginBottom: 2 }}>暂无拦截记录</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1' }}>学生发送触发屏蔽词的内容后，记录会显示在此处</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {summary.map(c => (
                <button key={c.id} onClick={() => loadWarnings(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 24px', cursor: 'pointer', border: 'none', borderBottom: '1px solid #f1f5f9',
                    background: selectedClassroom === c.id ? '#f0f7ff' : 'white',
                    textAlign: 'left', fontFamily: 'inherit', width: '100%', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (selectedClassroom !== c.id) (e.currentTarget as HTMLElement).style.background = '#fafbfc'; }}
                  onMouseLeave={e => { if (selectedClassroom !== c.id) (e.currentTarget as HTMLElement).style.background = 'white'; }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: selectedClassroom === c.id ? '#2563eb' : 'transparent',
                    transition: 'all 0.15s',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: selectedClassroom === c.id ? '#1e40af' : '#0f172a' }}>{c.title || '未命名课堂'}</div>
                    <div style={{ fontSize: "0.75rem", color: '#94a3b8', marginTop: 2, display: 'flex', gap: 10 }}>
                      <span>{c.className}</span>
                      <span style={{
                        padding: '0 6px', borderRadius: 3,
                        background: c.status === 'active' ? '#dcfce7' : c.status === 'paused' ? '#fef3c7' : '#f1f5f9',
                        color: c.status === 'active' ? '#16a34a' : c.status === 'paused' ? '#d97706' : '#94a3b8',
                        fontSize: "0.688rem", fontWeight: 600,
                      }}>
                        {c.status === 'ended' ? '已结束' : c.status === 'paused' ? '已暂停' : '进行中'}
                      </span>
                    </div>
                  </div>
                  <div style={{
                    fontSize: "0.813rem", fontWeight: 700,
                    padding: '2px 12px', borderRadius: 8,
                    background: c.warningCount > 0 ? '#fef2f2' : '#f1f5f9',
                    color: c.warningCount > 0 ? '#dc2626' : '#94a3b8',
                    flexShrink: 0,
                  }}>
                    {c.warningCount} 次
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 拦截详情 */}
        {selectedClassroom && <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden', flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9', background: '#fafbff',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>拦截详情</h2>
              {warnings.length > 0 && (
                <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400 }}>
                  {warnings.length} 条记录
                </span>
              )}
            </div>
            {warnings.length > 0 && <button onClick={() => void clearWarnings()} disabled={shieldAction !== null} style={{
              fontSize: "0.75rem", padding: '5px 12px', borderRadius: 6, border: '1px solid #fecaca',
              background: 'white', color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.1s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white'; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              清空全部
            </button>}
          </div>
          {loadingWarnings ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>加载中...</div>
          ) : warnings.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 8 }}>
                <circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#64748b', marginBottom: 2 }}>暂无拦截记录</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1' }}>该课堂暂无触发屏蔽词的行为</div>
            </div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: "0.813rem" }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #eef2f6', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: "0.75rem", letterSpacing: '0.02em' }}>学生</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: "0.75rem", letterSpacing: '0.02em' }}>时间</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: "0.75rem", letterSpacing: '0.02em' }}>提问内容</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedWarnings.map((w, i) => {
                    const words = w.word.split(', ');
                    let highlighted = w.content || '';
                    for (const word of words) {
                      if (!word) continue;
                      highlighted = highlighted.replace(
                        new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                        (m: string) => `\x00HL${m}\x00HL`
                      );
                    }
                    const parts = highlighted.split('\x00HL').filter(Boolean);
                    return (
                    <tr key={w.id} style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.1s',
                    }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fafbff'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'white' : '#f8fafc'; }}>
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: '50%',
                            background: '#eef2ff', color: '#2563eb',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: "0.625rem", fontWeight: 700, flexShrink: 0,
                          }}>
                            {(w.studentName || '?')[0]}
                          </div>
                          {w.studentName || '未知'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b', whiteSpace: 'nowrap', fontSize: "0.75rem", fontFamily: 'monospace' }}>
                        {new Date(w.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: "0.75rem", color: '#475569', maxWidth: 300, wordBreak: 'break-word', lineHeight: 1.6 }}>
                        {parts.map((p: string, j: number) =>
                          j % 2 === 1
                            ? <span key={j} style={{ background: '#fef08a', color: '#92400e', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</span>
                            : <span key={j}>{p}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                        <button onClick={() => void deleteWarning(w.id)} disabled={shieldAction !== null} style={{
                          width: 30, height: 30, borderRadius: 6, border: 'none',
                          background: 'transparent', cursor: 'pointer', color: '#cbd5e1',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.1s',
                        }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#cbd5e1'; }}
                          title="删除">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '10px 16px', borderTop: '1px solid #eef2f6' }}>
                <Pagination current={warningPage} total={warnings.length} pageSize={warningPageSize} pageSizeOptions={[10, 20, 50, 100]} onChange={setWarningPage} onPageSizeChange={setWarningPageSize} />
              </div>
            </div>
          )}
        </div>}

      </div>}

    </div>
  );
};
