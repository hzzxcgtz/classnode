import { memo, useState } from 'react';
import { Markdown } from '@/lib/markdown';
import { AgentAvatar } from './agent-avatar';
import type { ChatAgent } from '../classroom-types';
import styles from '../chat.module.css';

export interface ThinkingContentProps {
  content: string;
  agent: ChatAgent;
  apiBase: string;
}

/** 深度思考过程展示组件 */
export const ThinkingContent = memo(function ThinkingContent({
  content, agent, apiBase,
}: ThinkingContentProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
      <div className={styles.messageAuthor}>
        <div className={styles.messageAvatar}>
          <AgentAvatar size={40} borderRadius={12} fontSize={17} agent={agent} apiBase={apiBase} />
        </div>
        <span>{agent?.name || 'AI助手'}</span>
        <small>深度思考</small>
      </div>
      <div style={{
        maxWidth: '78%', padding: 0,
        borderRadius: '6px 18px 18px 18px',
        background: '#faf5ff', color: '#5b21b6',
        border: '1px solid #e9d5ff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        lineHeight: 1.7, fontSize: "0.813rem", wordBreak: 'break-word',
      }}>
        <button type="button" onClick={() => setCollapsed(prev => !prev)} aria-expanded={!collapsed}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px',
            cursor: 'pointer', userSelect: 'none',
            borderBottom: collapsed ? 'none' : '1px solid #e9d5ff',
            color: '#7c3aed', fontWeight: 600, fontSize: "0.75rem",
            width: '100%', border: 'none', background: 'transparent', textAlign: 'left',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/>
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>
          </svg>
          深度思考过程
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {!collapsed && (
          <div style={{
            padding: '10px 14px',
            fontSize: "0.813rem", color: '#6d28d9', lineHeight: 1.8,
            fontStyle: 'italic',
            opacity: 0.85,
          }}>
            <Markdown>{content}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
});
