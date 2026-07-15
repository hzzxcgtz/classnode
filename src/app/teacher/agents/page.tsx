'use client';

import { useState, useEffect, useRef } from 'react';
import { FieldError, Toast, Pagination } from '@/lib/components';
import type { AgentSummary } from '@/lib/types';
import { AgentHelpButton } from './help-button';
import { AgentLogoField } from './logo-field';
import { AgentPlatformSelector } from './platform-selector';
import { AgentCredentialsFields } from './credentials-fields';
import { AgentCard } from './agent-card';
import { AgentDeleteBlockedDialog, AgentErrorTip, type AgentErrorTipData } from './agent-overlays';
import { useAgentController } from './use-agent-controller';
import { useAgentFormFields } from './use-agent-form-fields';
import { useAgentLogo } from './use-agent-logo';
import { useAgentFormActions } from './use-agent-form-actions';
import { AGENT_PLATFORMS, type AgentPlatform } from './agent-platforms';

export default function AgentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AgentSummary | null>(null);
  const [agentPage, setAgentPage] = useState(1);
  const [agentPageSize, setAgentPageSize] = useState(12);
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const toastTimerRef = useRef<number | null>(null);
  const [errorTip, setErrorTip] = useState<AgentErrorTipData | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ agentName: string } | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | AgentPlatform>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'healthy' | 'error'>('all');

  const { agents, loading, testing, busyOperation, loadAgents, toggleAgent, deleteAgent, testAgent } = useAgentController({
    onNotice: notice => {
      setToast({ show: true, msg: notice.message, type: notice.type });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    },
    onDeleteBlocked: agent => setDeleteBlocked({ agentName: agent.name }),
  });

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const normalizedAgentSearch = agentSearch.trim().toLocaleLowerCase('zh-CN');
  const filteredAgents = agents.filter(agent => {
    const matchesSearch = !normalizedAgentSearch || agent.name.toLocaleLowerCase('zh-CN').includes(normalizedAgentSearch);
    const matchesPlatform = platformFilter === 'all' || agent.platform === platformFilter;
    const enabled = agent.enabled !== false;
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'enabled' && enabled)
      || (statusFilter === 'disabled' && !enabled)
      || (statusFilter === 'healthy' && enabled && agent.lastCheckOk === true)
      || (statusFilter === 'error' && enabled && Boolean(agent.lastCheckAt) && agent.lastCheckOk === false);
    return matchesSearch && matchesPlatform && matchesStatus;
  });
  const pagedAgents = filteredAgents.slice((agentPage - 1) * agentPageSize, agentPage * agentPageSize);
  const agentSummary = {
    enabled: agents.filter(agent => agent.enabled !== false).length,
    healthy: agents.filter(agent => agent.enabled !== false && agent.lastCheckOk === true).length,
    error: agents.filter(agent => agent.enabled !== false && Boolean(agent.lastCheckAt) && agent.lastCheckOk === false).length,
  };

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

      {!loading && agents.length > 0 && (
        <>
          <div className="agent-management-overview" aria-label="智能体状态概览">
            {[
              { label: '全部智能体', value: agents.length, tone: 'blue' },
              { label: '当前启用', value: agentSummary.enabled, tone: 'purple' },
              { label: '连接健康', value: agentSummary.healthy, tone: 'green' },
              { label: '连接异常', value: agentSummary.error, tone: 'red' },
            ].map(item => (
              <div key={item.label} className={`tone-${item.tone}`}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="agent-management-filters">
            <label className="agent-management-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={agentSearch} onChange={event => { setAgentSearch(event.target.value); setAgentPage(1); }} placeholder="搜索智能体名称" aria-label="搜索智能体" />
              {agentSearch && <button type="button" onClick={() => { setAgentSearch(''); setAgentPage(1); }} aria-label="清空智能体搜索">×</button>}
            </label>
            <select value={platformFilter} onChange={event => { setPlatformFilter(event.target.value as 'all' | AgentPlatform); setAgentPage(1); }} aria-label="按平台筛选智能体">
              <option value="all">全部平台</option>
              {AGENT_PLATFORMS.map(platform => <option key={platform.value} value={platform.value}>{platform.label}</option>)}
            </select>
            <select value={statusFilter} onChange={event => { setStatusFilter(event.target.value as typeof statusFilter); setAgentPage(1); }} aria-label="按状态筛选智能体">
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
              <option value="healthy">连接健康</option>
              <option value="error">连接异常</option>
            </select>
          </div>
        </>
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
      ) : filteredAgents.length === 0 ? (
        <div className="agent-management-filter-empty">
          <strong>没有符合条件的智能体</strong>
          <span>可以更换关键词、平台或连接状态</span>
          <button className="btn btn-secondary" onClick={() => { setAgentSearch(''); setPlatformFilter('all'); setStatusFilter('all'); setAgentPage(1); }}>查看全部智能体</button>
        </div>
      ) : (
        <div className="agent-management-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {pagedAgents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              testing={testing === agent.id}
              toggling={busyOperation === `${agent.id}:toggle`}
              deleting={busyOperation === `${agent.id}:delete`}
              onToggle={() => void toggleAgent(agent)}
              onTest={() => void testAgent(agent)}
              onEdit={() => { setEditing(agent); setShowForm(true); }}
              onDelete={() => void deleteAgent(agent)}
              onShowError={(text, top, left) => setErrorTip({ text, top, left })}
              onHideError={() => setErrorTip(null)}
            />
          ))}
        </div>
      )}
      {filteredAgents.length > agentPageSize && (
        <Pagination current={agentPage} total={filteredAgents.length} pageSize={agentPageSize} pageSizeOptions={[8, 12, 20, 40, 60]} onChange={setAgentPage} onPageSizeChange={setAgentPageSize} />
      )}

      {deleteBlocked && <AgentDeleteBlockedDialog agentName={deleteBlocked.agentName} onClose={() => setDeleteBlocked(null)} />}
      {errorTip && <AgentErrorTip tip={errorTip} />}

      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

function AgentForm({ agent, onClose, onSaved }: { agent: AgentSummary | null; onClose: () => void; onSaved: () => void }) {
  const fields = useAgentFormFields(agent);
  const { name, setName, platform, setPlatform, apiKey, apiUrl, botId, projectId, apiSecret, greeting, setGreeting,
    updateCredential,
    hasSavedApiKey, hasSavedApiSecret, savedApiKeyLabel, editingSavedPlatform } = fields;
  const logo = useAgentLogo(agent);
  const { fileRef, preview: logoPreview, selectFile: handleLogoChange, applyRemote: applyRemoteLogo, remove: handleRemoveLogo, appendTo: appendLogoTo } = logo;
  const actions = useAgentFormActions({
    agent, values: { name, platform, apiKey, apiUrl, botId, projectId, apiSecret, greeting },
    hasSavedApiKey, hasSavedApiSecret, setName, setGreeting, applyRemoteLogo, appendLogoTo, onSaved,
  });
  const { fetchingInfo, saving, fieldErrors, toast, setToast, clearError, clearErrors, fetchInfo: handleFetchInfo, submit } = actions;
  const handleSubmit = (event: React.FormEvent) => { event.preventDefault(); void submit(); };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  return (
    <div className="modal-overlay">
      <div className="modal-content agent-form-modal" role="dialog" aria-modal="true" aria-labelledby="agent-form-title" onClick={e => e.stopPropagation()} style={{
        maxWidth: 520, padding: 0, borderRadius: 14,
      }}>
        {/* 顶栏 */}
        <div style={{
          padding: '16px 24px 0',
          background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)',
          borderBottom: '1px solid var(--border)',
          position: 'relative',
        }}>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭智能体表单" style={{
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
          <h2 id="agent-form-title" style={{ fontSize: "1rem", fontWeight: 700, margin: '0 0 2px' }}>
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
              <div className="agent-form-identity" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <AgentLogoField inputRef={fileRef} preview={logoPreview} onChange={handleLogoChange} onRemove={handleRemoveLogo} />
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>智能体名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <div className="agent-form-name-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="input" autoFocus value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="例如: AI英语助教"
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
              <AgentPlatformSelector platform={platform} onChange={next => { setPlatform(next); clearErrors(); }} />

              <AgentCredentialsFields
                platform={platform}
                editing={editingSavedPlatform}
                savedApiKeyLabel={savedApiKeyLabel}
                apiKey={apiKey}
                apiUrl={apiUrl}
                botId={botId}
                projectId={projectId}
                apiSecret={apiSecret}
                fieldErrors={fieldErrors}
                onChange={(field, value) => {
                  updateCredential(field, value);
                  clearError(field);
                }}
              />
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

          <div className="agent-form-footer" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <AgentHelpButton platform={platform} />
            <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving} style={{ fontSize: "0.813rem", padding: '7px 18px' }}>取消</button>
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
