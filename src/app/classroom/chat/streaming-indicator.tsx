import { memo, useMemo } from 'react';
import { Markdown, stripImages } from '@/lib/markdown';
import { AgentAvatar } from './agent-avatar';
import type { ChatAgent } from '../classroom-types';
import styles from '../chat.module.css';

export interface StreamingIndicatorProps {
  streamingContent: string;
  agent: ChatAgent;
  apiBase: string;
}

export const StreamingIndicator = memo(function StreamingIndicator({
  streamingContent, agent, apiBase,
}: StreamingIndicatorProps) {
  const strippedContent = useMemo(() => stripImages(streamingContent), [streamingContent]);
  return (
    <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
      <div className={styles.messageAuthor}>
        <div className={styles.messageAvatar}>
          <AgentAvatar size={40} borderRadius={12} fontSize={17} agent={agent} apiBase={apiBase} />
        </div>
        <span>{agent?.name || 'AI助手'}</span>
        <small>正在组织回答</small>
      </div>
      <div className={`${styles.messageBubble} ${styles.assistantBubble} ${styles.streamingBubble}`}>
        {strippedContent ? (
          <Markdown streaming allowImages={false}>{strippedContent}</Markdown>
        ) : (
          <span style={{
            fontSize: "0.875rem", color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 0,
            lineHeight: '18px',
          }}>
            <span style={{ animation: 'thinkingWave 1.4s ease-in-out infinite' }}>正</span>
            <span style={{ animation: 'thinkingWave 1.4s 0.2s ease-in-out infinite' }}>在</span>
            <span style={{ animation: 'thinkingWave 1.4s 0.4s ease-in-out infinite' }}>思</span>
            <span style={{ animation: 'thinkingWave 1.4s 0.6s ease-in-out infinite' }}>考</span>
            <span style={{ animation: 'thinkingWave 1.4s 0.8s ease-in-out infinite', marginLeft: 2 }}>·</span>
            <span style={{ animation: 'thinkingWave 1.4s 1.0s ease-in-out infinite' }}>·</span>
            <span style={{ animation: 'thinkingWave 1.4s 1.2s ease-in-out infinite' }}>·</span>
          </span>
        )}
      </div>
    </div>
  );
});
