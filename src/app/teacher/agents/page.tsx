'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { FieldError, Toast } from '@/lib/components';

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const [errorTip, setErrorTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{
    agentId: string;
    agentName: string;
  } | null>(null);

  const loadAgents = async () => {
    try {
      setAgents(await api.getAgents());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadAgents(); }, []);

  // 用 ref 保持 loadAgents 引用最新，避免闭包过期
  const loadAgentsRef = useRef(loadAgents);
  loadAgentsRef.current = loadAgents;
  const socketRef = useRef<any>(null);

  // 实时监听智能体检测结果（不主动断开 socket，与课堂看板模式一致）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { io } = await import('socket.io-client');
      const sk = io(getApiBaseUrl(), { transports: ['websocket', 'polling'], reconnection: true });
      sk.on('agents-checked', () => {
        if (!cancelled) loadAgentsRef.current();
      });
      socketRef.current = sk;
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>AI智能体</h1>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
              接入 Coze、Coze Agent、智谱清言、OpenAI 兼容接口的 AI智能体
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              接入智能体
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <AgentForm
          agent={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); loadAgents(); }}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>加载中...</div>
      ) : agents.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: '#f1f5f9', margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
              <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /><path d="M8 4V2" /><path d="M16 4V2" /><path d="M8 20v2" /><path d="M16 20v2" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>还没有接入智能体</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
            点击上方按钮，接入您在 Coze、Coze Agent 等平台配置好的 AI 助手
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => setShowForm(true)}>
            接入第一个智能体
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {agents.map(agent => {
            const platformColors: Record<string, string> = {
              coze: '#2563eb',
              openai: '#16a34a',
              'coze-agent': '#7c3aed',
              zhipuai: '#1d8cf8',
            };
            const platformLabels: Record<string, string> = {
              coze: 'Coze Bot',
              openai: 'OpenAI',
              'coze-agent': 'Coze Agent',
              zhipuai: '智谱清言',
            };
            // 不同类型对应不同标签底色
            const badgeBg: Record<string, string> = {
              coze: '#eef2ff', 'coze-agent': '#f5f3ff', zhipuai: '#ecfeff', openai: '#f0fdf4',
            };
            const platColor = platformColors[agent.platform] || '#64748b';
            const isEnabled = agent.enabled !== false;
            return (
              <div key={agent.id} className="card" style={{
                borderLeft: `5px solid ${isEnabled ? platColor : '#e2e8f0'}`,
                padding: '16px 20px',
              }}>
                {/* 第一行：头像 + 信息 + 开关 */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* 头像 */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    background: isEnabled ? `${platColor}12` : '#f1f5f9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 700, color: isEnabled ? platColor : '#94a3b8',
                    overflow: 'hidden',
                  }}>
                    {agent.logo
                      ? <img src={agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : agent.name[0]}
                  </div>

                  {/* 信息 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#1a1a2e', marginBottom: 3 }}>
                      {agent.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4,
                        fontSize: 11, fontWeight: 600,
                        background: badgeBg[agent.platform] || '#f1f5f9',
                        color: platColor,
                      }}>
                        {platformLabels[agent.platform]}
                      </span>

                    </div>
                  </div>

                  {/* 启用/停用开关 */}
                  <button onClick={async () => {
                    const form = new FormData();
                    form.append('enabled', isEnabled ? 'false' : 'true');
                    await api.updateAgent(agent.id, form);
                    loadAgents();
                  }} style={{
                    flexShrink: 0, marginTop: 2,
                    position: 'relative', width: 40, height: 22,
                    borderRadius: 11, border: 'none', cursor: 'pointer',
                    background: isEnabled ? '#22c55e' : '#d1d5db',
                    transition: 'background 0.2s', padding: 0,
                  }} title={isEnabled ? '点击停用' : '点击启用'}>
                    <div style={{
                      position: 'absolute', top: 2,
                      left: isEnabled ? 20 : 2,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* 分割线 + 连接状态 + 操作按钮 */}
                <div style={{
                  marginTop: 14, paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {/* 左侧：状态指示 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                    {agent.lastCheckAt === null ? (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>未检测</span>
                      </>
                    ) : agent.lastCheckOk ? (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 500, whiteSpace: 'nowrap' }}>正常</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          {new Date(agent.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                        <span style={{
                          fontSize: 11, color: '#dc2626', fontWeight: 500, whiteSpace: 'nowrap',
                          cursor: 'help', borderBottom: '1px dashed #fca5a5',
                        }}
                          onMouseEnter={e => {
                            if (!agent.lastCheckError) return;
                            const r = e.currentTarget.getBoundingClientRect();
                            setErrorTip({ text: agent.lastCheckError, top: r.top - 8, left: r.left + r.width / 2 });
                          }}
                          onMouseLeave={() => setErrorTip(null)}>
                          异常
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {new Date(agent.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </>
                    )}
                  </div>

                  {/* 右侧：操作按钮 */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    {isEnabled && (
                      <button style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                        border: '1px solid #d1d5db', background: 'white', color: '#475569',
                        display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
                      }}
                        onClick={async () => {
                          setTesting(agent.id);
                          setToast({ show: false, msg: '', type: 'success' });
                          try {
                            const result = await api.testAgent(agent.id);
                            // 乐观更新本地状态，无需等待服务端持久化
                            setAgents(prev => prev.map(a =>
                              a.id === agent.id
                                ? { ...a, lastCheckAt: new Date().toISOString(), lastCheckOk: result.success, lastCheckError: result.success ? null : (result.error || '连接失败') }
                                : a
                            ));
                            setToast({ show: true, msg: result.success ? '连接成功' : '连接失败：' + (result.error || '请检查配置'), type: result.success ? 'success' : 'error' });
                          } catch { setToast({ show: true, msg: '测试请求失败', type: 'error' }); }
                          setTesting(null);
                          setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
                        }}
                        disabled={testing === agent.id}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        {testing === agent.id ? '测试中' : '测试'}
                      </button>
                    )}
                    <button style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid #d1d5db', background: 'white', color: '#475569',
                      display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
                    }}
                      onClick={() => { setEditing(agent); setShowForm(true); }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      编辑
                    </button>
                    <button style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid #d1d5db', background: 'white', color: '#ef4444',
                      display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
                    }}
                      onClick={async () => {
                        try {
                          const usage = await api.checkAgentUsage(agent.id);
                          if (usage.used) {
                            setDeleteBlocked({ agentId: agent.id, agentName: agent.name });
                            return;
                          }
                        } catch {}
                        if (confirm(`确定删除 "${agent.name}" 吗？`)) {
                          await api.deleteAgent(agent.id);
                          loadAgents();
                        }
                      }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 删除被阻止的浮动弹窗 */}
      {deleteBlocked && (
        <>
          <div className="modal-overlay" onClick={() => setDeleteBlocked(null)} />
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 201, background: 'white', borderRadius: 16, padding: 32,
            width: 400, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: '#fef2f2', margin: '0 auto 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>无法删除智能体</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                该智能体正在被课堂使用中，请先删除关联的课堂后再试。
              </p>
            </div>
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
              padding: '14px 16px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>
                「{deleteBlocked.agentName}」
              </div>
              <div style={{ fontSize: 13, color: '#b91c1c' }}>
                该智能体已被配置到课堂中使用，无法直接删除。
              </div>
            </div>
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }}
              onClick={() => setDeleteBlocked(null)}>
              知道了
            </button>
          </div>
        </>
      )}

      {/* 异常信息浮动浮窗 */}
      {errorTip && (
        <div style={{
          position: 'fixed',
          top: errorTip.top,
          left: errorTip.left,
          transform: 'translate(-50%, -100%)',
          background: '#1e293b',
          color: '#f1f5f9',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 11,
          whiteSpace: 'normal',
          wordBreak: 'break-all',
          maxWidth: 260,
          lineHeight: 1.5,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          zIndex: 9999,
          pointerEvents: 'none',
        }}>
          {errorTip.text}
        </div>
      )}

      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

function HelpIcon({ imageSrc }: { imageSrc: string }) {
  const [show, setShow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const showTooltip = () => {
    clearTimeout(timerRef.current);
    if (iconRef.current) {
      const r = iconRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, left: r.left + r.width / 2 });
    }
    setShow(true);
  };

  return (
    <>
      <span ref={iconRef} style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 4, cursor: 'pointer', verticalAlign: 'middle' }}
        onMouseEnter={showTooltip}
        onMouseLeave={() => { timerRef.current = setTimeout(() => setShow(false), 300); }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </span>
      {show && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          transform: 'translateX(-50%)', zIndex: 9999, cursor: 'pointer',
          background: 'white', borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
          padding: 8, maxWidth: 340, border: '1px solid #e2e8f0',
        }}
          onMouseEnter={() => clearTimeout(timerRef.current)}
          onMouseLeave={() => { timerRef.current = setTimeout(() => setShow(false), 300); }}
          onClick={() => setFullscreen(true)}
        >
          <img src={imageSrc} alt="配置说明" style={{ width: '100%', display: 'block', borderRadius: 6 }} />
          <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 4 }}>点击放大</div>
        </div>
      )}
      {fullscreen && (
        <div onClick={() => setFullscreen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 100000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 32,
        }}>
          <img src={imageSrc} alt="配置说明" style={{
            maxWidth: '95%', maxHeight: '95%', objectFit: 'contain',
            borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          }} onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

function AgentForm({ agent, onClose, onSaved }: { agent: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(agent?.name || '');
  const [platform, setPlatform] = useState(agent?.platform || 'coze');
  const [apiKey, setApiKey] = useState(agent?.apiKey || '');
  const [apiUrl, setApiUrl] = useState(agent?.apiUrl || '');
  const [botId, setBotId] = useState(agent?.botId || '');
  const [projectId, setProjectId] = useState(() => {
    try { return agent?.extra ? JSON.parse(agent.extra).projectId || '' : ''; }
    catch { return ''; }
  });
  const [apiSecret, setApiSecret] = useState(() => {
    try { return agent?.extra ? JSON.parse(agent.extra).apiSecret || '' : ''; }
    catch { return ''; }
  });
  const [greeting, setGreeting] = useState(agent?.greeting || '');
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [fetchedLogoUrl, setFetchedLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(() => {
    if (agent?.logo) {
      const apiBase = getApiBaseUrl();
      return agent.logo.startsWith('/') ? `${apiBase}${agent.logo}` : agent.logo;
    }
    return null;
  });
  const [logoRemoved, setLogoRemoved] = useState(false);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoPreview(URL.createObjectURL(file));
      setLogoRemoved(false);
    }
  };

  const handleFetchInfo = async () => {
    if (!botId || !apiKey) {
      setToast({ msg: '请先填写 Bot ID 和 API Token 后再获取信息', type: 'error' });
      return;
    }
    setFetchingInfo(true);
    try {
      const resp = agent
        ? await api.getAgentInfo(agent.id)
        : await api.getAgentInfoDirect({ platform, botId, apiKey, apiUrl: apiUrl || undefined });
      if (resp.name) setName(resp.name);
      if (resp.iconUrl) {
        setLogoPreview(resp.iconUrl);
        setFetchedLogoUrl(resp.iconUrl);
      }
      if (resp.greeting) setGreeting(resp.greeting);
    } catch (e) {
      console.error('Failed to fetch agent info:', e);
    }
    setFetchingInfo(false);
  };

  const clearError = (field: string) => {
    setFieldErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!name) errors.name = '请填写智能体名称';
    if (platform === 'coze' && !botId) errors.botId = '请填写 Bot ID';
    if (platform === 'coze-agent') {
      if (!apiUrl) errors.apiUrl = '请填写 API URL';
      if (!projectId) errors.projectId = '请填写 Project ID';
    }
    if (platform === 'zhipuai') {
      if (!botId) errors.botId = '请填写智能体 ID (assistant_id)';
      if (!apiSecret) errors.apiSecret = '请填写 API Secret';
    }
    if (!apiKey) errors.apiKey = '请填写 API Token';
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setSaving(true);
    try {
      const form = new FormData();
      form.append('name', name);
      form.append('platform', platform);
      form.append('apiKey', apiKey);
      if (apiUrl) form.append('apiUrl', apiUrl);
      if (botId) form.append('botId', botId);
      if (platform === 'coze-agent') {
        form.append('extra', JSON.stringify({ projectId }));
      }
      if (platform === 'zhipuai') {
        form.append('extra', JSON.stringify({ apiSecret }));
      }

      if (fileRef.current?.files?.[0]) {
        form.append('logo', fileRef.current.files[0]);
      } else if (fetchedLogoUrl && !logoRemoved) {
        form.append('logo', fetchedLogoUrl);
      } else if (agent && logoRemoved) {
        form.append('removeLogo', 'true');
      }

      form.append('greeting', greeting || '');

      if (agent) {
        await api.updateAgent(agent.id, form);
      } else {
        await api.createAgent(form);
      }
      onSaved();
    } catch (e: any) {
      setFieldErrors({ submit: e.message });
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{
        maxWidth: 520, padding: 0, borderRadius: 14,
      }}>
        {/* 顶栏 */}
        <div style={{
          padding: '16px 24px 0',
          background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)',
          borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px' }}>
            {agent ? '编辑智能体' : '接入AI智能体'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            接入 Coze、Coze Agent、智谱清言或 OpenAI 兼容接口的 AI智能体
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '14px 24px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 基本信息 */}
          <div style={{
            background: '#fafbfc', borderRadius: 8, padding: 14,
            border: '1px solid #eef2f6',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: '#94a3b8',
              marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>
              基本信息
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 头像 + 名称 — 对齐 */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ flexShrink: 0 }}>
                  <div style={{ position: 'relative' }}>
                    <div onClick={() => fileRef.current?.click()} style={{
                      width: 56, height: 56, borderRadius: 12,
                      background: logoPreview ? `url(${logoPreview}) center/cover no-repeat` : '#f1f4f9',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', overflow: 'hidden',
                      border: '2px dashed #d0d5dd',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#d0d5dd'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      {!logoPreview && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                      )}
                    </div>
                    <input type="file" ref={fileRef} accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} />
                    <button type="button" onClick={() => fileRef.current?.click()} style={{
                      position: 'absolute', bottom: -6, right: -6,
                      width: 20, height: 20, borderRadius: '50%',
                      background: '#2563eb', color: 'white', border: '2px solid white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', fontSize: 12, lineHeight: 1,
                      padding: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    }} title="上传头像">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    {logoPreview && (
                      <button type="button" onClick={() => { setLogoPreview(null); setLogoRemoved(true); if (fileRef.current) fileRef.current.value = ''; }} style={{
                        position: 'absolute', top: -5, right: -5,
                        width: 18, height: 18, borderRadius: '50%',
                        background: '#ef4444', color: 'white', border: '2px solid white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', fontSize: 9, lineHeight: 1,
                        padding: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                      }} title="移除头像">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>智能体名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="input" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="例如: AI英语助教"
                      style={{ fontSize: 13, padding: '8px 12px', flex: 1, borderColor: fieldErrors.name ? '#ef4444' : undefined }} />
                    {platform !== 'coze-agent' ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleFetchInfo}
                        disabled={fetchingInfo}
                        style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        {fetchingInfo ? '获取中...' : '从 Coze 获取'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                        该接入方式不支持自动获取
                      </span>
                    )}
                  </div>
                  {fieldErrors.name && <FieldError message={fieldErrors.name} />}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>开场白</label>
                <textarea
                  className="input"
                  value={greeting}
                  onChange={e => setGreeting(e.target.value)}
                  placeholder={platform === 'coze-agent' ? '手动输入开场白内容' : '从 Coze 自动获取，或手动输入开场白'}
                  style={{ fontSize: 13, padding: '8px 12px', minHeight: 72, resize: 'vertical', width: '100%' }}
                />
              </div>
            </div>
          </div>

          {/* 平台配置 */}
          <div style={{
            background: '#fafbfc', borderRadius: 8, padding: 14,
            border: '1px solid #eef2f6',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: '#94a3b8',
              marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>
              平台配置
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>平台类型 <span style={{ color: 'var(--danger)' }}>*</span></label>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
                }}>
                  {[
                    { value: 'coze', label: 'Coze Bot', desc: '扣子低代码', disabled: false },
                    { value: 'coze-agent', label: 'Coze Agent', desc: '扣子编程', disabled: false },
                    { value: 'zhipuai', label: '智谱清言', desc: 'GLM系列', disabled: true },
                    { value: 'openai', label: 'OpenAI', desc: '兼容接口', disabled: true },
                  ].map(p => (
                    <button key={p.value} type="button"
                      onClick={() => !p.disabled && setPlatform(p.value)}
                      title={p.disabled ? '暂未开放' : undefined}
                      style={{
                        padding: '7px 6px', borderRadius: 6, cursor: p.disabled ? 'not-allowed' : 'pointer',
                        border: `1.5px solid ${platform === p.value && !p.disabled ? '#2563eb' : '#e2e8f0'}`,
                        background: platform === p.value && !p.disabled ? '#eef2ff' : p.disabled ? '#f8f9fb' : 'white',
                        textAlign: 'center', transition: 'all 0.12s', opacity: p.disabled ? 0.5 : 1,
                      }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: p.disabled ? '#94a3b8' : (platform === p.value ? '#2563eb' : '#475569') }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: p.disabled ? '#cbd5e1' : '#94a3b8', marginTop: 1 }}>{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bot ID — Coze 必填 */}
              {platform === 'coze' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    Bot ID <HelpIcon imageSrc="/images/help/coze-config.png" /> <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={botId} onChange={e => { setBotId(e.target.value); clearError('botId'); }}
                    placeholder="在 Coze 机器人发布页获取 Bot ID"
                    style={{ fontSize: 13, padding: '8px 12px', borderColor: fieldErrors.botId ? '#ef4444' : undefined }} />
                  {fieldErrors.botId && <FieldError message={fieldErrors.botId} />}
                </div>
              )}

              {/* 智能体 ID — 智谱清言必填 */}
              {platform === 'zhipuai' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    智能体 ID <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={botId} onChange={e => { setBotId(e.target.value); clearError('botId'); }}
                    placeholder="在智谱清言创作者中心获取 assistant_id"
                    style={{ fontSize: 13, padding: '8px 12px', borderColor: fieldErrors.botId ? '#ef4444' : undefined }} />
                  {fieldErrors.botId && <FieldError message={fieldErrors.botId} />}
                </div>
              )}

              {/* API URL — 智谱清言 / OpenAI / Coze Agent */}
              {(platform === 'zhipuai' || platform === 'openai' || platform === 'coze-agent') && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>API URL <HelpIcon imageSrc="/images/help/coze-agent-config.png" /> <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input className="input" value={apiUrl} onChange={e => { setApiUrl(e.target.value); clearError('apiUrl'); }}
                    placeholder={platform === 'coze-agent' ? 'https://xxxx.coze.site' : platform === 'zhipuai' ? 'https://open.bigmodel.cn/api/paas/v4' : 'https://api.openai.com/v1'}
                    style={{ fontSize: 13, padding: '8px 12px', borderColor: fieldErrors.apiUrl ? '#ef4444' : undefined }} />
                  {fieldErrors.apiUrl && <FieldError message={fieldErrors.apiUrl} />}
                </div>
              )}

              {/* Project ID — Coze Agent 必填 */}
              {platform === 'coze-agent' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    Project ID <HelpIcon imageSrc="/images/help/coze-agent-config.png" /> <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={projectId} onChange={e => { setProjectId(e.target.value); clearError('projectId'); }}
                    placeholder="在 Coze 项目设置中获取 Project ID"
                    style={{ fontSize: 13, padding: '8px 12px', borderColor: fieldErrors.projectId ? '#ef4444' : undefined }} />
                  {fieldErrors.projectId && <FieldError message={fieldErrors.projectId} />}
                </div>
              )}


              {/* API Secret — 智谱清言必填 */}
              {platform === 'zhipuai' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    API Secret <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" type="password" value={apiSecret} onChange={e => { setApiSecret(e.target.value); clearError('apiSecret'); }}
                    placeholder="在智谱清言创作者中心获取 api_secret"
                    style={{ fontSize: 13, padding: '8px 12px', borderColor: fieldErrors.apiSecret ? '#ef4444' : undefined }} />
                  {fieldErrors.apiSecret && <FieldError message={fieldErrors.apiSecret} />}
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>
                  API Token <HelpIcon imageSrc={platform === 'coze' ? '/images/help/coze-token.png' : '/images/help/coze-agent-config.png'} /> <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input className="input" type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); clearError('apiKey'); }}
                  placeholder={platform === 'coze-agent' ? '' : 'pat_...'}
                  style={{ fontSize: 13, padding: '8px 12px', borderColor: fieldErrors.apiKey ? '#ef4444' : undefined }} />
                {fieldErrors.apiKey && <FieldError message={fieldErrors.apiKey} />}
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  在对应平台的个人设置中创建并复制访问令牌
                </p>
              </div>
            </div>
          </div>

      {fieldErrors.submit && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: '#fef2f2', border: '1px solid #fecaca',
              color: '#dc2626', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              {fieldErrors.submit}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: 13, padding: '7px 18px' }}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: 13, padding: '7px 20px' }}>
              {saving ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg>
                  保存中...
                </span>
              ) : (agent ? '更新设置' : '确认接入')}
            </button>
          </div>
        </form>
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
