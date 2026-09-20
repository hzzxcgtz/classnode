'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, getStudentSessionAuthorization } from '@/lib/api';
import { Toast } from '@/lib/components';
import type { ChatAgent, ChatPanelProps } from '../classroom-types';
import { API_BASE_URL, fixSvgUrl } from '../avatar-utils';
import { SvgAvatar } from './svg-avatar';
import { MessageItem } from './message-item';
import { StreamingIndicator } from './streaming-indicator';
import { ThinkingContent } from './thinking-content';
import { AvatarChangerContent } from './avatar-changer';
import { useVoiceInput } from './use-voice-input';
import styles from './chat.module.css';

const MAX_ATTACHED_FILES = 5;

export function StudentChatContent({
  // M1b-2 Task 3 起必填且无默认值：默认 true 会把「外壳忘了传」伪装成「一直可见」。
  active,
  code,
  classroom,
  selectedStudent,
  avatarSvgs,
  avatarTokenCount,
  allStudentAvatars,
  teacherMsgs,
  messages,
  loadingMessages,
  waitingAI,
  paused,
  agentDisabled,
  shieldWarning,
  toast,
  loadError,
  connected,
  connectionError,
  streamingContent,
  thinkingContent,
  teacherNotifBubble,
  blacklisted,
  setSelectedStudent,
  setAvatarSvgs,
  setAllStudentAvatars,
  setMessages,
  setWaitingAI,
  setPaused,
  setAgentDisabled,
  setShieldWarning,
  setToast,
  setConnectionError,
  setStreamingContent,
  setThinkingContent,
  setTeacherNotifBubble,
  fetchStudentTokens,
  onSwitchIdentity,
  onExit,
  onClassroomEnded,
  onRetryRestore,
  wsRef,
  statusSocketRef,
  chatConnectionGenerationRef,
  sendingRef,
  identityConflictTimerRef,
  teacherNotifTimerRef,
  streamingBufferRef,
  streamingRafRef,
}: ChatPanelProps) {
  // M1a：会话所有权（code/step/classroom/selectedStudent/messages/... ）已上移到
  // page.tsx 的 useClassroomSession；task 3 又把 useChatSocket 连同它写入的
  // connected/connectionError/streamingContent/thinkingContent/teacherNotifBubble/
  // blacklisted 一并上移。这里只剩下学伴模块自身、与 socket 无关的状态。
  const [showAvatarChanger, setShowAvatarChanger] = useState(false);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ url: string; name: string }[]>([]);
  const [showTeacherPanel, setShowTeacherPanel] = useState(false);
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, offX: 0, offY: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const chatShellRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<{ index: number; top: number; text: string }[]>([]);
  const [markerBarStyle, setMarkerBarStyle] = useState<{ left: number; top: number; height: number } | null>(null);
  const [activeMsgIndex, setActiveMsgIndex] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<{ index: number; text: string; x: number; y: number } | null>(null);
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // ===== 浮层逃生舱（M1b-2 Task 2）=====
  // 面板里有五个 `position: fixed` 元素：滚动标记条（z-index 20）、标记 tooltip（30）、
  // 头像更换模态（`.modal-overlay` → 100）、全屏图片查看器（9999）、Toast（99999）。
  // §4.6 的切换动画会给面板加 `transform`，面板随即成为它们的**包含块** —— 它们会被重新
  // 锚定到面板盒子、被裁切、暗色遮罩跟着平移。提到 `document.body` 才能逃出去。
  //
  // Ruling 5：**portal 本身不够**。提到 body 之后它们不再继承面板的 `visibility:hidden`，
  // 会浮在首页与另外两个 tab 之上。所以每个浮层都必须**显式按所属模块的 active 决定可见性**。
  //   · 不能用「非 active 就卸载」：那会丢掉全屏查看器的缩放/位置与模态的展开状态，
  //     而 §4.5 要求模块挂载后状态完整保留（切回来查看器还开着、还停在原缩放）。
  //   · 所以这里保持挂载，只把 `active` 翻译成 `visibility`（与面板自身被隐藏的方式一致，
  //     顺带获得「隐藏时不可聚焦/不可点」的语义，见 §4.10 C2）。
  //
  // SSR 守卫：Next.js 静态导出会在构建期预渲染本页，那时没有 `document`。用 mounted 标志
  // 而不是 `typeof document !== 'undefined'` 内联判断 —— 后者会让服务端输出与首次客户端
  // 渲染不一致（hydration 不匹配）。浮层的初始状态全是关闭，所以只晚一帧，肉眼不可见。
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  const overlayPortal = (node: ReactNode) => {
    if (!portalReady || !node) return null;
    return createPortal(
      <div style={{ visibility: active ? 'visible' : 'hidden' }}>{node}</div>,
      document.body,
    );
  };

  // ⚠️ M1b-2 Task 5 起面板常驻（切 Tab 只隐藏不卸载，§4.5），这条清理只在「面板真正卸载」
  // 时执行：换身份、课堂结束、或整页离开。§4.10 A 记录的缺口 ——
  // streamingRafRef/streamingBufferRef 与两个定时器的复位**只长在这里** —— 因此由外壳选的
  // **路线 A**（Ruling 4：`key={selectedStudent?.id}`）兜底：换身份即重挂 ⇒ 这条清理照跑，
  // 今天的 ref/清理语义完整保留。外壳在 classroom-shell.tsx 里给的正是那个 key。
  // 谁把那个 key 换掉，M1a 修过的「RAF id 已取消但非空 ⇒ 流式文字完全不显示」就会原样回来。
  useEffect(() => () => {
    chatConnectionGenerationRef.current += 1;
    if (wsRef.current) { wsRef.current.disconnect(); wsRef.current = null; }
    if (statusSocketRef.current) { statusSocketRef.current.disconnect(); statusSocketRef.current = null; }
    if (streamingRafRef.current) cancelAnimationFrame(streamingRafRef.current);
    // 两个 streaming ref 由 page.tsx 持有，跨面板挂载存活；只 cancel 不置空会让下一次
    // 会话带着已取消的 raf id 重建 —— ai-chunk 的 `if (!streamingRafRef.current)` 会
    // 永远为假，RAF 不再调度，流式文字完全不显示。这里显式复位成 useRef 的初值。
    streamingRafRef.current = null;
    streamingBufferRef.current = '';
    if (identityConflictTimerRef.current) window.clearTimeout(identityConflictTimerRef.current);
    if (teacherNotifTimerRef.current) window.clearTimeout(teacherNotifTimerRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 卸载清理只跑一次；ref 由 page.tsx 创建、按对象身份传入，是稳定对象
  // 点击外部关闭教师消息面板
  const teacherPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // M1b-2 Task 1：这是 document 级监听，模块隐藏时不该继续挂在 document 上。
    // 隐藏期间不挂（此时点外部也没有"关闭弹层"的意义），active 回来后重新挂载；
    // 弹层状态本身跨 tab 保留，所以切回来时若还开着，行为与之前一致。
    if (!active || !showTeacherPanel) return;
    const handler = (e: MouseEvent) => {
      if (teacherPanelRef.current && !teacherPanelRef.current.contains(e.target as Node)) {
        setShowTeacherPanel(false);
      }
    };
    // 延迟挂载以避免触发按钮自身的 click 事件
    const attachTimer = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      // 必须显式清掉定时器：否则清理先于定时器执行时会 remove 一个尚未 add 的监听，
      // 随后那个定时器再把 handler 永久挂到 document 上（再也摘不掉，包括卸载时）。
      // active 进依赖后挂载/摘除变得频繁，这个窗口必须关掉。
      window.clearTimeout(attachTimer);
      document.removeEventListener('click', handler);
    };
  }, [active, showTeacherPanel]);

  // 实时通信（useChatSocket）已整体上移到 use-classroom-session.ts：socket 属于
  // 「课堂会话」而不是「学伴模块」—— M1b-2 之后面板常驻却随时可能不可见，让模块持有
  // socket 就等于用可见性决定连接的生死。面板仍需要的 ref（发送闸门 / 停止生成 /
  // 卸载清理）由 page.tsx 按对象身份透传。
  // `active` 交给语音：模块被隐藏时必须停麦（Ruling 6，见 use-voice-input.ts 里那条 effect）。
  const { voiceInputAvailable, voiceListening, toggleVoiceInput } = useVoiceInput({ input, setInput, setToast, inputRef, active });

  // iPadOS 15 的 100vh 会包含 Safari 工具栏占用的区域。键盘弹出后
  // Safari 还会平移 visualViewport：保持页面起点不动，只把偏移量计入
  // 可用高度，避免在触摸滚动期间反复移动整个页面造成抖动。
  //
  // M1b-2 Task 1：面板常驻后「挂载」不再等于「可见」，这道锁改挂 active。
  // scrollLockRef 同时承担两件事：**证明锁是我们自己上的**，以及**记住加锁前的值**。
  // 它是幂等性的全部依据：
  //   · 只有「当前未持有锁」时才快照 —— cleanup 一定会先还原并把它置空，因此下一次
  //     激活读到的必然是加锁前的真实值，**永不可能是我们自己写进去的 'hidden'**；
  //   · 只有持有者才还原，且还原后立刻让出持有权。
  // React 保证同一 effect 的 cleanup 一定先于下一次 setup 运行，所以「重新激活」与
  // 「上一次的还原」不会交错：反复切走切回 N 次后，DOM 状态始终等于「最后一次 active
  // 的稳态」（隐藏 → 原值，可见 → 'hidden'），既不会把 'hidden' 越叠越深，也不会漏还原。
  // （真正会踩雷的是「只把 if (!active) return 塞进函数体、依赖仍留 []」：那样这道锁
  //   只在挂载时上一次，切走后无人释放 —— 面板又不再卸载 —— <body> 会在整堂课上永远
  //   停在 overflow:hidden。也就是说缺陷不在「往依赖里加 active」，而在**取锁与放锁
  //   必须成对挂在同一个状态上**；这条 ref 语义正是把这件事写死。）
  const scrollLockRef = useRef<{ body: string; html: string } | null>(null);
  useEffect(() => {
    const shell = chatShellRef.current;
    if (!active || !shell) return;
    const viewport = window.visualViewport;
    if (scrollLockRef.current === null) {
      scrollLockRef.current = {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
    }
    let frame: number | null = null;
    let settleTimer: number | null = null;

    const updateViewportHeight = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visualHeight = viewport?.height || window.innerHeight;
        const visualOffsetTop = viewport?.offsetTop || 0;
        const height = Math.round(visualHeight + visualOffsetTop);
        shell.style.setProperty('--chat-viewport-height', `${height}px`);
        frame = null;
      });
    };

    // Older WebKit may report offsetTop=0 in the first keyboard resize event
    // and correct it shortly afterwards. Re-measure once after the animation
    // settles instead of following every visualViewport scroll event.
    const updateAndSettle = () => {
      updateViewportHeight();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(updateViewportHeight, 120);
    };

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    updateAndSettle();
    window.addEventListener('resize', updateAndSettle);
    window.addEventListener('orientationchange', updateAndSettle);
    document.addEventListener('focusin', updateAndSettle);
    document.addEventListener('focusout', updateAndSettle);
    viewport?.addEventListener('resize', updateAndSettle);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      window.removeEventListener('resize', updateAndSettle);
      window.removeEventListener('orientationchange', updateAndSettle);
      document.removeEventListener('focusin', updateAndSettle);
      document.removeEventListener('focusout', updateAndSettle);
      viewport?.removeEventListener('resize', updateAndSettle);
      // 刻意**不**移除 --chat-viewport-height：面板不再卸载，把最后一次量到的高度留着，
      // 切回学伴时的第一帧就是正确高度（否则那一帧会落到 100dvh 兜底上，而 Safari 15
      // 不认识 dvh 会把整条声明丢弃 → 该帧高度退化为 auto）。下一次激活会立刻重新量。
      const saved = scrollLockRef.current;
      if (saved !== null) {
        document.body.style.overflow = saved.body;
        document.documentElement.style.overflow = saved.html;
        scrollLockRef.current = null;
      }
    };
  }, [active]);

  // 全屏预览图片：ESC 关闭 + 滚轮缩放 + 鼠标拖拽
  // M1b-2 Task 1：五个监听全挂在 window 上，其中 wheel 还带 preventDefault —— 模块隐藏
  // 时必须摘掉，否则学生打开图片后切到别的 tab，**整个外壳的滚轮都会被吃掉**。
  // 查看器本身不关闭（状态跨 tab 保留，切回来它还在，与 §4.10 C3 一致）；重新可见时
  // setup 会把「拖到一半」的状态复位，不会带着拖拽中的状态回来。
  // M1b-2 Task 2（M1）：**只复位 `dragging`，不复位 `offX/offY`。** 那两个累加器对应
  // `imgOffset`（`translate(...)`），而 §4.10 C3 要求缩放/位置跨 tab 保留 —— 在这里清零
  // 会让「拖过图 → 切走 → 切回 → 再按下拖动」的第一帧 mousemove 把图猛地拉回原点
  // （累加器归零、`imgOffset` 仍在原处）。归零改在 `openFullscreenImage` 里做，那里
  // 本来就同时清零 `imgOffset`，两者永远同生同灭。
  // M1b-2 Task 2（M3）：cleanup 是唯一能收口「拖拽中途被切走」的位置 —— 那一刻 mouseup
  // 监听已经摘掉，`onMouseUp` 永远不会跑，光标会永久停在 'grabbing'。所以由 cleanup 复位。
  useEffect(() => {
    if (!active || !fullscreenImg) return;
    const d = dragRef.current;
    d.dragging = false;
    // setup 时捕获浮层节点（此时 effect 已跑在 commit 之后，ref 必然是挂上的），
    // 供 cleanup 复位光标 —— 见下方 cleanup 的说明，也避免在 cleanup 里读 ref.current。
    const overlayEl = overlayRef.current;

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
      // M3：拖拽中途切走（或切换查看的图片）时 `mouseup` 监听已摘，`onMouseUp` 不再运行，
      // 光标会永久停在 'grabbing'。下一次可见时 setup 只复位 `dragging`、不碰光标，
      // 所以必须在 cleanup 收口。这里用 setup 时捕获的节点而不是 `overlayRef.current`：
      // 关闭查看器时 ref 已经脱离（读 `.current` 会是 null，白写），而 active 切换时
      // 浮层**保持挂载**（Ruling 5），捕获的节点就是那个仍在文档里的元素。
      d.dragging = false;
      if (overlayEl) overlayEl.style.cursor = 'zoom-out';
    };
  }, [active, fullscreenImg]);

  const SOCKET_URL = API_BASE_URL;
  const apiBase = SOCKET_URL;

  /** 获取当前学生/小组绑定的智能体 */
  const getCurrentAgent = () => {
    if ((classroom?.mode === 'group' || classroom?.mode === 'advanced') && selectedStudent?.groupId && classroom?.groups) {
      const group = classroom.groups.find((group) => group.id === selectedStudent.groupId);
      if (group?.agent) return group.agent;
    }
    return classroom?.agents?.[0] || null;
  };

  const renderAgentAvatar = (size: number, borderRadius = 8, fontSize = 13, agent?: ChatAgent) => {
    const theAgent = agent || getCurrentAgent();
    const logoUrl = theAgent?.logo ? (theAgent.logo.startsWith('/') ? `${apiBase}${theAgent.logo}` : theAgent.logo) : null;
    if (logoUrl) {
      return <img src={logoUrl} alt="" style={{ width: size, height: size, borderRadius, objectFit: 'cover', flexShrink: 0 }} />;
    }
    return (
      <div style={{
        width: size, height: size, borderRadius,
        background: 'linear-gradient(135deg, #667eea, #764ba2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize, color: 'white', fontWeight: 700, flexShrink: 0,
      }}>
        {theAgent?.name?.[0] || 'AI'}
      </div>
    );
  };

  // 判断用户是否手动向上滚动
  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUpRef.current = !isAtBottom;
    setShowScrollBtn(!isAtBottom);
  };

  // 计算滚动标记位置
  const updateMarkers = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container || container.scrollHeight <= 0) return;
    const userMsgEls = container.querySelectorAll<HTMLElement>('[data-msg-id]');
    if (userMsgEls.length === 0) { setMarkers([]); setMarkerBarStyle(null); return; }
    const cr = container.getBoundingClientRect();
    const items: { index: number; top: number; text: string }[] = [];
    for (const el of userMsgEls) {
      const idx = parseInt(el.getAttribute('data-msg-id') || '', 10);
      if (isNaN(idx)) continue;
      const er = el.getBoundingClientRect();
      const topInContent = er.top - cr.top + container.scrollTop;
      const contentEl = el.querySelector('[data-msg-content]');
      const rawText = ((contentEl?.textContent || '').trim()).replace(/\s+/g, ' ');
      const preview = rawText.length > 30 ? rawText.slice(0, 30) + '…' : rawText;
      items.push({ index: idx, top: (topInContent / container.scrollHeight) * container.clientHeight, text: preview });
    }
    setMarkers(items);
    // 标记条对齐内部包裹层的右边缘（而非全宽滚动容器的右边缘）
    const wrapper = container.querySelector<HTMLElement>('[data-chat-wrapper]');
    const wr = wrapper ? wrapper.getBoundingClientRect() : cr;
    setMarkerBarStyle({ left: wr.right - 20, top: cr.top, height: cr.height });
  }, []);

  // 点击标记跳转
  const scrollToMarker = useCallback((index: number) => {
    const container = chatContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-msg-id="${index}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // 新消息到达、AI 流式输出、或首次进入对话页时自动滚动到底部
  // 用 useEffect 代替 useLayoutEffect，避免 scrollTop 强制同步布局阻塞主线程
  // iOS 键盘弹出时避免因滚动导致键盘收起：若输入框有焦点则不滚动
  // M1b-2 Task 1 **刻意不给这条加 active 门**：它只写自己子树内的 scrollTop，没有任何
  // 页面级副作用；保持无门意味着隐藏期间视图也一直贴着最新一条，学生切回学伴时不需要
  // 任何补滚就停在正确位置。
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = chatContainerRef.current;
    if (!el) return;
    // iPhone/iPad 上如果输入框有焦点，不自动滚动以免布局变化导致键盘收起
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && document.activeElement === inputRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
  }, [messages, streamingContent, waitingAI]);

  // 初始化滚动标记、追踪当前可见消息（高亮标记）、监听容器尺寸变化
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    requestAnimationFrame(() => updateMarkers());

    // IntersectionObserver: 追踪当前在视口中的用户消息，用于高亮对应标记
    const visibleIds = new Set<number>();
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const idx = parseInt((entry.target as HTMLElement).getAttribute('data-msg-id') || '', 10);
        if (isNaN(idx)) continue;
        if (entry.isIntersecting) visibleIds.add(idx);
        else visibleIds.delete(idx);
      }
      // 取可见消息中序号最小的（最靠近顶部）作为"当前"消息
      setActiveMsgIndex(visibleIds.size > 0 ? Math.min(...visibleIds) : null);
    }, { root: container, rootMargin: '-20px 0px -70% 0px' }) : null;

    const msgEls = container.querySelectorAll<HTMLElement>('[data-msg-id]');
    if (io) msgEls.forEach(el => io.observe(el));

    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => requestAnimationFrame(() => updateMarkers()))
      : null;
    if (ro) ro.observe(container);

    return () => { if (io) io.disconnect(); if (ro) ro.disconnect(); };
  }, [messages, updateMarkers]);

  // 标记条补测（M1b-2 Task 2）：标记条已 portal 到 body，是**视口坐标**的 `position: fixed`，
  // 不再跟着面板平移。而 §4.6 的切换动画是靠 `transform` 平移面板的 —— transform 不改变布局
  // 尺寸，容器的 ResizeObserver 不会触发，`updateMarkers` 也不会因 `messages` 未变而重跑。
  // 于是「最后一次测量发生在面板被平移的时刻」会让标记条整体偏掉一整个位移量。
  // 这里在 active 上升沿补测一次，保证学生能看见标记条时它一定是当前视口下的正确位置。
  // （今天 active 恒为 true，本 effect 等价于挂载时多测一次，与既有那条 rAF 同形，无害。）
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => updateMarkers());
    return () => cancelAnimationFrame(frame);
  }, [active, updateMarkers]);

  // 聚焦输入框的两条路径（M1b-2 Task 1 合并成一条，两者都必须在「可见」时才做）：
  //   ① AI 回答完成（waitingAI 由 true 变 false）：答完了把焦点还给学生；
  //   ② 模块由不可见变为可见（active 上升沿）：等价于基线的「进入聊天即聚焦」。
  // 原来的 <textarea autoFocus> 已删除：常驻面板下它只在首次挂载时生效，而模块隐藏时
  // （尤其 §4.6 动画期的 opacity/transform 阶段）元素仍可被聚焦 —— iPad 上会在学生已经
  // 切到另一个 tab 或首页时弹出键盘。等价的「首次聚焦」由 ② 承担。
  // iOS Safari 需要特殊处理：程序化 focus() 不会弹出虚拟键盘，
  // 临时设置 readOnly→focus→移除 readOnly 能强制触发键盘
  // M2（Task 2）：这条 effect 有一条**迟到的**副作用路径，必须显式收口。
  //   · `requestAnimationFrame` 与 150ms 的 `setTimeout` 都不受 `active` 约束 —— 若 `active`
  //     在 rAF 落地前转 false（§4.6 动画期元素仍可聚焦），焦点会落在学生已经离开的模块上，
  //     iPad 上键盘就弹在别的 tab 之上；
  //   · 更糟的是 `readOnly = true` 与 150ms 后的 `readOnly = false` 之间被切走：清理里若
  //     只取消定时器，`readOnly` 会**永久停在 true**，输入框再也打不了字。
  //   所以 cleanup 同时取消 rAF、取消定时器，并在确实设过 readOnly 时把它还回去。
  useEffect(() => {
    if (!active || waitingAI) return;
    let frame: number | null = null;
    let readOnlyTimer: number | null = null;
    // 只在真的把 readOnly 设成 true 时才记下元素：cleanup 的还原条件与设置条件因此严格同源，
    // 也避免在 cleanup 里读 `inputRef.current`（那时它可能已经指向别的节点或为 null）。
    let readOnlyEl: HTMLTextAreaElement | null = null;
    frame = requestAnimationFrame(() => {
      frame = null;
      const el = inputRef.current;
      if (!el) return;
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        el.readOnly = true;
        readOnlyEl = el;
        el.focus();
        readOnlyTimer = window.setTimeout(() => {
          readOnlyTimer = null;
          readOnlyEl = null;
          el.readOnly = false;
        }, 150);
      } else {
        el.focus();
      }
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (readOnlyTimer !== null) {
        window.clearTimeout(readOnlyTimer);
        readOnlyTimer = null;
        if (readOnlyEl) { readOnlyEl.readOnly = false; readOnlyEl = null; }
      }
    };
  }, [active, waitingAI]);

  const scrollToBottom = () => {
    const el = chatContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    userScrolledUpRef.current = false;
    setShowScrollBtn(false);
  };

  // 轮询后备：每 15 秒从 API 同步智能体启用/停用状态和课堂暂停状态（socket 事件的兜底）
  // M1b-2 Task 1 **刻意不给这条加 active 门**：它观察的是「课堂生命期」，不是模块呈现。
  // 面板常驻后若按可见性停掉它，学生只要不打开学伴 tab，课堂结束就再也检测不到
  // （§4.10 C1 是同一判断，并进一步要求把它搬进外壳 —— 那是另一件事，不在本任务内）。
  useEffect(() => {
    if (!code) return;
    const poll = async () => {
      try {
        const cr = await api.getClassroomByCode(code);
        if (cr.status === 'ended') {
          // 课堂已结束：清本地会话、提示、整页回首页 —— 编排归外壳
          onClassroomEnded();
          return;
        }
        // 分组/高级模式下检查当前小组绑定的智能体，否则使用第一个
        if ((cr.mode === 'group' || cr.mode === 'advanced') && selectedStudent?.groupId && cr.groups) {
          const g = cr.groups.find((group) => group.id === selectedStudent.groupId);
          setAgentDisabled(g?.agent?.enabled === false);
        } else {
          setAgentDisabled(cr.agents?.[0]?.enabled === false);
        }
        setPaused(cr.status === 'paused');
      } catch (error: unknown) {
        // 课堂已结束（API 返回 404 或 400）
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('课堂已结束') || msg.includes('互动码无效')) {
          onClassroomEnded();
        }
      }
    };
    poll(); // 立即执行一次
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [code, onClassroomEnded, selectedStudent?.groupId, setAgentDisabled, setPaused]); // 两个 setter 与 onClassroomEnded 都由外壳提供，是稳定引用

  const openFullscreenImage = (url: string) => {
    setZoomLevel(1);
    setImgOffset({ x: 0, y: 0 });
    // M1：拖拽累加器必须与 `imgOffset` 在同一处清零 —— 它们描述同一个平移量，
    // 分开复位会让「切走 → 切回 → 再拖」的第一帧把图拉回原点（详见查看器 effect 的注释）。
    dragRef.current.offX = 0;
    dragRef.current.offY = 0;
    dragRef.current.dragging = false;
    setFullscreenImg(url);
  };

  const handleStopGeneration = () => {
    if (wsRef.current) {
      wsRef.current.emit('stop-generation');
    }
    sendingRef.current = false;
    setWaitingAI(false);
    setStreamingContent('');
    setThinkingContent('');
  };

  const handleRevise = (content: string) => {
    if (waitingAI && classroom?.allowStudentStop === false) return;
    const stoppedCurrentAnswer = waitingAI;
    if (stoppedCurrentAnswer) handleStopGeneration();
    setAttachedFiles([]);
    setInput(content);
    window.requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
      inputRef.current.setSelectionRange(content.length, content.length);
    });
    setToast({
      msg: stoppedCurrentAnswer ? '已停止回答，请修改后重新发送' : '问题已放回输入框，请修改后重新发送',
      type: 'info',
    });
  };

  /** 将 WebP 图片转换为 PNG Blob */
  const convertWebpToPng = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas 2D 不可用')); return; }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            const newName = file.name.replace(/\.webp$/i, '.png');
            resolve(new File([blob], newName, { type: 'image/png' }));
          } else {
            reject(new Error('WebP 转换失败'));
          }
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('WebP 图片加载失败')); };
      img.src = url;
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const availableSlots = MAX_ATTACHED_FILES - attachedFiles.length;
    if (availableSlots <= 0) {
      setToast({ msg: `每条消息最多添加 ${MAX_ATTACHED_FILES} 个附件`, type: 'info' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (files.length > availableSlots) {
      files = files.slice(0, availableSlots);
      setToast({ msg: `本次仅添加前 ${availableSlots} 个附件（每条消息最多 ${MAX_ATTACHED_FILES} 个）`, type: 'info' });
    }
    setUploading(true);
    try {
      // WebP 图片自动转 PNG（部分平台不支持 WebP 格式）
      files = await Promise.all(files.map(async (f) => {
        if (f.type === 'image/webp' || /\.webp$/i.test(f.name)) {
          try {
            const png = await convertWebpToPng(f);
            console.log(`[Upload] WebP 已转 PNG: ${f.name} → ${png.name} (${(png.size / 1024).toFixed(1)}KB)`);
            return png;
          } catch (convErr) {
            console.warn('[Upload] WebP 转换失败，尝试原格式上传:', convErr);
            return f;
          }
        }
        return f;
      }));
      const newFiles: { url: string; name: string }[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${SOCKET_URL}/api/upload`, {
          method: 'POST', body: form, headers: getStudentSessionAuthorization(), credentials: 'include',
        });
        const data = await res.json();
        if (res.ok && data.success) {
          newFiles.push({ url: data.url, name: file.name });
        } else {
          throw new Error(data.error || `${file.name} 上传失败`);
        }
      }
      setAttachedFiles(prev => [...prev, ...newFiles]);
    } catch (error) {
      setToast({ msg: `附件上传失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const sendMessage = () => {
    const text = (inputRef.current?.value || '').trim();
    const files = attachedFiles;
    setConnectionError(null);
    if (!text && files.length === 0) return;
    if (sendingRef.current || waitingAI || paused || agentDisabled || blacklisted || !selectedStudent) return;
    if (!wsRef.current || !connected) {
      setToast({ msg: '连接暂不可用，请稍后重试', type: 'error' });
      return;
    }
    sendingRef.current = true;
    setWaitingAI(true);
    setInput('');
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setShieldWarning(null);
    setAttachedFiles([]);
    const userMsgContent = text || '(附件)';
    setMessages(prev => [...prev, {
      role: 'user', content: userMsgContent,
      fileUrls: files.map(f => f.url), fileNames: files.map(f => f.name),
    }]);
    userScrolledUpRef.current = false;
    wsRef.current.emit('send-message', {
      classroomCode: code,
      studentId: selectedStudent.id,
      content: userMsgContent,
      fileUrls: files.map(f => f.url),
      fileNames: files.map(f => f.name),
    });
  };

  /** 点击追问建议时自动发送该问题 */
  const handleFollowUp = (question: string) => {
    if (sendingRef.current || waitingAI || paused || agentDisabled || blacklisted || !wsRef.current || !connected || !selectedStudent) return;
    sendingRef.current = true;
    setWaitingAI(true);
    setConnectionError(null);
    setShieldWarning(null);
    setInput('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    setMessages(prev => [...prev, {
      role: 'user', content: question,
    }]);
    userScrolledUpRef.current = false;
    wsRef.current.emit('send-message', {
      classroomCode: code,
      studentId: selectedStudent.id,
      content: question,
    });
  };

  return (
    <div ref={chatShellRef} className={styles.chatShell}>
      {/* === 顶部栏 === */}
      <div className={styles.topBar}>
        <div className={styles.agentIdentity}>
          <div className={styles.headerAgentAvatar}>{renderAgentAvatar(48, 14, 20)}</div>
          <div className={styles.agentIdentityText}>
            <div className={styles.agentTitle}>
              {(() => {
                if ((classroom?.mode === 'group' || classroom?.mode === 'advanced') && selectedStudent?.groupId && classroom?.groups) {
                  const group = classroom.groups.find((group) => group.id === selectedStudent.groupId);
                  if (group?.agent?.name) return group.agent.name;
                }
                return classroom?.agents?.[0]?.name || 'AI 学习助手';
              })()}
            </div>
            <div className={styles.classroomMeta}>
              {classroom?.title || ''}
              <span>课堂 #{code}</span>
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <div className={`${styles.connectionBadge} ${connected ? styles.connectionOnline : styles.connectionOffline}`}>
            <span />
            {connected ? '已连接' : '连接断开'}
          </div>
          {/* 当前登录用户姓名标签 */}
          {selectedStudent?.name && (
            <div className={styles.studentBadge}>
              <div className={styles.studentBadgeAvatar}>
                {selectedStudent.avatarId && avatarSvgs[selectedStudent.avatarId] ? (
                  <SvgAvatar svg={avatarSvgs[selectedStudent.avatarId]} size={28} fallback={selectedStudent.name[0]} />
                ) : selectedStudent.name[0]}
              </div>
              {selectedStudent.name}
              {selectedStudent.studentId && avatarTokenCount > 0 && (
                <span onClick={() => setShowAvatarChanger(true)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 10, background: '#fffbeb', color: '#d97706', fontSize: "0.688rem", fontWeight: 700 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  {avatarTokenCount}
                </span>
              )}
            </div>
          )}
          {/* 消息按钮 */}
          <div ref={teacherPanelRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowTeacherPanel(p => !p)}
              title={showTeacherPanel ? '收起消息' : '查看消息'}
              className={`${styles.headerButton} ${teacherMsgs.length > 0 ? styles.headerButtonActive : ''}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              消息 {teacherMsgs.length}
            </button>
            {showTeacherPanel && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 50,
                marginTop: 6, width: 360, maxHeight: 300, overflowY: 'auto',
                borderRadius: 10, border: '1px solid #e0e7ff',
                background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
              }}>
                {teacherMsgs.length === 0 ? (
                  <div style={{ padding: '24px 14px', textAlign: 'center', color: '#94a3b8', fontSize: "0.813rem" }}>
                    暂无老师消息
                  </div>
                ) : (
                  teacherMsgs.map((msg, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 10, padding: '10px 14px',
                      borderBottom: i < teacherMsgs.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}>
                      <div style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: 7,
                        background: 'linear-gradient(135deg, #4338ca, #6366f1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff',
                      }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, fontSize: "0.75rem", color: '#4338ca' }}>老师</span>
                          <span style={{ fontSize: "0.688rem", color: '#94a3b8' }}>{msg.time}</span>
                        </div>
                        <div style={{ fontSize: "0.813rem", color: '#1e293b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{msg.message}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          {/* 切换用户按钮 */}
          <button onClick={onSwitchIdentity} disabled={waitingAI} title={waitingAI ? '请等待 AI 回答完成' : '切换用户'}
            className={styles.headerButton}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>
            </svg>
            切换
          </button>
          {/* 退出按钮 */}
          <button onClick={onExit} disabled={waitingAI} title={waitingAI ? '请等待 AI 回答完成' : '退出课堂'}
            className={`${styles.headerButton} ${styles.exitButton}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            退出
          </button>
        </div>
      </div>

      {/* === 消息区域 === */}
      <div ref={chatContainerRef} onScroll={handleChatScroll}
        className={styles.chatScroller}>
        <div data-chat-wrapper className={styles.chatWrapper}>

        {/* 加载错误提示：会话恢复失败 */}
        {loadError && messages.length === 0 && !waitingAI && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: '#fef2f2', color: '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: '#dc2626' }}>{loadError}</div>
            <p style={{ fontSize: "0.875rem", color: '#6b7280', margin: 0 }}>请确认课堂仍在进行中，或联系老师获取最新互动码</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onRetryRestore}
                style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: "0.813rem", cursor: 'pointer' }}>
                重试
              </button>
              <button onClick={onExit}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: "0.813rem", cursor: 'pointer' }}>
                返回首页
              </button>
            </div>
          </div>
        )}

        {/* 空状态：欢迎语 */}
        {messages.length === 0 && !waitingAI && !loadError && (
          <div className={styles.welcomeCard}>
            <span className={styles.welcomeEyebrow}>今天，我们一起探索</span>
            <div className={styles.welcomeAvatar} style={{ opacity: getCurrentAgent()?.enabled === false ? 0.5 : 1 }}>
              {renderAgentAvatar(88, 26, 22)}
            </div>
            <h2>
              {getCurrentAgent()?.name || 'AI 学习助手'}
            </h2>
            {getCurrentAgent()?.enabled === false ? (
              <div style={{ fontSize: "0.938rem", color: '#f59e0b', margin: 0, lineHeight: 1.6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  智能体已被教师停用，暂时无法回复消息
                </span>
              </div>
            ) : (
              <div className={styles.welcomeGreeting}>
                {getCurrentAgent()?.greeting ? (
                  <span>{getCurrentAgent()?.greeting}</span>
                ) : (
                  <>
                    你好呀！我是你的 AI 学习助手 🎉<br />
                    有什么问题尽管问我，也可以上传图片让我帮你评价哦！
                  </>
                )}
              </div>
            )}
            {getCurrentAgent()?.enabled !== false && (
              <div className={styles.starterPrompts} aria-label="快速开始">
                {["请帮我梳理思路", "能给我一些提示吗？", "请用例子解释一下"].map(prompt => (
                  <button key={prompt} type="button" onClick={() => {
                    setInput(prompt);
                    window.setTimeout(() => inputRef.current?.focus(), 0);
                  }}>{prompt}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 黑屏蒙版 */}
        {blacklisted && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24,
            backdropFilter: 'blur(6px)',
          }}>
            <div style={{
              width: 100, height: 100, borderRadius: '50%',
              background: 'rgba(239,68,68,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 40px rgba(239,68,68,0.2)',
            }}>
              <svg width= "52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <div style={{ fontSize: "1.625rem", fontWeight: 700, color: '#ffffff', letterSpacing: 2, textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>你已被教师黑屏</div>
            <div style={{ fontSize: "0.938rem", color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }}>请注意课堂纪律</div>
          </div>
        )}

        {/* 历史消息加载指示 */}
        {loadingMessages && messages.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              border: '3px solid #eef2f6',
              borderTopColor: 'var(--primary)',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: "0.938rem", color: '#64748b', fontWeight: 500 }}>
              正在加载历史消息...
            </div>
          </div>
        )}

          {/* 消息列表 */}
        {(() => {
          const memoAgent = getCurrentAgent();
          const studentAvatarSvg = selectedStudent?.avatarId && avatarSvgs[selectedStudent.avatarId] ? avatarSvgs[selectedStudent.avatarId] : undefined;
          const lastUserMessageIndex = messages.reduce((lastIndex, message, index) => message.role === 'user' ? index : lastIndex, -1);
          return messages.map((msg, i) => (
            <MessageItem key={msg.id || `msg-${i}`} msgIndex={i} msg={msg} studentName={selectedStudent?.name || ''} agent={memoAgent} apiBase={SOCKET_URL} avatarSvg={studentAvatarSvg} onImageClick={openFullscreenImage} onRevise={handleRevise} allowExport={classroom?.allowStudentExport} onFollowUp={handleFollowUp} allowFollowUps={classroom?.allowFollowUps !== false} allowStudentStop={classroom?.allowStudentStop !== false} aiResponding={waitingAI} isRespondingToThis={waitingAI && i === lastUserMessageIndex} />
          ));
        })()}

        {/* 深度思考过程（可折叠） */}
        {thinkingContent && (
          <ThinkingContent content={thinkingContent} agent={getCurrentAgent()} apiBase={SOCKET_URL} />
        )}

        {/* AI 思考中/流式输出 */}
        {waitingAI && (
          <StreamingIndicator streamingContent={streamingContent} agent={getCurrentAgent()} apiBase={SOCKET_URL} />
        )}

        {/* 底部锚点 */}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 回到底部按钮 */}
      {showScrollBtn && messages.length > 0 && (
        <button onClick={scrollToBottom} className={styles.scrollToBottom} aria-label="回到最新消息">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      )}

      {/* 滚动标记条（position: fixed 对齐滚动条位置；已 portal 到 body，见浮层逃生舱） */}
      {overlayPortal(markerBarStyle && markers.length > 0 && (
        <div style={{ position: 'fixed', left: markerBarStyle.left - 6, top: markerBarStyle.top, width: 20, height: markerBarStyle.height, pointerEvents: 'none', zIndex: 20 }}>
          {markers.map(m => {
            const isActive = m.index === activeMsgIndex;
            const isHovered = hoveredMarker?.index === m.index;
            const isHighlighted = isActive || isHovered;
            return (
              <div key={m.index}
                onClick={(e) => { e.stopPropagation(); scrollToMarker(m.index); }}
                onMouseEnter={() => {
                  // 标记左边缘的屏幕 X 坐标（标记容器 left + 20 - 4 - 11）
                  const markerLeftEdge = markerBarStyle.left - 1;
                  // 标记垂直中心：标记条 top + 标记在条内的 top + 2px（标记高 4px 的一半）
                  setHoveredMarker({ index: m.index, text: m.text, x: markerLeftEdge, y: markerBarStyle.top + m.top + 2 });
                }}
                onMouseLeave={() => {
                  if (hoveredMarker?.index === m.index) setHoveredMarker(null);
                }}
                style={{
                  position: 'absolute', right: 4, top: m.top - (isHighlighted ? 0 : 1),
                  width: isHighlighted ? 14 : 7,
                  height: isHighlighted ? 5 : 7,
                  borderRadius: isHighlighted ? 2 : '50%',
                  background: isHovered ? '#cbd5e1' : isActive ? '#6366f1' : '#cbd5e1',
                  cursor: 'pointer', pointerEvents: 'auto',
                  opacity: isHighlighted ? 1 : 0.5,
                  transition: 'opacity 0.15s, background 0.15s, width 0.15s, height 0.15s',
                }}
              />
            );
          })}
        </div>
      ))}
      {/* 自定义 tooltip：鼠标悬停标记时立即显示提问内容（已 portal 到 body） */}
      {overlayPortal(hoveredMarker && (
        <div style={{
          position: 'fixed',
          right: window.innerWidth - hoveredMarker.x + 9,
          top: hoveredMarker.y,
          transform: 'translateY(-50%)',
          maxWidth: 260,
          padding: '5px 10px',
          borderRadius: 6,
          background: '#1e293b',
          color: '#f1f5f9',
          fontSize: '0.75rem',
          lineHeight: 1.4,
          pointerEvents: 'none',
          zIndex: 30,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          {hoveredMarker.text}
        </div>
      ))}

      {/* 教师通知气泡 — 立体气泡样式 */}
      {teacherNotifBubble && (
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 20,
          maxWidth: 800, margin: '0 auto', padding: '0 20px 10px',
          animation: 'notifSlideUp 0.3s ease-out',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', paddingLeft: 4 }}>
            <div style={{
              position: 'relative',
              padding: '10px 14px', borderRadius: '6px 16px 16px 16px',
              background: 'linear-gradient(135deg, #fff7ed, #fffbeb)',
              fontSize: "0.813rem", color: '#451a03', lineHeight: 1.6,
              boxShadow: '0 2px 8px rgba(251,146,60,0.08), 0 8px 24px rgba(251,146,60,0.10)',
              maxWidth: '85%',
            }}>
              {/* 三角尾巴 */}
              <div style={{
                position: 'absolute', top: 0, left: -6,
                width: 12, height: 12,
                background: '#fff7ed',
                clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
                borderRadius: '0 0 0 2px',
              }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 5,
                  background: '#fed7aa', color: '#c2410c', flexShrink: 0,
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                </span>
                <span style={{ fontWeight: 600, fontSize: "0.688rem", color: '#c2410c' }}>老师</span>
              </div>
              <div>{teacherNotifBubble}</div>
            </div>
            <button onClick={() => setTeacherNotifBubble(null)}
              style={{
                flexShrink: 0, marginLeft: 8, alignSelf: 'flex-start', marginTop: 4,
                width: 20, height: 20, border: 'none', borderRadius: '50%',
                background: 'rgba(0,0,0,0.03)', cursor: 'pointer',
                color: '#cbd5e1', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 0, fontSize: "0.75rem", lineHeight: 1,
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; e.currentTarget.style.color = '#cbd5e1'; }}
            >✕</button>
          </div>
        </div>
      )}

      {/* === 输入区域 === */}
      <div className={styles.composerArea}>
        {/* 附件预览 */}
        {attachedFiles.length > 0 && (
          <div className={styles.attachmentStrip}>
            {attachedFiles.map((f, i) => (
              <div key={i} style={{ position: 'relative', flexShrink: 0, width: 64, height: 64, borderRadius: 10, overflow: 'hidden', border: '1px solid #eef2f6', background: '#f9fafb' }}>
                {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(f.url) ? (
                  <img src={`${SOCKET_URL}${f.url}`} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: "0.625rem", color: 'var(--text-secondary)', gap: 2 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', padding: '0 2px' }}>{f.name}</span>
                  </div>
                )}
                <button onClick={() => removeAttachedFile(i)}
                  style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.45)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.625rem", lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* 连接异常提示 - 浮动在输入条上方 */}
        {connectionError && (
          <div style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 'auto', maxWidth: 700, whiteSpace: 'nowrap',
            marginBottom: 8,
            padding: '6px 14px', borderRadius: 8,
            background: '#fef2f2', border: '1px solid #fecaca',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.813rem", color: '#991b1b',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            zIndex: 5,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {connectionError}
            <button onClick={() => setConnectionError(null)}
              style={{ marginLeft: 4, flexShrink: 0, width: 18, height: 18, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991b1b', opacity: 0.6, padding: 0, lineHeight: 1, fontSize: "0.875rem" }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#fecaca'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
            >×</button>
          </div>
        )}

        {/* 暂停提示 - 浮动在输入条上方 */}
        {paused && !connectionError && (
          <div style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 'auto', maxWidth: 700, whiteSpace: 'nowrap',
            marginBottom: 8,
            padding: '6px 14px', borderRadius: 8,
            background: '#fffbeb', border: '1px solid #fde68a',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.813rem", color: '#92400e',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            zIndex: 5,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            课堂已暂停，等待老师继续...
          </div>
        )}

        {/* 智能体停用提示 - 浮动在输入条上方 */}
        {agentDisabled && !paused && !connectionError && (
          <div style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 'auto', maxWidth: 700, whiteSpace: 'nowrap',
            marginBottom: 8,
            padding: '6px 14px', borderRadius: 8,
            background: '#fef2f2', border: '1px solid #fecaca',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.813rem", color: '#991b1b',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            zIndex: 5,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            智能体已被教师停用，暂时无法回复消息
          </div>
        )}

        {/* 屏蔽词警告提示（黑屏后不再显示）- 浮动在输入条上方 */}
        {shieldWarning && !blacklisted && !connectionError && (
          <div style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 'auto', maxWidth: 700, whiteSpace: 'nowrap',
            marginBottom: 8,
            padding: '6px 14px 6px 14px', borderRadius: 8,
            background: '#fef2f2', border: '1px solid #fecaca',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.75rem", color: '#991b1b',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            zIndex: 5,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>{shieldWarning}</span>
            <button onClick={() => setShieldWarning(null)}
              style={{ marginLeft: 4, flexShrink: 0, width: 18, height: 18, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991b1b', opacity: 0.6, padding: 0, lineHeight: 1, fontSize: "0.875rem" }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#fecaca'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
            >×</button>
          </div>
        )}

        {/* 输入工具条 */}
        <div className={styles.composerToolbar}>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileSelect} style={{ display: 'none' }} />

          {!blacklisted && (<>
          {/* 附件按钮 */}
          <button onClick={() => fileInputRef.current?.click()} disabled={waitingAI || uploading || paused || agentDisabled}
            title="上传图片或文件"
            className={styles.attachmentButton}>
            {uploading ? (
              <span style={{ fontSize: "1rem" }}>⏳</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            )}
          </button>

          <button type="button" onClick={toggleVoiceInput}
            disabled={waitingAI || paused || agentDisabled || blacklisted}
            aria-pressed={voiceListening}
            aria-label={voiceListening ? '停止语音输入' : '开始语音输入'}
            title={voiceListening ? '正在听写，点击停止' : voiceInputAvailable ? '语音输入' : '当前浏览器可能不支持语音输入'}
            className={`${styles.voiceButton} ${voiceListening ? styles.voiceButtonListening : ''}`}>
            {voiceListening ? (
              <span className={styles.voiceListeningDot} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="17" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </svg>
            )}
          </button>


          </>)}
          {/* 输入框 + 发送按钮（整合在一行） */}
          <div className={styles.composerBox}>
            <textarea ref={inputRef} value={input} onInput={e => {
              const el = e.target as HTMLTextAreaElement;
              setInput(el.value);
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 160) + 'px';
            }} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (voiceListening) return;
                sendMessage();
              }
            }} placeholder={blacklisted ? '暂时无法输入' : paused ? '课堂已暂停' : agentDisabled ? '智能体已停用' : '输入问题…'} disabled={waitingAI || paused || agentDisabled || blacklisted} autoComplete="off"
              rows={1}
              className={styles.composerTextarea} />
            {waitingAI && classroom?.allowStudentStop !== false ? (
              <button type="button" onClick={handleStopGeneration}
                className={`${styles.composerAction} ${styles.stopAction}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>
              </button>
            ) : (
              <button type="button" onClick={sendMessage} disabled={voiceListening || waitingAI || (!input.trim() && attachedFiles.length === 0) || paused || agentDisabled || blacklisted || !connected}
                className={styles.composerAction}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      {/* 头像更换弹窗（`.modal-overlay` 是 position: fixed / z-index 100，已 portal 到 body） */}
      {overlayPortal(showAvatarChanger && (
        <div className="modal-overlay" onClick={() => setShowAvatarChanger(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="avatar-changer-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <button type="button" aria-label="关闭更换头像窗口" onClick={() => setShowAvatarChanger(false)} style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: "1.25rem", color: '#64748b', lineHeight: 1 }}>×</button>
            <h3 id="avatar-changer-title" style={{ fontSize: "1rem", fontWeight: 600, margin: '0 0 4px' }}>🎨 更换头像</h3>
            <p style={{ fontSize: "0.75rem", color: '#64748b', margin: '0 0 4px' }}>
              剩余 <strong style={{ color: '#d97706' }}>{avatarTokenCount}</strong> 次更换机会，由教师奖励获得
            </p>
            <p style={{ fontSize: "0.688rem", color: '#94a3b8', margin: '0 0 16px' }}>
              可从教师头像库中选择，也可粘贴自定义 SVG 代码
            </p>
            <AvatarChangerContent
              studentId={selectedStudent?.id ?? ''}
              avatars={allStudentAvatars}
              onChanged={async (result) => {
                // 接口返回的是服务端最终保存（并已清理）的头像，先立即更新当前会话。
                setAvatarSvgs((current) => ({
                  ...current,
                  [result.avatarId]: fixSvgUrl(result.svgContent),
                }));
                setSelectedStudent((current) => current ? { ...current, avatarId: result.avatarId } : current);
                setShowAvatarChanger(false);
                fetchStudentTokens();
                try {
                  const [allAv, teacherAv] = await Promise.all([
                    api.getAvatarsAll('student'),
                    api.getAvatars('student'),
                  ]);
                  const m: Record<number, string> = {};
                  allAv.forEach((avatar) => { m[avatar.id] = fixSvgUrl(avatar.svgContent); });
                  setAvatarSvgs(m);
                  setAllStudentAvatars(teacherAv);
                  // 重新加载 classroom students 更新 selectedStudent
                  if (classroom?.id && selectedStudent?.id) {
                    const sts = await api.getClassroomStudents(classroom.id);
                    const updated = sts.find((student) => student.id === selectedStudent.id);
                    if (updated) setSelectedStudent(updated);
                  }
                } catch {}
              }}
              setToast={setToast}
            />
          </div>
        </div>
      ))}
      {/* Toast 自身是 position: fixed / z-index 99999，同样要逃出动画容器 */}
      {overlayPortal(toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />)}

      {/* 全屏图片预览（支持无极缩放；已 portal 到 body） */}
      {overlayPortal(fullscreenImg && (
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
      ))}
      </div>
    </div>
  );
}
