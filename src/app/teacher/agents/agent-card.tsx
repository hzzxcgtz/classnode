import Image from 'next/image';
import type { CSSProperties } from 'react';
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
  /** 打开关联清单弹窗（分析型列学习单、学伴型列课堂，见卡片上那个 chip）。 */
  onShowRelatedClassrooms: () => void;
}

const actionStyle = (danger = false) => ({
  fontSize: '0.688rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #d1d5db', background: 'white', color: danger ? '#a95757' : '#475569',
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
  const purpose = agentPurposeOf(agent.purpose);
  const enabled = agent.enabled !== false;
  const checkedAt = agent.lastCheckAt
    ? new Date(agent.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  const cardStyle = {
    '--agent-platform-color': color,
    '--agent-platform-soft': platform?.badgeBackground || '#f1f5f9',
    '--agent-platform-border': platform?.cardBorder || '#dbe3ee',
  } as CSSProperties;

  return (
    <div className="card agent-management-card" style={cardStyle}>
      <div className="agent-management-card-header">
        <div className="agent-management-card-avatar">
          {agent.logo ? <Image unoptimized width={46} height={46} src={agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo} alt="" /> : agent.name[0]}
        </div>
        <div className="agent-management-card-heading">
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
          <div className="agent-management-card-name-row">
            <span className="agent-management-card-name">{agent.name}</span>
            <PurposeChip purpose={agent.purpose} />
          </div>
          <div className="agent-management-card-tags">
            <span className="agent-management-platform-badge">
              {platform?.label || agent.platform}
            </span>
            {['coze-agent', 'wenxin'].includes(agent.platform) && <CapabilityTag>纯文字</CapabilityTag>}
            {agent.platform === 'wenxin' && <CapabilityTag>非流式</CapabilityTag>}
          </div>
        </div>
        <button type="button" onClick={onToggle} aria-pressed={enabled} aria-label={`${enabled ? '停用' : '启用'}${agent.name}`} className={`agent-management-toggle${enabled ? ' is-enabled' : ''}`} title={enabled ? '点击停用' : '点击启用'} disabled={toggling}>
          <span />
        </button>
      </div>

      <div className="agent-management-card-body">
        <div className="agent-management-card-meta">
          {/*
            ⊘ 2026-10-08（教师）：「这两个都不要显示了」——**去掉那句话、留小汉字**。
              原话是「「教师分析型智能体」改为「智能分析类」、「课堂学生学伴」改为「智能学伴类」」，
              但「智能学伴」在本仓**已经是一个课堂模块名**（`module-meta.tsx` 的 `companion`，
              学生端 Tab 上直接显示）⇒ 改了会撞名、学生会同时看到两个「智能学伴」。
              教师权衡后选了「都不要显示」。
            ⚠️ 留下的那枚小汉字是 `PurposeChip`（卡片标题旁，`学` / `析`）—— **没有**一起删。
            ⚠️ 这一句是**唯一**的字面拷贝（`purpose === 'analysis' ? … : …` 是运行时拼的），
              删掉它之后，"这一档叫什么"只由 `PurposeChip` 与筛选项（`学习类` / `分析类`）承担。
          */}
          <button type="button" className="related-classrooms-chip agent-management-classrooms-chip" onClick={onShowRelatedClassrooms}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            {/*
              ★ 2026-10-08（教师）：「这里应该是查看关联的学习单」。
              ⇒ 分析型说**学习单**、学伴型仍说**课堂** —— 两条关系本来就不是一回事：
                分析型靠 `Worksheet.settings.analysisAgentId`，学伴型靠 `ClassroomAgent`。
              ⚠️ 数字（`classroomCount`）只有学伴型那一条有：学习单的**条数**要点了才知道
                （清单在弹窗里跟同一次 usage 请求一起回来）。所以分析型这一档**不显示数字**,
                而不是显示一个可能失真的 `0`。
            */}
            {purpose === 'analysis'
              ? '关联学习单'
              : typeof agent.classroomCount === 'number' ? (agent.classroomCount > 0 ? '关联课堂' : '未关联课堂') : '关联课堂'}
            {/*
              ★ 2026-10-08 第二批（教师）：「这个数据取不到吗？」⇒ 取得到，而且要显示出来。
              分析型那颗 chip 现在也带条数（`worksheetCount` 由列表接口算出）。
              ⚠️ 分析型**不显示** `classroomCount`（那是另一条关系），学伴型**不显示**
                `worksheetCount` —— 两条关系的数字混在一起才是真的说不清。
            */}
            {purpose === 'analysis' && typeof agent.worksheetCount === 'number' && agent.worksheetCount > 0 && (
              <span className="related-classrooms-chip-count">{agent.worksheetCount}</span>
            )}
            {purpose !== 'analysis' && typeof agent.classroomCount === 'number' && agent.classroomCount > 0 && (
              <span className="related-classrooms-chip-count">{agent.classroomCount}</span>
            )}
          </button>
        </div>

        {testing && <div className="agent-management-test-progress"><span /></div>}

        <div className="agent-management-status-row">
          <div className="agent-management-status-copy">
            {!enabled ? <Status color="#94a3b8" label="已停用" />
              : !checkedAt ? <Status color="#cbd5e1" label="尚未检测" />
                : agent.lastCheckOk ? <Status color="#3f8866" label="连接健康" labelColor="#3f8866" />
                  : <Status color="#b85d5d" label="连接异常" labelColor="#a94f4f" error onMouseEnter={event => {
                    if (!agent.lastCheckError) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    onShowError(agent.lastCheckError, rect.top - 8, rect.left + rect.width / 2);
                  }} onMouseLeave={onHideError} />}
          </div>
          {checkedAt && <Time>{checkedAt} 检测</Time>}
        </div>

        <div className="agent-management-card-footer">
          <span className="agent-management-card-helper">{enabled ? (purpose === 'analysis' ? '仅教师端可使用' : '可在课堂配置中选用') : '停用后不会出现在课堂中'}</span>
          <div className="agent-management-card-actions">
            {enabled && <button type="button" style={actionStyle()} onClick={onTest} disabled={testing}><RefreshIcon spinning={testing} />{testing ? '检测中...' : '测试'}</button>}
            <button type="button" style={actionStyle()} onClick={onEdit} disabled={toggling || deleting}><EditIcon />编辑</button>
            <button type="button" style={actionStyle(true)} onClick={onDelete} disabled={deleting || toggling}><DeleteIcon />{deleting ? '处理中...' : '删除'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilityTag({ children }: { children: React.ReactNode }) { return <span className="agent-management-capability-tag">{children}</span>; }
function Time({ children }: { children: React.ReactNode }) { return <span style={{ fontSize: '0.688rem', color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>{children}</span>; }
function Status({ color, label, labelColor, error, onMouseEnter, onMouseLeave }: { color: string; label: string; labelColor?: string; error?: boolean; onMouseEnter?: React.MouseEventHandler<HTMLSpanElement>; onMouseLeave?: () => void }) { return <><span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} /><span onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ fontSize: '0.688rem', color: labelColor || '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap', cursor: error ? 'help' : undefined, borderBottom: error ? '1px dashed #fca5a5' : undefined }}>{label}</span></>; }
function RefreshIcon({ spinning }: { spinning: boolean }) { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function EditIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function DeleteIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
