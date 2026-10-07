import { useRouter } from 'next/navigation';
import type { ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
import { SvgAvatar } from '@/components/svg-avatar';
import { useIsMobile } from '../use-is-mobile';

export interface IdentityPickerProps {
  classroom: StudentClassroom | null;
  students: ClassroomStudentSummary[];
  selectedStudent: ClassroomStudentSummary | null;
  identitySearch: string;
  onIdentitySearchChange: (value: string) => void;
  onlineStudentIds: Set<string>;
  avatarSvgs: Record<number, string>;
  joiningClassroom: boolean;
  loadError: string | null;
  onSelectStudent: (student: ClassroomStudentSummary) => void;
  onConfirm: () => void;
  onExit: () => void;
}

export function IdentityPicker({
  classroom,
  students,
  selectedStudent,
  identitySearch,
  onIdentitySearchChange,
  onlineStudentIds,
  avatarSvgs,
  joiningClassroom,
  loadError,
  onSelectStudent,
  onConfirm,
  onExit,
}: IdentityPickerProps) {
    const router = useRouter();
    const isMobile = useIsMobile();
    const isGroupMode = classroom?.mode === 'group' || classroom?.mode === 'advanced';
    const normalizedIdentitySearch = identitySearch.trim().toLocaleLowerCase('zh-CN');
    const visibleStudents = students
      .filter((student) => !normalizedIdentitySearch || student.name.toLocaleLowerCase('zh-CN').includes(normalizedIdentitySearch));
    if (isGroupMode) visibleStudents.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 24, position: 'relative' }}>
        <button onClick={onExit}
          style={{
            position: 'absolute', top: 20, left: 20,
            display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
            background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
            color: 'white', fontSize: "0.813rem", cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          退出
        </button>
        <div style={{ background: 'white', borderRadius: 20, padding: isMobile ? 24 : 32, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            {classroom?.title && (
              <div style={{ fontSize: "1.375rem", fontWeight: 700, color: '#0f172a', marginBottom: 6, lineHeight: 1.3 }}>{classroom.title}</div>
            )}
            <div style={{ fontSize: "0.938rem", fontWeight: 500, color: isGroupMode ? '#7c3aed' : 'var(--primary)' }}>
              {isGroupMode ? '请选择你的小组' : '请选择你的姓名'}
            </div>
          </div>
          {students.length > 8 && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="7" />
                <line x1="16.65" y1="16.65" x2="21" y2="21" />
              </svg>
              <input
                type="text"
                role="searchbox"
                value={identitySearch}
                onChange={(event) => onIdentitySearchChange(event.target.value)}
                placeholder={isGroupMode ? '搜索小组名称' : '搜索你的姓名'}
                aria-label={isGroupMode ? '搜索小组名称' : '搜索学生姓名'}
                className="input"
                style={{ paddingLeft: 40, paddingRight: identitySearch ? 72 : 14, minHeight: 44, background: '#f8fafc' }}
              />
              {identitySearch && (
                <button
                  type="button"
                  onClick={() => onIdentitySearchChange('')}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 0, borderRadius: 6, background: 'transparent', color: '#64748b', padding: '6px 8px', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  清除
                </button>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'min(400px, calc(100vh - 320px))', overflow: 'auto' }}>
            {visibleStudents.map((s) => {
              const isOnline = onlineStudentIds.has(s.id);
              const isSelected = selectedStudent?.id === s.id;
              return (
                <button key={s.id} onClick={() => !isOnline && onSelectStudent(s)} disabled={isOnline}
                  style={{ padding: '14px 18px', borderRadius: 12, border: '2px solid', borderColor: isSelected ? 'var(--primary)' : '#eef2f6', background: isOnline ? '#f9fafb' : isSelected ? '#eef3f8' : 'white', cursor: isOnline ? 'not-allowed' : 'pointer', fontSize: "0.938rem", textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, transition: 'all .15s', opacity: isOnline ? 0.5 : 1, width: '100%' }}>
                  {isGroupMode ? (
                    <>
                      <div style={{
                        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                        background: isOnline ? '#e5e7eb' : isSelected ? 'linear-gradient(135deg, #667eea, #764ba2)' : '#f3f4f6',
                        color: isOnline ? '#d1d5db' : isSelected ? 'white' : '#6b7280',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" />
                        </svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "1rem", fontWeight: 600, color: isOnline ? '#9ca3af' : '#1a1a2e', lineHeight: 1.4 }}>{s.name}</div>
                        {s.groupName && <div style={{ fontSize: "0.75rem", color: '#94a3b8', marginTop: 1 }}>小组</div>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: s.avatarId && avatarSvgs[s.avatarId] ? 'transparent' : (isOnline ? '#e5e7eb' : isSelected ? 'linear-gradient(135deg, #667eea, #764ba2)' : '#f3f4f6'), color: isOnline ? '#d1d5db' : isSelected ? 'white' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: "1rem" }}>
                        {s.avatarId && avatarSvgs[s.avatarId] ? (
                          <SvgAvatar svg={avatarSvgs[s.avatarId]} size={42} fallback={s.name[0]} />
                        ) : s.name[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "1rem", fontWeight: 600, color: isOnline ? '#9ca3af' : '#1a1a2e', lineHeight: 1.4 }}>{s.name}</div>
                      </div>
                    </>
                  )}
                  {isOnline && <span style={{ fontSize: "0.688rem", color: '#9ca3af', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>已登录</span>}
                </button>
              );
            })}
            {visibleStudents.length === 0 && (
              <div role="status" style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 12, border: '1px dashed #cbd5e1' }}>
                <div style={{ fontSize: '0.938rem', fontWeight: 600, marginBottom: 4 }}>没有找到匹配结果</div>
                <div style={{ fontSize: '0.813rem' }}>请检查输入，或清除搜索后重新选择</div>
              </div>
            )}
          </div>
          <button onClick={() => void onConfirm()} disabled={!selectedStudent || joiningClassroom}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 20, fontSize: "1rem", opacity: selectedStudent ? 1 : 0.5 }}>
            {joiningClassroom ? '进入中...' : isGroupMode ? '确认并进入小组对话' : '确认并进入对话'}
          </button>
          {loadError && (
            <div style={{
              width: '100%', marginTop: 12, padding: '10px 14px',
              background: '#f8eeee', border: '1px solid #fca5a5', borderRadius: 10,
              fontSize: "0.813rem", color: '#934e4e', textAlign: 'center',
            }}>
              {loadError}
            </div>
          )}
          {loadError && (
            <button onClick={() => router.push('/')}
              style={{ display: 'block', width: '100%', marginTop: 12, padding: '10px 0', fontSize: "0.875rem", color: 'var(--primary)', background: 'transparent', border: '1px solid #c7d2fe', borderRadius: 10, cursor: 'pointer' }}>
              返回首页
            </button>
          )}
        </div>
      </div>
    );
}
