import type { WorksheetSummary } from '@/lib/types';

interface WorksheetCardProps {
  worksheet: WorksheetSummary;
  deleting: boolean;
  duplicating: boolean;
  /** 打开编辑器（`/teacher/worksheets/edit/?id=…`）。标题与「编辑」按钮走同一条路。 */
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** 打开「引用情况」清单（哪些课堂 / 小组在用、收到多少份作答）。 */
  onShowUsage: () => void;
}

const actionStyle = (danger = false) => ({
  fontSize: '0.688rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #d1d5db', background: 'white', color: danger ? '#ef4444' : '#475569',
  display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
});

/**
 * 一张学习单卡片。布局与三按钮照 `webapps/webapp-card.tsx:32`，**但主点击动作不同**：
 * 网页那张卡的主动作是「预览」（一个弹窗），学习单这张是**跳转到编辑器**
 * （`/teacher/worksheets/edit/?id=…`）—— 学习单的内容改起来是一件独立的、要占满屏的事，
 * 塞进弹窗既不合适也做不到。
 *
 * ⚠️ 入口是**查询参数**不是路径段：本项目 `output: 'export'` 静态导出，没有任何动态路由
 * （`find src/app -name '[*]'` 为空），`/teacher/worksheets/edit/1` 这种地址根本生成不出来。
 * 全仓的同类跳转都是这个写法（`classroom/new/page.tsx:354` 的 `/teacher/classroom?id=`）。
 *
 * 学习单采用「柔和标题区 + 白色内容区」：它与智能体、探究网页不是同一种资产，
 * 不再强行复用左色条。引用状态改用带文字的按钮明确表达，避免只靠颜色传递信息。
 */
export function WorksheetCard({ worksheet, deleting, duplicating, onOpen, onDuplicate, onDelete, onShowUsage }: WorksheetCardProps) {
  const updatedAt = new Date(worksheet.updatedAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const used = worksheet.classroomCount > 0;

  return (
    <div className={used ? 'card worksheet-management-card' : 'card worksheet-management-card is-unused'}>
      <div className="worksheet-management-card-header">
        <div className="worksheet-management-card-icon">
          {/* 学习单 = 一张带勾选框的纸。图标与「探究网页」的地球刻意不同 —— 两页的卡片
              在列表里并排出现时，教师靠图标分辨哪张是哪一类的资产。 */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
            <rect x="9" y="2" width="6" height="4" rx="1" />
            <path d="M8 11l1.5 1.5L12 10" /><path d="M8 17l1.5 1.5L12 16" />
            <line x1="15" y1="12" x2="17" y2="12" /><line x1="15" y1="18" x2="17" y2="18" />
          </svg>
        </div>
        <div className="worksheet-management-card-heading">
          {/*
            标题是个按钮而不是纯文本：这一页最常做的事就是打开编辑器，让整块标题可点
            比逼教师去找右下角那个小按钮顺手得多。它长得仍然像标题（下面那条
            `.worksheet-management-card-title` 只管 hover / focus 的提示）。
          */}
          <button
            type="button"
            className="worksheet-management-card-title"
            onClick={onOpen}
            title="打开编辑器"
          >
            {worksheet.title}
          </button>
          <span className="worksheet-management-card-updated">更新于 {updatedAt}</span>
        </div>
      </div>

      <div className="worksheet-management-card-body">
        {worksheet.description && (
          <div className="worksheet-management-card-description">
            {worksheet.description}
          </div>
        )}

        <div className="worksheet-management-card-meta">
          <span className="worksheet-management-question-count">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            {worksheet.questionCount} 题
          </span>
          <button type="button" className="related-classrooms-chip worksheet-management-usage-chip" onClick={onShowUsage}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            {used ? `已用于 ${worksheet.classroomCount} 个课堂` : '尚未使用'}
          </button>
        </div>

        <div className="worksheet-management-card-footer">
          <div className="worksheet-management-card-actions">
            <button type="button" style={actionStyle()} onClick={onOpen}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              编辑
            </button>
            <button type="button" style={actionStyle()} onClick={onDuplicate} disabled={duplicating}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {duplicating ? '复制中...' : '复制一份'}
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
