'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo, Suspense, useLayoutEffect, type ReactNode, type Ref } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WordCloud, type Word, type WordRendererData } from "@isoterik/react-word-cloud";
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { stripImages, stripMarkdownToPlainText, Markdown } from '@/lib/markdown';
import { getApiBaseUrl, getClassroomPort } from '@/lib/api-base';
const API_BASE = getApiBaseUrl();
function fixSvgUrl(svg: string) { return svg ? svg.replace(/href="\/uploads\//g, `href="${API_BASE}/uploads/`) : svg; }
import { QRCodeSVG } from 'qrcode.react';
import QRCode from 'qrcode';
import { Toast } from '@/lib/components';
import { useWebappMonitor } from './use-webapp-monitor';
import { ExploreDetailPanel, ExploreMemberStrip, ExploreTile } from './explore-tiles';
import { applyModuleState, DEFAULT_MODULE_STATE, isClassroomModuleKey, isClassroomModuleState, isModuleId, MODULE_KEY_BY_ID, MODULE_KEYS, MODULE_STATES, moduleStateOf, type ModuleId } from '@/lib/classroom-modules';
import type { AgentSummary, AvatarSummary, ClassroomCardGroup, ClassroomCardMessage, ClassroomCardStudent, ClassroomDetail, ClassroomMessage, ClassroomModuleKey, ClassroomModuleState, StudentSummary } from '@/lib/types';
import type { Socket } from 'socket.io-client';

type ClassroomAgentDisplay = Pick<AgentSummary, 'id' | 'name' | 'logo'>;
type ClassroomGroupDisplay = { id: string; name: string };
type DisplayMessage = Pick<ClassroomMessage, 'content' | 'role' | 'createdAt' | 'roundIndex' | 'fileUrls' | 'fileNames'> & { id?: string };
type ClassroomGroupCard = { group: ClassroomCardGroup | null; members: ClassroomCardStudent[] };
type ClassroomDisplayCard = ClassroomCardStudent | ClassroomGroupCard;
type StudentBoardFilter = 'all' | 'online' | 'thinking' | 'attention' | 'offline';

function isClassroomGroupCard(card: ClassroomDisplayCard): card is ClassroomGroupCard {
  return 'members' in card;
}

function getGroupInitial(name?: string | null): string {
  return Array.from(name?.trim() || '')[0] || '组';
}

function PermissionMenuItem({ label, enabled, busy, onToggle }: {
  label: string;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button role="menuitemcheckbox" aria-checked={enabled} disabled={busy} onClick={onToggle}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px', border: 0, borderRadius: 8, background: 'transparent', cursor: busy ? 'wait' : 'pointer', color: '#334155', textAlign: 'left', fontSize: '0.813rem', opacity: busy ? 0.7 : 1 }}>
      <span style={{ width: 34, height: 20, padding: 2, borderRadius: 999, background: enabled ? '#2563eb' : '#cbd5e1', display: 'flex', justifyContent: enabled ? 'flex-end' : 'flex-start', transition: 'all .15s', flexShrink: 0 }}>
        <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(15,23,42,.2)' }} />
      </span>
      <span style={{ flex: 1 }}>{busy ? '更新中...' : label}</span>
      <span style={{ color: enabled ? '#16a34a' : '#94a3b8', fontSize: '0.75rem' }}>{enabled ? '已开启' : '已关闭'}</span>
    </button>
  );
}
/**
 * 「课堂权限」浮动窗里的一段 —— 三段分别对应三件套。
 *
 * <section> + aria-label 而不是一个裸 div：读屏可以按段跳（region），三段各自有名字。
 * 段标题的字号/字重/颜色与原来菜单里那几个小标题**逐字一致**，所以从菜单搬到浮窗之后
 * 观感不变；只是外面那层从 320px 的窄条换成了浮窗。
 *
 * `label` 由调用方用 `MODULE_ID_LABELS` 传进来，不在这里再写一遍
 * 「学习单 / 探究空间 / 智能学伴」——那三个名字已经有唯一出处（见文件上方 MODULE_LABELS 的注释）。
 */
function PermissionSection({ label, note, first = false, children }: {
  label: string;
  /** 可选的一句话说明，排在标题下面、控件上面。 */
  note?: string;
  /** 第一段不画上分隔线（它上面就是浮窗的标题栏）。 */
  first?: boolean;
  children?: ReactNode;
}) {
  return (
    <section aria-label={label} style={{ padding: '2px 8px 12px', borderTop: first ? 'none' : '1px solid #f1f5f9' }}>
      <div style={{ padding: '6px 10px 8px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>{label}</div>
      {note && <div style={{ padding: '0 10px 6px', fontSize: '0.688rem', color: '#94a3b8', lineHeight: 1.5 }}>{note}</div>}
      {children}
    </section>
  );
}

/** 模块名与三态的中文文案。用 Record<联合类型, string> 是为了让三态词汇表扩项时这里报错。 */
const MODULE_LABELS: Record<ClassroomModuleKey, string> = {
  'learning-sheet': '学习单',
  explorer: '探究空间',
  companion: '智能学伴',
};

const MODULE_STATE_LABELS: Record<ClassroomModuleState, string> = {
  open: '开放',
  preview: '预告',
  hidden: '隐藏',
};

/**
 * 同一个中文名，按 `ModuleId`（前端语义名）索引。
 *
 * 不重写一份字面量：`MODULE_LABELS` 已经按后端 key 存了这三个名字，这里只是**换一把钥匙**
 * ——写第二份字面量就是给自己留一个会漂移的副本（改了一处、另一处照旧）。
 * `satisfies Record<ModuleId, string>` 保证漏掉一个模块时**编译失败**。
 */
const MODULE_ID_LABELS = {
  worksheet: MODULE_LABELS[MODULE_KEY_BY_ID.worksheet],
  explore: MODULE_LABELS[MODULE_KEY_BY_ID.explore],
  companion: MODULE_LABELS[MODULE_KEY_BY_ID.companion],
} as const satisfies Record<ModuleId, string>;

const MODULE_STATE_HINTS: Record<ClassroomModuleState, string> = {
  open: '学生可直接使用',
  preview: '学生可见但被锁定',
  hidden: '学生端不显示',
};

/**
 * 探究空间画面的分辨率档位。
 *
 * `hint` 是**实测的单帧体积**（真实教师网页、桌面浏览器），直接写在按钮上给教师看：
 * 采集的代价不是一个抽象概念，是每帧几十 K 字符的传输与存盘。640 一帧约 24K，
 * 已经占掉单条上限（32K）的七成以上 —— 教师看不到这个数字就没法判断值不值。
 * ⚠️ 这些是**实测值**，不是按宽度线性估算出来的，别"顺手改成公式"。
 */
const WEBAPP_WIDTH_OPTIONS: Array<{ width: number; hint: string }> = [
  { width: 160, hint: '约4.6K' },
  { width: 240, hint: '约7.5K' },
  { width: 320, hint: '约12.5K' },
  { width: 480, hint: '约22K' },
  { width: 640, hint: '约24K' },
];

/** 画面更新的基准周期档位（毫秒）。服务端接受 5000~60000，这里只给四档常用的。 */
const WEBAPP_INTERVAL_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 10000, label: '10 秒' },
  { ms: 15000, label: '15 秒' },
  { ms: 20000, label: '20 秒' },
  { ms: 30000, label: '30 秒' },
];

// 缺省值必须与服务端 `DEFAULT_WEBAPP_CAPTURE` 一致（320 / 10000）。
// 教师端拿到的可能是老数据（没有这三个字段），此时按默认显示 —— 而不是显示成"关闭/最小档"。
const DEFAULT_WEBAPP_WIDTH = 320;
const DEFAULT_WEBAPP_FRAME_INTERVAL_MS = 10000;

/**
 * 采集参数里的一个档位按钮。
 *
 * 与下面的 ModuleStateRadio 刻意分开：那个的说明只进 `title`（悬停才可见），
 * 而这里每一档旁边必须**明明白白写着代价**，教师扫一眼就能比较。
 * 选中态、disabled、busy 的表现则与 ModuleStateRadio 保持一致（同一份菜单里两套观感会更糟）。
 */
function CaptureOption({ label, hint, selected, busy, disabled, onSelect }: {
  label: string;
  /** 副标注（分辨率档位用来写实测体积）。没有就不占位，行高靠 minHeight 对齐。 */
  hint?: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} aria-busy={busy} title={hint ? `${label}（${hint}）` : label}
      disabled={disabled} onClick={onSelect}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: 34, padding: '4px 2px', border: `1px solid ${selected ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#eff6ff' : 'white', color: selected ? '#1d4ed8' : '#475569', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}>
      <span>{busy ? '...' : label}</span>
      {hint && <span style={{ fontSize: '0.625rem', fontWeight: 400, color: selected ? '#3b82f6' : '#94a3b8' }}>{hint}</span>}
    </button>
  );
}

/**
 * 三态里的一个选项。与 PermissionMenuItem 的开关刻意分开：那是布尔、
 * role="menuitemcheckbox"；这里是三选一、role="menuitemradio"。混在一起
 * 会让同一份菜单里出现两套互斥语义，读起来像坏了。
 */
function ModuleStateRadio({ label, hint, selected, busy, disabled, onSelect }: {
  label: string;
  hint: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} aria-busy={busy} title={hint}
      disabled={disabled} onClick={onSelect}
      style={{ flex: 1, minHeight: 30, padding: '5px 6px', border: `1px solid ${selected ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#eff6ff' : 'white', color: selected ? '#1d4ed8' : '#475569', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}>
      {label}
    </button>
  );
}

/**
 * 看板上的一个「段选」按钮（跟随/指定，以及指定模式下的三选一）。
 *
 * 与 `ModuleStateRadio` 刻意分开：那个是**菜单里的**选项（`role="menuitemradio"`，
 * 生命周期跟着菜单走），这个是常驻在筛选行上的开关，用 `aria-pressed` 而不是
 * `menuitemradio` —— 挂在菜单语义下的常驻控件会让读屏把它念成菜单的一部分。
 */
function SegmentedButton({ label, hint, selected, onSelect }: {
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} title={hint} onClick={onSelect}
      style={{ minHeight: 30, padding: '5px 10px', border: `1px solid ${selected ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#eff6ff' : 'white', color: selected ? '#1d4ed8' : '#475569', cursor: 'pointer', fontSize: '0.75rem', fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
}

/**
 * 「此刻各模块人数」里的一个计数块。
 *
 * `muted` 用在两类项上：**不是三件套**的（首页 / 未知），以及**尚未支持**的学习单
 * —— 它们与真正能用的模块不是一个分量，同样的着色会让人以为它们也一样能用。
 */
function ModuleCountChip({ label, value, hint, muted = false }: {
  label: string;
  value: number;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: '0.75rem', color: muted ? '#94a3b8' : '#475569' }}>{label}</span>
      <span style={{ fontSize: '1.125rem', fontWeight: 700, color: muted ? '#cbd5e1' : '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {hint && <span style={{ fontSize: '0.625rem', color: '#cbd5e1' }}>{hint}</span>}
    </span>
  );
}

/**
 * 看板模式（P2.3）—— 两个视图（`board` / `webapp`）合成一个之后，格子内容改由它决定：
 *   · `follow` 每格显示**该学生此刻在用**的模块；
 *   · `assign` 全班格子统一显示教师选定的那一个模块。
 */
type BoardMode = 'follow' | 'assign';

/**
 * 一个格子**内容区**该渲染什么。
 *   · `ModuleId`  —— 三件套之一（跟随模式下由该学生的 focus 决定，指定模式下是教师选的）
 *   · `'home'`    —— 学生此刻停在**首页**（focus 明确是 `null`）
 *   · `'unknown'` —— 还没收到这个学生的 focus。**不猜**：猜一个模块会让教师看到
 *                    一个不存在的事实（比一句「不知道」糟得多）。
 */
type TileModule = ModuleId | 'home' | 'unknown';

/** 小组格子专用：组内成员此刻**不在同一个模块**。 */
type GroupTileModule = TileModule | 'mixed';

type StudentPresenceEvent = { studentId: string };
type StudentThinkingEvent = StudentPresenceEvent & { status: boolean };
type StudentMessageEvent = StudentPresenceEvent & {
  content: string;
  role: string;
  roundIndex?: number | null;
  timestamp: string;
  shieldFiltered?: boolean;
  fileUrls?: string | null;
  fileNames?: string | null;
};
type ShieldWarningEvent = StudentPresenceEvent & { warningCount: number };
type StudentAvatarChangedEvent = StudentPresenceEvent & { avatarId: number | null; svgContent?: string | null };
type ClassroomPermissionEvent = { allow: boolean };

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

  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [students, setStudents] = useState<ClassroomCardStudent[]>([]);
  const [studentStatuses, setStudentStatuses] = useState<Record<string, string>>({});
  const [deepThinkingStatuses, setDeepThinkingStatuses] = useState<Record<string, boolean>>({});
  const [studentRounds, setStudentRounds] = useState<Record<string, number>>({});
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ClassroomGroupDisplay | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);
  const [codeScreenKey, setCodeScreenKey] = useState(0);
  const [teacherCode, setTeacherCode] = useState('');
  const [studentUrl, setStudentUrl] = useState('');
  const [studentAvatars, setStudentAvatars] = useState<Record<number, string>>({});
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [loadingMessages, setLoadingMessages] = useState(false);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, offX: 0, offY: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const selectedStudentIdRef = useRef<string | null>(null); // 避免 useEffect 依赖 selectedStudent 导致重复挂载 socket
  // 投屏弹窗打开时监听 Socket 网卡切换事件
  useEffect(() => {
    if (codeScreenKey > 0) {
      let socket: Socket | null = null;
      import('socket.io-client').then(({ io }) => {
        socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'] });
        socket.on('nic-changed', () => {
          fetch(`${getApiBaseUrl()}/api/server-info`, { credentials: 'include' }).then(r => r.json()).then(d => {
            if (d.studentUrl) setStudentUrl(d.studentUrl);
          }).catch(() => {});
        });
      });
      return () => { if (socket) socket.disconnect(); };
    }
  }, [codeScreenKey]);
  // 加载头像 SVG
  useEffect(() => {
    api.getAvatarsAll('student').then(data => {
      const m: Record<number, string> = {};
      data.forEach((a: AvatarSummary) => { m[a.id] = a.svgContent; });
      setStudentAvatars(m);
    }).catch(() => {});
  }, []);

  // 全屏图片预览：ESC 关闭 + 滚轮缩放 + 鼠标拖拽
  useEffect(() => {
    if (!fullscreenImg) return;
    const d = dragRef.current;
    d.dragging = false; d.offX = 0; d.offY = 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFullscreenImg(null); setZoomLevel(1); }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.abs(e.deltaY) < 20 ? e.deltaY * 0.005 : e.deltaY > 0 ? -0.12 : 0.12;
      setZoomLevel(prev => Math.max(0.3, Math.min(15, prev + step)));
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      d.dragging = true;
      d.startX = e.clientX - d.offX;
      d.startY = e.clientY - d.offY;
      if (overlayRef.current) overlayRef.current.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!d.dragging) return;
      d.offX = e.clientX - d.startX;
      d.offY = e.clientY - d.startY;
      setImgOffset({ x: d.offX, y: d.offY });
    };
    const onMouseUp = () => {
      if (d.dragging) {
        d.dragging = false;
        if (overlayRef.current) overlayRef.current.style.cursor = 'zoom-out';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [fullscreenImg]);

  const openFullscreenImage = (url: string) => {
    setZoomLevel(1);
    setImgOffset({ x: 0, y: 0 });
    setFullscreenImg(url);
  };


  /** 生成并下载带 Logo 的二维码图片 */
  const downloadQRCode = async () => {
    const qrValue = studentUrl ? `${studentUrl}?code=${teacherCode}` : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}/classroom?code=${teacherCode}`;
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
  const [allMessages, setAllMessages] = useState<ClassroomMessage[]>([]);
  const [classroomAgent, setClassroomAgent] = useState<ClassroomAgentDisplay | null>(null);
  const [gridFullscreen, setGridFullscreen] = useState(false);
  /**
   * 看板模式（P2.3 把 `board` / `webapp` 两个视图合成了一个）。
   *
   * ⚠️ 这里**曾经**是 `teacherView: 'board' | 'webapp'` + `TeacherPageTabs` 的视图切换。
   * 两个视图各自有用的东西（学生的在线/轮数、探究空间的缩略图与「已打开/滚到哪」）
   * 现在都长在**同一批格子**里，切换按钮因此没有了存在意义。
   *
   * 默认 `follow`：教师绝大多数时候想知道「这个学生此刻在干什么」，
   * 而 `assign` 是一次主动的、有明确目的的选择（全班看同一个模块）。
   */
  const [boardMode, setBoardMode] = useState<BoardMode>('follow');
  /** 指定模式下全班统一显示的那个模块。默认「智能学伴」= 合并前那个视图的内容。 */
  const [assignModule, setAssignModule] = useState<ModuleId>('companion');
  /**
   * 学生 id → 他**此刻在哪个模块**（`null` = 首页）。数据源是 `student-module-focus`。
   *
   * ⚠️ 键不存在 = **还没收到**这个学生的 focus（不猜、也不按 null 处理）：
   * 服务端只对「已知状态」的学生回放，离线或从没切换过的学生本就没有状态。
   * 所以下面 `resolveTileModule` 用 `hasOwnProperty` 判在场，而不是读值判空。
   */
  const [studentModuleFocus, setStudentModuleFocus] = useState<Record<string, ModuleId | null>>({});
  /** 教师点开的**探究详情**是哪个学生（`null` = 没点开）。它会让学生转高频截图。 */
  const [exploreDetailId, setExploreDetailId] = useState<string | null>(null);
  const [fsCols, setFsCols] = useState(5);
  const gridRef = useRef<HTMLDivElement>(null);
  const fsContentRef = useRef<HTMLDivElement>(null);
  const fullscreenContentRef = useRef<HTMLDivElement>(null);
  const { joinTeacherBoard, on, emit } = useSocket();
  const [notifyState, setNotifyState] = useState<{ show: boolean; studentId?: string; studentName?: string; groupId?: string }>({ show: false });
  const [notifyText, setNotifyText] = useState('');
  const [notifySent, setNotifySent] = useState(false);
  const notifySendingRef = useRef(false);
  const drawerMessagesRef = useRef<HTMLDivElement>(null);
  const groupTooltipThrottle = useRef(0);
  const [studentWarnings, setStudentWarnings] = useState<Record<string, number>>({});
  const [studentBlacklisted, setStudentBlacklisted] = useState<Record<string, boolean>>({});
  const [groupTooltip, setGroupTooltip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const controlBusyRef = useRef(false);
  // 「课堂权限」是一个**浮动窗**（不再是下拉菜单），所以这里没有「点外面关」的那个 ref：
  // 遮罩本身就是那块「外面」（见浮窗 JSX 里遮罩的 onClick）。触发按钮的 ref 只用来在关闭时把焦点还回去。
  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false);
  const permissionsDialogRef = useRef<HTMLDivElement>(null);
  const permissionsButtonRef = useRef<HTMLButtonElement>(null);
  /** 是否**曾经**打开过。只为了避免首屏渲染（浮窗本来是关着的）去抢焦点。 */
  const permissionsDialogOpenedRef = useRef(false);
  const [showModulesMenu, setShowModulesMenu] = useState(false);
  const modulesMenuRef = useRef<HTMLDivElement>(null);
  const [studentBoardFilter, setStudentBoardFilter] = useState<StudentBoardFilter>('all');
  const [clearBusy, setClearBusy] = useState<string | null>(null);
  const clearBusyRef = useRef(false);

  // 「点外面关」只留给还在用下拉菜单的「模块状态」。
  // ⚠️ 课堂权限改成浮动窗之后**必须**把它从这份监听里摘掉：`permissionsMenuRef` 一旦是个空 ref，
  // `!undefined` 恒为真，浮窗会在**任何** pointerdown（含窗内每一次点击）时被关掉 ——
  // 而 pointerdown 早于 click，后果是窗内每个控件都点不动（点下去窗先没了）。
  useEffect(() => {
    const closeMenusOnOutsidePointerDown = (event: PointerEvent) => {
      if (!modulesMenuRef.current?.contains(event.target as Node)) setShowModulesMenu(false);
    };
    document.addEventListener('pointerdown', closeMenusOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsidePointerDown);
  }, []);

  // 课堂权限浮动窗的 Esc 关闭（"关闭方式"三条里的第二条：遮罩 / 关闭按钮见浮窗 JSX）。
  //
  // 写法照同项目已有的浮窗（`WebappPreviewDialog`、agent-form-modal）：监听只在浮窗**开着**时挂着，
  // 关掉之后这个 handler 根本不存在。这个 handler 从头到尾只调用 `setShowPermissionsDialog(false)`
  // 这一个 setter —— 它没有能力去关别的浮层。
  // ⚠️ 不要往这里加别的 setter：这页上吃 Esc 的浮层不止一个（全屏图片预览、投屏发码），
  // 顺手一起关，教师按一次 Esc 会连带丢掉投屏画面。
  useEffect(() => {
    if (!showPermissionsDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPermissionsDialog(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPermissionsDialog]);

  // 焦点进出：打开时进浮窗，关闭时还回触发按钮。
  // 少了「进」这一步，焦点会留在工具栏那个按钮上 —— 键盘与读屏用户感知不到自己刚打开了一个窗
  // （浮窗容器上的 `tabIndex={-1}` 就是为了让它能被聚焦）。
  // `permissionsDialogOpenedRef` 只是防止首屏渲染时（浮窗本来是关着的）跳去抢焦点。
  useEffect(() => {
    if (showPermissionsDialog) {
      permissionsDialogOpenedRef.current = true;
      permissionsDialogRef.current?.focus();
      return;
    }
    if (permissionsDialogOpenedRef.current) permissionsButtonRef.current?.focus();
  }, [showPermissionsDialog]);

  // 分组/高级模式：按小组聚合卡片
  const groupCards = useMemo<ClassroomGroupCard[] | null>(() => {
    if (!classroom || (classroom.mode !== 'advanced' && classroom.mode !== 'group')) return null;
    const map = new Map<string, ClassroomGroupCard>();
    for (const cs of students) {
      if (!cs.groupId) continue;
      let groupCard = map.get(cs.groupId);
      if (!groupCard) {
        groupCard = { group: cs.group ?? null, members: [] };
        map.set(cs.groupId, groupCard);
      }
      groupCard.members.push(cs);
    }
    // 组内按学号排序
    for (const g of map.values()) {
      g.members.sort((a, b) => (parseInt(a.student.studentNo ?? '', 10) || 999999) - (parseInt(b.student.studentNo ?? '', 10) || 999999));
    }
    // 按组名排序
    return Array.from(map.values()).sort((a, b) => (a.group?.name || '').localeCompare(b.group?.name || ''));
  }, [classroom, students]);

  // 课堂小组 ID → 创建课堂时冻结的成员快照；不依赖可变的小组名称。
  const groupMembersMap = useMemo(() => {
    const map: Record<string, Array<{ studentName: string; groupName: string }>> = {};
    if (!groupCards || !classroom?.groupMembersMap) return map;
    for (const g of groupCards) {
      if (!g.group?.id || !g.group.name) continue;
      const group = g.group;
      const backendData = classroom.groupMembersMap[group.id];
      if (backendData) {
        map[group.id] = backendData.members.map((m) => ({
          studentName: m.name,
          groupName: group.name,
        }));
      }
    }
    return map;
  }, [groupCards, classroom]);

  const classroomStudentCount = groupCards
    ? groupCards.reduce((total, group) => total + (group.group?.id ? (groupMembersMap[group.group.id]?.length ?? 0) : 0), 0)
    : students.length;

  // 打开抽屉时自动滚动到底部（最新消息）
  useEffect(() => {
    if (selectedStudent && drawerMessagesRef.current) {
      // 等待 React 渲染消息列表后再滚动
      requestAnimationFrame(() => {
        drawerMessagesRef.current?.scrollTo({ top: 999999, behavior: 'smooth' });
      });
    }
  }, [selectedStudent, messages]);

  // 投屏{selectedRounds.length > 0 ? ` (${selectedRounds.length})` : ''}讲评展开时自动滚到底部
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
      setTeacherCode(cr.code || '');
      setPaused(cr.status === 'paused');
      const students = cr.students || [];
      // 排序：标准模式按学号，分组/高级模式按组名
      const mode = cr.mode || 'standard';
      if (mode === 'standard') {
        students.sort((a, b) => (parseInt(a.student.studentNo ?? '', 10) || 999999) - (parseInt(b.student.studentNo ?? '', 10) || 999999));
      } else {
        students.sort((a, b) => {
          const ga = a.group?.name || '';
          const gb = b.group?.name || '';
          if (ga !== gb) return ga.localeCompare(gb);
          return (parseInt(a.student.studentNo ?? '', 10) || 999999) - (parseInt(b.student.studentNo ?? '', 10) || 999999);
        });
      }
      setStudents(students);
      const statuses: Record<string, string> = {};
      const rounds: Record<string, number> = {};
      const warnings: Record<string, number> = {};
      const blacklisted: Record<string, boolean> = {};
      students.forEach((s) => {
        rounds[s.id] = s.totalRounds || 0;
        warnings[s.id] = s.warningCount || 0;
        blacklisted[s.id] = s.blacklisted || false;
      });
      // 不通过 DB status 字段初始化在线状态，依赖 HTTP API 获取当前在线学生
      try {
        const online = await api.getOnlineStudentIds(id);
        online.studentIds?.forEach((sid: string) => { statuses[sid] = 'online'; });
      } catch {}
      setStudentStatuses(statuses);
      setStudentRounds(rounds);
      setStudentWarnings(warnings);
      setStudentBlacklisted(blacklisted);

      // 加载每位学生最近一轮对话预览和词云数据
      try {
        const allMsgs = await api.getAllMessages(id);
        setAllMessages(allMsgs);
        const grouped = new Map<string, ClassroomMessage[]>();
        for (const msg of allMsgs) {
          const sid = msg.classroomStudent?.id;
          if (!sid) continue;
          if (!grouped.has(sid)) grouped.set(sid, []);
          grouped.get(sid)!.push(msg);
        }
        setStudents(prev => prev.map(s => {
          const sid = s.id;
          const msgs = grouped.get(sid);
          if (!msgs || msgs.length === 0) return s;
          const lastUser = msgs.filter((m) => m.role === 'user').slice(-1)?.[0];
          const lastAssistant = msgs.filter((m) => m.role === 'assistant').slice(-1)?.[0];
          const preview: ClassroomCardStudent['messages'] = [];
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
        const found = agents.find((a) => agentIds.includes(a.id));
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

  // ESC 关闭投屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCodeScreenKey(0); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!id) { router.push('/teacher'); return; }
    const initialLoadTimer = window.setTimeout(() => { void loadClassroom(); }, 0);
    joinTeacherBoard(id);

    const unsub1 = on('student-online', (data: StudentPresenceEvent) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: 'online' }));
    });
    const unsub2 = on('student-offline', (data: StudentPresenceEvent) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: 'offline' }));
    });
    const unsub3 = on('student-thinking', (data: StudentThinkingEvent) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: data.status ? 'thinking' : 'online' }));
    });
    const unsubDeepThink = on('student-deep-thinking', (data: StudentThinkingEvent) => {
      if (data.status) {
        setDeepThinkingStatuses(prev => ({ ...prev, [data.studentId]: true }));
      } else {
        setDeepThinkingStatuses(prev => {
          const next = { ...prev };
          delete next[data.studentId];
          return next;
        });
      }
    });
    const unsub4 = on('student-message', (data: StudentMessageEvent) => {
      // 更新学生消息预览（仅保留最近3条用户提问）
      setStudents(prev => prev.map(s =>
        s.id === data.studentId
          ? {
              ...s,
              messages: data.role === 'user'
                ? [{ content: data.content, role: 'user', createdAt: data.timestamp }]
                : (() => {
                    const userMsgs = s.messages.filter((m) => m.role === 'user').slice(-1);
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
      // 如果当前选中该学生，追加消息
      if (selectedStudentIdRef.current === data.studentId) {
        setMessages(prev => [...prev, { content: data.content, role: data.role, roundIndex: data.roundIndex ?? null, createdAt: data.timestamp, fileUrls: data.fileUrls, fileNames: data.fileNames }]);
      }
    });

    const unsub5 = on('classroom-paused', () => setPaused(true));
    const unsub6 = on('classroom-resumed', () => setPaused(false));
    const unsub7 = on('classroom-ended', () => {
      setToast({ msg: '课堂已结束', type: 'success' });
      router.push('/teacher');
    });

    const unsub8 = on('shield-warning', (data: ShieldWarningEvent) => {
      setStudentWarnings(prev => ({ ...prev, [data.studentId]: data.warningCount }));
    });

    const unsub9 = on('student-blacklisted', (data: StudentPresenceEvent) => {
      setStudentBlacklisted(prev => ({ ...prev, [data.studentId]: true }));
    });

    const unsub10 = on('student-unblacklisted', (data: StudentPresenceEvent) => {
      setStudentBlacklisted(prev => ({ ...prev, [data.studentId]: false }));
      setStudentWarnings(prev => ({ ...prev, [data.studentId]: 0 }));
    });

    const unsub11 = on('student-avatar-changed', (data: StudentAvatarChangedEvent) => {
      if (data.avatarId && data.svgContent) {
        const avatarId = data.avatarId;
        const svgContent = data.svgContent;
        setStudentAvatars(prev => ({ ...prev, [avatarId]: svgContent }));
      }
      // 更新学生列表中的 avatarId
      setStudents(prev => prev.map(s => {
        if (s.id === data.studentId) {
          return { ...s, student: { ...s.student, avatarId: data.avatarId } };
        }
        return s;
      }));
      // 同步更新当前选中的学生头像（打开抽屉时实时刷新）
      setSelectedStudent((prev) => {
        if (!prev || prev.id !== data.studentId) return prev;
        return { ...prev, avatarId: data.avatarId };
      });
    });

    const unsub12 = on('allow-stop-changed', (data: ClassroomPermissionEvent) => {
      setClassroom((prev) => prev ? { ...prev, allowStudentStop: data.allow } : prev);
    });

    const unsub13 = on('allow-export-changed', (data: ClassroomPermissionEvent) => {
      setClassroom((prev) => prev ? { ...prev, allowStudentExport: data.allow } : prev);
    });

    const unsub14 = on('follow-ups-changed', (data: ClassroomPermissionEvent) => {
      setClassroom((prev) => prev ? { ...prev, allowFollowUps: data.allow } : prev);
    });

    // 模块三态回显：服务端在 PUT 成功后向 classroom:<id> 与 teacher:<id> 双发，
    // 所以另一台教师机（或本机另一个标签页）改态时这里立刻跟上，不必等轮询。
    // 载荷是线缆上的值，先过类型守卫 —— 非法 key/state 直接忽略，不写进本地三元素数组。
    // 连 null / undefined 都会走到这里，所以不能直接解构（解构会先抛错，守卫就没机会跑）。
    const unsub15 = on('module-state-changed', (data) => {
      const { moduleKey, state } = data ?? {};
      if (!isClassroomModuleKey(moduleKey) || !isClassroomModuleState(state)) return;
      setClassroom((prev) => prev ? { ...prev, modules: applyModuleState(prev.modules, moduleKey, state) } : prev);
    });

    // 「这个学生此刻在看哪个模块」（P2.3 看板「跟随」模式的数据源）。
    //
    // ⚠️ 学生只在**切换时**上报（几十字节），教师中途进来看板时由服务端**回放**当前状态
    // （每个已知状态的学生各一条）—— 所以这里**不做**初值拉取：拉取会与回放两个来源打架，
    // 而且拉回来的那份可能比回放的还旧。
    //
    // 载荷是线缆上的值：只有三件套与 `null` 是合法的，其余（含拼错的 key）**整条丢掉**
    // —— 存进去就会渲染出一个不存在的模块，且全程不报错。
    const unsub16 = on('student-module-focus', (data) => {
      const { studentId, moduleId } = data ?? {};
      if (typeof studentId !== 'string') return;
      const resolved: ModuleId | null | undefined = moduleId === null
        ? null
        : (isModuleId(moduleId) ? moduleId : undefined);
      if (resolved === undefined) return;
      setStudentModuleFocus((prev) => ({ ...prev, [studentId]: resolved }));
    });

    return () => { window.clearTimeout(initialLoadTimer); unsub1?.(); unsub2?.(); unsub3?.(); unsubDeepThink?.(); unsub4?.(); unsub5?.(); unsub6?.(); unsub7?.(); unsub8?.(); unsub9?.(); unsub10?.(); unsub11?.(); unsub12?.(); unsub13?.(); unsub14?.(); unsub15?.(); unsub16?.(); };
  }, [id, joinTeacherBoard, on, loadClassroom, router]);

  const openStudentDrawer = async (student: StudentSummary) => {
    if (selectedStudentIdRef.current === student.id) return; // 已选中，无需重复拉取
    selectedStudentIdRef.current = student.id;
    setSelectedStudent(student);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const msgs = await api.getStudentMessages(id, student.id);
      setMessages(msgs);
    } catch { setMessages([]); }
    finally { setLoadingMessages(false); }
  };

  /** 清除学生对话记录并同步更新监控框 */
  const handleClearMessages = async (studentId: string, studentName: string) => {
    if (clearBusyRef.current) return;
    if (!confirm(`确定清除「${studentName}」的全部对话记录？`)) return;
    clearBusyRef.current = true;
    setClearBusy(studentId);
    try {
      await api.clearStudentMessages(id, studentId);
      // 清除监控框预览
      setStudents(prev => prev.map(s => {
        // 标准模式：s.student 存在时直接匹配
        if (s.student && s.id === studentId) {
          return { ...s, messages: [] };
        }
        return s;
      }));
      // 重置对话轮数
      setStudentRounds(prev => ({ ...prev, [studentId]: 0 }));
      // 如果当前抽屉中正显示该学生，清空消息列表
      if (selectedStudentIdRef.current === studentId) {
        setMessages([]);
      }
      setToast({ msg: `已清除「${studentName}」的对话记录`, type: 'success' });
    } catch (error) {
      setToast({ msg: `清除「${studentName}」失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      clearBusyRef.current = false;
      setClearBusy(null);
    }
  };

  const incrementAvatarChangeTokens = (studentId: string) => {
    const updateStudent = (student: StudentSummary) => student.id === studentId
      ? { ...student, avatarChangeTokens: student.avatarChangeTokens + 1 }
      : student;
    setStudents((previous) => previous.map((card) => ({
      ...card,
      student: updateStudent(card.student),
    })));
    setSelectedStudent((previous) => previous ? updateStudent(previous) : previous);
  };

  /** 清除小组全体成员的对话记录并同步更新监控框 */
  const handleClearGroupMessages = async (members: ClassroomCardStudent[], groupName: string) => {
    if (clearBusyRef.current) return;
    if (!confirm(`确定清除「${groupName}」全体成员的对话记录？`)) return;
    clearBusyRef.current = true;
    setClearBusy(`group:${groupName}`);
    const results = await Promise.allSettled(members.map(async m => {
      const studentId = m.id;
      await api.clearStudentMessages(id, studentId);
      return studentId;
    }));
    const succeeded = results.filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled').map(result => result.value);
    if (succeeded.length) {
        setStudents(prev => prev.map(s => {
          if (s.student && succeeded.includes(s.id)) return { ...s, messages: [] };
          return s;
        }));
      setStudentRounds(prev => Object.fromEntries(Object.entries(prev).map(([studentId, rounds]) => [studentId, succeeded.includes(studentId) ? 0 : rounds])));
      if (selectedStudentIdRef.current && succeeded.includes(selectedStudentIdRef.current)) setMessages([]);
    }
    const failed = results.length - succeeded.length;
    setToast(failed ? { msg: `「${groupName}」已清除 ${succeeded.length} 人，${failed} 人失败，请重试`, type: 'error' } : { msg: `已清除「${groupName}」全体 ${succeeded.length} 人的对话记录`, type: 'success' });
    clearBusyRef.current = false;
    setClearBusy(null);
  };

  const sendNotification = () => {
    if (notifySendingRef.current) return;
    const message = notifyText.trim();
    if (!message) return;
    notifySendingRef.current = true;
    emit('teacher-send-notification', { classroomId: id, studentId: notifyState.studentId, groupId: notifyState.groupId, message });
    setNotifySent(true);
    setTimeout(() => { setNotifyState({ show: false }); notifySendingRef.current = false; }, 1200);
  };

  const runControlAction = async (key: string, action: () => Promise<void>) => {
    if (controlBusyRef.current) return;
    controlBusyRef.current = true;
    setControlBusy(key);
    try {
      await action();
    } catch (error) {
      setToast({ msg: `课堂设置更新失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      controlBusyRef.current = false;
      setControlBusy(null);
    }
  };

  const toggleQuestions = () => runControlAction('questions', async () => {
    if (paused) {
      await api.resumeClassroom(id);
      setPaused(false);
      setClassroom((previous) => previous ? { ...previous, status: 'active' } : previous);
    } else {
      await api.pauseClassroom(id);
      setPaused(true);
      setClassroom((previous) => previous ? { ...previous, status: 'paused' } : previous);
    }
  });

  const syncGroups = () => runControlAction('sync-groups', async () => {
    const result = await api.syncClassroomGroups(id);
    await loadClassroom();
    setToast({
      msg: result.addedGroups > 0
        ? `分组已同步，新增 ${result.addedGroups} 个小组${classroom?.mode === 'advanced' ? '（使用课堂默认智能体）' : ''}`
        : '分组成员已同步到课堂看板',
      type: 'success',
    });
  });

  const toggleStop = () => runControlAction('stop', async () => {
    const result = await api.toggleAllowStop(id);
    setClassroom((previous) => previous ? { ...previous, allowStudentStop: result.allowStudentStop } : previous);
  });

  const toggleExport = () => runControlAction('export', async () => {
    const result = await api.toggleAllowExport(id);
    setClassroom((previous) => previous ? { ...previous, allowStudentExport: result.allowStudentExport } : previous);
  });

  const toggleFollowUps = () => runControlAction('follow-ups', async () => {
    const result = await api.toggleAllowFollowUps(id);
    setClassroom((previous) => previous ? { ...previous, allowFollowUps: result.allowFollowUps } : previous);
  });

  // 探究空间画面采集（P2.2）。三个参数各是一个 busy 键，请求期间那一行整体禁用，防连点。
  //
  // 只发**本次改动的那一个**字段：服务端把「没给这个字段」读作「这次不改它」，
  // 三个一起发会把本地可能已经过期的另外两个值一起写回去（另一位教师刚调过就被覆盖）。
  // 传 null 更不行 —— 那会被当成数值 0 再夹成下界（已在服务端修掉，但界面上没必要去踩）。
  //
  // 回写的是**服务端的响应值**而不是请求值：夹取发生在服务端，界面上那几档只是候选。
  const setWebappCapture = (key: string, body: { enabled?: boolean; width?: number; frameIntervalMs?: number }) => {
    // 「关掉开关后，下面两行点了不生效」的**代码级**保证。
    // 界面上那两行已经 disabled（disabled 的按钮在浏览器里不会派发 click），这里再挡一道是因为
    // 那个属性是个样式层的东西：一次「顺手删掉 disabled 让文字别发灰」的改动就会让它失效，
    // 而失效的样子是**静默**的 —— 教师以为关掉了，请求照发，设置照改。
    if (!captureEnabled && key !== 'capture-enabled') return;
    return runControlAction(key, async () => {
      const result = await api.setWebappCapture(id, body);
      setClassroom((previous) => previous ? {
        ...previous,
        webappCaptureEnabled: result.enabled,
        webappThumbnailWidth: result.width,
        webappFrameIntervalMs: result.frameIntervalMs,
      } : previous);
    });
  };

  // 模块三态：与前三个开关不同，PUT 不返回「服务端权威的全量态」，所以要自己乐观更新。
  // 点击立刻写本地（下拉框里选中项马上跟手），失败则回滚并抛错，由 runControlAction 统一 Toast。
  // busy 键按模块区分，请求期间这一行整体禁用，防连点。
  const setModuleState = (moduleKey: ClassroomModuleKey, state: ClassroomModuleState) => {
    const previousState = moduleStateOf(classroom?.modules, moduleKey);
    // 点到当前态是空操作：服务端 upsert 幂等，但没必要为一次没有变化的写入惊动全体学生端。
    if (previousState === state) return;
    return runControlAction(`module:${moduleKey}`, async () => {
      setClassroom((previous) => previous ? { ...previous, modules: applyModuleState(previous.modules, moduleKey, state) } : previous);
      try {
        await api.setClassroomModuleState(id, moduleKey, state);
        // 成功后该课堂至少有这一行模块行了 —— 否则把 A 设成 open 再设回 preview 时，
        // 三态又全是预告，而 hasModuleRows 还停在初始加载的 false 上，
        // 菜单会重新弹出「未单独配置过模块」这句已经不成立的话。
        setClassroom((previous) => previous ? { ...previous, hasModuleRows: true } : previous);
      } catch (error) {
        // 只回滚被点击的这一个模块。回滚整个数组快照会把这一个 RTT 窗口内其它模块收到的
        // 广播一并抹掉（窗口内另一位教师改了别的模块时，本机会显示成旧态直到刷新）。
        setClassroom((previous) => previous ? { ...previous, modules: applyModuleState(previous.modules, moduleKey, previousState) } : previous);
        throw error;
      }
    });
  };


  /**
   * 探究空间（缩略图 + 文字档）的**唯一**一份订阅。
   *
   * 🔴 这里必须是**唯一**调用点（P2.3 看板合成时从 `webapp-monitor-view.tsx` 搬上来的）。
   * 看板合成之后每个格子都要显示自己那一份画面/文字档，而把订阅塞进格子里就是
   * 「N 个格子 N 份订阅、N 次 watch/unwatch」—— 服务端按需推流的闸门（Ruling 9）
   * 会被搅乱，学生端也可能被反复开关推流。
   * ⇒ 状态在这一层，格子只从里面取自己那一条。
   *
   * ⚠️ 与合并前的一处**行为差异**（有意为之）：订阅跟着**看板**走，而不是某个视图。
   * 合并前教师必须切到探究空间视图才会让学生开始推流；现在**跟随模式**下每格都可能显示
   * 画面，所以「开着看板」就该在推流档位上。
   *
   * 🔴 但**不能**因此变成"只要开着看板就无脑推流"：watch 一旦下发，全班学生立刻开始
   * 按档位截图（老 iPad 上 55~68ms/帧）。「指定 · 智能学伴」这种课堂上，屏幕上**一格**
   * 都不会用到那些图，却会让 40 台设备白白每 10 秒光栅化一次整页。
   * ⇒ 由 `needsExploreFrames` 把这件事说清楚：跟随模式要；指定模式下只有指定的正是
   *    探究空间时才要。**这是成本闸门，不是优化**（见 use-webapp-monitor.ts 的 prop 注释）。
   */
  const webappStates = useWebappMonitor({
    classroomId: id,
    roster: classroom?.students ?? [],
    webapps: classroom?.webapps ?? [],
    focusStudentId: exploreDetailId,
    needsExploreFrames: boardMode === 'follow' || assignModule === 'explore',
  });

  if (!classroom) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: "0.875rem" }}>加载中...</div>;
  }

  const statusValues = Object.values(studentStatuses);
  const onlineCount = statusValues.filter(v => v === 'online' || v === 'thinking').length;
  const thinkingCount = statusValues.filter(v => v === 'thinking').length;
  const offlineCount = statusValues.filter(v => v === 'offline').length;
  const totalRounds = Object.values(studentRounds).reduce((sum, r) => sum + r, 0);

  // 「这个课堂从没单独配置过模块，菜单里看到的是默认态」。
  //
  // 两个条件缺一不可：只看「三态都是预告」会把教师主动把三项都设成预告的课堂误判成未配置
  // （mergeModuleStates 补齐出来的默认态与显式设置的预告在 modules 里长得一模一样）。
  // hasModuleRows 用 === false 而不是 !：服务端读不到模块行时不发这个字段，那是「不知道」，
  // 不是「没有」，不能借它断言未配置。
  const modulesNeverConfigured = classroom.hasModuleRows === false
    && MODULE_KEYS.every((moduleKey) => moduleStateOf(classroom.modules, moduleKey) === DEFAULT_MODULE_STATE);

  // 探究空间画面的采集设置。老数据/老响应里这三个字段可能**根本不存在**。
  //
  // 🔴 方向至关重要：**认不出 = 开 / 用默认**。写成 `!classroom.webappCaptureEnabled`
  // 会让「不知道」显示成「已关闭」，教师看到的是一个假的关闭态 —— 而实际学生端还在传画面。
  // 判据与服务端 `normalizeCaptureConfig` 对齐：enabled 用 `!== false`，
  // 数值用 `??`（不是 `||`，那会把合法的 0 也吃掉；这里没有 0 档，但方向要一致）。
  const captureEnabled = classroom.webappCaptureEnabled !== false;
  const captureWidth = classroom.webappThumbnailWidth ?? DEFAULT_WEBAPP_WIDTH;
  const captureIntervalMs = classroom.webappFrameIntervalMs ?? DEFAULT_WEBAPP_FRAME_INTERVAL_MS;
  // 整个采集分组共用的禁用条件：关掉开关时下面两行置灰。
  // 注意 `disabled` 要落到 <button> 上，光靠样式挡不住键盘与脚本触发。
  const captureRowsDisabled = controlBusy !== null || !captureEnabled;
  // busy 指示按行给（分辨率/频率各一行），键的前缀在 setWebappCapture 里拼。
  const captureWidthBusy = controlBusy !== null && controlBusy.startsWith('capture-width-');
  const captureIntervalBusy = controlBusy !== null && controlBusy.startsWith('capture-interval-');

  const allDisplayCards: ClassroomDisplayCard[] = groupCards || students;
  const getDisplayCardStatus = (card: ClassroomDisplayCard): 'online' | 'thinking' | 'offline' => {
    if (isClassroomGroupCard(card)) {
      if (card.members.some((member) => studentStatuses[member.id] === 'thinking')) return 'thinking';
      if (card.members.some((member) => studentStatuses[member.id] === 'online')) return 'online';
      return 'offline';
    }
    const status = studentStatuses[card.id];
    return status === 'thinking' || status === 'online' ? status : 'offline';
  };
  const cardNeedsAttention = (card: ClassroomDisplayCard) => {
    const members = isClassroomGroupCard(card) ? card.members : [card];
    return members.some((member) => studentBlacklisted[member.id] || (studentWarnings[member.id] || 0) > 0);
  };
  const displayCards = allDisplayCards.filter((card) => {
    if (studentBoardFilter === 'all') return true;
    if (studentBoardFilter === 'attention') return cardNeedsAttention(card);
    return getDisplayCardStatus(card) === studentBoardFilter;
  });
  const boardFilterCounts: Record<StudentBoardFilter, number> = {
    all: allDisplayCards.length,
    online: allDisplayCards.filter((card) => getDisplayCardStatus(card) === 'online').length,
    thinking: allDisplayCards.filter((card) => getDisplayCardStatus(card) === 'thinking').length,
    attention: allDisplayCards.filter(cardNeedsAttention).length,
    offline: allDisplayCards.filter((card) => getDisplayCardStatus(card) === 'offline').length,
  };

  /* ═══════════ P2.3：一个格子的内容区显示什么 ═══════════ */

  /**
   * 单个学生此刻该显示哪个模块。
   *
   * `hasOwnProperty` 而不是读值判 `undefined`：**键不在 = 从没收到过**（`unknown`），
   * 与「收到了 null = 他在首页」是两件不同的事 —— 合并成一件就会把「不知道」说成
   * 「在首页」，而那是**编造**出来的一条事实。
   */
  const resolveTileModule = (studentId: string): TileModule => {
    if (boardMode === 'assign') return assignModule;
    if (!Object.prototype.hasOwnProperty.call(studentModuleFocus, studentId)) return 'unknown';
    const focus = studentModuleFocus[studentId];
    return focus === null ? 'home' : focus;
  };

  /** 小组格子：组内成员**全在同一个模块**就是那个模块，否则 `mixed`。 */
  const resolveGroupTileModule = (members: ClassroomCardStudent[]): GroupTileModule => {
    if (boardMode === 'assign') return assignModule;
    if (members.length === 0) return 'unknown';
    const first = resolveTileModule(members[0].id);
    return members.every((member) => resolveTileModule(member.id) === first) ? first : 'mixed';
  };

  /**
   * 这一格要不要显示「清除对话」垃圾桶。
   *
   * 🔴 用户原话：它**只针对学生与智能体对话的内容**。所以只在内容区真的显示着
   * 「智能学伴」的对话时才出现 —— 探究空间那格、学习单那格、在首页/状态未知那格
   * **都不显示**。一个点了没用的按钮比没有按钮更糟。
   *
   * 小组格是唯一的灰度情形：组内混着几个模块时，只要**有成员在学伴**，垃圾桶就还有
   * 意义（它一次清掉全组的学伴对话）；全组都不在学伴时不显示。
   */
  const tileShowsClear = (module: GroupTileModule, members: ClassroomCardStudent[]): boolean => {
    if (module === 'companion') return true;
    if (module !== 'mixed') return false;
    return members.some((member) => resolveTileModule(member.id) === 'companion');
  };

  /** 一个模块在教师看板上的中文名。`home` / `unknown` 不是模块，是两种「不在这三个里」。 */
  const moduleLabelOf = (module: TileModule): string => {
    if (module === 'home') return '首页';
    if (module === 'unknown') return '…';
    return MODULE_ID_LABELS[module];
  };

  /** 三件套各几人（+ 首页 / 未知）。**按人**数，不按格子 —— 小组格会把这些学生藏起来。 */
  const moduleDistribution: Record<TileModule, number> = (() => {
    const counts: Record<TileModule, number> = { worksheet: 0, explore: 0, companion: 0, home: 0, unknown: 0 };
    for (const student of students) counts[resolveTileModule(student.id)] += 1;
    return counts;
  })();

  /**
   * 探究画面的两个全局计数（合并前那面「图墙」顶部那一行就是它们）。
   *
   * 按**人**数、覆盖全班：与刚才那面图墙的语义一致 ——「这个班上有多少人在用探究空间」
   * 与「这一格是谁」是两个问题，第 2 个由每格的缩略图回答。
   */
  const exploreWithFrame = students.filter(s => webappStates[s.id]?.dataUrl).length;
  // 「打开了网页」= 收到过文字档且**此刻在前台**。与 withFrame 是两个独立的数：
  // 关掉画面的课堂里 withFrame 恒为 0，而这个数字仍然是有意义的。
  const exploreOpened = students.filter(s => webappStates[s.id]?.presence?.visible).length;

  /**
   * 探究详情浮层对应的学生。
   *
   * ⚠️ 从**名册**里现查，而不是把学生对象存进 state：名册在课堂进行中会变
   * （学生加入/离开、同步分组），存对象就等于留着一份不会更新的旧快照。
   * 查不到就当作没打开 —— 一个已经不在名册上的 id 不该让浮层继续挂在屏幕上。
   */
  const exploreDetailStudent = exploreDetailId ? students.find(s => s.id === exploreDetailId) ?? null : null;

  /**
   * 打开某个学生的探究详情。
   *
   * ⚠️ 顺手把**对话抽屉**关掉：两者是同一块位置（右上角、宽 420）的浮层，
   * 不互斥的话教师先点开 A 的对话、再点开 B 的探究画面，就会看到两块面板叠在一起
   * —— 而它们各自看起来都「正常」，只是合起来谁也读不出来。
   */
  const openExploreDetail = (studentId: string) => {
    setSelectedStudent(null);
    setSelectedGroup(null);
    selectedStudentIdRef.current = null;
    setExploreDetailId(studentId);
  };

  /**
   * 格子内容区的**唯一**渲染实现：主看板与全屏网格都调它。
   *
   * 为什么必须只有一份：这两处本来就是逐字重复的（合并前就是），再加一层「按模块分支」
   * 的分叉，全屏里少一个缩略图这类差异只会在全屏里才看得见。
   * 差异只剩 `compact`（全屏格子更小、字更小）这一个旋钮。
   */
  const renderTileContent = ({ module, members, isGroup, online, groupName, userMsg, assistantMsg, compact }: {
    module: GroupTileModule;
    /** 这一格代表的成员：学生格 = 那一个学生；小组格 = 全组成员（`members[0]` 是「主」学生）。 */
    members: ClassroomCardStudent[];
    isGroup: boolean;
    /** 学生格的在线判据；小组格传 `getDisplayCardStatus(card) !== 'offline'`。 */
    online: boolean;
    groupName?: string;
    userMsg?: ClassroomCardMessage;
    assistantMsg?: ClassroomCardMessage;
    compact: boolean;
  }) => {
    const primary = members[0];
    // 与合并前逐字一致：学生格的说话人后面带一个冒号，小组格用消息自带的 `studentName`。
    const speaker = isGroup
      ? (userMsg?.studentName || groupName || primary?.student.name || '')
      : `${primary?.student.name ?? ''}:`;

    /** 「最近一轮 Q&A」—— 合并前那个格子的内容，逐字保留（它就是 companion 的内容）。 */
    const companion = userMsg ? (
      <>
        <div style={{
          padding: compact ? '5px 8px' : '10px 14px', borderRadius: compact ? 6 : 8,
          background: '#eef2ff',
          fontSize: compact ? '0.625rem' : '0.75rem', lineHeight: compact ? 1.4 : 1.6, color: '#334155',
          wordBreak: 'break-word',
        }}>
          <span style={{ fontWeight: 600, color: '#2563eb', marginRight: compact ? 3 : 4 }}>{speaker}</span>
          <span>{stripMarkdownToPlainText(userMsg.content)}</span>
        </div>
        {assistantMsg && (
          <div style={{
            padding: compact ? '5px 8px' : '10px 14px', borderRadius: compact ? 6 : 8,
            background: '#f8fafc',
            border: '1px solid #eef2f6',
            fontSize: compact ? '0.625rem' : '0.75rem', lineHeight: compact ? 1.4 : 1.6, color: '#64748b',
            wordBreak: 'break-word',
          }}>
            <span style={{ fontWeight: 600, color: '#16a34a', marginRight: compact ? 3 : 4 }}>AI:</span>
            <span>{stripMarkdownToPlainText(assistantMsg.content)}</span>
          </div>
        )}
      </>
    ) : (
      <div style={{ padding: compact ? '6px 10px' : '10px 14px', borderRadius: compact ? 6 : 8, background: '#f9fafb', fontSize: compact ? '0.688rem' : '0.75rem', color: '#cbd5e1', textAlign: 'center' }}>
        暂无对话
      </div>
    );

    /** 「这一格没有可显示的内容」的统一长相（学习单 / 首页 / 状态未知三处共用）。 */
    const placeholder = (label: string, hint: string) => (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 6px', borderRadius: compact ? 6 : 8, background: '#f9fafb', border: '1px dashed #e2e8f0', textAlign: 'center' }}>
        <span style={{ fontSize: compact ? '0.688rem' : '0.813rem', fontWeight: 600, color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '0.625rem', color: '#cbd5e1', lineHeight: 1.4 }}>{hint}</span>
      </div>
    );

    switch (module) {
      case 'companion':
        return companion;
      case 'explore':
        return isGroup ? (
          <ExploreMemberStrip
            members={members}
            states={webappStates}
            statuses={studentStatuses}
            captureEnabled={captureEnabled}
            onOpenStudent={openExploreDetail}
          />
        ) : (
          <ExploreTile
            name={primary?.student.name ?? ''}
            state={primary ? webappStates[primary.id] : undefined}
            online={online}
            captureEnabled={captureEnabled}
            compact={compact}
          />
        );
      // 三件套的布局一次定形：学习单这一格**留位**、标明尚未支持，
      // 以后接上学习单时不用重排（用户裁定）。
      case 'worksheet':
        return placeholder('学习单 · 尚未支持', '这个模块还没接进看板');
      case 'home':
        return placeholder('在首页', '学生此刻停在首页，不在任何模块里');
      case 'unknown':
        return placeholder('…', '还没收到这个学生的模块状态');
      case 'mixed':
        // 组内成员各在各的模块：先把「谁在哪儿」列出来，再保留原有的全组对话预览
        // —— 列出清单不等于可以把对话藏起来（那会把一个既有的能力弄丢）。
        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
              {members.map((member) => (
                <div key={member.id} style={{ display: 'flex', gap: 6, fontSize: compact ? '0.625rem' : '0.688rem', lineHeight: 1.4 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }}>{member.student.name}</span>
                  <span style={{ marginLeft: 'auto', color: '#64748b', whiteSpace: 'nowrap' }}>{moduleLabelOf(resolveTileModule(member.id))}</span>
                </div>
              ))}
            </div>
            {companion}
          </>
        );
      default:
        // TS 认为不可达（联合类型已被上面穷尽）。留一条兜底是因为**线缆值**可能不在联合里：
        // 服务端只放行三件套与 null，但看板不该因为上游多了一种取值就渲染出一片空白。
        return placeholder('…', '这个模块看板还不认识');
    }
  };

  // 投屏轮次预计算
  const msgRounds: (number | null)[] = [];
  let _r = 0;
  for (let _i = 0; _i < messages.length; _i++) {
    const _m = messages[_i];
    if (_m.role === 'user') _r++;
    msgRounds.push((_m.role === 'user' || _m.role === 'assistant') ? (_r || 1) : null);
  }
  // 投屏过滤（只展示 selectedRounds 中的轮次）
  const projMsgs = messages.filter((_, i) => msgRounds[i] != null && selectedRounds.includes(msgRounds[i]!));
  const msgChecked = msgRounds.map(ri => ri != null && selectedRounds.includes(ri));
  const allRis = (() => {
    const s = new Set<number>();
    for (const mr of msgRounds) { if (mr != null) s.add(mr); }
    return Array.from(s).sort((a: number, b: number) => a - b);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {gridFullscreen && <style>{`body { overflow: hidden; }`}</style>}
      <style>{`.preview-scroll::-webkit-scrollbar { width: 4px; } .preview-scroll::-webkit-scrollbar-track { background: transparent; } .preview-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; } .preview-scroll { scrollbar-width: thin; scrollbar-color: #e2e8f0 transparent; } .control-btn:hover { background: #f1f5f9 !important; } @keyframes slideDown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

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
            <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0 }}>{classroom.title || '课堂看板'}</h1>
            <span style={{
              fontSize: "0.688rem", fontWeight: 600, padding: '2px 8px', borderRadius: 4,
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
              background: '#eef2ff', fontSize: "0.813rem", fontWeight: 500, color: '#2563eb',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
              互动码 <strong style={{ fontSize: "1rem", letterSpacing: 3, fontFamily: 'monospace' }}>{teacherCode}</strong>
            </div>
            {classroom.classes?.length > 0 && (
              <span style={{ fontSize: "0.75rem", color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                {classroom.classes.map((cc) => cc.class.name).join('、')}
              </span>
            )}
            <span style={{ fontSize: "0.813rem", color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
              {classroomStudentCount} 名学生
            </span>
          </div>
        </div>
          </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {classroom.status !== 'ended' && (
            <>
              <button className="btn btn-primary btn-lg" onClick={() => {
                fetch(`${getApiBaseUrl()}/api/server-info`, { credentials: 'include' }).then(r => r.json()).then(d => {
                      setStudentUrl(d.studentUrl || '');
                }).catch(() => {}).finally(() => setCodeScreenKey(k => k + 1));
              }} style={{ fontSize: "0.875rem", display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                投屏发码
              </button>
            </>
          )}
        </div>
      </div>


      {/* 实时数据统计 + 三件套分布（P2.3 融合成一行）。
          用 flex + `flexWrap` 而不是固定 4 列：多出来的「模块分布」是一张更宽的卡，
          挤进 `repeat(4, 1fr)` 会让原来那四张卡在窄屏上一起变形。 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24, alignItems: 'stretch' }}>
        {[
          { label: '在线人数', value: onlineCount, color: '#10b981', bg: '#ecfdf5', icon: 'online' },
          { label: '互动中', value: thinkingCount, color: '#f59e0b', bg: '#fffbeb', icon: 'thinking' },
          { label: '离线', value: offlineCount, color: '#94a3b8', bg: '#f1f5f9', icon: 'offline' },
          { label: '总交互轮数', value: totalRounds, color: '#8b5cf6', bg: '#f5f3ff', icon: 'message' },
        ].map(stat => (
          <div key={stat.label} style={{
            flex: '1 1 150px', minWidth: 0,
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
              <div style={{ fontSize: "1.625rem", fontWeight: 700, color: stat.color, lineHeight: 1.1 }}>{stat.value}</div>
              <div style={{ fontSize: "0.75rem", color: '#64748b', marginTop: 2 }}>{stat.label}</div>
            </div>
          </div>
        ))}

        {/* 三件套各几人。⚠️ 只有**跟随**模式下这四项才有信息量：指定模式下全班都是同一个模块，
            分布恒等于「全班 N 人」，写出来只会让人以为看错了。 */}
        <div data-board-distribution={boardMode} style={{
          flex: '2 1 320px', minWidth: 0,
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b' }}>
              {boardMode === 'follow' ? '此刻各模块人数' : '指定模式'}
            </span>
            {boardMode === 'assign' && (
              <span style={{ fontSize: "0.75rem", color: '#1d4ed8', fontWeight: 600 }}>
                全班统一显示「{MODULE_ID_LABELS[assignModule]}」
              </span>
            )}
          </div>
          {boardMode === 'follow' ? (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {/* 顺序 = 三件套本身（学习单 / 探究空间 / 智能学伴），学习单**留位**并标明尚未支持
                  —— 三件套的布局一次定形，以后接上学习单时不用重排。 */}
              <ModuleCountChip label={MODULE_ID_LABELS.worksheet} value={moduleDistribution.worksheet} hint="尚未支持" muted />
              <ModuleCountChip label={MODULE_ID_LABELS.explore} value={moduleDistribution.explore} />
              <ModuleCountChip label={MODULE_ID_LABELS.companion} value={moduleDistribution.companion} />
              {/* 首页与「状态未知」不是三件套，放在后面用弱化样式 —— 少了它们，
                  这几个学生在上面那三项里都找不到，教师会以为人丢了。 */}
              <ModuleCountChip label="首页" value={moduleDistribution.home} muted />
              <ModuleCountChip label="未知" value={moduleDistribution.unknown} muted />
            </div>
          ) : (
            <div style={{ fontSize: "0.75rem", color: '#94a3b8', lineHeight: 1.5 }}>
              各模块人数只在「跟随」模式下有意义（指定模式下全班都是同一个）。
            </div>
          )}
          {/* 合并前那面「图墙」顶部那一行：M 名已有画面、K 名已打开网页。
              它答的是「这个班上有多少人在用探究空间」，与每格答的「这一格是谁」是两个问题，
              两个都要留着（关掉画面的课堂里「有画面」恒为 0，而「已打开」照旧有信息量）。
              没有任何探究信号时整行不出现 —— 一句「0 人有画面、0 人已打开」只是噪音。 */}
          {(exploreWithFrame > 0 || exploreOpened > 0) && (
            <div style={{ fontSize: "0.688rem", color: '#94a3b8' }}>
              探究空间：{exploreWithFrame} 人已有画面，{exploreOpened} 人正打开着网页
            </div>
          )}
        </div>
      </div>
      </>)}
      {/* 对话分析面板（始终渲染，全屏时被 fixed 遮罩覆盖） */}
      <AnalyticsPanel classroomId={id} allMessages={allMessages} loadAnalytics={loadAnalytics} />
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>
        <div ref={gridRef} style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>学生互动面板</h2>
              <div style={{ fontSize: "0.75rem", color: '#64748b', marginTop: 2 }}>点击学生卡片查看完整对话，使用筛选快速定位课堂状态</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {(classroom.mode === 'group' || classroom.mode === 'advanced') && classroom.status !== 'ended' && (
                <button className="btn btn-secondary" onClick={() => void syncGroups()} disabled={controlBusy !== null}
                  title="把当前班级的分组名称和成员同步到正在进行的课堂"
                  style={{ minHeight: 36, padding: '7px 12px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>
                  {controlBusy === 'sync-groups' ? '同步中...' : '同步分组'}
                </button>
              )}
              <button className={paused ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => void toggleQuestions()} disabled={controlBusy !== null}
                style={{ minHeight: 36, padding: '7px 12px', color: paused ? 'white' : '#2563eb' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {paused ? <><path d="M8 5v14l11-7z" /></> : <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>}
                </svg>
                {controlBusy === 'questions' ? '更新中...' : paused ? '恢复学生提问' : '暂停学生提问'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setNotifyText(''); setNotifySent(false); setNotifyState({ show: true }); }} style={{ minHeight: 36, padding: '7px 12px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                通知全体
              </button>
              {/* 触发按钮。打开的是**浮动窗**（aria-haspopup 从 "menu" 改成 "dialog"），
                  窗本身在文件末尾与其他浮层放在一起。
                  包裹层留着只是为了让按钮与相邻按钮的缩进/盒子一致；它不再需要 ref
                  —— 「点外面关」对浮窗没有意义（遮罩就是那块外面）。 */}
              <div style={{ position: 'relative' }}>
                <button ref={permissionsButtonRef} className="btn btn-secondary" aria-haspopup="dialog" aria-expanded={showPermissionsDialog} onClick={() => setShowPermissionsDialog((visible) => !visible)} style={{ minHeight: 36, padding: '7px 12px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.37.55.72 1 .9.35.14.73.2 1.1.2h.1v4h-.1a1.7 1.7 0 0 0-1.5.9z"/></svg>
                  课堂权限
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {/* ⚠️ 原来的下拉菜单内容（三个开关 + 探究空间画面那一组）整段搬进了文件末尾的
                    「课堂权限」浮动窗，见那里的 JSX。这里是**搬家**不是删除：
                    控件、handler、置灰的三道闸一个都没少。 */}
              </div>
              <div ref={modulesMenuRef} style={{ position: 'relative' }}>
                <button className="btn btn-secondary" aria-haspopup="menu" aria-expanded={showModulesMenu} onClick={() => setShowModulesMenu((visible) => !visible)} style={{ minHeight: 36, padding: '7px 12px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
                  模块状态
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showModulesMenu && (
                  <div role="menu" aria-label="课堂模块状态" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 80, width: 288, padding: 8, borderRadius: 12, background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 16px 40px rgba(15,23,42,0.14)' }}>
                    <div style={{ padding: '6px 10px 8px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>课堂模块</div>
                    {modulesNeverConfigured && (
                      <div style={{ margin: '0 10px 8px', padding: '8px 10px', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: '0.75rem', lineHeight: 1.5 }}>
                        本课堂未单独配置过模块，以下三项均为默认的「预告」态。
                      </div>
                    )}
                    {MODULE_KEYS.map((moduleKey) => {
                      const currentState = moduleStateOf(classroom.modules, moduleKey);
                      const moduleBusy = controlBusy === `module:${moduleKey}`;
                      return (
                        <div key={moduleKey} role="group" aria-label={MODULE_LABELS[moduleKey]} style={{ padding: '4px 10px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.813rem', color: '#334155' }}>
                            <span style={{ flex: 1 }}>{MODULE_LABELS[moduleKey]}</span>
                            {moduleBusy && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>更新中...</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {MODULE_STATES.map((state) => (
                              <ModuleStateRadio key={state}
                                label={MODULE_STATE_LABELS[state]}
                                hint={MODULE_STATE_HINTS[state]}
                                selected={currentState === state}
                                busy={moduleBusy}
                                disabled={controlBusy !== null}
                                onSelect={() => void setModuleState(moduleKey, state)} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* 全屏**只在指定模式下提供**（P2.3 的重新定位）。
                  全屏这个能力的本质是「把同一批格子铺满整块屏」——跟随模式下每格显示的是
                  **不同**的模块，铺满之后既不像投屏讲评、也不像图墙，教师按下去只会
                  得到一个与预期无关的覆盖层。所以这里按模式给，而不是像合并前那样按视图给。 */}
              {boardMode === 'assign' && (
                <button className="btn btn-secondary" onClick={() => setGridFullscreen(true)} title="全屏显示学生面板" style={{ minHeight: 36, padding: '7px 12px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                  全屏
                </button>
              )}
            </div>
          </div>

          {/* 看板模式开关（P2.3）。⚠️ **独立一行**，与筛选行同处（就在格子正上方）：
              它是「这一屏答的是哪个问题」的总开关，藏在某个菜单里等于没有。
              与 `gridFullscreen` 同进退 —— 全屏时整个 header 都被藏掉，这一条也不该留下。 */}
          {!gridFullscreen && (
            <div aria-label="看板模式" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>看板模式</span>
              <SegmentedButton label="跟随" hint="每格显示该学生此刻在用哪个模块"
                selected={boardMode === 'follow'} onSelect={() => setBoardMode('follow')} />
              <SegmentedButton label="指定" hint="全班格子统一显示下面选定的那一个模块"
                selected={boardMode === 'assign'} onSelect={() => setBoardMode('assign')} />
              {boardMode === 'follow' ? (
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  每格显示该学生此刻在用的模块；还没收到状态的学生显示「…」
                </span>
              ) : (
                <>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: 4 }}>全班显示</span>
                  {(['worksheet', 'explore', 'companion'] as ModuleId[]).map((moduleId) => (
                    <SegmentedButton key={moduleId}
                      label={MODULE_ID_LABELS[moduleId]}
                      hint={moduleId === 'worksheet' ? '学习单尚未支持，选中后每格显示占位' : `全班格子都显示「${MODULE_ID_LABELS[moduleId]}」`}
                      selected={assignModule === moduleId} onSelect={() => setAssignModule(moduleId)} />
                  ))}
                </>
              )}
            </div>
          )}

          <div aria-label="学生状态筛选" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
            {([
              ['all', '全部'], ['online', '在线'], ['thinking', '互动中'], ['attention', '需关注'], ['offline', '离线'],
            ] as Array<[StudentBoardFilter, string]>).map(([key, label]) => {
              const active = studentBoardFilter === key;
              const attention = key === 'attention' && boardFilterCounts.attention > 0;
              return (
                <button key={key} type="button" aria-pressed={active} onClick={() => setStudentBoardFilter(key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '5px 11px', borderRadius: 999, border: `1px solid ${active ? '#2563eb' : attention ? '#fecaca' : '#e2e8f0'}`, background: active ? '#2563eb' : attention ? '#fef2f2' : 'white', color: active ? 'white' : attention ? '#dc2626' : '#475569', cursor: 'pointer', fontSize: '0.813rem', fontWeight: active ? 600 : 500, whiteSpace: 'nowrap' }}>
                  {label}
                  <span style={{ minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, background: active ? 'rgba(255,255,255,.2)' : '#f1f5f9', color: active ? 'white' : attention ? '#dc2626' : '#64748b', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>{boardFilterCounts[key]}</span>
                </button>
              );
            })}
          </div>
          {/* `data-webapp-monitor` 三个属性是给**离线 E2E 探针**用的锚点
              （`.superpowers/sdd/…/dom-shot-e2e` 下那几个 verify 脚本按选择器取本块 innerText）。
              合并前它挂在 `webapp-monitor-view.tsx` 的根节点上，那个文件删掉之后锚点会断，
              所以搬到这里 —— 探针脚本不随产品走，但「锚点凭空消失」不该是一次合并的副作用。 */}
          <div className="student-grid"
            data-webapp-monitor={id}
            data-monitored={exploreWithFrame}
            data-opened={exploreOpened}>
            {allDisplayCards.length === 0 ? (
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
                <div style={{ fontSize: "0.938rem", fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>暂无学生加入</div>
                <div style={{ fontSize: "0.813rem", color: '#94a3b8' }}>学生通过互动码 <strong style={{ color: '#2563eb', fontFamily: 'monospace', fontSize: "0.938rem", letterSpacing: 2 }}>{teacherCode}</strong> 加入后，将在此处显示</div>
              </div>
            ) : displayCards.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '44px 20px', background: 'white', borderRadius: 14, border: '1px dashed #cbd5e1', color: '#64748b' }}>
                <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>当前筛选下没有学生</div>
                <button type="button" onClick={() => setStudentBoardFilter('all')} style={{ marginTop: 10, border: 0, background: 'transparent', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>查看全部学生</button>
              </div>
            ) : (
              displayCards.map((item: ClassroomDisplayCard) => {
                const isGroup = isClassroomGroupCard(item);
                const cs = isGroup ? item.members[0] : item;
                const student = cs.student;
                const sid = cs.id;
                const status = getDisplayCardStatus(item);
                const rounds = isGroup
                  ? item.members.reduce((sum: number, m) => sum + (studentRounds[m.id] || 0), 0)
                  : studentRounds[sid] || 0;
                const allMsgs = isGroup ? item.members.flatMap((m) => m.messages).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : null;
                const userMsg = isGroup ? allMsgs!.filter((m) => m.role === 'user')[0] : cs.messages.filter((m) => m.role === 'user').slice(-1)?.[0];
                const assistantMsg = isGroup ? allMsgs!.filter((m) => m.role === 'assistant')[0] : cs.messages.filter((m) => m.role === 'assistant').slice(-1)?.[0];
                const isSelected = !isGroup && selectedStudent?.id === sid;
                // 这一格的内容区该显示哪个模块（跟随 = 该学生的 focus；指定 = 教师选的）。
                const tileModule = isGroup ? resolveGroupTileModule(item.members) : resolveTileModule(sid);
                const showClear = tileShowsClear(tileModule, isGroup ? item.members : [cs]);
                return (
                  <div key={isGroup ? item.group?.id : cs.id}
                    onClick={() => {
                      // 点开的内容跟着格子显示的内容走：显示探究画面的格子点开的是**探究详情**
                      // （同时把那个学生转成高频截图），其余仍旧打开对话抽屉。
                      if (!isGroup && tileModule === 'explore') { openExploreDetail(sid); return; }
                      setExploreDetailId(null);
                      if (isGroup) setSelectedGroup(item.group);
                      else setSelectedGroup(null);
                      openStudentDrawer({ ...student, id: cs.id });
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
                        fontWeight: 700, fontSize: "0.938rem", overflow: 'hidden',
                      }}>
                        {isGroup ? (
                          getGroupInitial(item.group?.name)
                        ) : student.avatarId && studentAvatars[student.avatarId] ? (
                          <div style={{ width: 36, height: 36, filter: status === 'offline' ? 'grayscale(1)' : 'none' }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[student.avatarId]).replace('<svg', '<svg width="36" height="36"') }} />
                        ) : student.name[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* 姓名行 + 操作按钮 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: status === 'offline' ? '#9ca3af' : '#1a1a2e', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                            {isGroup ? (
                              <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}
                                onMouseEnter={(e) => setGroupTooltip({ id: item.group?.id ?? '', x: e.clientX, y: e.clientY })}
                                onMouseMove={(e) => { const n = Date.now(); if (n - groupTooltipThrottle.current < 100) return; groupTooltipThrottle.current = n; setGroupTooltip({ id: item.group?.id ?? '', x: e.clientX, y: e.clientY }); }}
                                onMouseLeave={() => setGroupTooltip(null)}>
                                {item.group?.name || '(未命名)'}
                              </span>
                            ) : (
                              <>{student.name}{student.studentNo && <span style={{ fontSize: "0.625rem", fontWeight: 500, color: '#94a3b8', marginLeft: 4 }}>#{student.studentNo}</span>}</>
                            )}
                          </span>
                          {!isGroup && (classroom.mode === 'advanced' || classroom.mode === 'group') && cs.group && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '0 6px', borderRadius: 4, fontSize: "0.625rem", fontWeight: 600,
                              background: '#f5f3ff', color: '#7c3aed', lineHeight: '18px', flexShrink: 0,
                            }}>
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="#7c3aed" stroke="none"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                              {cs.group.name}
                            </span>
                          )}
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, flexShrink: 0 }}>
                            {isGroup ? (
                              (() => {
                                const anyBlacklisted = item.members.some((m) => studentBlacklisted[m.id]);
                                return (
                                  <>
                                    <button title={anyBlacklisted ? '解除黑屏' : '黑屏处理'}
                                      onClick={async (e) => { e.stopPropagation();
                                        if (anyBlacklisted) { for (const m of item.members) { try { await api.unblacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: false })); setStudentWarnings(prev => ({ ...prev, [m.id]: 0 })); } catch {} } }
                                        else { for (const m of item.members) { try { await api.blacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: true })); } catch {} } }
                                      }}
                                      style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: anyBlacklisted ? '#d1fae5' : '#fee2e2', color: anyBlacklisted ? '#047857' : '#b91c1c', padding: 0 }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        {anyBlacklisted ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                      </svg>
                                    </button>
                                    <button title={item.group?.name ? `发通知给「${item.group.name}」` : '发通知'}
                                      onClick={(e) => { e.stopPropagation(); setNotifyText(''); setNotifySent(false); setNotifyState({ show: true, groupId: item.group?.id, studentName: item.group?.name || item.group?.id }); }}
                                      style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef2ff', color: '#4f46e5', padding: 0 }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                                    </button>
                                    {showClear && (
                                      <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                        onClick={(e) => { e.stopPropagation(); handleClearGroupMessages(item.members, item.group?.name || '该小组'); }}
                                        style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                      </button>
                                    )}
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
                                <button title="发消息"
                                  onClick={(e) => { e.stopPropagation(); setNotifyText(''); setNotifySent(false); setNotifyState({ show: true, studentId: sid, studentName: student.name }); }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef2ff', color: '#4f46e5', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                                </button>
                                <button title="奖励一次头像更换权限（学生可在对话页自行兑换）"
                                  onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定奖励「${student.name}」一次头像更换权限？`)) return; try { await api.rewardStudentAvatar(id, sid); incrementAvatarChangeTokens(sid); setToast({ msg: `已奖励 ${student.name} 一次头像更换权限`, type: 'success' }); } catch {} }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fffbeb', color: '#d97706', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                </button>
                                {/* 🔴 垃圾桶**只在内容区真的显示「智能学伴」对话时才出现**
                                    （用户原话：它只针对学生与智能体对话的内容）。 */}
                                {showClear && (
                                  <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                    onClick={(e) => { e.stopPropagation(); handleClearMessages(sid, student.name); }}
                                    style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {/* 人数（仅小组） */}
                        {isGroup && (
                          <div style={{ fontSize: "0.688rem", color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>
                            {item.group?.id ? (groupMembersMap[item.group.id]?.length ?? item.members.length) : item.members.length} 人
                          </div>
                        )}
                        {/* 状态标签 */}
                        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                          {studentBlacklisted[sid] && (
                            <div title="已被黑屏" style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 600,
                              background: '#1e293b', color: 'white', whiteSpace: 'nowrap',
                            }}>
                              黑屏
                            </div>
                          )}
                          {(() => {
                            const isDeep = isGroup
                              ? item.members.some((m) => deepThinkingStatuses[m.id])
                              : deepThinkingStatuses[sid];
                            const bg = isDeep ? '#f5f3ff' : status === 'online' ? '#ecfdf5' : status === 'thinking' ? '#fffbeb' : '#f1f5f9';
                            const dotColor = isDeep ? '#7c3aed' : status === 'online' ? '#10b981' : status === 'thinking' ? '#f59e0b' : '#94a3b8';
                            const textColor = isDeep ? '#7c3aed' : status === 'online' ? '#10b981' : status === 'thinking' ? '#f59e0b' : '#94a3b8';
                            const label = isDeep ? '深度思考' : status === 'online' ? '在线' : status === 'thinking' ? '思考' : '离线';
                            return (
                              <div title="当前状态" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 500, background: bg, color: textColor, whiteSpace: 'nowrap' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
                                {label}
                              </div>
                            );
                          })()}
                          <div title="对话轮数" style={{ padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 600, background: rounds > 0 ? '#eef2ff' : '#f3f4f6', color: rounds > 0 ? '#2563eb' : '#9ca3af', whiteSpace: 'nowrap' }}>
                            {rounds} 轮
                          </div>
                          {student.avatarChangeTokens > 0 && (
                            <div title="奖励次数" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 700, background: '#fffbeb', color: '#d97706', whiteSpace: 'nowrap' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                              {student.avatarChangeTokens}
                            </div>
                          )}
                          {!isGroup && studentWarnings[sid] > 0 && (
                            <div title="警告次数（点击清零）" onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定将「${student.name}」的警告次数清零？`)) return; try { await api.resetStudentWarnings(id, sid); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 600, background: '#fef2f2', color: '#dc2626', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                              {studentWarnings[sid]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>


                    {/* 内容区：按这一格的模块渲染（跟随 = 该学生此刻在用的；指定 = 教师选的）。
                        本格没有「学生与智能体对话」时也可能显示别的模块，所以
                        **没有**「最近一轮 Q&A 预览」这个固定说法了。 */}
                    <div className="preview-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                      {renderTileContent({
                        module: tileModule,
                        members: isGroup ? item.members : [cs],
                        isGroup,
                        online: status !== 'offline',
                        groupName: item.group?.name,
                        userMsg,
                        assistantMsg,
                        compact: false,
                      })}
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
            <div onClick={() => { setSelectedStudent(null); setSelectedGroup(null); selectedStudentIdRef.current = null; }}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: selectedGroup ? 10 : '50%', flexShrink: 0,
                    background: selectedGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #667eea, #764ba2)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: "0.938rem", overflow: 'hidden',
                  }}>
                    {selectedGroup ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                    ) : selectedStudent.avatarId && studentAvatars[selectedStudent.avatarId] ? (
                      <div style={{ width: 36, height: 36 }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[selectedStudent.avatarId]).replace('<svg', '<svg width="36" height="36"') }} />
                    ) : selectedStudent.name[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedGroup ? selectedGroup.name : selectedStudent.name}
                      {selectedGroup && groupMembersMap[selectedGroup.id] && (
                        <span style={{
                          fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8', marginLeft: 2,
                        }}>
                          {groupMembersMap[selectedGroup.id].length} 人
                        </span>
                      )}
                    </h3>
                    <div style={{ fontSize: "0.75rem", color: 'var(--text-secondary)', marginTop: 2 }}>
                      共 {messages.filter((m) => m.role === 'user').length} 轮交互 · {messages.length} 条消息
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-secondary" style={{ fontSize: "0.688rem", padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setShowFullscreen(true)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                    投屏
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: "0.688rem", padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => { setSelectedStudent(null); setSelectedGroup(null); selectedStudentIdRef.current = null; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    关闭
                  </button>
                </div>
              </div>
            </div>

            {allRis.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px', borderBottom: '1px solid #eef2f6', background: '#fafbff' }}>
                <span style={{ fontSize: "0.688rem", color: '#94a3b8' }}>投屏选择</span>
                <button onClick={() => setSelectedRounds(allRis.every(ri => selectedRounds.includes(ri)) ? [] : [...allRis])}
                  style={{ fontSize: "0.688rem", color: '#6366f1', cursor: 'pointer', border: 'none', background: 'transparent', padding: 0, fontWeight: 500 }}>
                  {allRis.every(ri => selectedRounds.includes(ri)) ? '取消全选' : `全选 (${allRis.length - selectedRounds.length} / ${allRis.length})`}
                </button>
              </div>
            )}

            {/* 消息列表 */}
            <div ref={drawerMessagesRef} style={{
              flex: 1, overflow: 'auto', padding: 16,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {loadingMessages ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 14 }}>
                  <div style={{
                    width: 36, height: 36, border: '3px solid #eef2f6',
                    borderTop: '3px solid var(--primary)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ color: 'var(--text-secondary)', fontSize: "0.813rem" }}>加载历史消息...</span>
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40, fontSize: "0.813rem" }}>
                  暂无对话记录
                </div>
              ) : (
                messages.map((m, i: number) => (
                  <div key={`dr-${m.role}-${m.createdAt || i}`} style={{
                    padding: '10px 14px',
                    borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    background: m.role === 'user' ? '#eef2ff' : '#f8fafc',
                    border: '1px solid',
                    borderColor: m.role === 'user' ? '#dbeafe' : '#eef2f6',
                    maxWidth: '90%',
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <div onClick={() => {
                        const ri = msgRounds[i];
                        if (ri != null) setSelectedRounds(function(prev: number[]) {
                          return prev.includes(ri) ? prev.filter(x => x !== ri) : [...prev, ri];
                        });
                      }}
                        style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid', borderColor: msgChecked[i] ? '#6366f1' : '#d1d5db', background: msgChecked[i] ? '#6366f1' : 'transparent', cursor: msgRounds[i] != null ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .12s', flexShrink: 0, opacity: msgRounds[i] != null ? 1 : 0 }}>
                        {msgChecked[i] && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                      <div style={{ fontSize: "0.688rem", fontWeight: 600, color: m.role === 'user' ? 'var(--primary)' : '#64748b' }}>
                        {m.role === 'user' ? selectedStudent.name : 'AI'}
                      </div>
                    </div>
                    {/* 附件图片 */}
                    {(() => {
                      const urls = m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : [];
                      const names = m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : [];
                      return urls.map((fu: string, fi: number) => (
                        <div key={fi} style={{ marginBottom: 6 }}>
                          {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
                            <img src={`${getApiBaseUrl()}${fu}`} alt={names[fi] || ''}
                              onClick={() => openFullscreenImage(`${getApiBaseUrl()}${fu}`)}
                              style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
                          ) : (
                            <div style={{ padding: '6px 10px', background: '#f3f4f6', borderRadius: 6, fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 4 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                              {names[fi] || '附件'}
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                    <div style={{ fontSize: "0.875rem", lineHeight: 1.6, wordBreak: 'break-word', color: '#1a1a2e' }}>
                      <Markdown>{m.fileUrls?.length ? stripImages(m.content) : m.content}</Markdown>
                    </div>
                    <div style={{ fontSize: "0.625rem", color: '#94a3b8', marginTop: 6, display: 'flex', gap: 8 }}>
                      <span>{new Date(m.createdAt).toLocaleTimeString()}</span>

                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          </>
        )}

        {/* 探究详情浮层（P2.3：原来长在「探究空间视图」里，现在跟着**格子内容**走
            —— 点开一个显示着缩略图的格子就是它）。 */}
        {exploreDetailStudent && (
          <ExploreDetailPanel
            student={exploreDetailStudent}
            state={webappStates[exploreDetailStudent.id]}
            /* ⚠️ 用**实时**的 `studentStatuses`，不是 `classroom.students[].status`。
               后者是挂载时取一次的 API 快照、永不刷新 ⇒ 这个格子会永远显示「未在线」。
               （判据与 `getDisplayCardStatus` 同源：`thinking` 也算在场，
               否则「学伴正在回答」的那几秒里它会闪成「未在线」。） */
            online={studentStatuses[exploreDetailStudent.id] === 'online' || studentStatuses[exploreDetailStudent.id] === 'thinking'}
            webapps={classroom.webapps ?? []}
            /* 采集开关只用来**决定文案**（关掉画面时，一个信号都没收到的格子该说
               「未打开」而不是「等待画面…」——因为那时永远不会再来一帧）。
               它不决定任何数据的收发：那是学生端与服务端的事。 */
            captureEnabled={captureEnabled}
            onClose={() => setExploreDetailId(null)}
          />
        )}

      </div>

      {/* 投屏发码 */}
      {codeScreenKey > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300, overflow: 'auto',
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setCodeScreenKey(0)}>
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
            <p style={{ fontSize: "1.875rem", color: 'rgba(255,255,255,0.6)', marginBottom: 36 }}>使用平板或手机自带相机扫码，微信/支付宝等扫码可能出现功能异常</p>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 56, marginBottom: 36, flexWrap: 'wrap' }}>
              <div style={{
                background: 'white', borderRadius: 24, overflow: 'hidden',
                display: 'inline-flex', flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}>
                <div style={{ padding: 24, position: 'relative', display: 'inline-flex' }}>
                  <QRCodeSVG
                    value={studentUrl ? `${studentUrl}?code=${teacherCode}` : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}/classroom?code=${teacherCode}`}
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
                    fontSize: "0.875rem", fontWeight: 600,
                    transition: 'all 0.15s', width: '100%',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  下载二维码图片
                </button>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: "1.375rem", color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>浏览器访问</div>
                <p style={{
                  fontSize: "2.75rem", fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: '0 0 8px 0',
                  fontFamily: 'monospace', letterSpacing: 1,
                }}>
                  {studentUrl ? studentUrl.replace('/classroom', '') : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}`}
                </p>
                <div style={{ fontSize: "1.375rem", color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>输入互动码</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(teacherCode || '').split('').map((d: string, i: number) => (
                    <div key={i} style={{
                      width: 96, height: 112, borderRadius: 14,
                      background: 'rgba(37,99,235,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: "4.5rem", fontWeight: 700, color: '#60a5fa',
                      lineHeight: 1,
                    }}>{d}</div>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn" style={{
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.15)', fontSize: "1.125rem", padding: '12px 36px',
              borderRadius: 10, cursor: 'pointer',
            }} onClick={() => setCodeScreenKey(0)}>
              返回看板
            </button>
          </div>
        </div>
      )}

      {/* 投屏讲评 */}
      {showFullscreen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: '#fff',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* 顶部信息栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 48px',
            background: 'white',
            borderBottom: '1px solid #eef2f6',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: '#0f172a', letterSpacing: 1 }}>
                {classroom?.title || '课堂'} · 学习展示
              </div>
              <div style={{ fontSize: "0.813rem", color: '#94a3b8' }}>
                {selectedStudent?.name || ''} · {projMsgs.filter((m) => m.role === 'user').length} 轮对话
              </div>
            </div>
            <button onClick={() => setShowFullscreen(false)}
              style={{ padding: '8px 20px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: "0.875rem", color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              退出投屏
            </button>
          </div>

          {/* 对话内容 */}
          <div ref={fullscreenContentRef} style={{
            flex: 1, overflow: 'auto', padding: '40px 60px',
            maxWidth: 1100, width: '100%', margin: '0 auto',
          }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 100, color: '#94a3b8', fontSize: "1.375rem" }}>
                暂无对话记录
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {projMsgs.map((m, i: number) => (
                  <div key={`fs-${m.role}-${m.createdAt || i}`} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}>
                    {/* 角色标签 */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 10,
                    }}>
                      {m.role === 'user' ? (
                        selectedStudent?.avatarId && studentAvatars[selectedStudent.avatarId] ? (
                          <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}
                            dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[selectedStudent.avatarId]).replace('<svg', '<svg width="48" height="48"') }} />
                        ) : (
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#eef2ff', color: '#667eea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.938rem", fontWeight: 700, flexShrink: 0 }}>
                            {selectedStudent?.name?.[0] || '学'}
                          </div>
                        )
                      ) : classroomAgent && (
                        <div style={{
                          width: 48, height: 48, borderRadius: 8,
                          background: 'linear-gradient(135deg, #667eea, #764ba2)',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: "0.938rem", fontWeight: 700, overflow: 'hidden',
                        }}>
                          {classroomAgent.logo
                            ? <img src={`${getApiBaseUrl()}${classroomAgent.logo}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : classroomAgent.name[0]
                          }
                        </div>
                      )}
                      <span style={{
                        fontSize: "1.25rem", fontWeight: 600,
                        color: m.role === 'user' ? '#667eea' : '#475569',
                      }}>
                        {m.role === 'user' ? selectedStudent?.name || '学生' : (classroomAgent?.name || 'AI 助手')}
                      </span>
                    </div>

                    {/* 消息气泡 */}
                    <div style={{
                      maxWidth: '78%',
                      padding: '20px 28px',
                      borderRadius: m.role === 'user' ? '20px 20px 6px 20px' : '6px 20px 20px 20px',
                      background: m.role === 'user' ? '#eef2ff' : '#f8fafc',
                      border: '1px solid',
                      borderColor: m.role === 'user' ? '#dbeafe' : '#eef2f6',
                      lineHeight: 1.8,
                      fontSize: "1.375rem",
                      color: '#0f172a',
                      wordBreak: 'break-word',
                    }}>
                      {/* 附件图片 */}
                      {(() => {
                        const urls = m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : [];
                        const names = m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : [];
                        return urls.map((fu: string, fi: number) => (
                          <div key={fi} style={{ marginBottom: 12 }}>
                            {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
                              <img src={`${getApiBaseUrl()}${fu}`} alt={names[fi] || ''}
                                onClick={() => openFullscreenImage(`${getApiBaseUrl()}${fu}`)}
                                style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 12, objectFit: 'contain', display: 'block', cursor: 'pointer' }} />
                            ) : (
                              <div style={{ padding: '10px 16px', background: m.role === 'user' ? 'rgba(102,126,234,0.08)' : '#f1f5f9', borderRadius: 10, fontSize: "1rem", display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                                {names[fi] || '附件'}
                              </div>
                            )}
                          </div>
                        ));
                      })()}
                      <Markdown>{m.fileUrls?.length ? stripImages(m.content) : m.content}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部水印 */}
          <div style={{
            textAlign: 'center', padding: '12px 0',
            fontSize: "0.813rem", color: '#cbd5e1',
            borderTop: '1px solid #f1f5f9',
          }}>
            ClassNode · 投屏展示
          </div>
        </div>
      )}

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
                color: 'white', fontWeight: 700, fontSize: "0.813rem",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: "0.938rem", color: '#0f172a' }}>学生互动面板 · 全屏模式</span>
              {/* 全屏只在指定模式下给（见 header 里那个按钮的注释），所以这里说得出
                  「全班显示的是哪个模块」——跟随模式下这句话就不成立了。 */}
              <span style={{ fontSize: "0.75rem", color: '#2563eb', fontWeight: 600 }}>
                全班显示「{MODULE_ID_LABELS[assignModule]}」
              </span>
              <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>
                {displayCards.length}{displayCards.length !== allDisplayCards.length ? ` / ${allDisplayCards.length}` : ''} {groupCards ? '个小组' : '名学生'}
              </span>
            </div>
            <button onClick={() => setGridFullscreen(false)}
              style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
                background: 'white', cursor: 'pointer', fontSize: "0.813rem", color: '#475569',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              退出全屏
            </button>
          </div>
          <div ref={fsContentRef} style={{ flex: 1, overflow: 'hidden', padding: '12px 20px', display: 'flex', flexDirection: 'column' }}>
            {/* 布局控制栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>
                {displayCards.length}{displayCards.length !== allDisplayCards.length ? ` / ${allDisplayCards.length}` : ''} {groupCards ? '个小组' : '名学生'} · {fsCols} 列（{Math.ceil(displayCards.length / fsCols)} 行）
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setFsCols(c => Math.max(2, c - 1))}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: "0.875rem", color: '#475569', lineHeight: 1 }}>
                  −
                </button>
                <span style={{ fontSize: "0.75rem", color: '#64748b', padding: '0 6px', minWidth: 30, textAlign: 'center' }}>
                  {fsCols}列
                </span>
                <button onClick={() => setFsCols(c => Math.min(8, c + 1))}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: "0.875rem", color: '#475569', lineHeight: 1 }}>
                  +
                </button>
              </div>
            </div>
            {/* 全屏学生网格 — 动态撑满 */}
            <div style={{ flex: 1, display: 'grid', gap: 12,
              gridTemplateColumns: `repeat(${fsCols}, 1fr)`,
              alignContent: 'stretch',
            }}>
              {allDisplayCards.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                  {groupCards ? '暂未分组' : '暂无学生加入'}
                </div>
              ) : displayCards.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 80, color: '#64748b' }}>
                  当前筛选下没有学生，请退出全屏后切换筛选条件
                </div>
              ) : (
                displayCards.map((item: ClassroomDisplayCard) => {
                  const isGroup = isClassroomGroupCard(item);
                  const cs = isGroup ? item.members[0] : item;
                  const student = cs.student;
                  const sid = cs.id;
                  const status = getDisplayCardStatus(item);
                  const rounds = isGroup
                    ? item.members.reduce((sum: number, m) => sum + (studentRounds[m.id] || 0), 0)
                    : studentRounds[sid] || 0;
                  const compact = fsCols >= 6;
                  const allMsgs = isGroup ? item.members.flatMap((m) => m.messages).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : null;
                  const userMsg = isGroup ? allMsgs!.filter((m) => m.role === 'user')[0] : cs.messages.filter((m) => m.role === 'user').slice(-1)?.[0];
                  const assistantMsg = isGroup ? allMsgs!.filter((m) => m.role === 'assistant')[0] : cs.messages.filter((m) => m.role === 'assistant').slice(-1)?.[0];
                  const isSelected = !isGroup && selectedStudent?.id === sid;
                  // 全屏**只在指定模式下可达**，所以这里每格的模块恒等于 `assignModule`
                  // —— 仍然走同一个 `renderTileContent`，不另写一份「全屏专用」的渲染。
                  const tileModule = isGroup ? resolveGroupTileModule(item.members) : resolveTileModule(sid);
                  const showClear = tileShowsClear(tileModule, isGroup ? item.members : [cs]);
                  return (
                    <div key={isGroup ? item.group?.id : cs.id}
                      onClick={() => {
                      if (!isGroup && tileModule === 'explore') { openExploreDetail(sid); return; }
                      setExploreDetailId(null);
                      if (isGroup) setSelectedGroup(item.group);
                      else setSelectedGroup(null);
                      openStudentDrawer({ ...student, id: cs.id });
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
                          fontWeight: 700, fontSize: compact ? 11 : 14, overflow: 'hidden',
                        }}>
                          {isGroup ? (
                            getGroupInitial(item.group?.name)
                          ) : student.avatarId && studentAvatars[student.avatarId] ? (
                            <div style={{ width: compact ? 26 : 36, height: compact ? 26 : 36, filter: status === 'offline' ? 'grayscale(1)' : 'none' }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[student.avatarId]).replace('<svg', `<svg width="${compact ? 26 : 36}" height="${compact ? 26 : 36}"`) }} />
                          ) : student.name[0]}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* 姓名行 + 操作按钮 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                            <span style={{ fontSize: compact ? 12 : 14, fontWeight: 600, color: status === 'offline' ? '#9ca3af' : '#1a1a2e', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              {isGroup ? (
                                <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}
                                  onMouseMove={(e) => setGroupTooltip({ id: item.group?.id ?? '', x: e.clientX, y: e.clientY })}
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
                                  const anyBlacklisted = item.members.some((m) => studentBlacklisted[m.id]);
                                  return (
                                    <>
                                      <button title={anyBlacklisted ? '解除黑屏' : '黑屏处理'}
                                        onClick={async (e) => { e.stopPropagation();
                                          if (anyBlacklisted) { for (const m of item.members) { try { await api.unblacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: false })); setStudentWarnings(prev => ({ ...prev, [m.id]: 0 })); } catch {} } }
                                          else { for (const m of item.members) { try { await api.blacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: true })); } catch {} } }
                                        }}
                                        style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: anyBlacklisted ? '#d1fae5' : '#fee2e2', color: anyBlacklisted ? '#047857' : '#b91c1c', padding: 0 }}>
                                        <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                          {anyBlacklisted ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                        </svg>
                                      </button>
                                      {showClear && (
                                        <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                          onClick={(e) => { e.stopPropagation(); handleClearGroupMessages(item.members, item.group?.name || '该小组'); }}
                                          style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                          <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                        </button>
                                      )}
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
                                  <button title="奖励一次头像更换权限（学生可在对话页自行兑换）"
                                    onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定奖励「${student.name}」一次头像更换权限？`)) return; try { await api.rewardStudentAvatar(id, sid); incrementAvatarChangeTokens(sid); setToast({ msg: `已奖励 ${student.name} 一次头像更换权限`, type: 'success' }); } catch {} }}
                                    style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fffbeb', color: '#d97706', padding: 0 }}>
                                    <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                  </button>
                                  {showClear && (
                                    <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                      onClick={(e) => { e.stopPropagation(); handleClearMessages(sid, student.name); }}
                                      style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                      <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {/* 人数（仅小组） */}
                          {isGroup && (
                            <div style={{ fontSize: compact ? 9 : 10, color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>
                              {item.group?.id ? (groupMembersMap[item.group.id]?.length ?? item.members.length) : item.members.length} 人
                            </div>
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
                            {student.avatarChangeTokens > 0 && (
                              <div title="奖励次数" style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3, padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 700, background: '#fffbeb', color: '#d97706', whiteSpace: 'nowrap' }}>
                                <svg width={compact ? 8 : 10} height={compact ? 8 : 10} viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                {student.avatarChangeTokens}
                              </div>
                            )}
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
                      {/* 内容区：与主看板**同一个**渲染实现，只有 `compact` 不同
                          —— 两处各写一遍必然出现「全屏里少了缩略图」这类只在全屏才看得见的差异。 */}
                      <div className="preview-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
                        {renderTileContent({
                          module: tileModule,
                          members: isGroup ? item.members : [cs],
                          isGroup,
                          online: status !== 'offline',
                          groupName: item.group?.name,
                          userMsg,
                          assistantMsg,
                          compact,
                        })}
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
          padding: '8px 12px', borderRadius: 8, fontSize: "0.75rem",
          lineHeight: 1.7, whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>
          {groupMembersMap[groupTooltip.id].map((d) => d.studentName).filter(Boolean).join('、')}
        </div>
      )}
      {/* 发通知弹窗 */}
      {notifyState.show && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }} onClick={() => setNotifyState({ show: false })}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 14, padding: 0,
            maxWidth: 440, width: '90%', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ padding: '20px 24px 16px' }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: '0 0 4px' }}>
                {notifyState.groupId ? `发通知给「${notifyState.studentName || notifyState.groupId}」` : notifyState.studentId ? `发消息给 ${notifyState.studentName || notifyState.studentId}` : '发通知给全班'}
              </h3>
              <p style={{ fontSize: "0.75rem", color: '#64748b', margin: '0 0 14px' }}>
                {notifyState.groupId ? '消息将出现在该组每位成员的对话页下方' : notifyState.studentId ? '消息将出现在该学生对话页下方' : '消息将出现在全班学生的对话页下方'}
              </p>
              {notifySent ? (
                <div style={{
                  padding: '14px', borderRadius: 8, background: '#f0fdf4',
                  border: '1px solid #bbf7d0', textAlign: 'center',
                  fontSize: "0.875rem", color: '#166534', fontWeight: 500,
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }}><polyline points="20 6 9 17 4 12" /></svg>
                  已发送
                </div>
              ) : (
                <>
                  <textarea
                    className="input"
                    value={notifyText}
                    onChange={e => { setNotifyText(e.target.value); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendNotification();
                      }
                    }}
                    placeholder="输入你想对学生说的话..."
                    rows={4}
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: "0.813rem", padding: '10px 14px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: "0.688rem", color: '#94a3b8' }}>Enter 发送 · Shift+Enter 换行</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setNotifyState({ show: false })} style={{ fontSize: "0.813rem", padding: '7px 18px' }}>取消</button>
                    <button className="btn btn-primary" onClick={sendNotification} disabled={!notifyText.trim() || notifySent}
                      style={{ fontSize: "0.813rem", padding: '7px 20px' }}>
                      发送
                    </button>
                  </div>
                </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* 「课堂权限」浮动窗（P2.3 第二批）。
          从下拉菜单改成浮窗：这个按钮底下的内容已经不是一条窄菜单装得下的量了
          （以后接上学习单只会更多），而且每一段以后各自还会长。
          **内容按三件套分成三段**，段的顺序就是三件套的顺序。
          ⚠️ 段里的控件与 handler 是从原来那份菜单里**原样搬来的** —— 同一批控件、同一批 handler、
             同一批 busy 键；「显示学生网页画面」关掉之后那两行置灰的**三道闸**也一起搬来了。
          ⚠️ 只有「模块状态」那个菜单不在这里（它管的是每个模块 open/preview/hidden，是另一件事）。 */}
      {showPermissionsDialog && (
        <div className="modal-overlay" style={{ zIndex: 400 }} onClick={() => setShowPermissionsDialog(false)}>
          <div ref={permissionsDialogRef} className="modal-content" role="dialog" aria-modal="true" aria-label="课堂权限" tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 560, padding: 0, borderRadius: 14, outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', borderBottom: '1px solid #e2e8f0', borderTopLeftRadius: 14, borderTopRightRadius: 14, background: 'linear-gradient(135deg, #f8faff, #f0f4ff)' }}>
              <h3 style={{ margin: 0, flex: 1, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>课堂权限</h3>
              <button type="button" aria-label="关闭课堂权限窗口" onClick={() => setShowPermissionsDialog(false)}
                style={{ width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: '6px 12px 10px' }}>
              {/* ① 学习单 —— **占位**。学习单本身还没做，所以这里如实写「尚未支持」，
                  而不是留一段空白（空白会被读成加载失败），也不是先摆几个点不动的开关。
                  这一段留着是为了让三件套的分段一次定形：以后接上学习单，往里加开关就行。 */}
              <PermissionSection label={MODULE_ID_LABELS.worksheet} first>
                <div style={{ margin: '0 10px', padding: '10px 12px', borderRadius: 8, background: '#f8fafc', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: '0.75rem', lineHeight: 1.6 }}>
                  <strong style={{ color: '#64748b' }}>尚未支持。</strong>学习单还没有做，这里先留位。
                </div>
              </PermissionSection>

              {/* ② 探究空间 —— 画面采集（P2.2）。这一整组是从「课堂权限」菜单里原样搬来的：
                  同样是**按课堂**的开关，只是换了容器（窄菜单 → 浮窗的一段）。
                  容器上只去掉了 marginTop/borderTop/paddingTop 三个样式属性 —— 它们原本是用来和
                  菜单里上面那三个开关隔开的，而段与段之间的分隔线现在由 PermissionSection 画。 */}
              <PermissionSection label={MODULE_ID_LABELS.explore}>
                <div role="group" aria-label="探究空间画面">
                  <div style={{ padding: '6px 10px 4px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>探究空间画面</div>
                  <div style={{ padding: '0 10px 6px', fontSize: '0.688rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    采集学生探究网页的画面。设备跑不动时可以整个关掉。
                  </div>
                  <PermissionMenuItem label="显示学生网页画面"
                    enabled={captureEnabled}
                    busy={controlBusy === 'capture-enabled'}
                    onToggle={() => void setWebappCapture('capture-enabled', { enabled: !captureEnabled })} />
                  {/* 后果写在**关闭时**、且不跟着下面两行一起变淡 —— 变淡了就没人看得清了。
                      只说「学生端不再传画面」这一件确凿的事，不承诺关掉之后还能看到别的什么。 */}
                  {!captureEnabled && (
                    <div style={{ margin: '0 10px 8px', padding: '8px 10px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: '0.75rem', lineHeight: 1.5 }}>
                      已关闭：<strong>学生端不再传画面</strong>，下面的分辨率与更新频率随之失效。
                    </div>
                  )}
                  {/* 关掉开关时这两行整体置灰。
                      ⚠️ `opacity` 与 `cursor` 只是给人看的**提示**，拦不住键盘 Tab + 回车，
                          也拦不住脚本触发 —— 真正让「点了不生效」的是每个按钮上的 disabled
                          （`captureRowsDisabled` 同时含了「开关关着」与「有别的请求在跑」）。 */}
                  <div style={{ opacity: captureEnabled ? 1 : 0.45, cursor: captureEnabled ? 'default' : 'not-allowed' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 4px', fontSize: '0.75rem', color: '#334155' }}>
                      <span style={{ flex: 1 }}>分辨率</span>
                      {captureWidthBusy && <span style={{ fontSize: '0.688rem', color: '#94a3b8' }}>更新中...</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px' }}>
                      {WEBAPP_WIDTH_OPTIONS.map((option) => {
                        const busyKey = `capture-width-${option.width}`;
                        return (
                          <CaptureOption key={option.width}
                            label={String(option.width)}
                            hint={option.hint}
                            selected={captureWidth === option.width}
                            busy={controlBusy === busyKey}
                            disabled={captureRowsDisabled}
                            onSelect={() => void setWebappCapture(busyKey, { width: option.width })} />
                        );
                      })}
                    </div>
                    <div style={{ padding: '0 10px 8px', fontSize: '0.688rem', color: '#94a3b8', lineHeight: 1.5 }}>
                      小字是每帧的实测体积，越大越清楚、传输也越重。
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 4px', fontSize: '0.75rem', color: '#334155' }}>
                      <span style={{ flex: 1 }}>更新频率</span>
                      {captureIntervalBusy && <span style={{ fontSize: '0.688rem', color: '#94a3b8' }}>更新中...</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, padding: '0 10px 4px' }}>
                      {WEBAPP_INTERVAL_OPTIONS.map((option) => {
                        const busyKey = `capture-interval-${option.ms}`;
                        return (
                          <CaptureOption key={option.ms}
                            label={option.label}
                            selected={captureIntervalMs === option.ms}
                            busy={controlBusy === busyKey}
                            disabled={captureRowsDisabled}
                            onSelect={() => void setWebappCapture(busyKey, { frameIntervalMs: option.ms })} />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </PermissionSection>

              {/* ③ 智能学伴 —— 原来挂在菜单里那个「学生端功能」小标题下的三个开关。
                  它们本来就是智能学伴页面的三项能力开关，归到这一段（小标题随之取消：
                  段标题已经说明了范围，再叠一层「学生端功能」只会让人以为还管着别的模块）。 */}
              <PermissionSection label={MODULE_ID_LABELS.companion} note="学生端智能学伴页面的三项能力开关。">
                <PermissionMenuItem label="允许中断 AI 回答" enabled={classroom.allowStudentStop !== false} busy={controlBusy === 'stop'} onToggle={() => void toggleStop()} />
                <PermissionMenuItem label="允许导出对话" enabled={classroom.allowStudentExport !== false} busy={controlBusy === 'export'} onToggle={() => void toggleExport()} />
                <PermissionMenuItem label="显示追问建议" enabled={classroom.allowFollowUps !== false} busy={controlBusy === 'follow-ups'} onToggle={() => void toggleFollowUps()} />
              </PermissionSection>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* 全屏图片预览（支持无极缩放） */}
      {fullscreenImg && (
        <div ref={overlayRef}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            cursor: 'zoom-out',
            userSelect: 'none',
          }}>
          <img src={fullscreenImg} alt=""
            draggable={false}
            style={{
              transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${zoomLevel})`,
              transformOrigin: 'center center',
              maxWidth: '92vw', maxHeight: '92vh',
              objectFit: 'contain', borderRadius: 8,
              boxShadow: zoomLevel > 1 ? '0 0 60px rgba(0,0,0,0.4)' : '0 8px 40px rgba(0,0,0,0.5)',
              cursor: 'grab',
              pointerEvents: 'auto',
            }} />
          <button onClick={() => { setFullscreenImg(null); setZoomLevel(1); }}
            style={{
              position: 'absolute', top: 20, right: 24,
              width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: 'rgba(255,255,255,0.12)',
              color: 'white', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, lineHeight: 1,
              backdropFilter: 'blur(4px)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}>
            ✕
          </button>
          <div style={{
            position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          }}>
            {/* 缩放滑竿 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
              borderRadius: 24, padding: '8px 20px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
              <input type="range" min="30" max="300" value={Math.round(zoomLevel * 100)}
                onChange={e => setZoomLevel(parseInt(e.target.value) / 100)}
                style={{
                  width: 140, height: 4, appearance: 'none',
                  background: 'rgba(255,255,255,0.2)', borderRadius: 2,
                  outline: 'none', cursor: 'pointer',
                }}
                onInput={e => {
                  const v = parseInt((e.target as HTMLInputElement).value) / 100;
                  setZoomLevel(v);
                }} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
              <span style={{
                minWidth: 44, textAlign: 'center',
                color: 'rgba(255,255,255,0.85)', fontSize: "0.813rem",
                fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              }}>{Math.round(zoomLevel * 100)}%</span>
            </div>
            {/* 滚轮提示 */}
            <span style={{
              color: 'rgba(255,255,255,0.35)', fontSize: "0.75rem",
              letterSpacing: 0.5,
            }}>滚轮缩放</span>
          </div>
        </div>
      )}
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
  allMessages: ClassroomMessage[];
  loadAnalytics: () => void;
}

function WordText({ data, ref }: { data: WordRendererData; ref?: Ref<SVGTextElement> }) {
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

/**
 * ⚠️ `memo` 不是装饰（P2.3 起才需要）：探究空间的订阅搬到了 `page.tsx`，于是**每一帧**
 * （每个学生每 10 秒左右一帧）都会让那一层重渲染，而这个面板挂在那层下面。
 * 它真正依赖的只有三样：`classroomId`、`allMessages`（只在加载时换引用）、`loadAnalytics`
 * （`useCallback` 稳定）—— `memo` 让它的重渲染次数回到这三个的节奏，
 * 而不是跟着别人的帧走。（内部那几处 `useMemo` 挡得住重算，挡不住重渲染。）
 */
const AnalyticsPanel = memo(function AnalyticsPanel({ classroomId, allMessages, loadAnalytics }: AnalyticsPanelProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`cls_analytics_collapsed_${classroomId}`) === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem(`cls_analytics_collapsed_${classroomId}`, String(collapsed));
  }, [collapsed, classroomId]);
  const [cloudSource, setCloudSource] = useState<'user' | 'assistant' | 'both'>('user');
  const cloudRef = useRef<HTMLDivElement>(null);
  const [cloudWidth, setCloudWidth] = useState(360);

  useLayoutEffect(() => {
    const el = cloudRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setCloudWidth(Math.max(200, Math.floor(rect.width)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { loadAnalytics(); }, [classroomId, loadAnalytics]);

  // 词云计算：只在 allMessages 或 cloudSource 变化时才重算
  const isShieldFiltered = useCallback((m: ClassroomMessage) => (m.content || '').includes('**'), []);
  const filteredForCloud = useMemo(() => cloudSource === 'both'
    ? allMessages.filter((m) => !isShieldFiltered(m))
    : allMessages.filter((m) => m.role === cloudSource && !isShieldFiltered(m)), [allMessages, cloudSource, isShieldFiltered]);
  const words = useMemo(() => extractKeywords(filteredForCloud.map((m) => m.content || '')), [filteredForCloud]);

  // 活跃学生排名：每条学生提问计为一轮，不把 AI 回复重复计数。
  const topStudents = useMemo(() => {
    const studentRoundCounts = new Map<string, { name: string; count: number }>();
    for (const m of allMessages) {
      if (m.role !== 'user') continue;
      const sid = m.classroomStudent?.id;
      const name = m.classroomStudent?.student?.name || m.classroomStudent?.group?.name;
      if (!sid || !name) continue;
      const key = sid;
      const existing = studentRoundCounts.get(key) || { name, count: 0 };
      existing.count++;
      studentRoundCounts.set(key, existing);
    }
    const sorted = [...studentRoundCounts.entries()]
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const maxCount = sorted[0]?.count || 1;
    return { list: sorted, maxCount };
  }, [allMessages]);

  // 参与人数统计
  const participantCount = useMemo(() => {
    const sids = new Set<string>();
    for (const m of allMessages) {
      const sid = m.classroomStudent?.id;
      if (sid) sids.add(sid);
    }
    return sids.size;
  }, [allMessages]);

  // 词云组件 props 全部用 useMemo/useCallback 稳定引用，避免父组件重渲染时触发 WordCloud 重算
  const wordCloudData = useMemo(() => words.map(w => ({ text: w.word, value: w.count })), [words]);
  const stableFont = useCallback(() => '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif', []);
  const wordFontSize = useCallback((word: Word) => {
    const counts = words.map(w => w.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const range = max - min || 1;
    return 11 + ((word.value - min) / range) * 16;
  }, [words]);
  const wordFill = useCallback((_word: Word, i: number) => `url(#wcg${(i % 6) + 1})`, []);
  const wordGradients = useMemo(() => [
    { id: 'wcg1', type: 'linear' as const, angle: 45, stops: [{ offset: '0%' as const, color: '#2563eb' }, { offset: '100%' as const, color: '#7c3aed' }] },
    { id: 'wcg2', type: 'linear' as const, angle: -45, stops: [{ offset: '0%' as const, color: '#db2777' }, { offset: '100%' as const, color: '#ea580c' }] },
    { id: 'wcg3', type: 'linear' as const, angle: 135, stops: [{ offset: '0%' as const, color: '#059669' }, { offset: '100%' as const, color: '#10b981' }] },
    { id: 'wcg4', type: 'linear' as const, angle: 90, stops: [{ offset: '0%' as const, color: '#7c3aed' }, { offset: '100%' as const, color: '#c084fc' }] },
    { id: 'wcg5', type: 'linear' as const, angle: 0, stops: [{ offset: '0%' as const, color: '#dc2626' }, { offset: '100%' as const, color: '#fbbf24' }] },
    { id: 'wcg6', type: 'linear' as const, angle: -90, stops: [{ offset: '0%' as const, color: '#0891b2' }, { offset: '100%' as const, color: '#2dd4bf' }] },
  ], []);
  const renderWord = useCallback((data: WordRendererData, ref?: Ref<SVGTextElement>) => <WordText data={data} ref={ref} />, []);
  const stableRotate = useCallback(() => 0, []);

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
            <span style={{ fontSize: "0.938rem", fontWeight: 600, color: '#0f172a' }}>对话分析</span>
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
          <span style={{ fontSize: "0.938rem", fontWeight: 600, color: '#0f172a' }}>对话分析</span>
          <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400 }}>
            {allMessages.length} 条消息 · {participantCount} 人参与
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); loadAnalytics(); }}
            style={{
              background: '#f1f5f9', border: 'none', borderRadius: 6,
              padding: '4px 10px', fontSize: "0.688rem", color: '#64748b',
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
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
              }} />
              高频词云
              {words.length > 0 && (
                <span style={{ fontSize: "0.688rem", fontWeight: 400, color: '#94a3b8', textTransform: 'none' }}>
                  {words.length} 个热词
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([['user', '学生提问'], ['assistant', 'AI回答'], ['both', '全部']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setCloudSource(key)}
                  style={{
                    padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: "0.688rem", fontWeight: cloudSource === key ? 600 : 400,
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
              fontSize: "0.813rem", color: '#cbd5e1', textAlign: 'center',
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
                words={wordCloudData}
                width={cloudWidth}
                height={Math.min(Math.floor(cloudWidth * 0.38), 220)}
                font={stableFont}
                fontSize={wordFontSize}
                fill={wordFill}
                gradients={wordGradients}
                renderWord={renderWord}
                rotate={stableRotate}
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
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              活跃学生 TOP 10
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topStudents.list.length === 0 ? (
                <div style={{ fontSize: "0.813rem", color: '#cbd5e1', textAlign: 'center', padding: 16 }}>暂无数据</div>
              ) : (
                topStudents.list.map((s, i) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: i < 3 ? ['#fef3c7', '#e5e7eb', '#fed7aa'][i] : '#f1f5f9',
                      color: i < 3 ? ['#92400e', '#475569', '#9a3412'][i] : '#94a3b8',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: "0.625rem", fontWeight: 700, flexShrink: 0,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: "0.813rem", color: '#334155', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                    <div style={{
                      flex: '0 0 60px', height: 6, borderRadius: 3,
                      background: '#f1f5f9', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${(s.count / topStudents.maxCount) * 100}%`,
                        height: '100%', borderRadius: 3,
                        background: i < 3
                          ? ['#f59e0b', '#94a3b8', '#f97316'][i]
                          : '#a5b4fc',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <span style={{ fontSize: "0.688rem", color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 40, textAlign: 'right' }}>
                      {s.count} 轮
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
});
