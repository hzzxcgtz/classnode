import { memo, useCallback, useState } from 'react';
import { Markdown, stripImages } from '@/lib/markdown';
import { SvgAvatar } from './svg-avatar';
import { AgentAvatar } from './agent-avatar';
import type { ChatAgent, StudentChatMessage } from '../classroom-types';
import styles from '../chat.module.css';

export interface MessageItemProps {
  msg: StudentChatMessage;
  studentName: string;
  agent: ChatAgent;
  apiBase: string;
  avatarSvg?: string;
  onImageClick?: (url: string) => void;
  onRevise?: (content: string) => void;
  allowExport?: boolean;
  msgIndex?: number;
  onFollowUp?: (question: string) => void;
  allowFollowUps?: boolean;
  allowStudentStop?: boolean;
  isRespondingToThis?: boolean;
  aiResponding?: boolean;
}

export const MessageItem = memo(function MessageItem({
  msg, studentName, agent, apiBase, avatarSvg, onImageClick, onRevise, allowExport, msgIndex, onFollowUp, allowFollowUps, allowStudentStop, isRespondingToThis, aiResponding,
}: MessageItemProps) {
  const fileSources = msg.fileUrls || (msg.fileUrl ? [msg.fileUrl] : []);
  const followUps = msg.followUps ?? [];
  const [toast, setToast] = useState<string | null>(null);

  const handleCopy = useCallback(() => {
    const raw = msg.content || '';
    navigator.clipboard.writeText(raw).then(() => {
      setToast('已复制');
      setTimeout(() => setToast(null), 1500);
    }).catch(() => setToast('复制失败'));
  }, [msg.content]);

  const handleExportWord = useCallback(async () => {
    const raw = msg.content || '';
    const agentName = agent?.name || 'AI助手';
    const ts = msg.createdAt ? new Date(msg.createdAt).toLocaleString('zh-CN') : undefined;
    // DOCX is large and is not needed while joining a classroom. Loading it on
    // demand keeps the initial student bundle small enough for older iPads.
    const { exportMessageToWord } = await import('@/lib/export-doc');
    exportMessageToWord(raw, agentName, ts);
  }, [msg.content, msg.createdAt, agent]);

  return (
    <div data-msg-id={msg.role === 'user' && msgIndex !== undefined ? msgIndex : undefined} className={`${styles.messageRow} ${msg.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant}`}>
      {msg.role === 'assistant' && (
        <div className={styles.messageAuthor}>
          <div className={styles.messageAvatar}>
            <AgentAvatar size={40} borderRadius={12} fontSize={17} agent={agent} apiBase={apiBase} />
          </div>
          <span>{agent?.name || 'AI助手'}</span>
          <small>正在和你一起思考</small>
        </div>
      )}
      {msg.role === 'user' && studentName && (
        <div className={`${styles.messageAuthor} ${styles.messageAuthorUser}`}>
          {avatarSvg ? (
            <div className={styles.studentMessageAvatar}>
              <SvgAvatar svg={avatarSvg} size={40} fallback={studentName[0]} />
            </div>
          ) : (
            <div className={styles.studentAvatarFallback}>
              {studentName[0]}
            </div>
          )}
          <span>{studentName}</span>
        </div>
      )}
      <div data-msg-content className={`${styles.messageBubble} ${msg.role === 'user' ? styles.userBubble : msg.role === 'system' ? styles.systemBubble : styles.assistantBubble}`}>
        {fileSources.map((fu: string, fi: number) => (
          <div key={fi} style={{ marginBottom: 8 }}>
            {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
              <img src={`${apiBase}${fu}`} alt={(msg.fileNames?.[fi]) || msg.fileName || ''}
                onClick={() => onImageClick?.(`${apiBase}${fu}`)}
                style={{ maxWidth: 220, maxHeight: 160, borderRadius: 10, objectFit: 'cover', display: 'block', cursor: 'pointer', transition: 'opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }} />
            ) : (
              <div style={{ padding: '8px 12px', background: msg.role === 'user' ? 'rgba(255,255,255,0.15)' : '#f3f4f6', borderRadius: 8, fontSize: "0.813rem", display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                {(msg.fileNames?.[fi]) || msg.fileName || '文件'}
              </div>
            )}
          </div>
        ))}
        {msg.role === 'system' ? (
          <span>{msg.content}</span>
        ) : (
          <Markdown>{msg.fileUrls?.length ? stripImages(msg.content) : msg.content}</Markdown>
        )}
      </div>
      {msg.role === 'assistant' && allowExport !== false && (
        <div className={styles.messageActions}>
          <button onClick={handleCopy} className={styles.messageAction}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制
          </button>
          <button onClick={handleExportWord} className={styles.messageAction}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            导出
          </button>
          {toast && (
            <span style={{ fontSize: "0.688rem", color: '#10b981', animation: 'notifSlideUp 0.3s ease-out' }}>{toast}</span>
          )}
        </div>
      )}
      {/* 追问建议按钮 */}
      {msg.role === 'assistant' && onFollowUp && followUps.length > 0 && allowFollowUps !== false && (
        <div className={styles.followUps}>
          {followUps.map((q, i: number) => (
            <button key={i} onClick={() => onFollowUp(q)} className={styles.followUpButton}>
              <span aria-hidden="true">↗</span>
              {q}
            </button>
          ))}
        </div>
      )}
      {msg.role === 'user' && onRevise && (!aiResponding || (isRespondingToThis && allowStudentStop !== false)) && (
        <div className={`${styles.messageActions} ${styles.messageActionsUser}`}>
          <button
            onClick={() => onRevise(msg.content || '')}
            className={`${styles.messageAction} ${styles.reviseAction} ${isRespondingToThis ? styles.reviseActionActive : ''}`}
            title={isRespondingToThis ? '停止当前回答，并将问题放回输入框修改' : '将这条问题放回输入框修改后重新发送'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            {isRespondingToThis ? '停止并修改' : '修改后重发'}
          </button>
        </div>
      )}
    </div>
  );
});
