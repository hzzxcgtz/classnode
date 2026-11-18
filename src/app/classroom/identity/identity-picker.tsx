import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
import { studentNameIndex, matchesStudentName } from '@/lib/student-name-index';
import { SvgAvatar } from '@/components/svg-avatar';
import { useIsMobile } from '../use-is-mobile';
import styles from './identity-picker.module.css';

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
  onSelectStudent: (student: ClassroomStudentSummary | null) => void;
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
    const [group, setGroup] = useState<ClassroomStudentSummary | null>(null);
    const [returningToGroups, setReturningToGroups] = useState(false);
    const [initial, setInitial] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const memberLogin = classroom?.groupLoginMode === 'member';
    const isGroupMode = !group && (classroom?.mode === 'group' || classroom?.mode === 'advanced');
    const choices = useMemo(() => group ? (group.groupMembers ?? []).map(member => ({
      ...group, participantType: 'student' as const, id: member.participantId, studentId: member.studentId, avatarId: member.avatarId,
      groupMemberId: member.id, name: member.name, studentNo: member.studentNo,
    })) : students, [group, students]);
    const nameColumnWidth = Math.min(108, Math.max(54, ...choices.map(s =>
      Array.from(s.name).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 18 : 10), 0)
    )));
    const numberColumnWidth = Math.max(24, ...choices.map(s => s.studentNo ? (String(s.studentNo).length + 1) * 8 : 0));
    const indexedChoices = useMemo(() => choices.map(student => ({ student, index: studentNameIndex(student.name) })), [choices]);
    const initials = !isGroupMode && choices.length > 8
      ? [...new Set(indexedChoices.map(({ index }) => index.initial))].sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
      : [];
    const activeInitial = initials.includes(initial ?? '') ? initial : null;
    const initialColumns = Math.ceil((initials.length + 1) / 2);
    const visibleStudents = indexedChoices.filter(({ student, index }) =>
      (!activeInitial || index.initial === activeInitial) &&
      (isGroupMode ? student.name.toLowerCase().includes(identitySearch.trim().toLowerCase()) : matchesStudentName(index, identitySearch))
    ).map(({ student }) => student);
    const canConfirm = selectedStudent && visibleStudents.some(student =>
      student.id === selectedStudent.id && student.groupMemberId === selectedStudent.groupMemberId
    );
    if (isGroupMode) visibleStudents.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const groupStepLabel = (
      <>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0">
          <circle cx="9" cy="7" r="3" />
          <path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 4a3 3 0 0 1 0 6m2 4a4 4 0 0 1 3 4v2" />
        </svg>
        <span>1. 选择小组</span>
      </>
    );
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
            {memberLogin && (
              <ol aria-label="登录步骤" className="my-3 flex items-center justify-center gap-2 text-xs font-semibold">
                <li aria-current={!group ? 'step' : undefined}>
                  {group ? (
                    <button type="button" disabled={joiningClassroom}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1.5 text-slate-600 hover:bg-indigo-100 hover:text-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50"
                      onClick={() => {
                        setReturningToGroups(true);
                        setGroup(null);
                        setInitial(null);
                        onSelectStudent(null);
                        onIdentitySearchChange('');
                      }}
                    >{groupStepLabel}</button>
                  ) : <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-1.5 text-indigo-800">{groupStepLabel}</span>}
                </li>
                <li aria-hidden="true" className="text-slate-400">→</li>
                <li aria-current={group ? 'step' : undefined} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 ${group ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'}`}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0">
                    <circle cx="12" cy="7" r="3" />
                    <path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
                  </svg>
                  <span>2. 选择姓名</span>
                </li>
              </ol>
            )}
            <div style={{ fontSize: "0.938rem", fontWeight: 500, color: isGroupMode ? '#7c3aed' : 'var(--primary)' }}>
              {isGroupMode ? '请选择你的小组' : group ? `${group.name} · 请选择你的姓名` : '请选择你的姓名'}
            </div>
          </div>
          <div key={group ? 'members' : 'initial'} className={group ? styles.turnForward : returningToGroups ? styles.turnBack : undefined}>
          {choices.length > 8 && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="7" />
                <line x1="16.65" y1="16.65" x2="21" y2="21" />
              </svg>
              <input
                type="text"
                role="searchbox"
                value={identitySearch}
                onChange={(event) => { setInitial(null); onIdentitySearchChange(event.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
                placeholder={isGroupMode ? '搜索小组名称' : '搜索姓名或拼音首字母'}
                aria-label={isGroupMode ? '搜索小组名称' : '搜索姓名或拼音首字母'}
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
          {initials.length > 1 && (
            <div role="group" aria-label="按姓名拼音首字母筛选" className={styles.initials}
              style={{ gridTemplateColumns: `repeat(${initialColumns}, minmax(0, 1fr))` }}>
              {[null, ...initials].map(value => (
                <button key={value ?? 'all'} type="button" aria-pressed={value === activeInitial}
                  aria-label={value === null ? '全部姓名' : value === '#' ? '其他姓名' : `姓名首字母 ${value}`}
                  title={value === null ? '全部姓名' : value === '#' ? '其他姓名' : `姓名首字母 ${value}`}
                  disabled={joiningClassroom} className={styles.initialButton}
                  onClick={() => {
                    setInitial(value);
                    if (listRef.current) listRef.current.scrollTop = 0;
                  }}>
                  {value === null ? <><span className={styles.allLong}>全部</span><span className={styles.allShort}>全</span></> : value}
                </button>
              ))}
            </div>
          )}
          <div ref={listRef} className={styles.choiceList} style={{ display: isGroupMode ? 'grid' : 'flex', gridTemplateColumns: isGroupMode ? 'repeat(auto-fit, minmax(min(100%, 100px), 1fr))' : undefined, flexDirection: 'column', gap: 8, maxHeight: 'min(400px, calc(100vh - 320px))', overflow: 'auto' }}>
            {visibleStudents.map((s) => {
              const isOnline = onlineStudentIds.has(s.id);
              const isSelected = selectedStudent?.id === s.id && selectedStudent.groupMemberId === s.groupMemberId;
              return (
                <button key={s.groupMemberId ?? s.id} onClick={() => {
                  if (memberLogin && !group) {
                    setGroup(s);
                    setInitial(null);
                    onIdentitySearchChange('');
                  } else onSelectStudent(s);
                }} disabled={isOnline || joiningClassroom}
                  className={isGroupMode ? 'enabled:hover:brightness-[.98] focus-visible:outline-2 focus-visible:outline-indigo-500' : undefined}
                  style={{ padding: isGroupMode ? '12px 8px' : '8px 14px', aspectRatio: isGroupMode ? '1 / 1' : undefined, borderRadius: 12, border: '2px solid', borderColor: isSelected ? 'var(--primary)' : isGroupMode ? '#e0e4f3' : '#eef2f6', background: isOnline ? '#f9fafb' : isSelected ? '#e8eaff' : isGroupMode ? 'linear-gradient(145deg, #f7f8ff, #eef0fb)' : 'white', cursor: isOnline ? 'not-allowed' : 'pointer', fontSize: "0.938rem", textAlign: isGroupMode ? 'center' : 'left', display: 'flex', flexDirection: isGroupMode ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: isGroupMode ? 5 : 10, transition: 'all .15s', opacity: isOnline ? 0.5 : 1, width: '100%' }}>
                  {isGroupMode ? (
                    <span className="max-w-full break-words text-lg font-bold leading-snug text-indigo-950">{s.name}</span>
                  ) : (
                    <span className={styles.personContent} style={{ '--identity-name-width': `${nameColumnWidth}px`, '--identity-number-width': `${numberColumnWidth}px` } as CSSProperties}>
                      <span style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: s.avatarId && avatarSvgs[s.avatarId] ? 'transparent' : (isOnline ? '#e5e7eb' : isSelected ? 'linear-gradient(135deg, #667eea, #764ba2)' : '#f3f4f6'), color: isOnline ? '#d1d5db' : isSelected ? 'white' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: "1rem" }}>
                        {s.avatarId && avatarSvgs[s.avatarId] ? (
                          <SvgAvatar svg={avatarSvgs[s.avatarId]} size={36} fallback={s.name[0]} />
                        ) : s.name[0]}
                      </span>
                      <span className="min-w-0 break-words" style={{ fontSize: '1.125rem', fontWeight: 700, color: isOnline ? '#9ca3af' : '#1a1a2e', lineHeight: 1.35 }}><span className={/^[\p{Script=Han}]{2}$/u.test(s.name) ? styles.shortName : undefined}>{s.name}</span>{isOnline && <span className={styles.onlineLabel}>已登录</span>}</span>
                      <span className="shrink-0 text-xs font-medium text-slate-500">{s.studentNo ? `#${s.studentNo}` : ''}</span>
                    </span>
                  )}
                  {isOnline && isGroupMode && <span style={{ fontSize: "0.688rem", color: '#9ca3af', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>已登录</span>}
                </button>
              );
            })}
            {visibleStudents.length === 0 && (
              <div role="status" style={{ gridColumn: '1 / -1', padding: '36px 20px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 12, border: '1px dashed #cbd5e1' }}>
                <div style={{ fontSize: '0.938rem', fontWeight: 600, marginBottom: 4 }}>没有找到匹配结果</div>
                <div style={{ fontSize: '0.813rem' }}>请调整搜索内容或首字母筛选</div>
              </div>
            )}
          </div>
          {group && choices.length === 0 && <p>这个小组还没有组员，请联系老师。</p>}
          {(!memberLogin || group) && <button onClick={() => void onConfirm()} disabled={!canConfirm || joiningClassroom}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 20, fontSize: "1rem", opacity: canConfirm ? 1 : 0.5 }}>
            {joiningClassroom ? '进入中...' : '确认并进入课堂'}
          </button>}
          </div>
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
