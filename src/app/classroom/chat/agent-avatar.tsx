import { memo } from 'react';
import type { ChatAgent } from '../classroom-types';

export interface AgentAvatarProps {
  size: number;
  borderRadius?: number;
  fontSize?: number;
  agent: ChatAgent;
  apiBase: string;
}

export const AgentAvatar = memo(function AgentAvatar({
  size, borderRadius = 8, fontSize = 13, agent, apiBase,
}: AgentAvatarProps) {
  const logoUrl = agent?.logo
    ? (agent.logo.startsWith('/') ? `${apiBase}${agent.logo}` : agent.logo)
    : null;
  if (logoUrl) {
    return <img src={logoUrl} alt="" style={{ width: size, height: size, borderRadius, objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius,
      background: 'linear-gradient(135deg, #667eea, #764ba2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize, color: 'white', fontWeight: 700, flexShrink: 0,
    }}>
      {agent?.name?.[0] || 'AI'}
    </div>
  );
});
