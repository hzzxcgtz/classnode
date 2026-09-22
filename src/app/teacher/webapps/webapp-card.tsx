import type { WebappSummary } from '@/lib/types';

interface WebappCardProps {
  webapp: WebappSummary;
  deleting: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 打开「关联课堂」清单。 */
  onShowRelatedClassrooms: () => void;
}

const actionStyle = (danger = false) => ({
  fontSize: '0.688rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #d1d5db', background: 'white', color: danger ? '#ef4444' : '#475569',
  display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
});

/**
 * 一张网页卡片。布局与三按钮照 `agents/agent-card.tsx:63-79`，**但刻意没有「启用」开关** ——
 * 网页没有启用/停用这回事：它被课堂引用才有意义，那是课堂创建路径的属性。
 *
 * ⚠️ 卡片上**只显示入口文件名（`entryPath`），不显示任何 URL**。`entryPath` 是教师上传时
 * 自己的目录里的相对路径，不是地址；把它渲染成 `<a href>` 或补上托管源都会让「托管服务的
 * 地址」出现在界面上，而那是本模块刻意只在服务端拼的东西（规格 §5.3）。
 *
 * ⚠️ 左色条与头像的配色**承载信息**（已被课堂使用 / 一次都没被用过），不是装饰。
 * 从前它对每一张卡片都写死 `#2563eb`，于是教师看不出哪些上传的网页是死资产 ——
 * 而「清理没在用的网页」正是这一页最常做的事。智能体卡片用同一条色条表示启用/停用，
 * 两页是同一条视觉语法。
 */
export function WebappCard({ webapp, deleting, onPreview, onEdit, onDelete, onShowRelatedClassrooms }: WebappCardProps) {
  const createdAt = new Date(webapp.createdAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const used = webapp.classroomCount > 0;

  return (
    <div className={used ? 'card webapp-management-card' : 'card webapp-management-card is-unused'}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: used ? '#2563eb12' : '#f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: used ? '#2563eb' : '#94a3b8',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" />
            <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.938rem', color: '#1a1a2e', marginBottom: 3, wordBreak: 'break-all' }}>{webapp.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.688rem', fontWeight: 600, background: '#f1f5f9', color: '#475569' }}>
              入口 {webapp.entryPath}
            </span>
            <button type="button" className="related-classrooms-chip" onClick={onShowRelatedClassrooms}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              关联课堂
              {used && <span className="related-classrooms-chip-count">{webapp.classroomCount}</span>}
            </button>
          </div>
        </div>
      </div>

      <div className="webapp-management-card-footer" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.688rem', color: '#94a3b8', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{createdAt}</span>
        <div className="webapp-management-card-actions" style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          <button type="button" style={actionStyle()} onClick={onPreview}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            预览
          </button>
          <button type="button" style={actionStyle()} onClick={onEdit}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            改入口
          </button>
          <button type="button" style={actionStyle(true)} onClick={onDelete} disabled={deleting}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            {deleting ? '处理中...' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
