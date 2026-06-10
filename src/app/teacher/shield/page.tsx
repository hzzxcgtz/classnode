'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function ShieldPage() {
  const [tab, setTab] = useState<'words' | 'records'>('words');
  const [words, setWords] = useState<any[]>([]);
  const [newWord, setNewWord] = useState('');
  const [autoBlackCount, setAutoBlackCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [configSaved, setConfigSaved] = useState(false);
  const [configError, setConfigError] = useState('');
  const [builtinMsg, setBuiltinMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [categories, setCategories] = useState<{ name: string; count: number; words: { id: string; word: string }[] }[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  // 警告记录
  const [summary, setSummary] = useState<any[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingWarnings, setLoadingWarnings] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (tab === 'records') loadSummary();
  }, [tab]);

  const loadData = async () => {
    try {
      const [w, cfg, cats] = await Promise.all([api.getShieldWords(), api.getShieldConfig(), api.getShieldCategories()]);
      setWords(w);
      setAutoBlackCount(cfg.autoBlackCount || 0);
      setCategories(cats || []);
    } catch {}
  };

  const loadSummary = async () => {
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
  };

  const loadWarnings = async (classroomId: string) => {
    setSelectedClassroom(classroomId);
    setLoadingWarnings(true);
    try {
      const data = await api.getClassroomWarnings(classroomId);
      setWarnings(data);
    } catch {}
    setLoadingWarnings(false);
  };

  const builtinWords = words.filter(w => w.builtin);
  const customWords = words.filter(w => !w.builtin);

  const addWords = async () => {
    const raw = newWord.trim();
    if (!raw) return;
    // 按常见分隔符切分：中文逗号、英文逗号、分号、顿号、空格、换行
    const words = raw.split(/[,，;；、\s\n]+/).map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return;
    setSaving(true);
    setError('');
    let lastError = '';
    for (const w of words) {
      try {
        await api.addShieldWord(w);
      } catch (e: any) {
        lastError = e.message || `「${w}」添加失败`;
      }
    }
    if (lastError) setError(lastError);
    setNewWord('');
    loadData();
    setSaving(false);
  };

  const deleteWord = async (id: string) => {
    try {
      await api.deleteShieldWord(id);
      loadData();
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  };

  const saveConfig = async () => {
    setConfigSaved(false);
    setConfigError('');
    try {
      await api.updateShieldConfig(autoBlackCount);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e: any) {
      setConfigError(e.message || '保存失败');
      setTimeout(() => setConfigError(''), 3000);
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
        {[
          { key: 'words', label: '词库管理', icon: 'M12 2L2 7l10 5 10-5-10-5z' },
          { key: 'records', label: '拦截记录', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key as any); }}
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

        {/* 自动黑屏设置 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: '0 0 4px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            自动黑屏设置
          </h2>
          <p style={{ fontSize: "0.75rem", color: '#94a3b8', margin: '0 0 12px', paddingLeft: 14 }}>
            学生在触发屏蔽词多少次后自动黑屏（设为 0 为不自动黑屏）
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number"
              className="input"
              value={autoBlackCount}
              onChange={e => setAutoBlackCount(parseInt(e.target.value) || 0)}
              min={0}
              max={99}
              style={{ width: 80, textAlign: 'center', fontSize: "1rem", fontWeight: 600, padding: '8px 12px' }}
            />
            <span style={{ fontSize: "0.813rem", color: '#64748b' }}>次警告后自动黑屏</span>
            <button className="btn btn-primary" onClick={saveConfig}
              style={{ fontSize: "0.813rem", flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              {configSaved ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>已保存</>
              ) : '保存'}
            </button>
            {configError && (
              <span style={{ fontSize: "0.75rem", color: '#ef4444', marginLeft: 8 }}>{configError}</span>
            )}
          </div>
        </div>

        {/* 添加屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: '0 0 12px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
            添加自定义屏蔽词
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              className="input"
              value={newWord}
              onChange={e => { setNewWord(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addWords(); } }}
              placeholder="输入需要屏蔽的关键词，多个词可用逗号、空格、换行等分隔"
              rows={3}
              style={{ width: '100%', padding: '8px 14px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{
                fontSize: "0.688rem", color: '#94a3b8',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                支持批量添加，用 <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3, fontSize: "0.625rem" }}>,</code> <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3, fontSize: "0.625rem" }}>;</code> <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3, fontSize: "0.625rem" }}>、</code> <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3, fontSize: "0.625rem" }}>空格</code> 或 <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3, fontSize: "0.625rem" }}>换行</code> 分隔
              </div>
              <button className="btn btn-primary" onClick={addWords} disabled={saving || !newWord.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 18px', fontSize: "0.813rem", flexShrink: 0 }}>
                {saving ? (
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                )}
                批量添加
              </button>
            </div>
          </div>
          {error && (
            <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}
        </div>

        {/* 自定义屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff',
          }}>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
              自定义屏蔽词
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 8px', borderRadius: 10,
                background: customWords.length > 0 ? '#fef2f2' : '#f1f5f9',
                color: customWords.length > 0 ? '#dc2626' : '#94a3b8',
                fontSize: "0.688rem", fontWeight: 600,
              }}>
                {customWords.length} 个
              </span>
            </h2>
            {customWords.length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={async () => {
                  const ids = customWords.map(w => w.id);
                  const allDisabled = customWords.every(w => w.enabled === false);
                  try { await api.batchToggleShieldWords(ids, allDisabled); loadData(); } catch {}
                }}
                  style={{
                    position: 'relative', width: 40, height: 22,
                    borderRadius: 11, border: 'none', cursor: 'pointer',
                    background: customWords.some(w => w.enabled !== false) ? '#22c55e' : '#d1d5db',
                    transition: 'background 0.2s', padding: 0, alignSelf: 'center',
                  }}
                  title={customWords.some(w => w.enabled !== false) ? '一键禁用所有自定义屏蔽词' : '一键启用所有自定义屏蔽词'}>
                  <span style={{
                    position: 'absolute', top: 2,
                    left: customWords.some(w => w.enabled !== false) ? 20 : 2,
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s',
                  }} />
                </button>
                <button className="btn" onClick={async () => {
                  const ids = customWords.map(w => w.id);
                  try { await api.batchDeleteShieldWords(ids); loadData(); } catch {}
                }}
                  style={{ fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', color: customWords.length > 0 ? '#dc2626' : '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}
                  title="清空所有自定义屏蔽词">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  一键清空
                </button>
              </div>
            )}
          </div>
          {customWords.length === 0 ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>
              <div>暂无自定义屏蔽词</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1', marginTop: 2 }}>在上方输入关键词后点击「添加」即可创建</div>
            </div>
          ) : (
            <div style={{ padding: '14px 20px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {customWords.map(w => (
                  <div key={w.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px 4px 12px', borderRadius: 8,
                    background: '#fef2f2', color: '#991b1b',
                    fontSize: "0.813rem", fontWeight: 500, lineHeight: 1.4,
                    border: '1px solid #fecaca',
                    opacity: w.enabled === false ? 0.4 : 1,
                  }}>
                    {w.word}
                    <button onClick={() => deleteWord(w.id)}
                      style={{
                        width: 16, height: 16, border: 'none', borderRadius: '50%',
                        background: 'transparent', cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#dc2626', opacity: 0.4, fontSize: "0.75rem", lineHeight: 1,
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#fecaca'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.background = 'transparent'; }}
                      title="删除">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 系统屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff',
          }}>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
              系统屏蔽词
              {builtinWords.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 8px', borderRadius: 10,
                  background: '#eef2ff', color: '#6366f1',
                  fontSize: "0.688rem", fontWeight: 600,
                }}>
                  {builtinWords.length} 个
                </span>
              )}
            </h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={async () => {
                const ids = builtinWords.map(w => w.id);
                const allDisabled = builtinWords.every(w => w.enabled === false);
                try { await api.batchToggleShieldWords(ids, allDisabled); loadData(); } catch {}
              }}
                style={{
                  position: 'relative', width: 40, height: 22,
                  borderRadius: 11, border: 'none', cursor: 'pointer',
                  background: builtinWords.some(w => w.enabled !== false) ? '#22c55e' : '#d1d5db',
                  transition: 'background 0.2s', padding: 0,
                }}
                title={builtinWords.some(w => w.enabled !== false) ? '一键禁用所有系统屏蔽词' : '一键启用所有系统屏蔽词'}>
                <span style={{
                  position: 'absolute', top: 2,
                  left: builtinWords.some(w => w.enabled !== false) ? 20 : 2,
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  transition: 'left 0.2s',
                }} />
              </button>
              <button onClick={async () => {
                if (!confirm('确认清空所有系统屏蔽词？自定义屏蔽词不受影响。')) return;
                setBuiltinMsg(null);
                try {
                  const r = await api.clearBuiltinShieldWords();
                  setBuiltinMsg({ type: 'success', text: `已清空 ${r.deleted} 个系统屏蔽词` });
                  loadData();
                  setTimeout(() => setBuiltinMsg(null), 3000);
                } catch {
                  setBuiltinMsg({ type: 'error', text: '清空失败' });
                  setTimeout(() => setBuiltinMsg(null), 3000);
                }
              }}
                style={{ fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', color: builtinWords.length > 0 ? '#dc2626' : '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: builtinWords.length > 0 ? 'pointer' : 'not-allowed' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                一键清空
              </button>
              <button onClick={async () => {
                setBuiltinMsg(null);
                try {
                  const r = await api.restoreDefaultShieldWords();
                  setBuiltinMsg({ type: 'success', text: `已恢复 ${r.restored} 个默认屏蔽词` });
                  loadData();
                  setTimeout(() => setBuiltinMsg(null), 3000);
                } catch {
                  setBuiltinMsg({ type: 'error', text: '恢复失败' });
                  setTimeout(() => setBuiltinMsg(null), 3000);
                }
              }}
                style={{ fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', color: '#6366f1', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, cursor: 'pointer' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                恢复预设
              </button>
            </div>
          </div>
          {builtinMsg && (
            <div style={{
              padding: '8px 24px', fontSize: "0.75rem",
              color: builtinMsg.type === 'success' ? '#16a34a' : '#ef4444',
              background: builtinMsg.type === 'success' ? '#f0fdf4' : '#fef2f2',
              borderBottom: '1px solid #f1f5f9',
            }}>
              {builtinMsg.type === 'success' ? '✓ ' : '✗ '}{builtinMsg.text}
            </div>
          )}
          {builtinWords.length === 0 ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>
              <div>系统屏蔽词为空</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1', marginTop: 2 }}>点击「恢复预设」可重新加载系统内置的屏蔽词</div>
            </div>
          ) : (
            <div style={{ padding: '18px 24px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[{ name: '脏话辱骂', color: '#991b1b', bg: '#fef4f4', border: '#f0d6d4' },
                  { name: '色情低俗', color: '#831843', bg: '#fcf1f6', border: '#edd5de' },
                  { name: '暴力威胁', color: '#78350f', bg: '#fcf8f1', border: '#ece2c5' },
                  { name: '自残自杀', color: '#4c1d95', bg: '#f5f3fa', border: '#ddd5ed' },
                ].map(cat => {
                  const catData = categories.find(c => c.name === cat.name);
                  const count = catData?.count || 0;
                  const expanded = expandedCategories[cat.name];
                  return (
                    <div key={cat.name} style={{
                      borderRadius: 10,
                      border: `1px solid ${cat.border}`,
                      overflow: 'hidden',
                    }}>
                      <div
                        onClick={() => setExpandedCategories(prev => ({ ...prev, [cat.name]: !prev[cat.name] }))}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 16px', cursor: 'pointer',
                          background: cat.bg, userSelect: 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.97)'; }}
                        onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cat.color} strokeWidth="2.5" strokeLinecap="round"
                          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', flexShrink: 0 }}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <span style={{ flex: 1, fontSize: "0.875rem", fontWeight: 600, color: cat.color }}>{cat.name}</span>
                        <span style={{
                          fontSize: "0.75rem", fontWeight: 600, padding: '1px 8px', borderRadius: 6,
                          background: cat.bg, color: cat.color,
                          border: `1px solid ${cat.border}`,
                        }}>{count} 个</span>
                      </div>
                      {expanded && catData && (
                        <div style={{
                          padding: '10px 16px 12px',
                          display: 'flex', flexWrap: 'wrap', gap: 6,
                          borderTop: `1px solid ${cat.border}`,
                        }}>
                          {catData.words.map((w: any) => (
                            <span key={w.id} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '3px 6px 3px 8px', borderRadius: 6,
                              background: cat.bg, color: cat.color,
                              fontSize: "0.75rem", fontWeight: 500, lineHeight: 1.4,
                              opacity: w.enabled === false ? 0.35 : 1,
                            }}>
                              {w.word}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteWord(w.id);
                                }}
                                style={{
                                  width: 14, height: 14, border: 'none', borderRadius: '50%',
                                  background: 'transparent', cursor: 'pointer', padding: 0,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  color: cat.color, opacity: 0.35, fontSize: "0.625rem", lineHeight: 1,
                                  transition: 'all 0.1s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = cat.border; }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'transparent'; }}
                                title="删除">×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{
                marginTop: 14, padding: '8px 14px', borderRadius: 8,
                background: '#f1f5f9', fontSize: "0.75rem", color: '#64748b',
                display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                系统内置 {builtinWords.length} 个屏蔽词，覆盖四大类别，在学生发送消息时自动拦截。点击类别可展开查看具体词条。
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
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', background: '#fafbff' }}>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              课堂列表
              {summary.length > 0 && <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400 }}>（{summary.length} 个课堂有拦截记录）</span>}
            </h2>
          </div>
          {loadingSummary ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>加载中...</div>
          ) : summary.length === 0 ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>
              <div>暂无拦截记录</div>
              <div style={{ fontSize: "0.75rem", color: '#cbd5e1', marginTop: 2 }}>学生发送触发屏蔽词的内容后，记录会显示在此处</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {summary.map(c => (
                <button key={c.id} onClick={() => loadWarnings(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 24px', cursor: 'pointer', border: 'none', borderBottom: '1px solid #f1f5f9',
                    background: selectedClassroom === c.id ? '#f0f7ff' : 'white',
                    textAlign: 'left', fontFamily: 'inherit', width: '100%', transition: 'background 0.1s',
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#0f172a' }}>{c.title || '未命名课堂'}</div>
                    <div style={{ fontSize: "0.75rem", color: '#94a3b8', marginTop: 2, display: 'flex', gap: 8 }}>
                      <span>{c.className}</span>
                      <span>{c.status === 'ended' ? '已结束' : '进行中'}</span>
                    </div>
                  </div>
                  <div style={{
                    fontSize: "0.75rem", fontWeight: 600, padding: '2px 10px', borderRadius: 6,
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
            <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
              拦截详情
              {warnings.length > 0 && <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400 }}>（{warnings.length} 条）</span>}
            </h2>
            {warnings.length > 0 && <button onClick={async () => {
              if (!confirm('确认清空该课堂的所有拦截记录？')) return;
              try {
                await api.clearClassroomWarnings(selectedClassroom);
                loadWarnings(selectedClassroom);
                loadSummary();
              } catch {}
            }} style={{
              fontSize: "0.75rem", padding: '5px 12px', borderRadius: 6, border: '1px solid #fecaca',
              background: 'white', color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              清空全部
            </button>}
          </div>
          {loadingWarnings ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>加载中...</div>
          ) : warnings.length === 0 ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>暂无拦截记录</div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: "0.813rem" }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: "0.75rem" }}>学生</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: "0.75rem" }}>时间</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: "0.75rem" }}>提问内容</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#64748b', fontSize: "0.75rem" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {warnings.map((w, i) => {
                    // 高亮内容中的屏蔽词
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
                      background: i % 2 === 0 ? 'white' : '#fafbfc',
                    }}>
                      <td style={{ padding: '10px 16px', fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap' }}>
                        {w.studentName || '未知'}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#64748b', whiteSpace: 'nowrap', fontSize: "0.75rem" }}>
                        {new Date(w.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: "0.75rem", color: '#475569', maxWidth: 260, wordBreak: 'break-word' }}>
                        {parts.map((p: string, j: number) =>
                          j % 2 === 1
                            ? <span key={j} style={{ background: '#fef08a', color: '#92400e', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</span>
                            : <span key={j}>{p}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        <button onClick={async () => {
                          try {
                            await api.deleteWarning(w.id);
                            loadWarnings(selectedClassroom);
                            loadSummary();
                          } catch {}
                        }} style={{
                          width: 28, height: 28, borderRadius: 6, border: 'none',
                          background: 'transparent', cursor: 'pointer', color: '#94a3b8',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.1s',
                        }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
                          title="删除">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>}

      </div>}

    </div>
  );
};
