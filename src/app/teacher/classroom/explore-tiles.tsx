'use client';

import type { ClassroomCardStudent, ClassroomWebappSummary } from '@/lib/types';
import { tileCaption, timeLabel, type StudentMonitorState } from './use-webapp-monitor';

/**
 * 探究助手在**看板格子里**的那一块（P2.3 把原来的「探究助手视图」拆成了这些零件）。
 *
 * 这个文件里**没有 socket**：订阅只有一份，在 `use-webapp-monitor.ts` 里，
 * 由 `page.tsx` 调用一次。这里全是纯渲染 —— 传进来什么就画什么。
 */

/** 缩略图的底色与容器。图墙与详情面板共用，免得两处各画一个略不一样的框。 */
const shotBoxStyle = {
  position: 'relative',
  overflow: 'hidden',
  background: '#f1f5f9',
  borderRadius: 8,
} as const;

/**
 * 学生格子内容区里的「探究助手」。
 *
 * ⚠️ `objectFit: contain` 而不是 `cover`：cover 是**裁切填满**，会把画面切掉一块。
 * 学生端截的是**视口**，比例由他自己的窗口决定，未必是 16:10 ——
 * 实测常见的产物是 320x240 与 320x397 两种。图墙的任务是「一眼看出这个学生在做什么」，
 * **看全**比填满格子重要；留白处的底色就是上面的 background。
 */
export function ExploreTile({ name, state, online, captureEnabled, compact = false }: {
  /** 学生名，只用于 `alt` 文案（格子的姓名行在内容区外面）。 */
  name: string;
  state?: StudentMonitorState;
  online: boolean;
  captureEnabled: boolean;
  compact?: boolean;
}) {
  const caption = tileCaption(online, captureEnabled, state?.presence ?? null, state?.captureBlocked ?? false);
  const small = compact ? '0.625rem' : '0.75rem';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6, flex: 1, minHeight: 0 }}>
      <div style={{ ...shotBoxStyle, flex: 1, minHeight: 0 }}>
        {state?.dataUrl ? (
          <img src={state.dataUrl} alt={`${name} 的探究网页缩略图`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: '#94a3b8', fontSize: small, textAlign: 'center', padding: 4 }}>
            <span>{caption.label}</span>
            {caption.detail ? <span style={{ fontSize: '0.688rem', color: '#cbd5e1' }}>{caption.detail}</span> : null}
          </div>
        )}
      </div>
      {/* 有画面时以画面为准（画面本身就是最强的证据），没有画面时才用文字档。
          这里**没有**「点击 X · 输入 Y · 上报 Z」那一行，也不该有。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: small, color: '#64748b', whiteSpace: 'nowrap' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {state?.dataUrl ? `最新画面 ${timeLabel(state.at)}` : caption.label}
        </span>
        {state?.presence ? <span>{state.presence.visible ? '在用' : '已切走'}</span> : null}
        {state?.presence && state.presence.depth > 0 ? <span>滚到 {state.presence.depth}%</span> : null}
      </div>
    </div>
  );
}

/**
 * 小组格子里的探究画面：**每个成员一条**。
 *
 * 为什么需要它：分组 / 高级模式下看板按**小组**成格（不是按人），而老的「探究助手视图」
 * 是按人不按组的（它遍历 `students`）。合并之后如果小组格子不画成员画面，
 * 这些课堂就**再也看不到任何缩略图**了 —— 一条静默的能力丢失。
 */
export function ExploreMemberStrip({ members, states, statuses, captureEnabled, onOpenStudent }: {
  members: ClassroomCardStudent[];
  states: Record<string, StudentMonitorState>;
  /** 学生 id → 在线状态的实时映射（与主格子同源，见 page.tsx 的 `getDisplayCardStatus`）。 */
  statuses: Record<string, string>;
  captureEnabled: boolean;
  /** 点某个成员 ⇒ 打开他的探究详情（会让他转高频截图）。 */
  onOpenStudent: (studentId: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flex: 1, minHeight: 0 }}>
      {members.map(member => {
        const state = states[member.id];
        const online = statuses[member.id] === 'online' || statuses[member.id] === 'thinking';
        const caption = tileCaption(online, captureEnabled, state?.presence ?? null, state?.captureBlocked ?? false);
        return (
          <button key={member.id} type="button" onClick={(e) => { e.stopPropagation(); onOpenStudent(member.id); }}
            title={`${member.student.name} · ${caption.label}${caption.detail ? ` · ${caption.detail}` : ''}`}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ ...shotBoxStyle, flex: 1, minHeight: 0, display: 'block' }}>
              {state?.dataUrl ? (
                <img src={state.dataUrl} alt={`${member.student.name} 的探究网页缩略图`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              ) : (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', color: '#94a3b8' }}>
                  {caption.label}
                </span>
              )}
            </span>
            <span style={{ fontSize: '0.625rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.student.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 某个学生的探究详情（右侧浮层）。从原 `WebappMonitorView` 的抽屉原样搬来。
 *
 * 抽屉里**有当前状态、没有事件流**：这里曾经是最近 200 条操作事件的列表
 * （含「只显示字符个数、不显示输入内容」那条隐私约束）—— 那条链路没有回来，
 * 而恢复的文字档被服务端收成了**当前状态**，所以它在上面的信息栏里就说完了。
 */
export function ExploreDetailPanel({ student, state, online, webapps, captureEnabled, onClose }: {
  student: ClassroomCardStudent;
  state?: StudentMonitorState;
  online: boolean;
  webapps: readonly ClassroomWebappSummary[];
  captureEnabled: boolean;
  onClose: () => void;
}) {
  const webappName = state ? (webapps.find(w => w.id === state.webappId)?.name ?? '探究网页') : '探究网页';
  const caption = tileCaption(online, captureEnabled, state?.presence ?? null, state?.captureBlocked ?? false);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.12)' }} />
      <div role="dialog" aria-modal="true" aria-label={`${student.student.name} 的探究记录`} style={{
        position: 'fixed', top: 96, right: 24, bottom: 24, width: 420, zIndex: 291,
        background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, #f8faff, #f0f4ff)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.student.name}</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              {state?.dataUrl ? `最新画面 ${timeLabel(state.at)} · 共 ${state.frameCount} 帧` : '还没有收到画面'}
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>关闭</button>
        </div>
        {state?.dataUrl && (
          <div style={{ borderBottom: '1px solid var(--border)', background: '#f1f5f9' }}>
            <img src={state.dataUrl} alt={`${student.student.name} 的探究网页画面`} style={{ width: '100%', display: 'block' }} />
          </div>
        )}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{webappName}</span>
          {/* 与格子**同一套文案**（同一个 tileCaption）——两处不一致会让教师以为
              自己看到的是两个学生的状态。 */}
          <span>{caption.label}</span>
          <span>{state?.dataUrl ? timeLabel(state.at) : '暂无画面'}</span>
          {state?.presence && state.presence.depth > 0 ? <span>滚到 {state.presence.depth}%</span> : null}
          {state?.presence && state.presence.switches > 0 ? <span>切换过 {state.presence.switches} 次</span> : null}
        </div>
        <div className="preview-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px' }}>
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>
            {state?.dataUrl
              ? '这里只呈现定时快照（就是上面那张画面），以及「有没有在用、滚到哪儿」这两项状态。点击与输入不做记录。'
              : '还没有收到画面。学生打开探究网页后，画面会每隔几秒更新一次。'}
          </div>
        </div>
      </div>
    </>
  );
}
