import Image from 'next/image';
import { getApiBaseUrl } from '@/lib/api-base';
import { agentPurposeOf } from '@/lib/agent-purpose';
import type { AgentSummary } from '@/lib/types';
import { AGENT_PLATFORM_MAP, type AgentPlatform } from './agent-platforms';

interface AgentCardProps {
  agent: AgentSummary;
  testing: boolean;
  toggling: boolean;
  deleting: boolean;
  onToggle: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowError: (text: string, top: number, left: number) => void;
  onHideError: () => void;
  /** 打开「关联课堂」清单。 */
  onShowRelatedClassrooms: () => void;
}

const actionStyle = (danger = false) => ({
  fontSize: '0.688rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #d1d5db', background: 'white', color: danger ? '#ef4444' : '#475569',
  display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.6,
});

/**
 * 用途那一枚汉字（学 / 析）。
 *
 * ⚠️ 只在**确实是分析型**时才画「析」；其余一律「学」——
 * `Agent.purpose` 是后加的列，老行可能是 `null` / 缺字段，而那些**本来就是学伴**
 * （与 `normalizeAgentPurpose` 同一条回落方向：认不出就当学伴）。
 *
 * ★ 2026-09-26：判据搬到 `@/lib/agent-purpose` 的 `agentPurposeOf` ——
 * 「用途」筛选要判同一件事，两份拷贝分叉时卡片画「学」而筛选把它归进「分析类」，
 * 静默。**这里只是取用，判据不在这里。**
 */
const PURPOSE_CHIPS: Record<string, { char: string; color: string; bg: string; label: string }> = {
  tutoring: { char: '学', color: '#0e7490', bg: '#ecfeff', label: '学伴' },
  analysis: { char: '析', color: '#7c3aed', bg: '#f5f3ff', label: '分析' },
};

function PurposeChip({ purpose }: { purpose?: string | null }) {
  const meta = PURPOSE_CHIPS[agentPurposeOf(purpose)];
  return (
    <span
      role="img"
      aria-label={`用途：${meta.label}`}
      title={`用途：${meta.label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 18, height: 18, padding: '0 4px', borderRadius: 6,
        fontSize: 10, fontWeight: 700, lineHeight: 1,
        background: meta.bg, color: meta.color, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <span aria-hidden="true">{meta.char}</span>
    </span>
  );
}

export function AgentCard({ agent, testing, toggling, deleting, onToggle, onTest, onEdit, onDelete, onShowError, onHideError, onShowRelatedClassrooms }: AgentCardProps) {
  const platform = AGENT_PLATFORM_MAP[agent.platform as AgentPlatform];
  const color = platform?.color || '#64748b';
  const enabled = agent.enabled !== false;
  const checkedAt = agent.lastCheckAt
    ? new Date(agent.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="card agent-management-card" style={{ borderLeft: `5px solid ${enabled ? color : '#e2e8f0'}`, padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0, background: enabled ? `${color}12` : '#f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700,
          color: enabled ? color : '#94a3b8', overflow: 'hidden',
        }}>
          {agent.logo ? <Image unoptimized width={44} height={44} src={agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : agent.name[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ★ 2026-09-25（教师截图批注）：「这里可以加个类别『学』『析』」，
              随后又定了位置：「还是加到智能体名称后面吧」。
              🔴 值得它的理由：一排卡片扫过去时，**学伴**与**分析**是两种完全不同的东西 ——
              后者**绝不会出现在学生的列表里**（`Agent.purpose` 那道闸）—— 而它们在卡片上
              原本长得一模一样，只看名字看不出来。
              ⚠️ 挂在**名称这一行**而不是标签行：它是这个名字的**属性**，不是一项能力标签。
              ⚠️ 颜色与**课堂看板那枚模块字**同源（`classroom/page.tsx` 的 `ModuleInitialChip`）：
              学伴用学生端「智能学伴」的青色，分析用与「深度思考」同族的紫色 ——
              同一件事在两页认到的颜色必须是同一个（§4.6 立过的规矩）。
              ⚠️ 无障碍：光秃秃一个「学」对读屏无意义 ⇒ `role="img"` + `aria-label`，
              汉字本身 `aria-hidden`（本仓立过「图标化只减视觉宽度、不减无障碍信息」）。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: '0.938rem', color: '#1a1a2e', minWidth: 0, wordBreak: 'break-word' }}>{agent.name}</span>
            <PurposeChip purpose={agent.purpose} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.688rem', fontWeight: 600, background: platform?.badgeBackground || '#f1f5f9', color }}>
              {platform?.label || agent.platform}
            </span>
            {['coze-agent', 'wenxin'].includes(agent.platform) && <CapabilityTag>纯文字</CapabilityTag>}
            {agent.platform === 'wenxin' && <CapabilityTag>非流式</CapabilityTag>}
            {/*
              关联课堂入口。⚠️ 这里**刻意不**用左色条表达「被几个课堂用着」——
              智能体卡片的左色条已经承载「启用/停用」（那是这一页的主状态），
              再叠一层语义会让两种状态互相盖住。网页页没有启用概念，所以那边
              让色条承载使用状态。两页这点**故意不同**，不是不一致。
              ⚠️ 计数只在确实有值时才渲染：显示硬凑的 0 会让「数据没读到」和
              「读了、确实是 0」长得一样。
            */}
          </div>
          {/* ★ 2026-09-25（教师截图批注）：「这个直接放下一行，和右边一样」。
              🔴 原委与**网页卡片**那一处逐字相同（同一个 `flexWrap` 行、同一种观感事故）：
              它与平台标签挤在**同一个会换行的行**里 —— 标签少就并排（截图右边那张），
              标签多就掉到下一行（左边那张）。⇒ 同一个组件在不同数据下**行数不一样**，
              一排卡片扫过去是散的。
              现在**结构固定**：平台标签自己一行，关联课堂自己一行，与标签多少无关。 */}
          <div style={{ marginTop: 5 }}>
            <button type="button" className="related-classrooms-chip" onClick={onShowRelatedClassrooms}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              关联课堂
              {typeof agent.classroomCount === 'number' && agent.classroomCount > 0 && (
                <span className="related-classrooms-chip-count">{agent.classroomCount}</span>
              )}
            </button>
          </div>
        </div>
        <button type="button" onClick={onToggle} aria-pressed={enabled} aria-label={`${enabled ? '停用' : '启用'}${agent.name}`} style={{
          flexShrink: 0, marginTop: 2, position: 'relative', width: 40, height: 22, borderRadius: 11,
          border: 'none', cursor: 'pointer', background: enabled ? '#22c55e' : '#d1d5db', transition: 'background 0.2s', padding: 0,
        }} title={enabled ? '点击停用' : '点击启用'} disabled={toggling}>
          <span style={{ position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transition: 'left 0.2s' }} />
        </button>
      </div>

      {testing && <div style={{ marginTop: 8, height: 3, borderRadius: 2, overflow: 'hidden', background: '#e2e8f0', position: 'relative' }}><div style={{ position: 'absolute', inset: 0, width: '40%', background: 'linear-gradient(90deg, #6366f1, #3b82f6)', borderRadius: 2, animation: 'indeterminate 1.2s ease-in-out infinite' }} /></div>}

      <div className="agent-management-card-footer" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {!enabled ? <Status color="#94a3b8" label="停用" />
            : !checkedAt ? <Status color="#d1d5db" label="未检测" />
              : agent.lastCheckOk ? <><Status color="#22c55e" label="健康" labelColor="#16a34a" /><Time>{checkedAt}</Time></>
                : <><Status color="#ef4444" label="异常" labelColor="#dc2626" error onMouseEnter={event => {
                  if (!agent.lastCheckError) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  onShowError(agent.lastCheckError, rect.top - 8, rect.left + rect.width / 2);
                }} onMouseLeave={onHideError} /><Time>{checkedAt}</Time></>}
        </div>
        <div className="agent-management-card-actions" style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          {enabled && <button type="button" style={actionStyle()} onClick={onTest} disabled={testing}><RefreshIcon spinning={testing} />{testing ? '检测中...' : '测试'}</button>}
          <button type="button" style={actionStyle()} onClick={onEdit} disabled={toggling || deleting}><EditIcon />编辑</button>
          <button type="button" style={actionStyle(true)} onClick={onDelete} disabled={deleting || toggling}><DeleteIcon />{deleting ? '处理中...' : '删除'}</button>
        </div>
      </div>
    </div>
  );
}

function CapabilityTag({ children }: { children: React.ReactNode }) { return <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: '0.625rem', fontWeight: 500, color: '#94a3b8', border: '0.5px solid #e2e8f0' }}>{children}</span>; }
function Time({ children }: { children: React.ReactNode }) { return <span style={{ fontSize: '0.688rem', color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>{children}</span>; }
function Status({ color, label, labelColor, error, onMouseEnter, onMouseLeave }: { color: string; label: string; labelColor?: string; error?: boolean; onMouseEnter?: React.MouseEventHandler<HTMLSpanElement>; onMouseLeave?: () => void }) { return <><span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} /><span onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ fontSize: '0.688rem', color: labelColor || '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap', cursor: error ? 'help' : undefined, borderBottom: error ? '1px dashed #fca5a5' : undefined }}>{label}</span></>; }
function RefreshIcon({ spinning }: { spinning: boolean }) { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function EditIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function DeleteIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
