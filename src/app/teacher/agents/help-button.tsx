'use client';

export function AgentHelpButton({ platform }: { platform: string }) {
  return (
    <button
      type="button"
      onClick={() => window.open(`/help/agents?platform=${platform}`, '_blank', 'noopener,noreferrer')}
      title="查看配置截图，了解如何获取以上信息"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 24px', borderRadius: 10,
        background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
        color: '#4338ca', border: '1.5px dashed #a5b4fc',
        cursor: 'pointer', fontSize: '0.813rem', fontWeight: 600,
        fontFamily: 'inherit', transition: 'all 0.15s',
        boxShadow: '0 2px 8px rgba(99,102,241,0.08)',
      }}
      onMouseEnter={event => {
        event.currentTarget.style.background = 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)';
        event.currentTarget.style.borderStyle = 'solid';
        event.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.15)';
      }}
      onMouseLeave={event => {
        event.currentTarget.style.background = 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)';
        event.currentTarget.style.borderStyle = 'dashed';
        event.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.08)';
      }}
    >
      点击查看详细教程
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </button>
  );
}
