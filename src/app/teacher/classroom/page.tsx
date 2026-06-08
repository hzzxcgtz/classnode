'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense, useLayoutEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WordCloud } from "@isoterik/react-word-cloud";
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { renderMarkdown, stripImages } from '@/lib/markdown';
import { getApiBaseUrl, getClassroomPort } from '@/lib/api-base';
import { QRCodeSVG } from 'qrcode.react';
import QRCode from 'qrcode';
import { Toast } from '@/lib/components';

export default function ClassroomBoard() {
  return (
    <Suspense fallback={<div style={{textAlign:'center',padding:60,color:'#94a3b8',fontSize:14}}>加载中...</div>}>
      <ClassroomBoardContent />
    </Suspense>
  );
}

function ClassroomBoardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '';

  const [classroom, setClassroom] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [studentStatuses, setStudentStatuses] = useState<Record<string, string>>({});
  const [studentRounds, setStudentRounds] = useState<Record<string, number>>({});
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [hiddenRounds, setHiddenRounds] = useState<number[]>([]);
  const hideCensored = (msgs: any[]) => msgs.filter((m: any) =>
    !(m.shieldFiltered || (m.role === 'user' && (m.content || '').includes('**')))
  );
  // 为旧数据（roundIndex 为 null）自动补充轮次编号
  const ensureRoundIndices = (msgs: any[]) => {
    const needsCompute = msgs.some((m: any) => m.role === 'user' && m.roundIndex == null);
    if (!needsCompute) return msgs;
    let round = 0;
    return msgs.map((m: any) => {
      if (m.role === 'user') round++;
      return { ...m, roundIndex: m.roundIndex ?? round };
    });
  };
  const [showCodeScreen, setShowCodeScreen] = useState(false);
  const [teacherCode, setTeacherCode] = useState('');

  /** 生成并下载带 Logo 的二维码图片 */
  const downloadQRCode = async () => {
    const origin = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '';
    const qrValue = `${origin}/classroom?code=${teacherCode}`;
    const qrSize = 760;
    const textHeight = 70;
    const totalWidth = qrSize;
    const totalHeight = qrSize + textHeight;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d')!;

    await QRCode.toCanvas(canvas, qrValue, {
      width: qrSize,
      margin: 3,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });

    const logoSize = qrSize * 0.2;
    const cx = qrSize / 2, cy = qrSize / 2;
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      logoImg.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, logoSize / 2 + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, logoSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
        ctx.restore();
        resolve();
      };
      logoImg.onerror = () => { resolve(); };
      logoImg.src = `/qr-logo.png`;
    });

    const title = classroom?.title || '互动课堂';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(title, qrSize / 2, qrSize + textHeight / 2);

    const link = document.createElement('a');
    link.download = `ClassNode-${teacherCode}-${title}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const [paused, setPaused] = useState(false);
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [classroomAgent, setClassroomAgent] = useState<any>(null);
  const [gridFullscreen, setGridFullscreen] = useState(false);
  const [fsCols, setFsCols] = useState(5);
  const gridRef = useRef<HTMLDivElement>(null);
  const fsContentRef = useRef<HTMLDivElement>(null);
  const fullscreenContentRef = useRef<HTMLDivElement>(null);
  const { joinTeacherBoard, on } = useSocket();
  const drawerMessagesRef = useRef<HTMLDivElement>(null);
  const [studentWarnings, setStudentWarnings] = useState<Record<string, number>>({});
  const [studentBlacklisted, setStudentBlacklisted] = useState<Record<string, boolean>>({});
  const [groupTooltip, setGroupTooltip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // 分组/高级模式：按小组聚合卡片
  const groupCards = useMemo(() => {
    if (!classroom || (classroom.mode !== 'advanced' && classroom.mode !== 'group')) return null;
    const map = new Map<string, { group: any; members: any[] }>();
    for (const cs of students) {
      if (!cs.groupId) continue;
      let g = map.get(cs.groupId);
      if (!g) { g = { group: cs.group, members: [] }; map.set(cs.groupId, g); }
      g.members.push(cs);
    }
    // 组内按学号排序
    for (const g of map.values()) {
      g.members.sort((a, b) => (parseInt(a.student?.studentNo) || 999999) - (parseInt(b.student?.studentNo) || 999999));
    }
    // 按组名排序
    return Array.from(map.values()).sort((a, b) => (a.group?.name || '').localeCompare(b.group?.name || ''));
  }, [classroom, students]);

  // 小组名 → 成员列表（使用后端从 ClassGroup.studentIds 解析的真实学生数据）
  const groupMembersMap = useMemo(() => {
    const map: Record<string, any> = {};
    if (!groupCards || !classroom?.groupMembersMap) return map;
    for (const g of groupCards) {
      if (!g.group?.id || !g.group.name) continue;
      const backendData = classroom.groupMembersMap[g.group.name];
      if (backendData) {
        map[g.group.id] = backendData.members.map((m: any) => ({
          studentName: m.name,
          groupName: g.group.name,
        }));
      }
    }
    return map;
  }, [groupCards, classroom?.groupMembersMap]);

  // 打开抽屉时自动滚动到底部（最新消息）
  useEffect(() => {
    if (selectedStudent && drawerMessagesRef.current) {
      // 等待 React 渲染消息列表后再滚动
      requestAnimationFrame(() => {
        drawerMessagesRef.current?.scrollTo({ top: 999999, behavior: 'smooth' });
      });
    }
  }, [selectedStudent, messages]);

  // 投屏讲评展开时自动滚到底部
  useEffect(() => {
    if (showFullscreen && fullscreenContentRef.current) {
      requestAnimationFrame(() => {
        fullscreenContentRef.current?.scrollTo({ top: fullscreenContentRef.current.scrollHeight, behavior: 'auto' });
      });
    }
  }, [showFullscreen, messages]);

  const loadClassroom = useCallback(async () => {
    if (!id) return;
    try {
      const cr = await api.getClassroom(id);
      setClassroom(cr);
      setTeacherCode(cr.code);
      setPaused(cr.status === 'paused');
      const students = cr.students || [];
      // 排序：标准模式按学号，分组/高级模式按组名
      const mode = cr.mode || 'standard';
      if (mode === 'standard') {
        students.sort((a: any, b: any) => (parseInt(a.student?.studentNo) || 999999) - (parseInt(b.student?.studentNo) || 999999));
      } else {
        students.sort((a: any, b: any) => {
          const ga = a.group?.name || '';
          const gb = b.group?.name || '';
          if (ga !== gb) return ga.localeCompare(gb);
          return (parseInt(a.student?.studentNo) || 999999) - (parseInt(b.student?.studentNo) || 999999);
        });
      }
      setStudents(students);
      const statuses: Record<string, string> = {};
      const rounds: Record<string, number> = {};
      const warnings: Record<string, number> = {};
      const blacklisted: Record<string, boolean> = {};
      students.forEach((s: any) => {
        statuses[s.student.id] = s.status;
        rounds[s.student.id] = s.totalRounds || 0;
        warnings[s.student.id] = s.warningCount || 0;
        blacklisted[s.student.id] = s.blacklisted || false;
      });
      setStudentStatuses(statuses);
      setStudentRounds(rounds);
      setStudentWarnings(warnings);
      setStudentBlacklisted(blacklisted);

      // 加载每位学生最近一轮对话预览和词云数据
      try {
        const allMsgs = await api.getAllMessages(id);
        setAllMessages(allMsgs);
        const grouped = new Map<string, any[]>();
        for (const msg of allMsgs) {
          const sid = msg.classroomStudent?.student?.id;
          if (!sid) continue;
          if (!grouped.has(sid)) grouped.set(sid, []);
          grouped.get(sid)!.push(msg);
        }
        setStudents(prev => prev.map(s => {
          const sid = s.student.id;
          const msgs = grouped.get(sid);
          if (!msgs || msgs.length === 0) return s;
          const lastUser = msgs.filter((m: any) => m.role === 'user').slice(-1)?.[0];
          const lastAssistant = msgs.filter((m: any) => m.role === 'assistant').slice(-1)?.[0];
          const preview: any[] = [];
          if (lastUser) preview.push({ content: lastUser.content, role: 'user', createdAt: lastUser.createdAt });
          if (lastAssistant && (!lastUser || new Date(lastAssistant.createdAt) > new Date(lastUser.createdAt))) {
            preview.push({ content: lastAssistant.content, role: 'assistant', createdAt: lastAssistant.createdAt });
          }
          return { ...s, messages: preview };
        }));
      } catch {}
      // 加载课堂关联的智能体
      try {
        const agents = await api.getAgents();
        const agentIds = cr.agentIds || [];
        const found = agents.find((a: any) => agentIds.includes(a.id));
        setClassroomAgent(found || (agents.length > 0 ? agents[0] : null));
      } catch {}
    } catch {}
  }, [id]);

  const loadAnalytics = useCallback(async () => {
    if (!id) return;
    try {
      const msgs = await api.getAllMessages(id);
      setAllMessages(msgs);
    } catch {}
  }, [id]);

  useEffect(() => {
    if (!id) { router.push('/teacher'); return; }
    loadClassroom();
    joinTeacherBoard(id);

    const unsub1 = on('student-online', (data: any) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: 'online' }));
    });
    const unsub2 = on('student-offline', (data: any) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: 'offline' }));
    });
    const unsub3 = on('student-thinking', (data: any) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: data.status ? 'thinking' : 'online' }));
    });
    const unsub4 = on('student-message', (data: any) => {
      // 更新学生消息预览（仅保留最近3条用户提问）
      setStudents(prev => prev.map(s =>
        s.student.id === data.studentId
          ? {
              ...s,
              messages: data.role === 'user'
                ? [{ content: data.content, role: 'user', createdAt: data.timestamp }]
                : (() => {
                    const userMsgs = (s.messages || []).filter((m: any) => m.role === 'user').slice(-1);
                    return [...userMsgs, { content: data.content, role: 'assistant', createdAt: data.timestamp }];
                  })()
            }
          : s
      ));
      // 更新学生对话轮数（屏蔽词触发的提问不计入轮数）
      if (data.role === 'user' && !data.shieldFiltered) {
        setStudentRounds(prev => ({
          ...prev,
          [data.studentId]: (prev[data.studentId] || 0) + 1,
        }));
      }
      // 如果当前选中该学生，追加消息（排除被屏蔽的）
      if (selectedStudent?.id === data.studentId && !data.shieldFiltered) {
        setMessages(prev => [...prev, { content: data.content, role: data.role, roundIndex: data.roundIndex, createdAt: data.timestamp, fileUrls: data.fileUrls, fileNames: data.fileNames }]);
      }
    });

    const unsub5 = on('classroom-paused', () => setPaused(true));
    const unsub6 = on('classroom-resumed', () => setPaused(false));
    const unsub7 = on('classroom-ended', () => {
      setToast({ msg: '课堂已结束', type: 'info' });
      router.push('/teacher');
    });

    const unsub8 = on('shield-warning', (data: any) => {
      setStudentWarnings(prev => ({ ...prev, [data.studentId]: data.warningCount }));
    });

    const unsub9 = on('student-blacklisted', (data: any) => {
      setStudentBlacklisted(prev => ({ ...prev, [data.studentId]: true }));
    });

    const unsub10 = on('student-unblacklisted', (data: any) => {
      setStudentBlacklisted(prev => ({ ...prev, [data.studentId]: false }));
      setStudentWarnings(prev => ({ ...prev, [data.studentId]: 0 }));
    });

    return () => { unsub1?.(); unsub2?.(); unsub3?.(); unsub4?.(); unsub5?.(); unsub6?.(); unsub7?.(); unsub8?.(); unsub9?.(); unsub10?.(); };
  }, [id, joinTeacherBoard, on, loadClassroom, selectedStudent?.id, router]);

  const openStudentDrawer = async (student: any) => {
    setSelectedStudent(student);
    try {
      const msgs = await api.getStudentMessages(id, student.id);
      const clean = ensureRoundIndices(hideCensored(msgs));
      setMessages(clean);
      setHiddenRounds([]); // 默认全选
    } catch { setMessages([]); }
  };


  if (!classroom) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>加载中...</div>;
  }

  const statusValues = Object.values(studentStatuses);
  const onlineCount = statusValues.filter(v => v === 'online' || v === 'thinking').length;
  const thinkingCount = statusValues.filter(v => v === 'thinking').length;
  const offlineCount = statusValues.filter(v => v === 'offline').length;
  const totalRounds = Object.values(studentRounds).reduce((sum, r) => sum + r, 0);

  const statusColors: Record<string, string> = {
    online: '#10b981',
    thinking: '#f59e0b',
    offline: '#94a3b8',
  };
  const statusLabels: Record<string, string> = {
    online: '在线',
    thinking: '思考中...',
    offline: '离线',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {gridFullscreen && <style>{`body { overflow: hidden; }`}</style>}
      <style>{`@keyframes slideDown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* 顶部区域（非全屏时显示） */}
      {!gridFullscreen && (<>
      <div className="teacher-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <button onClick={() => router.push('/teacher')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '6px 8px', borderRadius: 8, marginTop: 2, flexShrink: 0,
              color: '#64748b', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{classroom.title || '课堂看板'}</h1>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
              background: classroom.mode === 'advanced' ? '#ecfdf5' : classroom.mode === 'group' ? '#f5f3ff' : '#eef2ff',
              color: classroom.mode === 'advanced' ? '#059669' : classroom.mode === 'group' ? '#7c3aed' : '#2563eb',
              whiteSpace: 'nowrap', lineHeight: '20px',
            }}>
              {classroom.mode === 'advanced' ? '高级模式' : classroom.mode === 'group' ? '分组模式' : '标准模式'}
            </span>
            <span className={`tag ${classroom.status === 'paused' ? 'tag-yellow' : classroom.status === 'active' ? 'tag-green' : 'tag-gray'}`}>
              {classroom.status === 'paused' ? '已暂停' : classroom.status === 'active' ? '进行中' : '已结束'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px 3px 10px', borderRadius: 6,
              background: '#eef2ff', fontSize: 13, fontWeight: 500, color: '#2563eb',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
              互动码 <strong style={{ fontSize: 16, letterSpacing: 3, fontFamily: 'monospace' }}>{teacherCode}</strong>
              <button onClick={() => setShowCodeScreen(true)} title="显示二维码"
                style={{
                  marginLeft: 2, width: 22, height: 22, borderRadius: 4, border: 'none',
                  background: 'rgba(37,99,235,0.1)', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: '#2563eb', padding: 0, flexShrink: 0,
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/>
                  <rect x="3" y="16" width="5" height="5" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
                  <line x1="11" y1="3" x2="13" y2="3"/><line x1="3" y1="11" x2="3" y2="13"/><line x1="21" y1="11" x2="21" y2="13"/>
                </svg>
              </button>
            </div>
            <span style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
              {students.length} 名学生
            </span>
          </div>
        </div>
          </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {classroom.status !== 'ended' && (
            <>
              <button className="btn btn-primary btn-lg" onClick={() => setShowCodeScreen(true)} style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                投屏发码
              </button>
              {paused && (
                <button className="btn btn-secondary" onClick={async () => {
                  await api.resumeClassroom(id);
                  setPaused(false);
                  loadClassroom();
                }} style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  继续上课
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 已暂停提示条 */}
      {paused && (
        <div style={{
          padding: '10px 16px', borderRadius: 10, marginBottom: 16,
          background: '#fffbeb', border: '1px solid #fde68a',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          课堂已暂停，学生无法发送消息。点击「继续上课」即可恢复。
        </div>
      )}

      {/* 实时数据统计 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: '在线人数', value: onlineCount, color: '#10b981', bg: '#ecfdf5', icon: 'online' },
          { label: '互动中', value: thinkingCount, color: '#f59e0b', bg: '#fffbeb', icon: 'thinking' },
          { label: '离线', value: offlineCount, color: '#94a3b8', bg: '#f1f5f9', icon: 'offline' },
          { label: '总交互轮数', value: totalRounds, color: '#8b5cf6', bg: '#f5f3ff', icon: 'message' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
            padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 14,
            transition: 'box-shadow 0.2s, transform 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11,
              background: stat.bg, color: stat.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {stat.icon === 'online' && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              )}
              {stat.icon === 'thinking' && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              )}
              {stat.icon === 'offline' && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 3.27A11 11 0 0 1 23 12"/><path d="M1 12a11 11 0 0 1 7.5-10.5"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="15" r="1"/>
                </svg>
              )}
              {stat.icon === 'message' && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: stat.color, lineHeight: 1.1 }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>
      </>)}
      {/* 对话分析面板（始终渲染，全屏时被 fixed 遮罩覆盖） */}
      <AnalyticsPanel classroomId={id} allMessages={allMessages} loadAnalytics={loadAnalytics} students={students} />
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>
        <div ref={gridRef} style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#0f172a' }}>学生互动面板</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                点击学生卡片查看完整对话
              </span>
              <button onClick={() => setGridFullscreen(true)}
                title="全屏显示学生面板"
                style={{
                  padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0',
                  background: 'white', cursor: 'pointer', color: '#64748b', fontSize: 12,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                全屏
              </button>
            </div>
          </div>
          <div className="student-grid">
            {(groupCards || students).length === 0 ? (
              <div style={{
                gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px',
                background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: '#f1f5f9', margin: '0 auto 12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  </svg>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>暂无学生加入</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>学生通过互动码 <strong style={{ color: '#2563eb', fontFamily: 'monospace', fontSize: 15, letterSpacing: 2 }}>{teacherCode}</strong> 加入后，将在此处显示</div>
              </div>
            ) : (
              (groupCards || students).map((item: any) => {
                const isGroup = groupCards && item.members;
                const cs = isGroup ? item.members[0] : item;
                const student = cs.student;
                const sid = student.id;
                const status = isGroup
                  ? item.members.some((m: any) => studentStatuses[m.student.id] === 'online')
                    ? 'online'
                    : item.members.some((m: any) => studentStatuses[m.student.id] === 'thinking')
                    ? 'thinking'
                    : 'offline'
                  : studentStatuses[sid] || 'offline';
                const rounds = isGroup
                  ? item.members.reduce((sum: number, m: any) => sum + (studentRounds[m.student.id] || 0), 0)
                  : studentRounds[sid] || 0;
                const allMsgs = isGroup ? item.members.flatMap((m: any) => m.messages || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : null;
                const userMsg = isGroup ? allMsgs!.filter((m: any) => m.role === 'user')[0] : cs.messages?.filter((m: any) => m.role === 'user').slice(-1)?.[0];
                const assistantMsg = isGroup ? allMsgs!.filter((m: any) => m.role === 'assistant')[0] : cs.messages?.filter((m: any) => m.role === 'assistant').slice(-1)?.[0];
                const isSelected = !isGroup && selectedStudent?.id === sid;
                return (
                  <div key={isGroup ? item.group?.id : cs.id}
                    onClick={() => {
                      if (isGroup) setSelectedGroup(item.group);
                      else setSelectedGroup(null);
                      openStudentDrawer(student);
                    }}
                    style={{
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: isSelected ? '#2563eb' : status === 'thinking' ? '#f59e0b' : '#e2e8f0',
                      padding: isGroup ? '18px 18px 16px' : '20px 18px 18px',
                      borderRadius: 12,
                      position: 'relative',
                      background: 'white',
                      display: 'flex',
                      flexDirection: 'column',
                      height: 260,
                      transition: 'all 0.15s',
                      boxShadow: isSelected ? '0 4px 16px rgba(37,99,235,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                      overflow: 'hidden',
                    }}>
                    {/* 头像 + 姓名行（含操作按钮）+ 学号 + 状态标签 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: isGroup ? 10 : '50%', flexShrink: 0,
                        background: status === 'online' ? (isGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #10b981, #34d399)') : status === 'thinking' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : '#e5e7eb',
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 15,
                      }}>
                        {isGroup ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                        ) : student.name[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* 姓名行 + 操作按钮 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: status === 'offline' ? '#9ca3af' : '#1a1a2e', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                            {isGroup ? (
                              <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}
                                onMouseMove={(e) => setGroupTooltip({ id: item.group?.id, x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => setGroupTooltip(null)}>
                                {item.group?.name || '(未命名)'}
                              </span>
                            ) : (
                              <>{student.name}{student.studentNo && <span style={{ fontSize: 10, fontWeight: 500, color: '#94a3b8', marginLeft: 4 }}>#{student.studentNo}</span>}</>
                            )}
                          </span>
                          {!isGroup && (classroom.mode === 'advanced' || classroom.mode === 'group') && cs.group && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                              background: '#f5f3ff', color: '#7c3aed', lineHeight: '18px', flexShrink: 0,
                            }}>
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="#7c3aed" stroke="none"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                              {cs.group.name}
                            </span>
                          )}
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, flexShrink: 0 }}>
                            {isGroup ? (
                              (() => {
                                const anyBlacklisted = item.members.some((m: any) => studentBlacklisted[m.student.id]);
                                return (
                                  <>
                                    <button title={anyBlacklisted ? '解除黑屏' : '黑屏处理'}
                                      onClick={async (e) => { e.stopPropagation();
                                        if (anyBlacklisted) { for (const m of item.members) { try { await api.unblacklistStudent(id, m.student.id); setStudentBlacklisted(prev => ({ ...prev, [m.student.id]: false })); setStudentWarnings(prev => ({ ...prev, [m.student.id]: 0 })); } catch {} } }
                                        else { for (const m of item.members) { try { await api.blacklistStudent(id, m.student.id); setStudentBlacklisted(prev => ({ ...prev, [m.student.id]: true })); } catch {} } }
                                      }}
                                      style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: anyBlacklisted ? '#d1fae5' : '#fee2e2', color: anyBlacklisted ? '#047857' : '#b91c1c', padding: 0 }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        {anyBlacklisted ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                      </svg>
                                    </button>
                                    <button title="清除对话"
                                      onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定清除「${item.group?.name || '该小组'}」全体成员的对话记录？`)) return; for (const m of item.members) { try { await api.clearStudentMessages(id, m.student.id); } catch {} } }}
                                      style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                    </button>
                                  </>
                                );
                              })()
                            ) : (
                              <>
                                <button title={studentBlacklisted[sid] ? '解除黑屏' : '黑屏处理'}
                                  onClick={async (e) => { e.stopPropagation(); if (studentBlacklisted[sid]) { try { await api.unblacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: false })); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} } else { try { await api.blacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: true })); } catch {} } }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: studentBlacklisted[sid] ? '#d1fae5' : '#fee2e2', color: studentBlacklisted[sid] ? '#047857' : '#b91c1c', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    {studentBlacklisted[sid] ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                  </svg>
                                </button>
                                <button title="清除对话"
                                  onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定清除「${student.name}」的全部对话记录？`)) return; try { await api.clearStudentMessages(id, sid); } catch {} }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {/* 人数（仅小组） */}
                        {isGroup && (
                          <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>{item.members.length} 人</div>
                        )}
                        {/* 状态标签 */}
                        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                          {studentBlacklisted[sid] && (
                            <div title="已被黑屏" style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                              background: '#1e293b', color: 'white', whiteSpace: 'nowrap',
                            }}>
                              黑屏
                            </div>
                          )}
                          <div title="当前状态" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 500, background: status === 'online' ? '#ecfdf5' : status === 'thinking' ? '#fffbeb' : '#f1f5f9', color: status === 'online' ? '#10b981' : status === 'thinking' ? '#f59e0b' : '#94a3b8', whiteSpace: 'nowrap' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: status === 'online' ? '#10b981' : status === 'thinking' ? '#f59e0b' : '#94a3b8', display: 'inline-block' }} />
                            {status === 'online' ? '在线' : status === 'thinking' ? '思考' : '离线'}
                          </div>
                          <div title="对话轮数" style={{ padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: rounds > 0 ? '#eef2ff' : '#f3f4f6', color: rounds > 0 ? '#2563eb' : '#9ca3af', whiteSpace: 'nowrap' }}>
                            {rounds} 轮
                          </div>
                          {!isGroup && studentWarnings[sid] > 0 && (
                            <div title="警告次数（点击清零）" onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定将「${student.name}」的警告次数清零？`)) return; try { await api.resetStudentWarnings(id, sid); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: '#fef2f2', color: '#dc2626', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                              {studentWarnings[sid]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>


                    {/* 最近一轮 Q&A 预览 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      {userMsg ? (
                        <>
                          {/* 学生提问 */}
                          <div style={{
                            padding: '10px 14px', borderRadius: 8,
                            background: '#eef2ff',
                            fontSize: 12, lineHeight: 1.6, color: '#334155',
                            wordBreak: 'break-word',
                          }}>
                            <span style={{ fontWeight: 600, color: '#2563eb', marginRight: 4 }}>
                              {isGroup ? (userMsg.studentName || item.group?.name || student.name) : student.name + ':'}
                            </span>
                            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(
                              userMsg.content
                                .replace(/```[\s\S]*?```/g, '[代码]')
                                .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片]')
                                .replace(/<img\s+[^>]*\/?\s*>/gi, '[图片]')
                                .slice(0, 300)
                            ) }} />
                          </div>
                          {/* AI 回答 */}
                          {assistantMsg && (
                            <div style={{
                              padding: '10px 14px', borderRadius: 8,
                              background: '#f8fafc',
                              border: '1px solid #eef2f6',
                              fontSize: 12, lineHeight: 1.6, color: '#64748b',
                              wordBreak: 'break-word',
                            }}>
                              <span style={{ fontWeight: 600, color: '#16a34a', marginRight: 4 }}>
                                AI:
                              </span>
                              <span dangerouslySetInnerHTML={{ __html: renderMarkdown(
                                assistantMsg.content
                                  .replace(/```[\s\S]*?```/g, '[代码]')
                                  .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片]')
                                  .replace(/<img\s+[^>]*\/?\s*>/gi, '[图片]')
                                  .slice(0, 300)
                              ) }} />
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f9fafb', fontSize: 12, color: '#cbd5e1', textAlign: 'center' }}>
                          暂无对话
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧对话详情 - 浮层模式 */}
        {selectedStudent && (
          <>
            {/* 遮罩层 */}
            <div onClick={() => { setSelectedStudent(null); setSelectedGroup(null); }}
              style={{
                position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.12)',
              }} />
            {/* 浮层面板 */}
            <div style={{
              position: 'fixed', top: 96, right: 24, bottom: 24,
              width: 420, zIndex: 291,
              background: 'white', borderRadius: 14,
              border: '1px solid #e2e8f0',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            }}>
            {/* 抽屉头部 */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              background: 'linear-gradient(135deg, #f8faff, #f0f4ff)',
              borderRadius: '12px 12px 0 0',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: selectedGroup ? 10 : '50%',
                    background: selectedGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #667eea, #764ba2)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 15,
                  }}>
                    {selectedGroup ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                    ) : selectedStudent.name[0]}
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {selectedGroup ? selectedGroup.name : selectedStudent.name}
                      {selectedGroup && groupMembersMap[selectedGroup.id] && (
                        <span style={{
                          fontSize: 11, fontWeight: 500, color: '#94a3b8', marginLeft: 2,
                        }}>
                          {groupMembersMap[selectedGroup.id].length} 人
                        </span>
                      )}
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      共 {messages.filter((m: any) => m.role === 'user').length} 轮交互 · {messages.length} 条消息
                    </div>
                    {selectedGroup && groupMembersMap[selectedGroup.id] && (
                      <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 4, lineHeight: 1.5 }}>
                        {groupMembersMap[selectedGroup.id].map((d:any)=>d.studentName).join('、')}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary"
                    onClick={() => setShowFullscreen(true)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                    投屏
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => { setSelectedStudent(null); setSelectedGroup(null); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    关闭
                  </button>
                </div>
              </div>
            </div>

            {/* 消息列表 */}
            <div ref={drawerMessagesRef} style={{
              flex: 1, overflow: 'auto', padding: 16,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {/* 全选/取消 */}
              {messages.length > 0 && (() => {
                const ris = Array.from(new Set(messages.filter((m: any) => m.role === 'user').map((m: any) => m.roundIndex).filter(ri => ri != null))) as number[];
                ris.sort((a, b) => a - b);
                if (ris.length === 0) return null;
                const noHidden = ris.every(ri => !hiddenRounds.includes(ri));
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 0' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>投屏选择</span>
                    <button onClick={() => setHiddenRounds(noHidden ? [...ris] : [])}
                      style={{ fontSize: 11, color: '#6366f1', cursor: 'pointer', border: 'none', background: 'transparent', padding: 0, fontWeight: 500 }}>
                      {noHidden ? '取消全选' : `全选 (${ris.length})`}
                    </button>
                  </div>
                );
              })()}
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40, fontSize: 13 }}>
                  暂无对话记录
                </div>
              ) : (
                messages.map((m: any, i: number) => (
                  <div key={i} style={{
                    display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'stretch',
                  }}>
                    {/* 投屏选择复选框 */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', paddingTop: 14 }}>
                      <div onClick={() => {
                        const ri = m.roundIndex;
                        if (ri != null) {
                          setHiddenRounds(prev =>
                            prev.includes(ri) ? prev.filter(r => r !== ri) : [...prev, ri]
                          );
                        }
                      }}
                        style={{
                          width: 18, height: 18, borderRadius: 4, border: '2px solid',
                          borderColor: m.roundIndex != null && !hiddenRounds.includes(m.roundIndex) ? '#6366f1' : '#d1d5db',
                          background: m.roundIndex != null && !hiddenRounds.includes(m.roundIndex) ? '#6366f1' : 'transparent',
                          cursor: m.roundIndex != null ? 'pointer' : 'default',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all .12s', flexShrink: 0,
                          opacity: m.roundIndex != null ? 1 : 0,
                        }}>
                        {m.roundIndex != null && !hiddenRounds.includes(m.roundIndex) && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                    }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600,
                        color: m.role === 'user' ? 'var(--primary)' : '#64748b',
                        padding: '0 4px',
                      }}>
                        {m.role === 'user' ? selectedStudent.name : 'AI'}
                      </div>
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                      background: m.role === 'user' ? '#eef2ff' : '#f8fafc',
                      border: '1px solid',
                      borderColor: m.role === 'user' ? '#dbeafe' : '#eef2f6',
                      maxWidth: '90%',
                    }}>
                      {/* 附件图片 */}
                      {(() => {
                        const urls = m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : [];
                        const names = m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : [];
                        return urls.map((fu: string, fi: number) => (
                          <div key={fi} style={{ marginBottom: 6 }}>
                            {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
                              <img src={`${getApiBaseUrl()}${fu}`} alt={names[fi] || ''}
                                style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <div style={{ padding: '6px 10px', background: '#f3f4f6', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                                {names[fi] || '附件'}
                              </div>
                            )}
                          </div>
                        ));
                      })()}
                      <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1a1a2e' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.fileUrls?.length ? stripImages(m.content) : m.content) }} />
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, display: 'flex', gap: 8 }}>
                        <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
                ))
              )}
            </div>
          </div>
          </>
        )}
      </div>

      {/* 投屏发码 */}
      {showCodeScreen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300, overflow: 'auto',
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowCodeScreen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <p style={{ fontSize: 30, color: 'rgba(255,255,255,0.6)', marginBottom: 36 }}>使用手机或平板扫描二维码，或在浏览器打开下方网址</p>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 56, marginBottom: 36, flexWrap: 'wrap' }}>
              <div style={{
                background: 'white', borderRadius: 24, overflow: 'hidden',
                display: 'inline-flex', flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}>
                <div style={{ padding: 24, position: 'relative', display: 'inline-flex' }}>
                  <QRCodeSVG
                    value={`http://${typeof window !== 'undefined' ? window.location.hostname : ''}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}/classroom?code=${teacherCode}`}
                    size={360}
                    level="M"
                  />
                  <img src="/qr-logo.png" alt=""
                    style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 72, height: 72, borderRadius: '50%',
                      objectFit: 'cover', background: 'white',
                      padding: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    }}
                    onError={e => { (e.target as HTMLElement).style.display = 'none'; }}
                  />
                </div>
                <button onClick={downloadQRCode}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '14px 0', border: 'none', cursor: 'pointer',
                    borderTop: '1px solid #eef2f6',
                    background: '#f8fafc', color: '#2563eb',
                    fontSize: 14, fontWeight: 600,
                    transition: 'all 0.15s', width: '100%',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  下载二维码图片
                </button>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>浏览器访问</div>
                <p style={{
                  fontSize: 44, fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: '0 0 28px 0',
                  fontFamily: 'monospace', letterSpacing: 1,
                }}>
                  http://{typeof window !== 'undefined' ? window.location.hostname : ''}:{typeof window !== 'undefined' ? getClassroomPort() : '3001'}
                </p>
                <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>输入互动码</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  {teacherCode.split('').map((d, i) => (
                    <div key={i} style={{
                      width: 96, height: 112, borderRadius: 14,
                      background: 'rgba(37,99,235,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 72, fontWeight: 700, color: '#60a5fa',
                      lineHeight: 1,
                    }}>{d}</div>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn" style={{
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.15)', fontSize: 18, padding: '12px 36px',
              borderRadius: 10, cursor: 'pointer',
            }} onClick={() => setShowCodeScreen(false)}>
              返回看板
            </button>
          </div>
        </div>
      )}

      {/* 投屏讲评 */}
      {showFullscreen && (() => {
        const projMsgs = messages.filter((m: any) => !hiddenRounds.includes(m.roundIndex));
        const roundMap = new Map<number, any[]>();
        for (const m of projMsgs) {
          if (!roundMap.has(m.roundIndex)) roundMap.set(m.roundIndex, []);
          roundMap.get(m.roundIndex)!.push(m);
        }
        const sortedRounds = Array.from(roundMap.entries()).sort(([a], [b]) => a - b);
        const renderMsgFiles = (m: any, labelColor: string, bg: string) => {
          const urls = m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : [];
          const names = m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : [];
          return (
            <>
              {urls.map((fu: string, fi: number) => (
                <div key={fi} style={{ marginBottom: 10 }}>
                  {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
                    <img src={`${getApiBaseUrl()}${fu}`} alt={names[fi] || ''}
                      style={{ maxWidth: 260, maxHeight: 180, borderRadius: 10, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ padding: '8px 14px', background: bg, borderRadius: 8, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                      {names[fi] || '附件'}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.fileUrls?.length ? stripImages(m.content) : m.content) }} />
            </>
          );
        };
        return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* 顶部栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 40px',
            background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
            borderBottom: '1px solid #e2e8f0',
            zIndex: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
                {selectedStudent?.name || '学生'} 的对话
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                {sortedRounds.length} 轮展示
              </div>
            </div>
            <button onClick={() => setShowFullscreen(false)}
              style={{ padding: '8px 20px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 14, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              退出投屏
            </button>
          </div>

          {/* 对话内容 */}
          <div ref={fullscreenContentRef} style={{
            flex: 1, overflow: 'auto', padding: '28px 48px 40px',
          }}>
            {sortedRounds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8', fontSize: 18 }}>
                请先在右侧面板中选择要投屏的对话轮次
              </div>
            ) : (
              <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 36 }}>
                {sortedRounds.map(([ri, roundMsgs]) => {
                  const userMsg = roundMsgs.find((m: any) => m.role === 'user');
                  const aiMsg = roundMsgs.find((m: any) => m.role === 'assistant');
                  return (
                    <div key={ri} style={{
                      background: 'white',
                      borderRadius: 16,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                      overflow: 'hidden',
                    }}>
                      {/* 轮次标题 */}
                      <div style={{
                        padding: '10px 24px',
                        borderBottom: '1px solid #f1f5f9',
                        fontSize: 12, fontWeight: 600, color: '#94a3b8',
                        letterSpacing: 0.5,
                      }}>
                        第 {ri} 轮
                      </div>
                      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {/* 学生消息 */}
                        {userMsg && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#667eea', paddingRight: 4 }}>
                              {selectedStudent?.name || '学生'}
                            </div>
                            <div style={{
                              maxWidth: '80%',
                              padding: '14px 20px',
                              borderRadius: '16px 16px 4px 16px',
                              background: '#eef2ff',
                              color: '#1a1a2e',
                              fontSize: 17,
                              wordBreak: 'break-word',
                            }}>
                              {userMsg && renderMsgFiles(userMsg, '#667eea', 'rgba(102,126,234,0.08)')}
                            </div>
                          </div>
                        )}
                        {/* AI 消息 */}
                        {aiMsg && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
                              <div style={{ width: 24, height: 24, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                                {classroomAgent?.logo ? (
                                  <img src={`${getApiBaseUrl()}${classroomAgent.logo}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{
                                    width: '100%', height: '100%',
                                    background: 'linear-gradient(135deg, #667eea, #764ba2)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: 700, color: 'white',
                                  }}>
                                    {classroomAgent?.name?.[0] || 'AI'}
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                                {classroomAgent?.name || 'AI 助手'}
                              </span>
                            </div>
                            <div style={{
                              maxWidth: '80%',
                              padding: '14px 20px',
                              borderRadius: '4px 16px 16px 16px',
                              background: '#f8fafc',
                              border: '1px solid #eef2f6',
                              color: '#0f172a',
                              fontSize: 17,
                              wordBreak: 'break-word',
                            }}>
                              {aiMsg && renderMsgFiles(aiMsg, '#475569', '#f1f5f9')}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部水印 */}
          <div style={{
            textAlign: 'center', padding: '8px 0',
            fontSize: 12, color: '#cbd5e1',
            borderTop: '1px solid #f1f5f9',
            background: 'rgba(255,255,255,0.85)',
          }}>
            ClassNode · 投屏展示 · {selectedStudent?.name || ''}
          </div>
        </div>
        );
      })()}

      {/* 全屏学生网格覆盖层 — 盖过左侧导航栏 */}
      {gridFullscreen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 250,
          background: '#f8fafc', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 24px', background: 'white',
            borderBottom: '1px solid #e2e8f0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: 13,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>学生互动面板 · 全屏模式</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{(groupCards || students).length} {groupCards ? '个小组' : '名学生'}</span>
            </div>
            <button onClick={() => setGridFullscreen(false)}
              style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
                background: 'white', cursor: 'pointer', fontSize: 13, color: '#475569',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              退出全屏
            </button>
          </div>
          <div ref={fsContentRef} style={{ flex: 1, overflow: 'hidden', padding: '12px 20px', display: 'flex', flexDirection: 'column' }}>
            {/* 布局控制栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {(groupCards || students).length} {groupCards ? '个小组' : '名学生'} · {fsCols} 列（{Math.ceil((groupCards || students).length / fsCols)} 行）
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setFsCols(c => Math.max(2, c - 1))}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 14, color: '#475569', lineHeight: 1 }}>
                  −
                </button>
                <span style={{ fontSize: 12, color: '#64748b', padding: '0 6px', minWidth: 30, textAlign: 'center' }}>
                  {fsCols}列
                </span>
                <button onClick={() => setFsCols(c => Math.min(8, c + 1))}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 14, color: '#475569', lineHeight: 1 }}>
                  +
                </button>
              </div>
            </div>
            {/* 全屏学生网格 — 动态撑满 */}
            <div style={{ flex: 1, display: 'grid', gap: 12,
              gridTemplateColumns: `repeat(${fsCols}, 1fr)`,
              alignContent: 'stretch',
            }}>
              {(groupCards || students).length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                  {groupCards ? '暂未分组' : '暂无学生加入'}
                </div>
              ) : (
                (groupCards || students).map((item: any) => {
                  const isGroup = groupCards && item.members;
                  const cs = isGroup ? item.members[0] : item;
                  const student = cs.student;
                  const sid = student.id;
                  const status = isGroup
                    ? item.members.some((m: any) => studentStatuses[m.student.id] === 'online')
                      ? 'online'
                      : item.members.some((m: any) => studentStatuses[m.student.id] === 'thinking')
                      ? 'thinking'
                      : 'offline'
                    : studentStatuses[sid] || 'offline';
                  const rounds = isGroup
                    ? item.members.reduce((sum: number, m: any) => sum + (studentRounds[m.student.id] || 0), 0)
                    : studentRounds[sid] || 0;
                  const compact = fsCols >= 6;
                  const allMsgs = isGroup ? item.members.flatMap((m: any) => m.messages || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : null;
                  const userMsg = isGroup ? allMsgs!.filter((m: any) => m.role === 'user')[0] : cs.messages?.filter((m: any) => m.role === 'user').slice(-1)?.[0];
                  const assistantMsg = isGroup ? allMsgs!.filter((m: any) => m.role === 'assistant')[0] : cs.messages?.filter((m: any) => m.role === 'assistant').slice(-1)?.[0];
                  const isSelected = !isGroup && selectedStudent?.id === sid;
                  return (
                    <div key={isGroup ? item.group?.id : cs.id}
                      onClick={() => {
                      if (isGroup) setSelectedGroup(item.group);
                      else setSelectedGroup(null);
                      openStudentDrawer(student);
                    }}
                      style={{
                        cursor: 'pointer',
                        border: '2px solid',
                        borderColor: isSelected ? '#2563eb' : status === 'thinking' ? '#f59e0b' : '#e2e8f0',
                        padding: compact ? (isGroup ? '14px 10px 6px' : '16px 12px 6px') : (isGroup ? '18px 14px 8px' : '20px 16px 8px'),
                        borderRadius: 12,
                        background: 'white', position: 'relative',
                        display: 'flex', flexDirection: 'column',
                        transition: 'all 0.15s',
                        boxShadow: isSelected ? '0 4px 16px rgba(37,99,235,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                        minHeight: 0,
                        height: compact ? 155 : 190,
                        overflow: 'hidden',
                      }}>
                      {/* 头像 + 姓名行（含操作按钮）+ 学号 + 状态标签 */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: compact ? 6 : 8, marginBottom: compact ? 3 : 6 }}>
                        <div style={{
                          width: compact ? 26 : 36,
                          height: compact ? 26 : 36,
                          borderRadius: isGroup ? (compact ? 6 : 8) : '50%', flexShrink: 0,
                          background: status === 'online' ? (isGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #10b981, #34d399)') : status === 'thinking' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : '#e5e7eb',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: compact ? 11 : 14,
                        }}>
                          {isGroup ? (
                            <svg width={compact ? 14 : 18} height={compact ? 14 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                          ) : student.name[0]}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* 姓名行 + 操作按钮 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                            <span style={{ fontSize: compact ? 12 : 14, fontWeight: 600, color: status === 'offline' ? '#9ca3af' : '#1a1a2e', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              {isGroup ? (
                                <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}
                                  onMouseMove={(e) => setGroupTooltip({ id: item.group?.id, x: e.clientX, y: e.clientY })}
                                  onMouseLeave={() => setGroupTooltip(null)}>
                                  {item.group?.name || '(未命名)'}
                                </span>
                              ) : (
                                <>{student.name}{student.studentNo && <span style={{ fontSize: compact ? 8 : 10, fontWeight: 500, color: '#94a3b8', marginLeft: 3 }}>#{student.studentNo}</span>}</>
                              )}
                            </span>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: compact ? 2 : 3, flexShrink: 0 }}>
                              {isGroup ? (
                                (() => {
                                  const anyBlacklisted = item.members.some((m: any) => studentBlacklisted[m.student.id]);
                                  return (
                                    <>
                                      <button title={anyBlacklisted ? '解除黑屏' : '黑屏处理'}
                                        onClick={async (e) => { e.stopPropagation();
                                          if (anyBlacklisted) { for (const m of item.members) { try { await api.unblacklistStudent(id, m.student.id); setStudentBlacklisted(prev => ({ ...prev, [m.student.id]: false })); setStudentWarnings(prev => ({ ...prev, [m.student.id]: 0 })); } catch {} } }
                                          else { for (const m of item.members) { try { await api.blacklistStudent(id, m.student.id); setStudentBlacklisted(prev => ({ ...prev, [m.student.id]: true })); } catch {} } }
                                        }}
                                        style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: anyBlacklisted ? '#d1fae5' : '#fee2e2', color: anyBlacklisted ? '#047857' : '#b91c1c', padding: 0 }}>
                                        <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                          {anyBlacklisted ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                        </svg>
                                      </button>
                                      <button title="清除对话"
                                        onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定清除「${item.group?.name || '该小组'}」全体成员的对话记录？`)) return; for (const m of item.members) { try { await api.clearStudentMessages(id, m.student.id); } catch {} } }}
                                        style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                        <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                      </button>
                                    </>
                                  );
                                })()
                              ) : (
                                <>
                                  <button title={studentBlacklisted[sid] ? '解除黑屏' : '黑屏处理'}
                                    onClick={async (e) => { e.stopPropagation(); if (studentBlacklisted[sid]) { try { await api.unblacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: false })); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} } else { try { await api.blacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: true })); } catch {} } }}
                                    style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: studentBlacklisted[sid] ? '#d1fae5' : '#fee2e2', color: studentBlacklisted[sid] ? '#047857' : '#b91c1c', padding: 0 }}>
                                    <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      {studentBlacklisted[sid] ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                    </svg>
                                  </button>
                                  <button title="清除对话"
                                    onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定清除「${student.name}」的全部对话记录？`)) return; try { await api.clearStudentMessages(id, sid); } catch {} }}
                                    style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                    <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {/* 人数（仅小组） */}
                          {isGroup && (
                            <div style={{ fontSize: compact ? 9 : 10, color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>{item.members.length} 人</div>
                          )}
                          {/* 状态标签 */}
                          <div style={{ display: 'flex', gap: compact ? 2 : 3, marginTop: compact ? 2 : 4, flexWrap: 'wrap' }}>
                            {studentBlacklisted[sid] && (
                              <div title="已被黑屏" style={{
                                display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3,
                                padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6,
                                fontSize: compact ? 8 : 10, fontWeight: 600,
                                background: '#1e293b', color: 'white', whiteSpace: 'nowrap',
                              }}>
                                黑屏
                              </div>
                            )}
                            <div title="当前状态" style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3, padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 500, background: status === 'online' ? '#ecfdf5' : status === 'thinking' ? '#fffbeb' : '#f1f5f9', color: status === 'online' ? '#10b981' : status === 'thinking' ? '#f59e0b' : '#94a3b8', whiteSpace: 'nowrap' }}>
                              <span style={{ width: compact ? 4 : 5, height: compact ? 4 : 5, borderRadius: '50%', background: status === 'online' ? '#10b981' : status === 'thinking' ? '#f59e0b' : '#94a3b8', display: 'inline-block' }} />
                              {status === 'online' ? '在线' : status === 'thinking' ? '思考' : '离线'}
                            </div>
                            <div title="对话轮数" style={{ padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 600, background: rounds > 0 ? '#eef2ff' : '#f3f4f6', color: rounds > 0 ? '#2563eb' : '#9ca3af', whiteSpace: 'nowrap' }}>
                              {rounds} 轮
                            </div>
                            {!isGroup && studentWarnings[sid] > 0 && (
                              <div title="警告次数（点击清零）" onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定将「${student.name}」的警告次数清零？`)) return; try { await api.resetStudentWarnings(id, sid); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3, padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 600, background: '#fef2f2', color: '#dc2626', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                                <svg width={compact ? 8 : 10} height={compact ? 8 : 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                {studentWarnings[sid]}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* 最近一轮 Q&A 预览 */}
                      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                        {userMsg ? (
                          <>
                            {/* 学生提问 */}
                            <div style={{
                              padding: '5px 8px', borderRadius: 6,
                              background: '#eef2ff',
                              fontSize: 10, lineHeight: 1.4, color: '#334155',
                              wordBreak: 'break-word',
                            }}>
                              <span style={{ fontWeight: 600, color: '#2563eb', marginRight: 3 }}>
                                {isGroup ? (userMsg.studentName || item.group?.name || student.name) : student.name + ':'}
                              </span>
                              <span dangerouslySetInnerHTML={{ __html: renderMarkdown(
                                userMsg.content
                                  .replace(/```[\s\S]*?```/g, '[代码]')
                                  .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片]')
                                  .replace(/<img\s+[^>]*\/?\s*>/gi, '[图片]')
                                  .slice(0, 150)
                              )}} />
                            </div>
                            {/* AI 回答 */}
                            {assistantMsg && (
                              <div style={{
                                padding: '5px 8px', borderRadius: 6,
                                background: '#f8fafc',
                                border: '1px solid #eef2f6',
                                fontSize: 10, lineHeight: 1.4, color: '#64748b',
                                wordBreak: 'break-word',
                              }}>
                                <span style={{ fontWeight: 600, color: '#16a34a', marginRight: 3 }}>
                                  AI:
                                </span>
                                <span dangerouslySetInnerHTML={{ __html: renderMarkdown(
                                  assistantMsg.content
                                    .replace(/```[\s\S]*?```/g, '[代码]')
                                    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片]')
                                    .replace(/<img\s+[^>]*\/?\s*>/gi, '[图片]')
                                    .slice(0, 150)
                                )}} />
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ padding: '6px 10px', borderRadius: 8, background: '#f9fafb', fontSize: 11, color: '#cbd5e1', textAlign: 'center' }}>
                            暂无对话
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      {groupTooltip && groupMembersMap[groupTooltip.id] && (
        <div style={{
          position: 'fixed', left: groupTooltip.x + 12, top: groupTooltip.y - 10,
          zIndex: 9999, pointerEvents: 'none',
          background: '#1e293b', color: '#f1f5f9',
          padding: '8px 12px', borderRadius: 8, fontSize: 12,
          lineHeight: 1.7, whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>
          {groupMembersMap[groupTooltip.id].map((d: any) => d.studentName).filter(Boolean).join('、')}
        </div>
      )}
      {toast && <Toast msg={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─── 对话分析面板 ──────────────────────────────────────────────

function extractKeywords(texts: string[]): { word: string; count: number }[] {
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
    '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没',
    '看', '好', '自己', '这', '那', '什么', '怎么', '为什么', '因为', '所以',
    '但是', '如果', '虽然', '可以', '这个', '那个', '我们', '他们', '它们',
    '一个', '没有', '不是', '就是', '还是', '或者', '而且', '然后', '已经',
    '只是', '因为', '所以', '可以', '不能', '可能', '应该', '这些', '那些',
    '之后', '之前', '时候', '现在', '已经', '知道', '觉得', '认为', '需要',
    '通过', '进行', '以及', '还有', '之后', '这样', '不是', '就是', '只是',
    '因为', '所以', '可以', '可能', '能够', '把', '被', '让', '给', '对',
    '向', '从', '在', '到', '于', '与', '以', '为', '等', '之', '所', '比',
    '用', '做', '想', '问', '能', '让', '跟', '说', '看', '被',
    '请', '您', '谢谢', '感谢', '请问', '你好', '你好', '没问题',
    '回答', '问题', '答案', '内容', '信息', '方法', '步骤', '方式',
    '是否', '如何', '哪些', '什么', '怎么', '多少', '多久', '哪里',
    '这个', '那个', '这些', '那些', '这里', '那里', '这样', '那样',
    '的', '是', '了', '我', '们', '你', '他', '她', '它', '有', '不',
    '在', '和', '就', '也', '都', '到', '说', '要', '去', '会', '着',
    '没', '看', '好', '把', '被', '让', '给', '对', '向', '从', '以',
    '与', '为', '等', '之', '所', '比', '用', '做', '想', '问', '能',
    '让', '跟', '说', '看', '被', '其', '中', '大', '小', '多', '少',
    '长', '短', '高', '低', '新', '旧', '好', '坏', '快', '慢',
  ]);

  const sentenceDelimiters = /[，。！？、；：""''（）【】《》\n\r\t.?!;:()\-\[\]{}]+/;
  const wordCounts = new Map<string, number>();

  for (const text of texts) {
    const cleaned = text.replace(/https?:\/\/[^\s]+/g, '').replace(/\*\*/g, '').replace(/`[^`]+`/g, '');
    const sentences = cleaned.split(sentenceDelimiters).filter(Boolean);
    for (const sentence of sentences) {
      const chineseChars = sentence.replace(/[^一-鿿]/g, '');
      if (chineseChars.length < 2) continue;
      const chars = [...chineseChars];
      // 提取 2~4 字词组
      const maxGram = Math.min(4, chars.length);
      for (let n = 2; n <= maxGram; n++) {
        for (let i = 0; i <= chars.length - n; i++) {
          const gram = chars.slice(i, i + n).join('');
          if (/^\d+$/.test(gram)) continue;
          if (/^[a-zA-Z]{1,2}$/.test(gram)) continue;
          if (stopWords.has(gram[0]) || stopWords.has(gram[gram.length - 1])) continue;
          if (stopWords.has(gram)) continue;
          wordCounts.set(gram, (wordCounts.get(gram) || 0) + 1);
        }
      }
    }
  }

  // 去掉被更长的高频词包含的片段（"黄瓜" count=5 被 "黄瓜设计" count=5 包含 → 去掉"黄瓜"）
  const entries = [...wordCounts.entries()];
  const filtered = entries.filter(([word, count]) => {
    return !entries.some(([otherWord, otherCount]) =>
      otherWord !== word &&
      otherWord.includes(word) &&
      otherCount >= count * 0.7 &&
      otherWord.length > word.length
    );
  });

  return filtered
    .map(([word, count]) => ({ word, count }))
    .filter(w => w.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

interface AnalyticsPanelProps {
  classroomId: string;
  allMessages: any[];
  loadAnalytics: () => void;
  students: any[];
}

function WordText({ data, ref }: { data: any; ref?: any }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), (data.index ?? 0) * 45);
    return () => clearTimeout(timer);
  }, [data.index]);

  return (
    <text
      ref={ref}
      textAnchor="middle"
      transform={`translate(${data.x}, ${data.y}) rotate(${data.rotate}) scale(${visible ? 1 : 0})`}
      style={{
        fontFamily: data.font,
        fontSize: data.size,
        fontWeight: 600,
        fill: data.fill,
        cursor: 'pointer',
        paintOrder: 'stroke',
        stroke: 'rgba(255,255,255,0.3)',
        strokeWidth: '0.5px',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        opacity: visible ? (hovered ? 1 : 0.88) : 0,
        filter: hovered ? 'brightness(1.15) drop-shadow(0 0 6px currentColor)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {data.text}
    </text>
  );
}

function AnalyticsPanel({ classroomId, allMessages, loadAnalytics, students }: AnalyticsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [cloudSource, setCloudSource] = useState<'user' | 'assistant' | 'both'>('user');
  const cloudRef = useRef<HTMLDivElement>(null);
  const [cloudWidth, setCloudWidth] = useState(360);
  const [cloudHeight, setCloudHeight] = useState(200);

  useLayoutEffect(() => {
    const el = cloudRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setCloudWidth(Math.max(200, Math.floor(rect.width)));
      if (rect.height > 0) setCloudHeight(Math.max(200, Math.floor(rect.height)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { loadAnalytics(); }, [classroomId]);

  // 词云：根据来源过滤，排除被屏蔽词过滤的消息（内容含 ** 表示被替换）
  const isShieldFiltered = (m: any) => (m.content || '').includes('**');
  const filteredForCloud = cloudSource === 'both'
    ? allMessages.filter((m: any) => !isShieldFiltered(m))
    : allMessages.filter((m: any) => m.role === cloudSource && !isShieldFiltered(m));
  const words = extractKeywords(filteredForCloud.map((m: any) => m.content || ''));

  // 活跃学生排名
  const studentMsgCounts = new Map<string, { name: string; count: number }>();
  for (const m of allMessages) {
    const sid = m.classroomStudent?.student?.id;
    const name = m.classroomStudent?.student?.name;
    if (!sid || !name) continue;
    const key = sid;
    const existing = studentMsgCounts.get(key) || { name, count: 0 };
    existing.count++;
    studentMsgCounts.set(key, existing);
  }
  const topStudents = [...studentMsgCounts.entries()]
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topMaxCount = topStudents[0]?.count || 1;

  // 参与人数统计
  const participantStudents = new Map<string, number>();
  for (const m of allMessages) {
    const sid = m.classroomStudent?.student?.id;
    if (sid) participantStudents.set(sid, (participantStudents.get(sid) || 0) + 1);
  }

  if (collapsed) {
    return (
      <div style={{
        background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
        marginBottom: 24, overflow: 'hidden',
      }}>
        <div
          onClick={() => setCollapsed(false)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>对话分析</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
      marginBottom: 24, overflow: 'hidden',
    }}>
      {/* 头部 */}
      <div
        onClick={() => setCollapsed(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', cursor: 'pointer',
          borderBottom: '1px solid #f1f5f9', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>对话分析</span>
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>
            {allMessages.length} 条消息 · {participantStudents.size} 人参与
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); loadAnalytics(); }}
            style={{
              background: '#f1f5f9', border: 'none', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, color: '#64748b',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            刷新
          </button>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 0 }}>
        {/* 左列: 词云 */}
        <div style={{
          alignSelf: 'start', width: '100%',
          padding: '0 20px 20px', borderRight: '1px solid #f1f5f9',
          background: '#fff',
        }}>
          <style>{`
            .wc-cloud text { cursor: pointer; }
          `}</style>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
              }} />
              高频词云
              {words.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', textTransform: 'none' }}>
                  {words.length} 个热词
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([['user', '学生提问'], ['assistant', 'AI回答'], ['both', '全部']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setCloudSource(key)}
                  style={{
                    padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: cloudSource === key ? 600 : 400,
                    background: cloudSource === key ? '#eef2ff' : 'transparent',
                    color: cloudSource === key ? '#2563eb' : '#94a3b8',
                    transition: 'all 0.12s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {words.length === 0 ? (
            <div style={{
              flex: 1, minHeight: 200,
              fontSize: 13, color: '#cbd5e1', textAlign: 'center',
              padding: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, justifyContent: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              暂无对话数据
            </div>
          ) : (
            <div ref={cloudRef} className="wc-cloud" style={{
              minHeight: 200, position: 'relative',
              margin: '0 auto', background: '#fff', borderRadius: 12, width: '100%',
            }}>
              <WordCloud
                words={words.map(w => ({ text: w.word, value: w.count }))}
                width={cloudWidth}
                height={Math.min(Math.floor(cloudWidth * 0.38), 220)}
                font={() => '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'}
                fontSize={(word) => {
                  const min = Math.min(...words.map(w => w.count));
                  const max = Math.max(...words.map(w => w.count));
                  const range = max - min || 1;
                  const normalized = (word.value - min) / range;
                  return 11 + normalized * 16;
                }}
                fill={(_w, i) => `url(#wcg${(i % 6) + 1})`}
                gradients={[
                  { id: 'wcg1', type: 'linear', angle: 45, stops: [{ offset: '0%', color: '#2563eb' }, { offset: '100%', color: '#7c3aed' }] },
                  { id: 'wcg2', type: 'linear', angle: -45, stops: [{ offset: '0%', color: '#db2777' }, { offset: '100%', color: '#ea580c' }] },
                  { id: 'wcg3', type: 'linear', angle: 135, stops: [{ offset: '0%', color: '#059669' }, { offset: '100%', color: '#10b981' }] },
                  { id: 'wcg4', type: 'linear', angle: 90, stops: [{ offset: '0%', color: '#7c3aed' }, { offset: '100%', color: '#c084fc' }] },
                  { id: 'wcg5', type: 'linear', angle: 0, stops: [{ offset: '0%', color: '#dc2626' }, { offset: '100%', color: '#fbbf24' }] },
                  { id: 'wcg6', type: 'linear', angle: -90, stops: [{ offset: '0%', color: '#0891b2' }, { offset: '100%', color: '#2dd4bf' }] },
                ]}
                renderWord={(data, ref) => <WordText data={data} ref={ref} />}
                rotate={() => [0, 0, 0, -15, 15][Math.floor(Math.random() * 5)]}
                spiral="archimedean"
                padding={3}
                enableTooltip
                transition="all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"
              />
            </div>
          )}
        </div>

        {/* 右列: 活跃排行 */}
        <div style={{ alignSelf: 'start', width: '100%', minWidth: 0 }}>
          {/* 活跃学生排名 */}
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              活跃学生 TOP 10
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topStudents.length === 0 ? (
                <div style={{ fontSize: 13, color: '#cbd5e1', textAlign: 'center', padding: 16 }}>暂无数据</div>
              ) : (
                topStudents.map((s, i) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: i < 3 ? ['#fef3c7', '#e5e7eb', '#fed7aa'][i] : '#f1f5f9',
                      color: i < 3 ? ['#92400e', '#475569', '#9a3412'][i] : '#94a3b8',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 13, color: '#334155', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                    <div style={{
                      flex: '0 0 60px', height: 6, borderRadius: 3,
                      background: '#f1f5f9', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${(s.count / topMaxCount) * 100}%`,
                        height: '100%', borderRadius: 3,
                        background: i < 3
                          ? ['#f59e0b', '#94a3b8', '#f97316'][i]
                          : '#a5b4fc',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 40, textAlign: 'right' }}>
                      {s.count} 条
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
