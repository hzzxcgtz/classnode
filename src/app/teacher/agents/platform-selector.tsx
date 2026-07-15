import Image from 'next/image';
import { AGENT_PLATFORMS, type AgentPlatform } from './agent-platforms';

export function AgentPlatformSelector({ platform, onChange }: {
  platform: AgentPlatform;
  onChange: (platform: AgentPlatform) => void;
}) {
  return (
    <div className="agent-platform-selector">
      <div className="agent-platform-selector-heading">
        <strong>选择智能体平台 <span style={{ color: 'var(--danger)' }}>*</span></strong>
        <a href="/teacher/guide#ai-agents" target="_blank" rel="noopener noreferrer">
          不知道怎么选？查看平台特点 →
        </a>
      </div>
      <div className="agent-platform-tabs" role="tablist" aria-label="智能体平台">
        {AGENT_PLATFORMS.map(option => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={platform === option.value}
            className={platform === option.value ? 'is-active' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.logo && <Image width={20} height={20} src={`/images/platforms/${option.logo}.png`} alt="" />}
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
