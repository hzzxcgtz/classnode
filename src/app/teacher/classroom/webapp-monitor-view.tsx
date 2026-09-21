'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/lib/socket';
import type { WebappEvent } from '@/lib/socket-events';
import type { ClassroomCardStudent, ClassroomWebappSummary } from '@/lib/types';

/**
 * 每个学生最多留多少条事件在内存里（教师端）。
 *
 * 与 `explore-panel.tsx` 那个 50 不同，那个是**一条消息**的上限（服务端的
 * MAX_WEBAPP_EVENTS_PER_MESSAGE），这个是**一个学生整节课**的展示窗口。
 * 抽屉只展示最近这些条：教师看的是「现在在干什么」，历史应当去课后汇总里看。
 * 200 条 × 十几个学生的量级在浏览器里可以忽略不计（每条是 7 个短字段）。
 */
const MAX_EVENTS_PER_STUDENT = 200;

/** 事件类型的中文文案。用 Record<联合类型, string> 让 SDK 加一种 kind 时这里编译失败。 */
const EVENT_LABELS: Record<WebappEvent['kind'], string> = {
  click: '点击',
  input: '输入',
  scroll: '滚动',
  navigate: '切换页面',
  visibility: '切换前后台',
  report: '主动上报',
};

interface StudentMonitorState {
  dataUrl: string | null;
  /** 最新一帧的**服务端**时刻（`webapp-student-frame` 的 `at`）。 */
  at: number;
  webappId: string;
  frameCount: number;
  clicks: number;
  inputs: number;
  reports: number;
  events: WebappEvent[];
}

function emptyState(webappId: string): StudentMonitorState {
  return { dataUrl: null, at: 0, webappId, frameCount: 0, clicks: 0, inputs: 0, reports: 0, events: [] };
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * 「探究助手」实时视图。
 *
 * 三条不变量：
 *   1. **挂载即订阅、卸载即退订**。退订（`unwatch-webapp-monitor`）不是可选项：
 *      少了它服务端的 `hasWatchers` 恒为真 ⇒ **学生端永不停止推流**，
 *      Ruling 9 的按需推流整个白做（后果是学生的老 iPad 一直在截图上传，而没人在看）。
 *   2. **房间名由 T5 定死**（`teacher:<classroomId>:webapp`），服务端在收到
 *      `watch-webapp-monitor` 时自己 join —— 客户端**没有** join 房间这个动作，
 *      Socket.IO 的房间里没有客户端侧的 join。所以这里只发事件。
 *   3. **只认本课堂名册上的学生**：`webapp-student-event` / `webapp-student-frame`
 *      的载荷里没有 classroomId（契约如此），房间就是归属判据。但教师从课堂 X 切到 Y 时
 *      两条 effect 会在同一 tick 里交替，万一有一帧漏进来，按 studentId 建格会凭空多出
 *      一块图墙格子 —— 所以名册之外的直接丢掉。
 */
export function WebappMonitorView({ classroomId, students, webapps }: {
  classroomId: string;
  students: ClassroomCardStudent[];
  webapps: ClassroomWebappSummary[];
}) {
  const { on, emit } = useSocket();
  const [states, setStates] = useState<Record<string, StudentMonitorState>>({});
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  /**
   * 名册的 ref 镜像：下面那两个订阅回调**不是**每次渲染重建的（重建会在切换途中漏事件），
   * 所以它们读到的必须是当下名册，经 ref 读而不是经闭包。
   */
  const rosterRef = useRef<Set<string>>(new Set());
  useEffect(() => { rosterRef.current = new Set(students.map(s => s.id)); }, [students]);

  useEffect(() => {
    if (!classroomId) return;
    const firstWebappId = webapps[0]?.id ?? '';
    emit('watch-webapp-monitor', { classroomId });

    const merge = (studentId: string, patch: (prev: StudentMonitorState) => StudentMonitorState) => {
      setStates(prev => {
        const current = prev[studentId] ?? emptyState(firstWebappId);
        return { ...prev, [studentId]: patch(current) };
      });
    };

    const unsubFrame = on('webapp-student-frame', data => {
      if (!rosterRef.current.has(data.studentId)) return;
      merge(data.studentId, prev => ({
        ...prev,
        dataUrl: data.dataUrl,
        at: data.at,
        webappId: data.webappId,
        frameCount: prev.frameCount + 1,
      }));
    });

    const unsubEvent = on('webapp-student-event', data => {
      if (!rosterRef.current.has(data.studentId)) return;
      merge(data.studentId, prev => {
        let clicks = prev.clicks;
        let inputs = prev.inputs;
        let reports = prev.reports;
        for (const event of data.events) {
          if (event.kind === 'click') clicks += 1;
          else if (event.kind === 'input') inputs += 1;
          else if (event.kind === 'report') reports += 1;
        }
        const merged = [...prev.events, ...data.events];
        return {
          ...prev,
          webappId: data.webappId || prev.webappId,
          clicks, inputs, reports,
          events: merged.length > MAX_EVENTS_PER_STUDENT ? merged.slice(merged.length - MAX_EVENTS_PER_STUDENT) : merged,
        };
      });
    });

    return () => {
      // ⚠️ **先退订再解绑**（顺序无关，但退订必须真的发生）。这条 emit 是整个按需推流
      // 的「关闸」信号；漏掉它的表现是「学生端一直推，而教师已经走了」，全程无报错。
      emit('unwatch-webapp-monitor', { classroomId });
      unsubFrame?.();
      unsubEvent?.();
    };
    // `webapps` 只用于首帧的兜底 webappId，不进依赖：它变化时重挂会多一对 watch/unwatch，
    // 而重挂期间的那几帧会丢。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, emit, on]);

  const webappName = (webappId: string) => webapps.find(w => w.id === webappId)?.name ?? '探究网页';
  const tiles = students.map(student => ({ student, state: states[student.id] }));
  const withFrame = tiles.filter(item => item.state?.dataUrl).length;
  const active = tiles.filter(item => item.state && item.state.events.length > 0).length;
  const open = openStudentId ? students.find(s => s.id === openStudentId) ?? null : null;
  const openState = openStudentId ? states[openStudentId] : undefined;

  return (
    <div data-webapp-monitor={classroomId} data-monitored={withFrame}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>共 {students.length} 名学生，{withFrame} 名已有画面，{active} 名有互动</span>
        <span style={{ color: '#94a3b8' }}>没人在看时学生端不会推流，学生打开网页后画面会在几秒内出现</span>
      </div>

      {students.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', color: '#94a3b8' }}>
          这个课堂还没有学生
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
          {tiles.map(({ student, state }) => (
            <button key={student.id} type="button" onClick={() => setOpenStudentId(student.id)}
              style={{
                textAlign: 'left', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                border: '1px solid #e2e8f0', background: 'white', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column',
              }}>
              <div style={{ aspectRatio: '16 / 10', background: '#f1f5f9', position: 'relative', overflow: 'hidden' }}>
                {state?.dataUrl ? (
                  <img src={state.dataUrl} alt={`${student.student.name} 的探究网页缩略图`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.75rem' }}>
                    {student.status === 'online' ? '等待画面…' : '未在线'}
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.813rem', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.student.name}</span>
                <span style={{ fontSize: '0.688rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                  点击 {state?.clicks ?? 0} · 输入 {state?.inputs ?? 0} · 上报 {state?.reports ?? 0}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <>
          <div onClick={() => setOpenStudentId(null)} style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.12)' }} />
          <div role="dialog" aria-modal="true" aria-label={`${open.student.name} 的探究记录`} style={{
            position: 'fixed', top: 96, right: 24, bottom: 24, width: 420, zIndex: 291,
            background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, #f8faff, #f0f4ff)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{open.student.name}</h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {openState?.dataUrl ? `最新画面 ${timeLabel(openState.at)} · 共 ${openState.frameCount} 帧` : '还没有收到画面'}
                </div>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setOpenStudentId(null)} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>关闭</button>
            </div>
            {openState?.dataUrl && (
              <div style={{ borderBottom: '1px solid var(--border)', background: '#f1f5f9' }}>
                <img src={openState.dataUrl} alt={`${open.student.name} 的探究网页画面`} style={{ width: '100%', display: 'block' }} />
              </div>
            )}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>{openState ? webappName(openState.webappId) : '探究网页'}</span>
              <span>点击 {openState?.clicks ?? 0}</span>
              <span>输入 {openState?.inputs ?? 0}</span>
              <span>上报 {openState?.reports ?? 0}</span>
            </div>
            <div className="preview-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px' }}>
              {!openState || openState.events.length === 0 ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>
                  还没有互动记录。学生点击、输入时这里会实时出现。
                </div>
              ) : (
                [...openState.events].reverse().map((event, index) => (
                  <div key={`${event.at}-${index}`} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f8fafc', fontSize: '0.75rem' }}>
                    <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{timeLabel(event.at)}</span>
                    <span style={{ color: '#2563eb', whiteSpace: 'nowrap', fontWeight: 500 }}>{EVENT_LABELS[event.kind] ?? event.kind}</span>
                    <span style={{ flex: 1, minWidth: 0, color: '#475569', wordBreak: 'break-all' }}>
                      {event.selector || '—'}
                      {/* ⚠️ 只显示**字符个数**，永远不显示输入内容（规格 §5.4 的隐私红线）。 */}
                      {event.kind === 'input' && event.length > 0 ? ` · ${event.length} 个字符` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
