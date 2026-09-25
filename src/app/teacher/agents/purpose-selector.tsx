/**
 * ★ M7b：**「用途」选择器** —— `Agent.purpose` 的**唯一写入口**。
 *
 * 🔴 独立审查 C1 抓到的：服务端的读（学生端那道闸）与写（`POST/PUT /api/agents`）都做了，
 * 而**前端一个 `purpose` 都没发、也没有任何控件** ⇒ 新建的 bot 永远是 `tutoring`，
 * 学习单那个「分析型智能体」下拉永远是空的 ⇒ **整条 M7b 在界面上不可达**
 * （按钮恒灰，而旁边的提示让教师去改一个不存在的控件）。
 *
 * ⇒ 这个控件是那一批功能**能不能被用上**的前提，不是装饰。
 *
 * ★ 2026-09-25 版式（教师截图批注：「这个几种类型的智能体共用的选择，要单独提取出来，
 * 不要放在每个编辑框内部，学伴和分析这两个选择按钮可以加图标美化一下，设计得小一些」）：
 *
 * · **提取**：它从「一栏一个框」变成了**横贯整个表单的一条窄带**（`agent-form-purpose`
 *   在 `page.tsx` 里占满整行）。它本来就与平台无关（任何平台都要选用途），
 *   挤在某一栏里会让它看起来像那一栏的一部分。
 * · **小**：两个选项从「上下两行文字的方块」压成**一枚带图标的胶囊**；
 *   逐条的说明改挂 `title` / `aria-label`（⚠️ 本仓立过「图标化只减视觉宽度、
 *   不减无障碍信息」——所以说明是**换了位置**，不是被删掉），只留一句共用的提示在右边。
 * · **图标**：学伴 = 对话气泡，分析 = 柱状图。⚠️ 图标是**装饰**（`aria-hidden`）：
 *   旁边的文字已经说了是什么，读屏再念一遍图标只是啰嗦。
 */
const ICON_PROPS = {
  width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;

const PURPOSES = [
  {
    value: 'tutoring',
    label: '学伴',
    hint: '学生可以选它聊天（三件套的「智能学伴」）',
    icon: <svg {...ICON_PROPS}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  },
  {
    value: 'analysis',
    label: '分析',
    hint: '专用于分析全班作答；绝不会出现在学生的学伴列表里',
    icon: <svg {...ICON_PROPS}><line x1="6" y1="20" x2="6" y2="14" /><line x1="12" y1="20" x2="12" y2="8" /><line x1="18" y1="20" x2="18" y2="4" /></svg>,
  },
] as const;

export function AgentPurposeSelector({ purpose, onChange }: {
  purpose: string;
  onChange: (purpose: 'tutoring' | 'analysis') => void;
}) {
  return (
    <div style={{
      background: '#fafbfc', border: '1px solid #eef2f6', borderRadius: 8,
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <strong style={{ fontSize: '0.813rem', color: '#1e293b', whiteSpace: 'nowrap' }}>
        用途 <span style={{ color: 'var(--danger)' }}>*</span>
      </strong>

      <div style={{ display: 'flex', gap: 6 }}>
        {PURPOSES.map(option => {
          const selected = purpose === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              // ⚠️ 逐条的说明**换到了这里**，没有被删掉：胶囊上放不下两行字，
              //    但「分析型不会出现在学生列表里」这件事必须还能被读到。
              title={`${option.label}：${option.hint}`}
              aria-label={`${option.label}：${option.hint}`}
              onClick={() => onChange(option.value)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                border: `1px solid ${selected ? '#2563eb' : '#cbd5e1'}`,
                background: selected ? '#eff6ff' : '#fff',
                color: selected ? '#1d4ed8' : '#475569',
                borderRadius: 999, padding: '5px 12px', fontSize: '0.813rem',
                fontWeight: selected ? 600 : 500, fontFamily: 'inherit',
              }}
            >
              <span aria-hidden="true" style={{ display: 'flex', flexShrink: 0 }}>{option.icon}</span>
              {option.label}
            </button>
          );
        })}
      </div>

      {/* 右端那一句是**两个选项共用**的提示，所以留在外面（放进任一枚胶囊都会偏心）。 */}
      <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: 'auto', minWidth: 0 }}>
        分析型不会出现在学生的学伴列表里
      </span>
    </div>
  );
}
