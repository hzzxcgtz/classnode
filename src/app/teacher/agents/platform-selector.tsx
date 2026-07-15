import Image from 'next/image';
import { AGENT_PLATFORMS, type AgentPlatform } from './agent-platforms';

export function AgentPlatformSelector({ platform, onChange }: {
  platform: AgentPlatform;
  onChange: (platform: AgentPlatform) => void;
}) {
  return (
    <div>
      <label style={{ fontSize: "0.75rem", fontWeight: 500, marginBottom: 4, display: 'block' }}>平台类型 <span style={{ color: 'var(--danger)' }}>*</span></label>
      <div className="agent-platform-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {AGENT_PLATFORMS.map(option => (
          <div key={option.value} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <button type="button" onClick={() => onChange(option.value)} aria-pressed={platform === option.value} style={{
              width: '100%', padding: '10px 6px 7px', borderRadius: 6, cursor: 'pointer',
              border: `1.5px solid ${platform === option.value ? '#2563eb' : '#e2e8f0'}`,
              background: platform === option.value ? '#eef2ff' : 'white',
              textAlign: 'center', transition: 'all 0.12s', opacity: 1, fontFamily: 'inherit',
            }}>
              {option.logo && <Image width={22} height={22} src={`/images/platforms/${option.logo}.png`} alt="" style={{ width: 22, height: 22, objectFit: 'contain', marginBottom: 4, display: 'block', margin: '0 auto 4px' }} />}
              <div style={{ fontSize: "0.813rem", fontWeight: 600, color: platform === option.value ? '#2563eb' : '#475569' }}>{option.label}</div>
              <div style={{ fontSize: "0.625rem", color: '#94a3b8', marginTop: 1 }}>{option.description}</div>
            </button>
          </div>
        ))}
      </div>
      <a href="/teacher/guide#ai-agents" target="_blank" rel="noopener noreferrer" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        marginTop: 8, fontSize: "0.75rem", color: '#6366f1',
        textDecoration: 'none', fontWeight: 500, transition: 'color 0.12s',
      }}
        onMouseEnter={e => { e.currentTarget.style.color = '#4f46e5'; e.currentTarget.style.textDecoration = 'underline'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.textDecoration = 'none'; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        不知道怎么选平台？前往查看各平台特点 →
      </a>
    </div>
  );
}
