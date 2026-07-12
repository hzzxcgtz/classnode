export interface AgentErrorTipData { text: string; top: number; left: number }

export function AgentDeleteBlockedDialog({ agentName, onClose }: { agentName: string; onClose: () => void }) {
  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content" role="alertdialog" aria-modal="true" aria-labelledby="delete-blocked-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 400, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <div style={{ textAlign: 'center', marginBottom: 20 }}><div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fef2f2', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 id="delete-blocked-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px' }}>无法删除智能体</h3><p style={{ fontSize: '0.813rem', color: '#64748b', margin: 0 }}>该智能体正在被课堂使用中，请先删除关联的课堂后再试。</p></div>
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}><div style={{ fontSize: '0.813rem', fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>「{agentName}」</div><div style={{ fontSize: '0.813rem', color: '#b91c1c' }}>该智能体已被配置到课堂中使用，无法直接删除。</div></div>
    <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}

export function AgentErrorTip({ tip }: { tip: AgentErrorTipData }) {
  return <div role="tooltip" style={{ position: 'fixed', top: tip.top, left: tip.left, transform: 'translate(-50%, -100%)', background: '#1e293b', color: '#f1f5f9', padding: '6px 10px', borderRadius: 6, fontSize: '0.688rem', whiteSpace: 'normal', wordBreak: 'break-all', maxWidth: 260, lineHeight: 1.5, boxShadow: '0 4px 12px rgba(0,0,0,0.25)', zIndex: 9999, pointerEvents: 'none' }}>{tip.text}</div>;
}
