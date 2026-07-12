export type AgentPlatform = 'coze' | 'coze-agent' | 'zhipuai' | 'wenxin';

export const AGENT_PLATFORMS: Array<{
  value: AgentPlatform;
  label: string;
  description: string;
  logo: string;
  color: string;
  badgeBackground: string;
}> = [
  { value: 'coze', label: 'Coze 低代码', description: '字节扣子', logo: 'coze-lowcode', color: '#4f7bc9', badgeBackground: '#f0f4fa' },
  { value: 'coze-agent', label: 'Coze 编程', description: '字节扣子', logo: 'coze-code', color: '#8b6eb5', badgeBackground: '#f5f2fa' },
  { value: 'zhipuai', label: '清言智能体', description: '智谱清言', logo: 'zhipuai', color: '#5d9b8e', badgeBackground: '#f0f7f5' },
  { value: 'wenxin', label: '文心智能体', description: '百度文心', logo: 'wenxin', color: '#c0605a', badgeBackground: '#fdf2f1' },
];

export const AGENT_PLATFORM_MAP = Object.fromEntries(
  AGENT_PLATFORMS.map(platform => [platform.value, platform]),
) as Record<AgentPlatform, (typeof AGENT_PLATFORMS)[number]>;
