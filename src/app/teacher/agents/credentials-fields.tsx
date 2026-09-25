import { FieldError } from '@/lib/components';
import { useState } from 'react';
import type { AgentPlatform } from './agent-platforms';
import type { PlatformTokenSummary } from '@/lib/types';

export interface AgentCredentialValues {
  /**
   * ★ 2026-09-25：选中的**共享 API Token**（`''` = 用自带的 `apiKey`）。
   * ⚠️ 它是「这一格凭据值」的一种，所以并进本类型 —— 表单那个逐平台草稿的机制
   * （`use-agent-form-fields` 的 `draftsRef`）就不用为它单开一条路。
   */
  credentialId: string;
  apiKey: string;
  apiUrl: string;
  botId: string;
  projectId: string;
  apiSecret: string;
}

type CredentialField = keyof AgentCredentialValues;

interface AgentCredentialsFieldsProps extends AgentCredentialValues {
  platform: AgentPlatform;
  editing: boolean;
  savedApiKeyLabel?: string;
  savedApiSecretLabel?: string;
  fieldErrors: Record<string, string>;
  onChange: (field: CredentialField, value: string) => void;
  /** ★ 2026-09-25：可选的共享 Token 清单（只有 `coze` 用得上）。 */
  tokens?: PlatformTokenSummary[];
  /** 打开「管理 API Token」弹窗。 */
  onManageTokens?: () => void;
}

const SAVED_SECRET_PLACEHOLDER = '••••••••••••••••••••••••';

const inputStyle = (error?: string) => ({
  fontSize: '0.813rem', padding: '8px 12px', borderColor: error ? '#ef4444' : undefined,
});

function RequiredField({ label, value, placeholder, hint, savedDisplay = false, error, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  savedDisplay?: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [replacingSavedValue, setReplacingSavedValue] = useState(false);
  const showingSavedValue = savedDisplay && !value && !replacingSavedValue;

  return (
    <div>
      <label style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>
        {label} <span style={{ color: 'var(--danger)' }}>*</span>
      </label>
      <input
        className={`input${showingSavedValue ? ' saved-secret-display' : ''}`}
        type="text"
        value={showingSavedValue ? placeholder : value}
        onFocus={() => {
          if (showingSavedValue) setReplacingSavedValue(true);
        }}
        onBlur={() => {
          if (savedDisplay && !value) setReplacingSavedValue(false);
        }}
        onChange={event => onChange(event.target.value)}
        placeholder={savedDisplay ? `输入新的${label}以替换原值` : placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        style={inputStyle(error)}
      />
      {hint && !error && <div style={{ color: '#64748b', fontSize: '0.688rem', marginTop: 4 }}>{hint}</div>}
      {error && <FieldError message={error} />}
    </div>
  );
}

function PlatformNotice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 8,
      background: 'linear-gradient(135deg, #fff7ed, #fffbeb)', border: '1px solid #fed7aa',
      fontSize: '0.75rem', color: '#9a3412', lineHeight: 1.6,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span><strong>温馨提示</strong>：{children}</span>
    </div>
  );
}

export function AgentPlatformNotice({ platform }: { platform: AgentPlatform }) {
  if (platform === 'coze' || platform === 'coze-agent') {
    return <PlatformNotice>扣子平台每天 0 点重置免费点数，当天至少登录一次即可正常使用。</PlatformNotice>;
  }
  if (platform === 'wenxin') {
    return <PlatformNotice>文心智能体暂不支持流式输出，需等待完整回复，体验上稍有延迟。受 API 功能限制，不支持图片理解。</PlatformNotice>;
  }
  return null;
}

export function AgentCredentialsFields(props: AgentCredentialsFieldsProps) {
  const { platform, editing, savedApiKeyLabel, savedApiSecretLabel, fieldErrors, onChange } = props;
  const update = (field: CredentialField) => (value: string) => onChange(field, value);
  const apiKeyLabel = platform === 'wenxin' ? '密钥' : platform === 'zhipuai' ? 'API Key' : 'API Token';
  const apiKeyPlaceholder = editing
    ? savedApiKeyLabel || SAVED_SECRET_PLACEHOLDER
    : platform === 'coze' ? '在 Coze 个人令牌页面创建，以 pat_ 开头'
      : platform === 'wenxin' ? '在文心智能体平台的 Secret Key'
        : platform === 'zhipuai' ? '在智谱清言开发者面板获取 api_key' : '';

  return (
    <>
      {platform === 'coze' && <RequiredField label="Bot ID" value={props.botId} placeholder="在 Coze 机器人发布页获取 Bot ID，纯数字" error={fieldErrors.botId} onChange={update('botId')} />}
      {platform === 'wenxin' && <RequiredField label="App ID" value={props.botId} placeholder="在文心智能体平台获取 App ID" error={fieldErrors.botId} onChange={update('botId')} />}
      {platform === 'zhipuai' && <RequiredField label="Assistant ID" value={props.botId} placeholder="智能体对话页地址栏中的 ID" error={fieldErrors.botId} onChange={update('botId')} />}
      {platform === 'coze-agent' && (
        <>
          <RequiredField label="API URL" value={props.apiUrl} placeholder="https://xxxx.coze.site" error={fieldErrors.apiUrl} onChange={update('apiUrl')} />
          <RequiredField label="Project ID" value={props.projectId} placeholder="在 Coze 项目设置中获取 Project ID" error={fieldErrors.projectId} onChange={update('projectId')} />
        </>
      )}
      {/* ★ 2026-09-25：**Coze 低代码的 Token 改成「选一份共享的」**。
          Token 属于扣子账号、不属于 Bot —— 同一个号做出来的智能体共用一份，
          换一次只需改那一份（新建/管理在「API Token」弹窗里）。

          ⚠️ 仍保留「自带 Token」这一项（= `credentialId` 为空）：
          「这个 Bot 用的不是我的号」是真实存在的情况，去掉它等于逼教师绕路。
          ⚠️ 选了共享凭据时**不再强制填 apiKey**（下方 `validateAgentCredentials` 同源）。 */}
      {platform === 'coze' ? (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.813rem', color: '#475569', fontWeight: 500, marginBottom: 4 }}>
            {apiKeyLabel}
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="input" value={props.credentialId} onChange={(e) => update('credentialId')(e.target.value)}
              style={{ fontSize: '0.813rem', padding: '8px 12px', flex: 1, minWidth: 0, borderColor: fieldErrors.apiKey ? '#ef4444' : undefined }}>
              <option value="">自带 Token（只给这一个智能体用）</option>
              {(props.tokens ?? []).filter((row) => row.platform === 'coze').map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '6px 12px', flexShrink: 0 }}
              onClick={() => props.onManageTokens?.()}>管理</button>
          </div>
          {props.credentialId ? (
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
              这一份由多个智能体共用，换 Token 只需在「API Token」里改一次。
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <RequiredField label="Token" value={props.apiKey} placeholder={apiKeyPlaceholder} hint={editing ? '当前显示的是脱敏旧值；点击输入框后可粘贴新值并直接替换' : undefined} savedDisplay={editing} error={fieldErrors.apiKey} onChange={update('apiKey')} />
            </div>
          )}
        </div>
      ) : (
        <RequiredField label={apiKeyLabel} value={props.apiKey} placeholder={apiKeyPlaceholder} hint={editing ? '当前显示的是脱敏旧值；点击输入框后可粘贴新值并直接替换' : undefined} savedDisplay={editing} error={fieldErrors.apiKey} onChange={update('apiKey')} />
      )}
      {platform === 'zhipuai' && (
        <RequiredField label="API Secret" value={props.apiSecret} placeholder={editing ? savedApiSecretLabel || SAVED_SECRET_PLACEHOLDER : '在智谱清言开发者面板获取 api_secret'} hint={editing ? '当前显示的是脱敏旧值；点击输入框后可粘贴新值并直接替换' : undefined} savedDisplay={editing} error={fieldErrors.apiSecret} onChange={update('apiSecret')} />
      )}
    </>
  );
}

export function validateAgentCredentials(platform: AgentPlatform, values: AgentCredentialValues, hasSavedApiKey: boolean, hasSavedApiSecret: boolean) {
  const errors: Record<string, string> = {};
  if (platform === 'coze' && !values.botId.trim()) errors.botId = '请填写 Bot ID';
  if (platform === 'coze-agent') {
    if (!values.apiUrl.trim()) errors.apiUrl = '请填写 API URL';
    if (!values.projectId.trim()) errors.projectId = '请填写 Project ID';
  }
  if (platform === 'wenxin' && !values.botId.trim()) errors.botId = '请填写 App ID';
  if (platform === 'zhipuai') {
    if (!values.botId.trim()) errors.botId = '请填写 Assistant ID';
    if (!hasSavedApiSecret && !values.apiSecret.trim()) errors.apiSecret = '请填写 API Secret';
  }
  // ★ 2026-09-25：`coze` 选了**共享凭据**时不必再填 Token —— 判据与
  // `use-agent-form-actions` 那条「获取信息」的前置判据**同源**（两处不一致会出现
  // 「能保存但不能再获取信息」这种极难归因的错位）。
  const usesSharedCredential = platform === 'coze' && !!values.credentialId;
  if (!usesSharedCredential && !hasSavedApiKey && !values.apiKey.trim()) {
    errors.apiKey = platform === 'wenxin' ? '请填写密钥' : '请填写 API Token';
  }
  return errors;
}
