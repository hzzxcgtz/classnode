/**
 * ★ M7b：**「用途」选择器** —— `Agent.purpose` 的**唯一写入口**。
 *
 * 🔴 独立审查 C1 抓到的：服务端的读（学生端那道闸）与写（`POST/PUT /api/agents`）都做了，
 * 而**前端一个 `purpose` 都没发、也没有任何控件** ⇒ 新建的 bot 永远是 `tutoring`，
 * 学习单那个「分析型智能体」下拉永远是空的 ⇒ **整条 M7b 在界面上不可达**
 * （按钮恒灰，而旁边的提示让教师去改一个不存在的控件）。
 *
 * ⇒ 这个控件是那一批功能**能不能被用上**的前提，不是装饰。
 */
const PURPOSES = [
  { value: 'tutoring', label: '学伴', hint: '学生可以选它聊天（三件套的「智能学伴」）' },
  { value: 'analysis', label: '分析', hint: '专用于分析全班作答；**绝不会出现在学生的列表里**' },
] as const;

export function AgentPurposeSelector({ purpose, onChange }: {
  purpose: string;
  onChange: (purpose: 'tutoring' | 'analysis') => void;
}) {
  return (
    <div className="agent-form-section" style={{ background: '#fafbfc', borderRadius: 8, padding: 14, border: '1px solid #eef2f6' }}>
      <strong>用途 <span style={{ color: 'var(--danger)' }}>*</span></strong>
      <p style={{ margin: '4px 0 10px', fontSize: '0.78rem', color: '#64748b' }}>
        分析型智能体专门用来「发给 AI 分析」——它<b>不会</b>出现在学生的学伴列表里。
        学习单里那个「分析型智能体」下拉只列用途为「分析」的。
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {PURPOSES.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={purpose === option.value}
            onClick={() => onChange(option.value)}
            style={{
              flex: 1, textAlign: 'left', cursor: 'pointer',
              border: `1px solid ${purpose === option.value ? 'var(--primary, #2563eb)' : '#cbd5e1'}`,
              background: purpose === option.value ? '#eff6ff' : '#fff',
              borderRadius: 8, padding: '8px 12px',
            }}
          >
            <strong style={{ display: 'block', fontSize: '0.85rem', color: '#1e293b' }}>{option.label}</strong>
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>{option.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
