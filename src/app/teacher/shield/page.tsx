'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function ShieldPage() {
  const [words, setWords] = useState<any[]>([]);
  const [newWord, setNewWord] = useState('');
  const [autoBlackCount, setAutoBlackCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [w, cfg] = await Promise.all([api.getShieldWords(), api.getShieldConfig()]);
      setWords(w);
      setAutoBlackCount(cfg.autoBlackCount || 0);
    } catch {}
  };

  const builtinWords = words.filter(w => w.builtin);
  const customWords = words.filter(w => !w.builtin);

  const addWord = async () => {
    const word = newWord.trim();
    if (!word) return;
    setSaving(true);
    setError('');
    try {
      await api.addShieldWord(word);
      setNewWord('');
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  const deleteWord = async (id: string) => {
    try {
      await api.deleteShieldWord(id);
      loadData();
    } catch {}
  };

  const saveConfig = async () => {
    setConfigSaved(false);
    try {
      await api.updateShieldConfig(autoBlackCount);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 页面标题 */}
      <div className="teacher-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg, #dc2626, #f87171)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>屏蔽管理</h1>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 0', lineHeight: 1.6, paddingLeft: 42 }}>
            学生发送的消息中包含屏蔽词时将自动替换为 <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>***</code> 并记录警告。触发警告达到设定次数后自动黑屏。
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 自动黑屏设置 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            自动黑屏设置
          </h2>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 12px', paddingLeft: 14 }}>
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
              style={{ width: 80, textAlign: 'center', fontSize: 16, fontWeight: 600, padding: '8px 12px' }}
            />
            <span style={{ fontSize: 13, color: '#64748b' }}>次警告后自动黑屏</span>
            <button className="btn btn-primary" onClick={saveConfig}
              style={{ fontSize: 13, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              {configSaved ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>已保存</>
              ) : '保存'}
            </button>
          </div>
        </div>

        {/* 添加屏蔽词 */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
            添加自定义屏蔽词
          </h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              className="input"
              value={newWord}
              onChange={e => { setNewWord(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') addWord(); }}
              placeholder="输入需要屏蔽的关键词"
              style={{ flex: 1, padding: '8px 14px' }}
            />
            <button className="btn btn-primary" onClick={addWord} disabled={saving || !newWord.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '0 20px', fontSize: 14 }}>
              {saving ? (
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              )}
              添加
            </button>
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
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
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
              自定义屏蔽词
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 8px', borderRadius: 10,
                background: customWords.length > 0 ? '#fef2f2' : '#f1f5f9',
                color: customWords.length > 0 ? '#dc2626' : '#94a3b8',
                fontSize: 11, fontWeight: 600,
              }}>
                {customWords.length} 个
              </span>
            </h2>
            {customWords.length > 0 && (
              <button className="btn" onClick={async () => {
                const ids = customWords.map(w => w.id);
                try { await api.batchDeleteShieldWords(ids); loadData(); } catch {}
              }}
                style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px' }}
                title="清空所有自定义屏蔽词">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                清空
              </button>
            )}
          </div>
          {customWords.length === 0 ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              <div>暂无自定义屏蔽词</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>在上方输入关键词后点击「添加」即可创建</div>
            </div>
          ) : (
            <div style={{ padding: '14px 20px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {customWords.map(w => (
                  <div key={w.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px 4px 12px', borderRadius: 8,
                    background: '#fef2f2', color: '#991b1b',
                    fontSize: 13, fontWeight: 500, lineHeight: 1.4,
                    border: '1px solid #fecaca',
                  }}>
                    {w.word}
                    <button onClick={() => deleteWord(w.id)}
                      style={{
                        width: 16, height: 16, border: 'none', borderRadius: '50%',
                        background: 'transparent', cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#dc2626', opacity: 0.4, fontSize: 12, lineHeight: 1,
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

        {/* 系统默认词库（功能暂未启用） */}
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          opacity: 0.5,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px', borderBottom: '1px solid #f1f5f9',
            background: '#fafbff',
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
              系统默认词库
              {builtinWords.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 8px', borderRadius: 10,
                  background: '#eef2ff', color: '#6366f1',
                  fontSize: 11, fontWeight: 600,
                }}>
                  {builtinWords.length} 个
                </span>
              )}
            </h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button disabled
                style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', color: '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'not-allowed' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                一键清空
              </button>
              <button disabled
                style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', color: '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'not-allowed' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                恢复预设
              </button>
            </div>
          </div>
          {builtinWords.length === 0 ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              <div>暂无默认屏蔽词</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>系统默认词库功能暂未启用</div>
            </div>
          ) : (
            <div style={{ padding: '14px 20px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {builtinWords.map(w => (
                  <div key={w.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px 4px 12px', borderRadius: 8,
                    background: '#eef2ff', color: '#4338ca',
                    fontSize: 13, fontWeight: 500, lineHeight: 1.4,
                    border: '1px solid #c7d2fe',
                  }}>
                    {w.word}
                    <button onClick={() => deleteWord(w.id)}
                      style={{
                        width: 16, height: 16, border: 'none', borderRadius: '50%',
                        background: 'transparent', cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#6366f1', opacity: 0.4, fontSize: 12, lineHeight: 1,
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#c7d2fe'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.background = 'transparent'; }}
                      title="删除">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
