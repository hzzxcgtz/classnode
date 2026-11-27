import { externalWebappHref } from '@/lib/external-webapp';
import type { WebappSummary } from '@/lib/types';

interface WebappCardProps {
  webapp: WebappSummary;
  deleting: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  retryingMedia: boolean;
  onRetryMedia: () => void;
  /** 打开「关联课堂」清单。 */
  onShowRelatedClassrooms: () => void;
}

const actionStyle = (danger = false) => ({
  fontSize: "0.75rem", padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #d1d5db', background: 'white', color: danger ? '#a85d5d' : '#475569',
  display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
});

/**
 * 一张网页卡片。布局与三按钮照 `agents/agent-card.tsx:63-79`，**但刻意没有「启用」开关** ——
 * 网页没有启用/停用这回事：它被课堂引用才有意义，那是课堂创建路径的属性。
 *
 * 上传的网页显示入口文件名；外部网页提供新标签页链接。
 *
 * 探究网页采用「柔和标题区 + 白色内容区」，头部按单文件 / 多文件区分，
 * 引用状态改用带文字的按钮明确表达，避免让一条颜色同时承担类别与状态两种含义。
 */
export function WebappCard({ webapp, deleting, onPreview, onEdit, onDelete, onShowRelatedClassrooms, retryingMedia, onRetryMedia }: WebappCardProps) {
  const createdAt = new Date(webapp.createdAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const externalHref = externalWebappHref(webapp.externalUrl);
  const used = webapp.classroomCount > 0;
  const fileKind = webapp.fileCount === 1 ? 'single' : (webapp.fileCount ?? 0) > 1 ? 'multiple' : 'unknown';
  const fileKindLabel = fileKind === 'single' ? '单文件' : fileKind === 'multiple' ? '多文件' : '';

  return (
    <div className={used ? 'card webapp-management-card' : 'card webapp-management-card is-unused'} data-file-kind={fileKind}>
      <div className="webapp-management-card-header">
        <div className="webapp-management-card-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" />
            <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
          </svg>
        </div>
        <div className="webapp-management-card-heading">
          <div className="webapp-management-card-title">{webapp.name}</div>
          <span className="webapp-management-card-created">{webapp.externalUrl ? '添加于' : '上传于'} {createdAt}{fileKindLabel && ` · ${fileKindLabel}`}</span>
        </div>
      </div>

      <div className="webapp-management-card-body">
        {webapp.mediaStatus === 'https-required' && (
          <p className="webapp-management-media-status">设备权限已保存。<a href="/teacher/settings/?tab=network">启用学生课堂 HTTPS</a>后生效。</p>
        )}
        {webapp.mediaStatus === 'port-unavailable' && (
          <div className="webapp-management-media-status">
            <span>设备权限已保存，专用 HTTPS 端口启动失败。</span>
            <button type="button" className="btn btn-secondary" disabled={retryingMedia} onClick={onRetryMedia}>
              {retryingMedia ? '正在重试…' : '重试启动'}
            </button>
          </div>
        )}
        <div className="webapp-management-card-meta">
          <span className="webapp-management-entry-chip" title={webapp.externalUrl ?? webapp.entryPath}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h.01M11 8h.01" /><path d="M3 11h18" />
            </svg>
            {webapp.externalUrl ? '外部链接' : `入口 ${webapp.entryPath}`}
          </span>
          <button type="button" className="related-classrooms-chip webapp-management-usage-chip" onClick={onShowRelatedClassrooms}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            {used ? `已用于 ${webapp.classroomCount} 个课堂` : '尚未使用'}
          </button>
        </div>

        <div className="webapp-management-card-footer">
          <div className="webapp-management-card-actions">
            {webapp.externalUrl ? (
              externalHref && <a style={actionStyle()} href={externalHref} target="_blank" rel="noopener noreferrer">打开链接 ↗</a>
            ) : (
              <button type="button" style={actionStyle()} onClick={onPreview}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                预览
              </button>
            )}
            <button type="button" style={actionStyle()} onClick={onEdit}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              编辑
            </button>
            <button type="button" style={actionStyle(true)} onClick={onDelete} disabled={deleting}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              {deleting ? '处理中...' : '删除'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
