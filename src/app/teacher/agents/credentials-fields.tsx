import { FieldError } from '@/lib/components';
import type { AgentPlatform } from './agent-platforms';

export interface AgentCredentialValues {
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
}

const SAVED_SECRET_PLACEHOLDER = '••••••••••••••••••••••••';

const inputStyle = (error?: string) => ({
  fontSize: '0.813rem', padding: '8px 12px', borderColor: error ? '#ef4444' : undefined,
});

function RequiredField({ label, value, placeholder, hint, savedDisplay = false, error, type = 'text', onChange }: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  savedDisplay?: boolean;
  error?: string;
  type?: 'text' | 'password';
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>
        {label} <span style={{ color: 'var(--danger)' }}>*</span>
      </label>
      <input className={`input${savedDisplay && !value ? ' saved-secret-display' : ''}`} type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} style={inputStyle(error)} />
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
      <RequiredField label={apiKeyLabel} type="password" value={props.apiKey} placeholder={apiKeyPlaceholder} hint={editing ? '已安全保存；如需更换，直接输入新值' : undefined} savedDisplay={editing} error={fieldErrors.apiKey} onChange={update('apiKey')} />
      {platform === 'zhipuai' && (
        <RequiredField label="API Secret" type="password" value={props.apiSecret} placeholder={editing ? savedApiSecretLabel || SAVED_SECRET_PLACEHOLDER : '在智谱清言开发者面板获取 api_secret'} hint={editing ? '已安全保存；如需更换，直接输入新值' : undefined} savedDisplay={editing} error={fieldErrors.apiSecret} onChange={update('apiSecret')} />
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
  if (!hasSavedApiKey && !values.apiKey.trim()) errors.apiKey = platform === 'wenxin' ? '请填写密钥' : '请填写 API Token';
  return errors;
}
