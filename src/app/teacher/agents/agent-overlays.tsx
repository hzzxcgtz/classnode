import { RelatedClassroomList } from '@/lib/components';
import { agentPurposeOf } from '@/lib/agent-purpose';
import type { RelatedClassroom, RelatedWorksheet } from '@/lib/types';

export interface AgentErrorTipData { text: string; top: number; left: number }

/** Show every actual reference, including worksheets that only use this agent for analysis. */
export function AgentDeleteBlockedDialog({ agentName, classrooms, worksheets, onClose }: {
  agentName: string;
  classrooms: RelatedClassroom[];
  worksheets: RelatedWorksheet[];
  onClose: () => void;
}) {
  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content teacher-dialog teacher-dialog-alert" role="alertdialog" aria-modal="true" aria-labelledby="delete-blocked-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 440, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <div style={{ textAlign: 'center', marginBottom: 20 }}><div style={{ width: 52, height: 52, borderRadius: '50%', background: '#f8eeee', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a85d5d" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 id="delete-blocked-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px' }}>无法删除智能体</h3><p style={{ fontSize: '0.813rem', color: 'var(--text-secondary, #475569)', margin: 0 }}>「{agentName}」仍有关联，请先取消关联后再删除。</p></div>
    <div style={{maxHeight:'50vh',overflowY:'auto',marginBottom:20,display:'grid',gap:12}}>
      {classrooms.length > 0 && <section style={{border:'1px solid #dce5ee',borderRadius:10,padding:'14px 16px'}}>
        <h4 style={{margin:'0 0 8px',fontSize:'.85rem'}}>关联课堂 · {classrooms.length}</h4>
        <RelatedClassroomList classrooms={classrooms} emptyText="没有关联课堂" />
      </section>}
      {worksheets.length > 0 && <section style={{border:'1px solid #dce5ee',borderRadius:10,padding:'14px 16px'}}>
        <h4 style={{margin:'0 0 8px',fontSize:'.85rem'}}>关联学习单 · {worksheets.length}</h4>
        <p style={{margin:'0 0 8px',fontSize:'.8rem',color:'#71849a'}}>在学习单设置中更换或取消分析智能体。</p>
        <ul style={{listStyle:'none',padding:0,margin:0}}>{worksheets.map(worksheet => <li key={worksheet.id}
          style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'8px 0'}}>
          <span style={{fontSize:'.85rem',overflowWrap:'anywhere'}}>{worksheet.title || '未命名学习单'}</span>
          <a href={`/teacher/worksheets/edit/?id=${encodeURIComponent(worksheet.id)}`} style={{flexShrink:0,fontSize:'.8rem',color:'#3b628d'}}>打开学习单</a>
        </li>)}</ul>
      </section>}
      {!classrooms.length && !worksheets.length && <p role="status">关联信息已变化，请关闭后重试。</p>}
    </div>
    <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}

/**
 * 卡片上那个 chip 打开的清单。
 *
 * ★ 2026-10-08（教师）：「（分析型那张卡上）这里应该是**查看关联的学习单**。」
 * ⇒ 同一处入口按 `purpose` 分流：
 *   · **分析型** → 列学习单（来源是 `Worksheet.settings.analysisAgentId`，不是关联表，
 *     见 `RelatedWorksheet` 的注释）；
 *   · **学伴型** → 列课堂（与原来一致，走 `ClassroomAgent` / 组级材料）。
 * ⚠️ 两张清单在**同一次** usage 请求里一起回来，所以这里不做二次请求。
 * 删除拦截弹窗单独展示所有引用，不按智能体用途隐藏关联。
 */
export function AgentRelatedClassroomsDialog({ agentName, purpose, classrooms, worksheets, loading, onClose }: {
  agentName: string;
  purpose?: string | null;
  classrooms: RelatedClassroom[];
  worksheets: RelatedWorksheet[];
  loading: boolean;
  onClose: () => void;
}) {
  const showsWorksheets = agentPurposeOf(purpose) === 'analysis';
  const pending = <div className="related-classroom-list is-pending"><span className="related-classroom-hint">正在读取…</span></div>;
  const emptyWorksheets = (
    <div className="related-classroom-list is-empty">
      <span className="related-classroom-hint">还没有学习单指定它做分析</span>
    </div>
  );
  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content teacher-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-related-classrooms-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 440, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <h3 id="agent-related-classrooms-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px', wordBreak: 'break-all' }}>
      「{agentName}」关联的{showsWorksheets ? '学习单' : '课堂'}
    </h3>
    <p style={{ fontSize: '0.813rem', color: 'var(--text-secondary, #475569)', margin: '0 0 16px' }}>
      {showsWorksheets ? '学习单可以在编辑页里指定由它做分析。' : '教师可以在「新建课堂」里为课堂勾选智能体。'}
    </p>
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '4px 14px', marginBottom: 20 }}>
      {showsWorksheets
        ? (loading ? pending : worksheets.length === 0 ? emptyWorksheets : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {worksheets.map((worksheet) => (
              <li key={worksheet.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: '0.813rem', color: '#334155', wordBreak: 'break-all' }}>{worksheet.title || '未命名学习单'}</span>
                <a href={`/teacher/worksheets/edit/?id=${worksheet.id}`} style={{ fontSize: "0.75rem", color: '#3f6fa8', flex: '0 0 auto', textDecoration: 'none' }}>打开学习单</a>
              </li>
            ))}
          </ul>
        ))
        : <RelatedClassroomList classrooms={classrooms} loading={loading} emptyText="还没有课堂关联这个智能体" />}
    </div>
    <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}

export function AgentErrorTip({ tip }: { tip: AgentErrorTipData }) {
  return <div className="teacher-floating-tip" role="tooltip" style={{ position: 'fixed', top: tip.top, left: tip.left, transform: 'translate(-50%, -100%)', maxWidth: 260, zIndex: 9999, pointerEvents: 'none' }}>{tip.text}</div>;
}
