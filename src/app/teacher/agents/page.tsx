'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { FieldError, Toast, Pagination } from '@/lib/components';

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [agentPage, setAgentPage] = useState(1);
  const [agentPageSize, setAgentPageSize] = useState(12);
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const [errorTip, setErrorTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{
    agentId: string;
    agentName: string;
  } | null>(null);

  const loadAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
      setAgentPage(1);
    } catch {}
    setLoading(false);
  };

  const pagedAgents = agents.slice((agentPage - 1) * agentPageSize, agentPage * agentPageSize);

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
            <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>AI智能体</h1>
            <p style={{ color: '#64748b', fontSize: "0.813rem", marginTop: 4 }}>
              接入 Coze 低代码、Coze 编程、清言智能体、文心智能体等多种 AI 平台
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
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: "0.875rem" }}>加载中...</div>
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
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: '0 0 8px' }}>还没有接入智能体</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: "0.875rem", marginBottom: 24 }}>
            点击上方按钮，接入您在 Coze、清言智能体、文心智能体等平台配置好的 AI 助手
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => setShowForm(true)}>
            接入第一个智能体
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {pagedAgents.map(agent => {
            // 平台色调（柔和色系，预留 8 色供后续接入）
            const platformColors: Record<string, string> = {
              coze: '#4f7bc9',        // 灰蓝
              'coze-agent': '#8b6eb5', // 灰紫
              wenxin: '#c0605a',       // 豆沙红
              zhipuai: '#5d9b8e',      // 灰绿
              // 预留：
              // p6: '#b88b4a'  土黄
              // p7: '#7a9bb5'  雾蓝
              // p8: '#b57a9e'  玫瑰褐
            };
            const platformLabels: Record<string, string> = {
              coze: 'Coze 低代码',
              'coze-agent': 'Coze 编程',
              wenxin: '文心智能体',
              zhipuai: '清言智能体',
            };
            // 标签底色（极淡）
            const badgeBg: Record<string, string> = {
              coze: '#f0f4fa', 'coze-agent': '#f5f2fa', wenxin: '#fdf2f1', zhipuai: '#f0f7f5',
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
                    fontSize: "1.25rem", fontWeight: 700, color: isEnabled ? platColor : '#94a3b8',
                    overflow: 'hidden',
                  }}>
                    {agent.logo
                      ? <img src={agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : agent.name[0]}
                  </div>

                  {/* 信息 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.938rem", color: '#1a1a2e', marginBottom: 3 }}>
                      {agent.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4,
                        fontSize: "0.688rem", fontWeight: 600,
                        background: badgeBg[agent.platform] || '#f1f5f9',
                        color: platColor,
                      }}>
                        {platformLabels[agent.platform]}
                      </span>
                      {['coze-agent', 'wenxin'].includes(agent.platform) && (
                        <span style={{
                          padding: '1px 6px', borderRadius: 3,
                          fontSize: "0.625rem", fontWeight: 500,
                          color: '#94a3b8', border: '0.5px solid #e2e8f0',
                        }}>
                          纯文字
                        </span>
                      )}
                      {agent.platform === 'wenxin' && (
                        <span style={{
                          padding: '1px 6px', borderRadius: 3,
                          fontSize: "0.625rem", fontWeight: 500,
                          color: '#94a3b8', border: '0.5px solid #e2e8f0',
                        }}>
                          非流式
                        </span>
                      )}
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

                {/* 测试中的动画指示条 */}
                {testing === agent.id && (
                  <div style={{
                    marginTop: 8, height: 3, borderRadius: 2, overflow: 'hidden',
                    background: '#e2e8f0', position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute', inset: 0, width: '40%',
                      background: 'linear-gradient(90deg, #6366f1, #3b82f6)',
                      borderRadius: 2,
                      animation: 'indeterminate 1.2s ease-in-out infinite',
                    }} />
                  </div>
                )}
                {/* 分割线 + 连接状态 + 操作按钮 */}
                <div style={{
                  marginTop: 14, paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {/* 左侧：状态指示 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                    {!isEnabled ? (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#94a3b8', flexShrink: 0 }} />
                        <span style={{ fontSize: "0.688rem", color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap' }}>停用</span>
                      </>
                    ) : agent.lastCheckAt === null ? (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
                        <span style={{ fontSize: "0.688rem", color: '#94a3b8', whiteSpace: 'nowrap' }}>未检测</span>
                      </>
                    ) : agent.lastCheckOk ? (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                        <span style={{ fontSize: "0.688rem", color: '#16a34a', fontWeight: 500, whiteSpace: 'nowrap' }}>健康</span>
                        <span style={{ fontSize: "0.688rem", color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          {new Date(agent.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                        <span style={{
                          fontSize: "0.688rem", color: '#dc2626', fontWeight: 500, whiteSpace: 'nowrap',
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
                        <span style={{ fontSize: "0.688rem", color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {new Date(agent.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </>
                    )}
                  </div>

                  {/* 右侧：操作按钮 */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    {isEnabled && (
                      <button style={{
                        fontSize: "0.688rem", padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
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
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                          style={testing === agent.id ? { animation: 'spin 1s linear infinite' } : undefined}>
                          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        {testing === agent.id ? '检测中...' : '测试'}
                      </button>
                    )}
                    <button style={{
                      fontSize: "0.688rem", padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid #d1d5db', background: 'white', color: '#475569',
                      display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
                    }}
                      onClick={() => { setEditing(agent); setShowForm(true); }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      编辑
                    </button>
                    <button style={{
                      fontSize: "0.688rem", padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
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
      {agents.length > agentPageSize && (
        <Pagination current={agentPage} total={agents.length} pageSize={agentPageSize} pageSizeOptions={[8, 12, 20, 40, 60]} onChange={setAgentPage} onPageSizeChange={setAgentPageSize} />
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
              <h3 style={{ fontSize: "1.063rem", fontWeight: 700, margin: '0 0 4px' }}>无法删除智能体</h3>
              <p style={{ fontSize: "0.813rem", color: '#64748b', margin: 0 }}>
                该智能体正在被课堂使用中，请先删除关联的课堂后再试。
              </p>
            </div>
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
              padding: '14px 16px', marginBottom: 20,
            }}>
              <div style={{ fontSize: "0.813rem", fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>
                「{deleteBlocked.agentName}」
              </div>
              <div style={{ fontSize: "0.813rem", color: '#b91c1c' }}>
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
          fontSize: "0.688rem",
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

function HelpButton({ platform }: { platform: string }) {
  return (
    <button
      type="button"
      onClick={() => window.open(`/help/agents?platform=${platform}`, '_blank')}
      title="查看配置截图，了解如何获取以上信息"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 24px', borderRadius: 10,
        background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
        color: '#4338ca', border: '1.5px dashed #a5b4fc',
        cursor: 'pointer', fontSize: "0.813rem", fontWeight: 600,
        fontFamily: 'inherit', transition: 'all 0.15s',
        boxShadow: '0 2px 8px rgba(99,102,241,0.08)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)'; e.currentTarget.style.borderStyle = 'solid'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.15)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)'; e.currentTarget.style.borderStyle = 'dashed'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.08)'; }}
    >
      点击查看详细教程
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </button>
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
      if (!resp.name && !resp.iconUrl) {
        setToast({ msg: '未能从 Coze 获取到智能体信息，请检查 Bot ID 和 API Token 是否正确', type: 'error' });
      }
    } catch (e) {
      setToast({ msg: '获取信息失败：' + (e instanceof Error ? e.message : '请求异常'), type: 'error' });
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
    if (platform === 'wenxin') {
      if (!botId) errors.botId = '请填写 App ID';
    }
    if (platform === 'zhipuai') {
      if (!botId) errors.botId = '请填写 Assistant ID';
      if (!apiSecret) errors.apiSecret = '请填写 API Secret';
    }
    if (!apiKey) errors.apiKey = platform === 'wenxin' ? '请填写密钥' : '请填写 API Token';
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
    <div className="modal-overlay">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{
        maxWidth: 520, padding: 0, borderRadius: 14,
      }}>
        {/* 顶栏 */}
        <div style={{
          padding: '16px 24px 0',
          background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)',
          borderBottom: '1px solid var(--border)',
          position: 'relative',
        }}>
          <button type="button" onClick={onClose} style={{
            position: 'absolute', top: 12, right: 12,
            width: 28, height: 28, borderRadius: 6,
            border: 'none', background: 'transparent',
            color: '#94a3b8', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: "1rem", lineHeight: 1,
            transition: 'all 0.12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#475569'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}>
            ✕
          </button>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: '0 0 2px' }}>
            {agent ? '编辑智能体' : '接入AI智能体'}
          </h2>
          <p style={{ fontSize: "0.75rem", color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            接入 Coze 低代码、Coze 编程、清言智能体、文心智能体等多种 AI 平台
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '14px 24px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div style={{
            background: '#fafbfc', borderRadius: 8, padding: 14,
            border: '1px solid #eef2f6',
          }}>
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
                      cursor: 'pointer', fontSize: "0.75rem", lineHeight: 1,
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
                        cursor: 'pointer', fontSize: "0.563rem", lineHeight: 1,
                        padding: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                      }} title="移除头像">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>智能体名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="input" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="例如: AI英语助教"
                      style={{ fontSize: "0.813rem", padding: '8px 12px', flex: 1, borderColor: fieldErrors.name ? '#ef4444' : undefined }} />
                    {platform === 'coze' ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleFetchInfo}
                        disabled={fetchingInfo}
                        style={{ fontSize: "0.75rem", padding: '5px 12px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        {fetchingInfo ? '获取中...' : '从 Coze 获取'}
                      </button>
                    ) : null}
                  </div>
                  {fieldErrors.name && <FieldError message={fieldErrors.name} />}
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>开场白</label>
                <textarea
                  className="input"
                  value={greeting}
                  onChange={e => setGreeting(e.target.value)}
                  placeholder={platform === 'coze' ? '从 Coze 自动获取，或手动输入开场白' : '手动输入开场白内容'}
                  style={{ fontSize: "0.813rem", padding: '8px 12px', minHeight: 72, resize: 'vertical', width: '100%' }}
                />
              </div>
            </div>
          </div>

          <div style={{
            background: '#fafbfc', borderRadius: 8, padding: 14,
            border: '1px solid #eef2f6',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>平台类型 <span style={{ color: 'var(--danger)' }}>*</span></label>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
                }}>
                  {[
                    { value: 'coze', label: 'Coze 低代码', desc: '字节扣子', disabled: false, helpUrl: 'https://www.coze.cn' },
                    { value: 'coze-agent', label: 'Coze 编程', desc: '字节扣子', disabled: false, helpUrl: 'https://www.coze.cn' },
                    { value: 'zhipuai', label: '清言智能体', desc: '智谱清言', disabled: false, helpUrl: 'https://chatglm.cn/developersPanel/apiSet' },
                    { value: 'wenxin', label: '文心智能体', desc: '百度文心', disabled: false, helpUrl: 'https://agents.baidu.com' },
                  ].map(p => {
                    const logoMap: Record<string, string> = {
                      coze: 'coze-lowcode',
                      'coze-agent': 'coze-code',
                      zhipuai: 'zhipuai',
                      wenxin: 'wenxin',
                    };
                    return (
                    <div key={p.value} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <button type="button"
                        onClick={() => !p.disabled && setPlatform(p.value)}
                        title={p.disabled ? '暂未开放' : undefined}
                        style={{
                          width: '100%', padding: '10px 6px 7px', borderRadius: 6, cursor: p.disabled ? 'not-allowed' : 'pointer',
                          border: `1.5px solid ${platform === p.value && !p.disabled ? '#2563eb' : '#e2e8f0'}`,
                          background: platform === p.value && !p.disabled ? '#eef2ff' : p.disabled ? '#f8f9fb' : 'white',
                          textAlign: 'center', transition: 'all 0.12s', opacity: p.disabled ? 0.5 : 1, fontFamily: 'inherit',
                      }}>
                        {logoMap[p.value] && (
                          <img src={`/images/platforms/${logoMap[p.value]}.png`} alt=""
                            style={{ width: 22, height: 22, objectFit: 'contain', marginBottom: 4, display: 'block', margin: '0 auto 4px' }} />
                        )}
                      <div style={{ fontSize: "0.813rem", fontWeight: 600, color: p.disabled ? '#94a3b8' : (platform === p.value ? '#2563eb' : '#475569') }}>{p.label}</div>
                      <div style={{ fontSize: "0.625rem", color: p.disabled ? '#cbd5e1' : '#94a3b8', marginTop: 1 }}>{p.desc}</div>
                    </button>
                      </div>
                    );
                  })}
                </div>
                <a href="/teacher/guide#ai-agents" target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    marginTop: 8, fontSize: "0.75rem", color: '#6366f1',
                    textDecoration: 'none', fontWeight: 500,
                    transition: 'color 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#4f46e5'; e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.textDecoration = 'none'; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  不知道怎么选平台？前往查看各平台特点 →
                </a>
              </div>

              {/* 扣子低代码温馨提醒 */}
              {platform === 'coze' && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'linear-gradient(135deg, #fff7ed, #fffbeb)',
                  border: '1px solid #fed7aa',
                  fontSize: "0.75rem", color: '#9a3412', lineHeight: 1.6,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>
                    <strong>温馨提示</strong>：扣子平台每天 0 点重置免费点数，当天至少登录一次即可正常使用。
                  </span>
                </div>
              )}
              {/* 扣子编程温馨提醒 */}
              {platform === 'coze-agent' && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'linear-gradient(135deg, #fff7ed, #fffbeb)',
                  border: '1px solid #fed7aa',
                  fontSize: "0.75rem", color: '#9a3412', lineHeight: 1.6,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>
                    <strong>温馨提示</strong>：扣子平台每天 0 点重置免费点数，当天至少登录一次即可正常使用。
                  </span>
                </div>
              )}

              {/* Bot ID — Coze 必填 */}
              {platform === 'coze' && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    Bot ID <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={botId} onChange={e => { setBotId(e.target.value); clearError('botId'); }}
                    placeholder="在 Coze 机器人发布页获取 Bot ID，纯数字"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.botId ? '#ef4444' : undefined }} />
                  {fieldErrors.botId && <FieldError message={fieldErrors.botId} />}
                </div>
              )}

              {/* 文心智能体温馨提醒 */}
              {platform === 'wenxin' && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'linear-gradient(135deg, #fff7ed, #fffbeb)',
                  border: '1px solid #fed7aa',
                  fontSize: "0.75rem", color: '#9a3412', lineHeight: 1.6,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>
                    <strong>温馨提示</strong>：文心智能体暂不支持流式输出，需等待完整回复，体验上稍有延迟。受 API 功能限制，不支持图片理解。
                  </span>
                </div>
              )}

              {/* App ID — 文心智能体必填 */}
              {platform === 'wenxin' && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    App ID <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={botId} onChange={e => { setBotId(e.target.value); clearError('botId'); }}
                    placeholder="在文心智能体平台获取 App ID"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.botId ? '#ef4444' : undefined }} />
                  {fieldErrors.botId && <FieldError message={fieldErrors.botId} />}
                </div>
              )}

              {/* Assistant ID — 智谱清言必填 */}
              {platform === 'zhipuai' && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    Assistant ID <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={botId} onChange={e => { setBotId(e.target.value); clearError('botId'); }}
                    placeholder="智能体对话页地址栏中的 ID"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.botId ? '#ef4444' : undefined }} />
                  {fieldErrors.botId && <FieldError message={fieldErrors.botId} />}
                </div>
              )}

              {/* API URL — Coze Agent 必填 */}
              {platform === 'coze-agent' && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>API URL <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input className="input" value={apiUrl} onChange={e => { setApiUrl(e.target.value); clearError('apiUrl'); }}
                    placeholder="https://xxxx.coze.site"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.apiUrl ? '#ef4444' : undefined }} />
                  {fieldErrors.apiUrl && <FieldError message={fieldErrors.apiUrl} />}
                </div>
              )}

              {/* Project ID — Coze Agent 必填 */}
              {platform === 'coze-agent' && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    Project ID <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" value={projectId} onChange={e => { setProjectId(e.target.value); clearError('projectId'); }}
                    placeholder="在 Coze 项目设置中获取 Project ID"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.projectId ? '#ef4444' : undefined }} />
                  {fieldErrors.projectId && <FieldError message={fieldErrors.projectId} />}
                </div>
              )}

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>
                  {platform === 'wenxin' ? '密钥' : platform === 'zhipuai' ? 'API Key' : 'API Token'} <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input className="input" type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); clearError('apiKey'); }}
                  placeholder={
                    platform === 'coze' ? '在 Coze 个人令牌页面创建，以 pat_ 开头' :
                    platform === 'wenxin' ? '在文心智能体平台的 Secret Key' :
                    platform === 'zhipuai' ? '在智谱清言开发者面板获取 api_key' :
                    ''
                  }
                  style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.apiKey ? '#ef4444' : undefined }} />
                {fieldErrors.apiKey && <FieldError message={fieldErrors.apiKey} />}
              </div>

              {/* API Secret — 智谱清言必填 */}
              {platform === 'zhipuai' && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>
                    API Secret <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" type="password" value={apiSecret} onChange={e => { setApiSecret(e.target.value); clearError('apiSecret'); }}
                    placeholder="在智谱清言开发者面板获取 api_secret"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.apiSecret ? '#ef4444' : undefined }} />
                  {fieldErrors.apiSecret && <FieldError message={fieldErrors.apiSecret} />}
                </div>
              )}
            </div>

          </div>

      {fieldErrors.submit && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: '#fef2f2', border: '1px solid #fecaca',
              color: '#dc2626', fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              {fieldErrors.submit}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <HelpButton platform={platform} />
            <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: "0.813rem", padding: '7px 18px' }}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: "0.813rem", padding: '7px 20px' }}>
              {saving ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg>
                  保存中...
                </span>
              ) : (agent ? '更新设置' : '确认接入')}
            </button>
            </div>
          </div>
        </form>
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
