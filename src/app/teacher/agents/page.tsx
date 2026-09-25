'use client';

import { useState, useEffect, useRef } from 'react';
import { FieldError, Toast, Pagination, TeacherPageHeader, TeacherEmptyState, TeacherLoadingState } from '@/lib/components';
import type { AgentSummary, PlatformTokenSummary, RelatedClassroom } from '@/lib/types';
import { api } from '@/lib/api';
import { tokenExpiryView } from '@/lib/platform-token-expiry';
import { ApiTokenModal, ExpiryChip } from './api-token-modal';
import { AgentHelpButton } from './help-button';
import { AgentLogoField } from './logo-field';
import { AgentPlatformSelector } from './platform-selector';
import { AgentPurposeSelector } from './purpose-selector';
import { AgentCredentialsFields, AgentPlatformNotice } from './credentials-fields';
import { AgentCard } from './agent-card';
import { AgentDeleteBlockedDialog, AgentErrorTip, AgentRelatedClassroomsDialog, type AgentErrorTipData } from './agent-overlays';
import { useAgentController } from './use-agent-controller';
import { useAgentFormFields } from './use-agent-form-fields';
import { useAgentLogo } from './use-agent-logo';
import { useAgentFormActions } from './use-agent-form-actions';
import { AGENT_PLATFORMS, AGENT_PLATFORM_MAP, type AgentPlatform } from './agent-platforms';

export default function AgentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AgentSummary | null>(null);
  const [agentPage, setAgentPage] = useState(1);
  const [agentPageSize, setAgentPageSize] = useState(12);
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const toastTimerRef = useRef<number | null>(null);
  const [errorTip, setErrorTip] = useState<AgentErrorTipData | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ agentName: string; classrooms: RelatedClassroom[] } | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  /**
   * ★ 2026-09-25：共享 API Token 的列表。
   * 🔴 **页面持有它、弹窗只是消费者** —— 因为顶上那条临期横幅与弹窗画的是**同一份数据**，
   * 两边各拉一次就会出现「横幅说 3 天后到期，点进去列表说还剩 12 天」。
   */
  const [tokens, setTokens] = useState<PlatformTokenSummary[]>([]);
  const [showTokens, setShowTokens] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<'all' | AgentPlatform>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'healthy' | 'error'>('all');

  const { agents, loading, testing, busyOperation, relatedClassrooms, relatedLoading, openRelatedClassrooms, closeRelatedClassrooms, loadAgents, toggleAgent, deleteAgent, testAgent } = useAgentController({
    onNotice: notice => {
      setToast({ show: true, msg: notice.message, type: notice.type });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    },
    onDeleteBlocked: (agent, classrooms) => setDeleteBlocked({ agentName: agent.name, classrooms }),
  });

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  /**
   * 拉一次 Token 列表。⚠️ **失败不阻断这一页**（智能体列表才是主角），
   * 但也**不静默吞掉** —— 顶上的横幅会因此不出现，而那正是「有效期的提醒」本身。
   * ⇒ 失败时把 `tokens` 留空（横幅不显示），错误由弹窗那一次请求自己报。
   */
  const loadTokens = async () => {
    try {
      setTokens(await api.getPlatformTokens());
    } catch {
      setTokens([]);
    }
  };
  useEffect(() => { void loadTokens(); }, []);

  const notify = (message: string) => {
    setToast({ show: true, msg: message, type: 'error' });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
  };

  /** 没填有效期的那几份 —— **单独一档**：我们不知道什么时候到期，所以提醒不了。 */
  const unsetTokens = tokens.filter((row) => tokenExpiryView(row.expiresAt, new Date()).level === 'none');

  /** 需要提醒的凭据：黄 / 红 / 已过期。⚠️ **不含 `none`**（那是另一回事，见横幅那段）。 */
  const expiringTokens = tokens
    .map((row) => ({ row, expiry: tokenExpiryView(row.expiresAt, new Date()) }))
    .filter(({ expiry }) => expiry.level === 'soon' || expiry.level === 'urgent' || expiry.level === 'expired');

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
      <TeacherPageHeader title="AI 智能体" description="接入并管理课堂使用的 AI 智能体。" actions={
        <>
          {/* ★ 2026-09-25：与「接入智能体」并排。⚠️ 在**没有 token 时也显示** ——
              它就是教师第一次该去的地方（Coze 低代码的智能体要选一份 Token）。 */}
          <button className="btn btn-secondary" onClick={() => setShowTokens(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" /></svg>
            API Token
          </button>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            接入智能体
          </button>
        </>
      } />

      {/* ★ 2026-09-25：**临期横幅**（spec §三③）。
          只在**真有事**时出现，其余时候完全不占位置。

          🔴 「未设置有效期」与「快到期了」是**两条不同的催促**，合成一句会让两边都变模糊：
          前者是「你还没告诉我什么时候到期」（我们不知道，所以提醒不了你），
          后者是「你告诉过我，而现在快了」。所以文案分开、颜色也分开。 */}
      {(expiringTokens.length > 0 || unsetTokens.length > 0) && (
        <div role="status" style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
          padding: '12px 16px', borderRadius: 10, marginBottom: 16,
          background: expiringTokens.length > 0 ? '#fffbeb' : '#f8fafc',
          border: `1px solid ${expiringTokens.length > 0 ? '#fde68a' : '#e2e8f0'}`,
          color: expiringTokens.length > 0 ? '#92400e' : '#475569',
          fontSize: '0.813rem', lineHeight: 1.7,
        }}>
          <span aria-hidden="true" style={{ fontSize: '1rem' }}>{expiringTokens.length > 0 ? '⚠️' : 'ℹ️'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {expiringTokens.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>API Token 快到期了</strong>
                {expiringTokens.map(({ row, expiry }) => (
                  <span key={row.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{row.label}</span>
                    <ExpiryChip level={expiry.level} text={expiry.text} />
                  </span>
                ))}
                <span>到期后智能体会连不上，请及时到扣子平台换新。</span>
              </div>
            )}
            {unsetTokens.length > 0 && (
              <div style={{ marginTop: expiringTokens.length > 0 ? 4 : 0 }}>
                还有 <strong>{unsetTokens.length}</strong> 份 Token 没填有效期（{unsetTokens.map((row) => row.label).join('、')}）——
                填了我们才能提前提醒你。
              </div>
            )}
          </span>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 12px', flexShrink: 0 }} onClick={() => setShowTokens(true)}>
            去处理
          </button>
        </div>
      )}

      {showTokens && (
        <ApiTokenModal
          tokens={tokens}
          onRefresh={loadTokens}
          onClose={() => setShowTokens(false)}
          onError={notify}
        />
      )}

      {showForm && (
        <AgentForm
          agent={editing}
          tokens={tokens}
          onManageTokens={() => setShowTokens(true)}
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
          <div className="agent-management-filters teacher-list-toolbar">
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
        <TeacherLoadingState label="正在加载智能体…" />
      ) : agents.length === 0 ? (
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /><path d="M8 4V2" /><path d="M16 4V2" /><path d="M8 20v2" /><path d="M16 20v2" /></svg>}
          title="还没有接入智能体"
          description="先接入一个已配置好的智能体，再把它带入课堂。"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}>接入第一个智能体</button>}
        />
      ) : filteredAgents.length === 0 ? (
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
          title="没有符合条件的智能体"
          description="可以调整关键词、平台或连接状态。"
          action={<button className="btn btn-secondary" onClick={() => { setAgentSearch(''); setPlatformFilter('all'); setStatusFilter('all'); setAgentPage(1); }}>查看全部智能体</button>}
        />
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
              onShowRelatedClassrooms={() => void openRelatedClassrooms(agent)}
            />
          ))}
        </div>
      )}
      {filteredAgents.length > agentPageSize && (
        <Pagination current={agentPage} total={filteredAgents.length} pageSize={agentPageSize} pageSizeOptions={[8, 12, 20, 40, 60]} onChange={setAgentPage} onPageSizeChange={setAgentPageSize} />
      )}

      {deleteBlocked && <AgentDeleteBlockedDialog agentName={deleteBlocked.agentName} classrooms={deleteBlocked.classrooms} onClose={() => setDeleteBlocked(null)} />}
      {relatedClassrooms && (
        <AgentRelatedClassroomsDialog
          agentName={relatedClassrooms.agent.name}
          classrooms={relatedClassrooms.classrooms}
          loading={relatedLoading}
          onClose={closeRelatedClassrooms}
        />
      )}
      {errorTip && <AgentErrorTip tip={errorTip} />}

      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

function AgentForm({ agent, tokens, onManageTokens, onClose, onSaved }: {
  agent: AgentSummary | null;
  /** ★ 2026-09-25：共享 API Token 清单 —— **页面持有**（顶上那条临期横幅画的是同一份）。 */
  tokens: PlatformTokenSummary[];
  onManageTokens: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields = useAgentFormFields(agent);
  const { name, setName, platform, setPlatform, credentialId, apiKey, apiUrl, botId, projectId, apiSecret, greeting, setGreeting,
    purpose, setPurpose,
    updateCredential,
    hasSavedApiKey, hasSavedApiSecret, savedApiKeyLabel, savedApiSecretLabel, editingSavedPlatform } = fields;
  const logo = useAgentLogo(agent);
  const { fileRef, preview: logoPreview, selectFile: handleLogoChange, applyRemote: applyRemoteLogo, remove: handleRemoveLogo, resetForPlatform: resetLogoForPlatform, appendTo: appendLogoTo } = logo;
  const actions = useAgentFormActions({
    agent, values: { name, platform, credentialId, apiKey, apiUrl, botId, projectId, apiSecret, greeting, purpose },
    hasSavedApiKey, hasSavedApiSecret, setName, setGreeting, applyRemoteLogo, appendLogoTo, onSaved,
  });
  const { fetchingInfo, saving, fieldErrors, toast, setToast, clearError, clearErrors, fetchInfo: handleFetchInfo, submit } = actions;
  const handleSubmit = (event: React.FormEvent) => { event.preventDefault(); void submit(); };
  const canFetchCozeInfo = platform === 'coze' && Boolean(botId.trim()) && (hasSavedApiKey || Boolean(apiKey.trim()));
  const handlePlatformChange = (next: AgentPlatform) => {
    if (next === platform) return;
    setPlatform(next);
    resetLogoForPlatform(next);
    clearErrors();
  };

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
        maxWidth: 860, padding: 0, borderRadius: 14,
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

        <form className="agent-form-layout" onSubmit={handleSubmit}>

          <div className="agent-form-platform">
            <AgentPlatformSelector platform={platform} onChange={handlePlatformChange} />
          </div>

          {/* ★ M7b：用途 —— `Agent.purpose` 的**唯一写入口**（独立审查 C1）。
              没有它，分析型智能体一个都建不出来，整条 M7b 在界面上不可达。 */}
          <div className="agent-form-section">
            <AgentPurposeSelector purpose={purpose} onChange={setPurpose} />
          </div>

          <div className="agent-form-section agent-form-credentials" style={{
            background: '#fafbfc', borderRadius: 8, padding: 14,
            border: '1px solid #eef2f6',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="agent-form-step-heading">
                <span>1</span>
                <div><strong>填写接入凭据</strong><small>{AGENT_PLATFORM_MAP[platform].label} · 凭据仅加密保存在本机</small></div>
              </div>

              <AgentCredentialsFields
                platform={platform}
                editing={editingSavedPlatform}
                savedApiKeyLabel={savedApiKeyLabel}
                savedApiSecretLabel={savedApiSecretLabel}
                credentialId={credentialId}
                tokens={tokens}
                onManageTokens={onManageTokens}
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

          <div className="agent-form-section agent-form-profile" style={{
            background: '#fafbfc', borderRadius: 8, padding: 14,
            border: '1px solid #eef2f6',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="agent-form-step-heading">
                <span>2</span>
                <div><strong>{AGENT_PLATFORM_MAP[platform].label}智能体资料</strong><small>{platform === 'coze' ? '自动获取或手动填写' : '请手动填写展示名称、头像和开场白'}</small></div>
              </div>
              {platform === 'coze' && (
                <button type="button" className="btn btn-primary agent-coze-fetch-button" onClick={handleFetchInfo} disabled={!canFetchCozeInfo || fetchingInfo}
                  title={canFetchCozeInfo ? '自动填入头像、名称和开场白' : '请先填写 Bot ID 和 API Token'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  {fetchingInfo ? '获取中...' : '从 Coze 获取资料'}
                </button>
              )}
              <div className="agent-form-identity" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <AgentLogoField inputRef={fileRef} preview={logoPreview} onChange={handleLogoChange} onRemove={handleRemoveLogo} />
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>智能体名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input className="input" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="例如: AI英语助教"
                    style={{ fontSize: "0.813rem", padding: '8px 12px', borderColor: fieldErrors.name ? '#ef4444' : undefined }} />
                  {fieldErrors.name && <FieldError message={fieldErrors.name} />}
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>开场白</label>
                <textarea
                  className="input"
                  value={greeting}
                  onChange={e => setGreeting(e.target.value)}
                  placeholder={platform === 'coze' ? '自动获取后会填入这里，也可以手动输入' : '手动输入开场白内容'}
                  style={{ fontSize: "0.813rem", padding: '8px 12px', minHeight: 72, resize: 'vertical', width: '100%' }}
                />
              </div>
            </div>
          </div>

          {(platform === 'coze' || platform === 'coze-agent' || platform === 'wenxin') && (
            <div className="agent-form-platform-notice">
              <AgentPlatformNotice platform={platform} />
            </div>
          )}

          {fieldErrors.submit && (
            <div className="agent-form-submit-error" style={{
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
