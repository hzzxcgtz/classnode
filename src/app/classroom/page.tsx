'use client';

import { useState, useEffect, useRef, Suspense, memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { renderMarkdown, stripImages } from '@/lib/markdown';
import { getApiBaseUrl } from '@/lib/api-base';
import { Toast } from '@/lib/components';

const API_BASE_URL = getApiBaseUrl();
function fixSvgUrl(svg: string) { return svg ? svg.replace(/href="\/uploads\//g, `href="${API_BASE_URL}/uploads/`) : svg; }

// ===== 组件优化：抽离为 memo 子组件，避免父级 state 变化时重渲染全部消息 =====

const AgentAvatar = memo(function AgentAvatar({
  size, borderRadius = 8, fontSize = 13, agent, apiBase,
}: {
  size: number; borderRadius?: number; fontSize?: number;
  agent: any; apiBase: string;
}) {
  const logoUrl = agent?.logo
    ? (agent.logo.startsWith('/') ? `${apiBase}${agent.logo}` : agent.logo)
    : null;
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
      {agent?.name?.[0] || 'AI'}
    </div>
  );
});

const MessageItem = memo(function MessageItem({
  msg, studentName, agent, apiBase, avatarSvg, onImageClick,
}: {
  msg: any; studentName: string; agent: any; apiBase: string; avatarSvg?: string; onImageClick?: (url: string) => void;
}) {
  const fileSources = msg.fileUrls || (msg.fileUrl ? [msg.fileUrl] : []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
      {msg.role === 'assistant' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
          <div style={{ width: 42, height: 42, borderRadius: 8, flexShrink: 0, overflow: 'hidden' }}>
            <AgentAvatar size={42} borderRadius={8} fontSize={18} agent={agent} apiBase={apiBase} />
          </div>
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: 'var(--primary)' }}>{agent?.name || 'AI助手'}</span>
        </div>
      )}
      {msg.role === 'user' && studentName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 4 }}>
          {avatarSvg ? (
            <div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: fixSvgUrl(avatarSvg).replace('<svg', '<svg width="42" height="42"') }} />
          ) : (
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.875rem", fontWeight: 700, flexShrink: 0 }}>
              {studentName[0]}
            </div>
          )}
          <span style={{ fontSize: "0.938rem", fontWeight: 600, color: '#94a3b8' }}>{studentName}</span>
        </div>
      )}
      <div style={{
        maxWidth: '78%',
        minWidth: 320,
        padding: msg.role === 'system' ? '10px 16px' : '14px 18px',
        borderRadius: msg.role === 'user' ? '18px 18px 6px 18px' : '6px 18px 18px 18px',
        background: msg.role === 'user' ? 'linear-gradient(135deg, #667eea, #764ba2)' : 'white',
        color: msg.role === 'user' ? 'white' : '#1a1a2e',
        border: msg.role === 'assistant' ? '1px solid #eef2f6' : 'none',
        boxShadow: msg.role === 'assistant' ? '0 2px 8px rgba(0,0,0,0.04)' : '0 4px 12px rgba(102,126,234,0.2)',
        lineHeight: 1.7,
        fontSize: "1rem",
        wordBreak: 'break-word',
        position: 'relative',
      }}>
        {fileSources.map((fu: string, fi: number) => (
          <div key={fi} style={{ marginBottom: 8 }}>
            {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
              <img src={`${apiBase}${fu}`} alt={(msg.fileNames?.[fi]) || msg.fileName || ''}
                onClick={() => onImageClick?.(`${apiBase}${fu}`)}
                style={{ maxWidth: 220, maxHeight: 160, borderRadius: 10, objectFit: 'cover', display: 'block', cursor: 'pointer', transition: 'opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }} />
            ) : (
              <div style={{ padding: '8px 12px', background: msg.role === 'user' ? 'rgba(255,255,255,0.15)' : '#f3f4f6', borderRadius: 8, fontSize: "0.813rem", display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                {(msg.fileNames?.[fi]) || msg.fileName || '文件'}
              </div>
            )}
          </div>
        ))}
        {msg.role === 'system' ? (
          <span>{msg.content}</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.fileUrls?.length ? stripImages(msg.content) : msg.content) }} />
        )}
      </div>
    </div>
  );
});

const StreamingIndicator = memo(function StreamingIndicator({
  streamingContent, agent, apiBase,
}: {
  streamingContent: string; agent: any; apiBase: string;
}) {
  const displayHtml = useMemo(() => {
    if (!streamingContent) return '';
    return renderMarkdown(stripImages(streamingContent));
  }, [streamingContent]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
        <div style={{ width: 42, height: 42, borderRadius: 8, flexShrink: 0, overflow: 'hidden' }}>
          <AgentAvatar size={42} borderRadius={8} fontSize={18} agent={agent} apiBase={apiBase} />
        </div>
        <span style={{ fontSize: "0.875rem", fontWeight: 600, color: 'var(--primary)' }}>{agent?.name || 'AI助手'}</span>
      </div>
      <div style={{
        maxWidth: '78%', padding: '14px 18px',
        borderRadius: '6px 18px 18px 18px',
        background: 'white', color: '#1a1a2e',
        border: '1px solid #eef2f6',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        lineHeight: 1.7, fontSize: "0.938rem", wordBreak: 'break-word',
      }}>
        {streamingContent ? (
          <span dangerouslySetInnerHTML={{ __html: displayHtml + '<span style="display:inline-block;width:2px;height:1em;background:var(--primary);margin-left:2px;animation:blink 0.8s infinite;vertical-align:text-bottom"></span>' }} />
        ) : (
          <div style={{ display: 'flex', gap: 5, padding: '4px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db', animation: 'typing 1.4s infinite' }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db', animation: 'typing 1.4s 0.2s infinite' }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db', animation: 'typing 1.4s 0.4s infinite' }} />
          </div>
        )}
      </div>
    </div>
  );
});

function StudentChatContent() {
  const router = useRouter();
  const [code, setCode] = useState('');

  // 首次渲染时一次性读取 URL 并处理全部逻辑，消除时序竞争
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get('code') || '';
    if (!codeFromUrl) { router.push('/'); return; }
    setCode(codeFromUrl);
    const saved = localStorage.getItem(`chat_session_${codeFromUrl}`);
    let sessionData: { studentId: string; studentName: string } | null = null;
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (Date.now() - session.timestamp < 7200000) {
          sessionData = { studentId: session.studentId, studentName: session.studentName };
          setSelectedStudent({ id: session.studentId, name: session.studentName });
        }
      } catch {}
    }
    loadClassroom(codeFromUrl).then(async (cr) => {
      if (!cr) return;
      if (sessionData) {
        // 有有效会话，直接进入对话页恢复聊天（identity-conflict 事件兜底处理设备冲突）
        setStep('chat');
        // 从数据库加载教师通知（持久化后可导出，且刷新不丢失）
        if (cr.id) {
          try {
            const notifs = await api.getTeacherNotifications(cr.id, sessionData.studentId);
            const seen = seenNotifIdsRef.current;
            const msgs: { message: string; time: string }[] = [];
            for (const n of notifs) {
              seen.add(n.id);
              const d = new Date(n.createdAt);
              const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
              msgs.push({ message: n.content, time });
            }
            setTeacherMsgs(msgs);
            // 持久化已见的通知 ID 以防 socket 重放重复
            try { localStorage.setItem('_seen_notif_ids', JSON.stringify([...seen])); } catch {}
          } catch {}
        }
        if (cr.id) await loadMessages(cr.id, sessionData.studentId);
        startChatSession(sessionData.studentId, sessionData.studentName, codeFromUrl);
        // 恢复头像数据 + token
        try {
          const [avData, avTeacherData, stsData, tokenData] = await Promise.all([
            api.getAvatarsAll('student'),
            api.getAvatars('student'),
            cr.id ? api.getClassroomStudents(cr.id) : Promise.resolve([]),
            api.getStudentTokens(sessionData.studentId),
          ]);
          const m: Record<number, string> = {};
          avData.forEach((a: any) => { m[a.id] = fixSvgUrl(a.svgContent); });
          setAvatarSvgs(m);
          setAllStudentAvatars(avTeacherData);
          setAvatarTokenCount(tokenData.tokens || 0);
          const cur = (stsData as any[]).find((s: any) => s.id === sessionData!.studentId);
          if (cur) setSelectedStudent(cur);
        } catch {}
      } else {
        setStep('identity');
      }
    });
  }, []);

  const [step, setStep] = useState<'loading' | 'identity' | 'chat'>('loading');
  const [classroom, setClassroom] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [avatarSvgs, setAvatarSvgs] = useState<Record<number, string>>({});
  const [avatarTokenCount, setAvatarTokenCount] = useState(0);
  const [showAvatarChanger, setShowAvatarChanger] = useState(false);
  const [allStudentAvatars, setAllStudentAvatars] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [waitingAI, setWaitingAI] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [connected, setConnected] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ url: string; name: string }[]>([]);
  const [paused, setPaused] = useState(false);
  const [agentDisabled, setAgentDisabled] = useState(false);
  const [shieldWarning, setShieldWarning] = useState<string | null>(null);
  const [blacklisted, setBlacklisted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [teacherMsgs, setTeacherMsgs] = useState<{ message: string; time: string }[]>([]);
  const [showTeacherPanel, setShowTeacherPanel] = useState(false);
  const [teacherNotifBubble, setTeacherNotifBubble] = useState<string | null>(null);
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, offX: 0, offY: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const wsRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [onlineStudentIds, setOnlineStudentIds] = useState<Set<string>>(new Set());
  const statusSocketRef = useRef<any>(null);
  // 跟踪最后一次用户消息中附带的文件，用于 AI 回复时一同展示
  const lastUserFileRef = useRef<{ urls: string[]; names: string[] }>({ urls: [], names: [] });
  // 流式输出 RAF 节流：累积 chunk 后每帧只更新一次 state，避免高频 setState 阻塞
  const streamingBufferRef = useRef('');
  const streamingRafRef = useRef<number | null>(null);
  // 去重教师消息：通过唯一 ID 跟踪已收到的通知，跨刷新持久化
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  // 点击外部关闭教师消息面板
  const teacherPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showTeacherPanel) return;
    const handler = (e: MouseEvent) => {
      if (teacherPanelRef.current && !teacherPanelRef.current.contains(e.target as Node)) {
        setShowTeacherPanel(false);
      }
    };
    // 延迟挂载以避免触发按钮自身的 click 事件
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [showTeacherPanel]);
  // 初始化时从 localStorage 恢复已见 ID
  useEffect(() => {
    try {
      const saved = localStorage.getItem('_seen_notif_ids');
      if (saved) seenNotifIdsRef.current = new Set(JSON.parse(saved));
    } catch {}
  }, []);

  // 手机端检测（< 640px）
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 全屏预览图片：ESC 关闭 + 滚轮缩放 + 鼠标拖拽
  useEffect(() => {
    if (!fullscreenImg) return;
    setZoomLevel(1);
    setImgOffset({ x: 0, y: 0 });
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

  const SOCKET_URL = API_BASE_URL;
  const apiBase = SOCKET_URL;

  /** 获取当前学生/小组绑定的智能体 */
  const getCurrentAgent = () => {
    if ((classroom?.mode === 'group' || classroom?.mode === 'advanced') && selectedStudent?.groupId && classroom?.groups) {
      const group = classroom.groups.find((g: any) => g.id === selectedStudent.groupId);
      if (group?.agent) return group.agent;
    }
    return classroom?.agents?.[0] || null;
  };

  const renderAgentAvatar = (size: number, borderRadius = 8, fontSize = 13, agent?: any) => {
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

  // 新消息到达、AI 流式输出、或首次进入对话页时自动滚动到底部
  // 用 useEffect 代替 useLayoutEffect，避免 scrollTop 强制同步布局阻塞主线程
  // iOS 键盘弹出时避免因滚动导致键盘收起：若输入框有焦点则不滚动
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = chatContainerRef.current;
    if (!el) return;
    // iOS 上如果输入框有焦点，不自动滚动以免布局变化导致键盘收起
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && document.activeElement === inputRef.current) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, streamingContent, step, waitingAI]);

  // AI 回答完成后自动聚焦输入框
  // iOS Safari 需要特殊处理：程序化 focus() 不会弹出虚拟键盘，
  // 临时设置 readOnly→focus→移除 readOnly 能强制触发键盘
  useEffect(() => {
    if (!waitingAI && step === 'chat') {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
          el.readOnly = true;
          el.focus();
          setTimeout(() => { el.readOnly = false; }, 150);
        } else {
          el.focus();
        }
      });
    }
  }, [waitingAI, step]);

  const scrollToBottom = () => {
    const el = chatContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    userScrolledUpRef.current = false;
    setShowScrollBtn(false);
  };

  const loadClassroom = async (classroomCode?: string, sessionStudentId?: string) => {
    try {
      setLoadError(null);
      const cr = await api.getClassroomByCode(classroomCode || code);
      setClassroom(cr);
      if (cr.status === 'paused') setPaused(true);
      // 如果是从缓存恢复会话，检查该学生/小组绑定的智能体是否停用
      if (sessionStudentId && (cr.mode === 'group' || cr.mode === 'advanced') && cr.groups) {
        // 需要先获取学生的 groupId
        try {
          const sts = await api.getClassroomStudents(cr.id);
          const myStudent = sts.find((s: any) => s.id === sessionStudentId);
          if (myStudent?.groupId) {
            const g = cr.groups.find((gr: any) => gr.id === myStudent.groupId);
            if (g?.agent?.enabled === false) setAgentDisabled(true);
          }
        } catch {}
      } else {
        if (cr.agents?.[0]?.enabled === false) setAgentDisabled(true);
      }
      return cr;
    } catch (e: any) {
      setLoadError(e.message || '课堂不存在或已结束');
    }
  };

  // 同步错误检测：loadClassroom 失败后从 'loading' 切换到 'identity' 以显示错误
  useEffect(() => {
    if (step === 'loading' && loadError) {
      setStep('identity');
    }
  }, [loadError]);

  const loadMessages = async (classroomId: string, studentId: string) => {
    try {
      const msgs = await api.getStudentMessages(classroomId, studentId);
      if (msgs && msgs.length > 0) {
        setMessages(msgs.map((m: any) => ({
          role: m.role,
          content: m.content,
          roundIndex: m.roundIndex,
          fileUrls: m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : undefined,
          fileNames: m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : undefined,
        })));
      }
    } catch {}
  };

  // 轮询后备：每 15 秒从 API 同步智能体启用/停用状态和课堂暂停状态（socket 事件的兜底）
  useEffect(() => {
    if (step !== 'chat' || !code) return;
    const poll = async () => {
      try {
        const cr = await api.getClassroomByCode(code);
        if (cr.status === 'ended') {
          localStorage.removeItem(`chat_session_${code}`);
          setToast({ msg: '课堂已结束', type: 'info' });
          router.push('/');
          return;
        }
        // 分组/高级模式下检查当前小组绑定的智能体，否则使用第一个
        if ((cr.mode === 'group' || cr.mode === 'advanced') && selectedStudent?.groupId && cr.groups) {
          const g = cr.groups.find((gr: any) => gr.id === selectedStudent.groupId);
          setAgentDisabled(g?.agent?.enabled === false);
        } else {
          setAgentDisabled(cr.agents?.[0]?.enabled === false);
        }
        setPaused(cr.status === 'paused');
      } catch (e: any) {
        // 课堂已结束（API 返回 404 或 400）
        const msg = e.message || '';
        if (msg.includes('课堂已结束') || msg.includes('互动码无效')) {
          localStorage.removeItem(`chat_session_${code}`);
          setToast({ msg: '课堂已结束', type: 'info' });
          router.push('/');
        }
      }
    };
    poll(); // 立即执行一次
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [step, code]);

  // 如果选中的学生被登录了，取消选中
  useEffect(() => {
    if (selectedStudent && onlineStudentIds.has(selectedStudent.id)) {
      setSelectedStudent(null);
    }
  }, [onlineStudentIds, selectedStudent]);

  useEffect(() => {
    if (step === 'identity' && classroom?.id) {
      api.getClassroomStudents(classroom.id).then(data => {
        setStudents(data);
        // 加载头像 SVG 映射
        api.getAvatarsAll('student').then(avatars => {
          const m: Record<number, string> = {};
          avatars.forEach((a: any) => { m[a.id] = fixSvgUrl(a.svgContent); });
          setAvatarSvgs(m);
        }).catch(() => {});
      }).catch(() => {});
      // 连接状态监听 socket，获取已登录学生列表
      (async () => {
        const { io } = await import('socket.io-client');
        if (statusSocketRef.current) statusSocketRef.current.disconnect();
        const sk = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
        sk.on('connect', () => sk.emit('listen-classroom-status', classroom.id));
        sk.on('online-students', (data: any) => setOnlineStudentIds(new Set(data.studentIds)));
        statusSocketRef.current = sk;
      })();
    }
    // 离开身份选择页时断开状态监听
    return () => {
      if (statusSocketRef.current) {
        statusSocketRef.current.disconnect();
        statusSocketRef.current = null;
      }
    };
  }, [step, classroom?.id]);

  // 提取为独立函数，支持刷新恢复
  const startChatSession = async (studentId: string, studentName: string, classroomCode?: string) => {
    const joinCode = classroomCode || code;
    try {
      const { io } = await import('socket.io-client');
      const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
      socket.on('connect', () => {
        socket.emit('join-classroom', { classroomCode: joinCode, studentId });
        setConnected(true);
      });

      const flushStreaming = () => {
        if (streamingRafRef.current) { cancelAnimationFrame(streamingRafRef.current); streamingRafRef.current = null; }
        streamingBufferRef.current = '';
      };

      socket.on('ai-response', (data: any) => {
        flushStreaming();
        const attached = lastUserFileRef.current;
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.content,
          roundIndex: data.roundIndex,
          // 携带用户上次上传的文件，确保图片在 AI 回答框中也能显示
          fileUrls: attached.urls.length > 0 ? [...attached.urls] : undefined,
          fileNames: attached.names.length > 0 ? [...attached.names] : undefined,
        }]);
        lastUserFileRef.current = { urls: [], names: [] };
        setStreamingContent('');
        setWaitingAI(false);
      });

      socket.on('ai-thinking', () => {
        flushStreaming();
        setWaitingAI(true);
        setStreamingContent('');
      });

      socket.on('ai-chunk', (data: any) => {
        streamingBufferRef.current += data.content;
        if (!streamingRafRef.current) {
          streamingRafRef.current = requestAnimationFrame(() => {
            streamingRafRef.current = null;
            setStreamingContent(streamingBufferRef.current);
          });
        }
      });

      socket.on('ai-error', (data: any) => {
        setWaitingAI(false);
        setConnectionError(data.error || 'AI 回复遇到了问题，请稍后重试');
      });

      socket.on('agent-disabled', () => {
        setWaitingAI(false);
        setAgentDisabled(true);
      });

      socket.on('agent-enabled', () => {
        setAgentDisabled(false);
      });

      socket.on('classroom-ended', () => {
        localStorage.removeItem(`chat_session_${code}`);
        setToast({ msg: '课堂已结束', type: 'info' });
        router.push('/');
      });

      socket.on('classroom-paused', () => {
        if (streamingRafRef.current) { cancelAnimationFrame(streamingRafRef.current); streamingRafRef.current = null; }
        streamingBufferRef.current = '';
        setPaused(true);
        setWaitingAI(false);
        setStreamingContent('');
      });

      socket.on('classroom-resumed', () => {
        setPaused(false);
      });

      socket.on('identity-conflict', (data: any) => {
        setMessages(prev => [...prev, { role: 'system', content: '⚠️ ' + data.error }]);
        setWaitingAI(false);
        setConnected(false);
        // 断开后清除会话，回到身份选择页
        localStorage.removeItem(`chat_session_${code}`);
        setTimeout(() => {
          if (wsRef.current) wsRef.current.disconnect();
          wsRef.current = null;
          setStep('identity');
          setSelectedStudent(null);
          setMessages([]);
        }, 2000);
      });

      socket.on('disconnect', () => setConnected(false));
      socket.on('connect_error', () => setConnected(false));

      socket.on('error', (err: string) => {
        setWaitingAI(false);
        setMessages(prev => [...prev, { role: 'system', content: '⚠️ ' + err }]);
      });

      socket.on('messages-cleared', (data: any) => {
        if (data.studentId === studentId) {
          setMessages([]);
          setStreamingContent('');
          setWaitingAI(false);
        }
      });

      socket.on('avatar-rewarded', (data: any) => {
        if (data?.tokens) {
          setAvatarTokenCount(data.tokens);
          setToast({ msg: '🎉 老师奖励了你一次更换头像的机会！点击姓名旁的⭐即可更换', type: 'success' });
        }
      });

      socket.on('teacher-notification', (data: any) => {
        // 通过唯一 ID 去重（Db 持久化后，防止缓存重放 / socket 重连产生的重复）
        if (data.id && seenNotifIdsRef.current.has(data.id)) return;
        if (data.id) seenNotifIdsRef.current.add(data.id);
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        setTeacherMsgs(prev => [...prev, { message: data.message, time: timeStr }]);
        setTeacherNotifBubble(data.message);
        setTimeout(() => setTeacherNotifBubble(null), 15000);
      });

      socket.on('shield-warned', (data: any) => {
        const name = data.studentName || '学生';
        setShieldWarning(`${name}同学你好，课堂交流请使用文明用语哦！请修改你的提问。`);
        // 将对话区域中上一条学生消息替换为过滤后的内容
        setMessages(prev => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'user') {
              next[i] = { ...next[i], content: data.filteredContent || next[i].content };
              break;
            }
          }
          return next;
        });
      });

      socket.on('student-blacklisted', (data: any) => {
        if (data.studentId && data.studentId !== studentId) return;
        setBlacklisted(true);
        setWaitingAI(false);
        setStreamingContent('');
        setShieldWarning(null);
      });

      socket.on('student-unblacklisted', (data: any) => {
        if (data.studentId && data.studentId !== studentId) return;
        setBlacklisted(false);
        setShieldWarning(null);
        // 移除自动黑屏消息
        setMessages(prev => prev.filter(m => !(m.role === 'system' && typeof m.content === 'string' && m.content.includes('自动黑屏'))));
      });

      wsRef.current = socket;
    } catch {
      setConnected(false);
    }
  };

  const handleSwitchIdentity = () => {
    if (waitingAI) return;
    // 断开当前连接
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    localStorage.removeItem(`chat_session_${code}`);
    setMessages([]);
    setSelectedStudent(null);
    setShieldWarning(null);
    setStep('identity');
  };

  const handleExit = () => {
    if (waitingAI) return;
    if (wsRef.current) { wsRef.current.disconnect(); wsRef.current = null; }
    if (statusSocketRef.current) { statusSocketRef.current.disconnect(); statusSocketRef.current = null; }
    localStorage.removeItem(`chat_session_${code}`);
    router.push('/');
  };


  const fetchStudentTokens = async () => {
    if (!selectedStudent?.id) return;
    try {
      const result = await api.getStudentTokens(selectedStudent.id);
      setAvatarTokenCount(result.tokens || 0);
    } catch {}
  };

  const handleIdentityConfirm = async () => {
    if (!selectedStudent) return;
    setStep('chat');
    // 保存会话到 localStorage
    localStorage.setItem(`chat_session_${code}`, JSON.stringify({
      studentId: selectedStudent.id,
      studentName: selectedStudent.name,
      timestamp: Date.now(),
    }));
    // 加载头像库（仅显示教师创建的供选择）+ 头像 SVG 映射（含学生自己的）
    api.getAvatars('student').then(data => { setAllStudentAvatars(data); }).catch(() => {});
    api.getAvatarsAll('student').then(data => { const m: Record<number, string> = {}; data.forEach((a: any) => { m[a.id] = fixSvgUrl(a.svgContent); }); setAvatarSvgs(m); }).catch(() => {});
    fetchStudentTokens();
    // 加载该学生的历史对话
    if (classroom?.id) {
      await loadMessages(classroom.id, selectedStudent.id);
    }
    await startChatSession(selectedStudent.id, selectedStudent.name);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const newFiles: { url: string; name: string }[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${SOCKET_URL}/api/upload`, { method: 'POST', body: form });
        const data = await res.json();
        if (data.success) {
          newFiles.push({ url: data.url, name: file.name });
        }
      }
      setAttachedFiles(prev => [...prev, ...newFiles]);
    } catch {}
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const sendMessage = () => {
    const text = (inputRef.current?.value || '').trim();
    const files = attachedFiles;
    setConnectionError(null);
    if (!text && files.length === 0) return;
    if (waitingAI || paused || agentDisabled || blacklisted || !wsRef.current) return;
    setInput('');
    if (inputRef.current) inputRef.current.value = '';
    setShieldWarning(null);
    setAttachedFiles([]);
    const userMsgContent = text || '(附件)';
    // 记录本次用户消息的文件，供 AI 回复时一同展示
    lastUserFileRef.current = { urls: files.map(f => f.url), names: files.map(f => f.name) };
    setMessages(prev => [...prev, {
      role: 'user', content: userMsgContent,
      fileUrls: files.map(f => f.url), fileNames: files.map(f => f.name),
    }]);
    // 发送后立即滚动到底部，确保新消息可见
    userScrolledUpRef.current = false;
    const el = chatContainerRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    wsRef.current.emit('send-message', {
      classroomCode: code,
      studentId: selectedStudent.id,
      content: userMsgContent,
      fileUrls: files.map(f => f.url),
      fileNames: files.map(f => f.name),
    });
  };

  if (step === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: "1rem", marginBottom: 8 }}>正在连接课堂...</div>
          <div style={{ fontSize: "0.813rem", opacity: 0.7 }}>互动码: {code}</div>
        </div>
      </div>
    );
  }

  if (step === 'identity') {
    const isGroupMode = classroom?.mode === 'group' || classroom?.mode === 'advanced';
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 24, position: 'relative' }}>
        <button onClick={handleExit}
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
        <div style={{ background: 'white', borderRadius: 20, padding: 40, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            {classroom?.title && (
              <div style={{ fontSize: "1.375rem", fontWeight: 700, color: '#0f172a', marginBottom: 6, lineHeight: 1.3 }}>{classroom.title}</div>
            )}
            <div style={{ fontSize: "0.938rem", fontWeight: 500, color: isGroupMode ? '#7c3aed' : 'var(--primary)' }}>
              {isGroupMode ? '请选择你的小组' : '请选择你的姓名'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflow: 'auto' }}>
            {[...students].sort((a, b) => {
              if (isGroupMode) return a.name.localeCompare(b.name, 'zh-CN');
              return (parseInt(a.studentNo) || 0) - (parseInt(b.studentNo) || 0);
            }).map((s: any) => {
              const isOnline = onlineStudentIds.has(s.id);
              const isSelected = selectedStudent?.id === s.id;
              return (
                <button key={s.id} onClick={() => !isOnline && setSelectedStudent(s)} disabled={isOnline}
                  style={{ padding: '14px 18px', borderRadius: 12, border: '2px solid', borderColor: isSelected ? 'var(--primary)' : '#eef2f6', background: isOnline ? '#f9fafb' : isSelected ? '#eef2ff' : 'white', cursor: isOnline ? 'not-allowed' : 'pointer', fontSize: "0.938rem", textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, transition: 'all .15s', opacity: isOnline ? 0.5 : 1, width: '100%' }}>
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
                          <div style={{ width: 42, height: 42 }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(avatarSvgs[s.avatarId]).replace('<svg', '<svg width="42" height="42"') }} />
                        ) : s.name[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        {s.studentNo && <div style={{ fontSize: "0.75rem", fontWeight: 500, color: '#9ca3af', lineHeight: 1.3 }}>{s.studentNo}</div>}
                        <div style={{ fontSize: "1rem", fontWeight: 600, color: isOnline ? '#9ca3af' : '#1a1a2e', lineHeight: 1.4 }}>{s.name}</div>
                      </div>
                    </>
                  )}
                  {isOnline && <span style={{ fontSize: "0.688rem", color: '#9ca3af', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>已登录</span>}
                </button>
              );
            })}
          </div>
          <button onClick={handleIdentityConfirm} disabled={!selectedStudent}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 20, fontSize: "1rem", opacity: selectedStudent ? 1 : 0.5 }}>
            {isGroupMode ? '确认并进入小组对话' : '确认并进入对话'}
          </button>
          {loadError && (
            <div style={{
              width: '100%', marginTop: 12, padding: '10px 14px',
              background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10,
              fontSize: "0.813rem", color: '#dc2626', textAlign: 'center',
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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', background: 'linear-gradient(180deg, #f0f4ff 0%, #f8fafc 100%)' }}>
      {/* === 顶部栏 === */}
      <div style={{ padding: isMobile ? '8px 12px' : '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 4 : 0, background: 'white', borderBottom: '1px solid #eef2f6', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {renderAgentAvatar(42, 12, 20)}
          <div>
            <div style={{ fontSize: "1.063rem", fontWeight: 600, color: '#1a1a2e', lineHeight: 1.3 }}>
              {(() => {
                if ((classroom?.mode === 'group' || classroom?.mode === 'advanced') && selectedStudent?.groupId && classroom?.groups) {
                  const group = classroom.groups.find((g: any) => g.id === selectedStudent.groupId);
                  if (group?.agent?.name) return group.agent.name;
                }
                return classroom?.agents?.[0]?.name || 'AI 学习助手';
              })()}
            </div>
            <div style={{ fontSize: "0.75rem", color: 'var(--text-secondary)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
              {classroom?.title || ''}
              <span style={{ fontSize: "0.625rem", color: '#6366f1', fontWeight: 600, background: '#eef2ff', padding: '1px 5px', borderRadius: 4, letterSpacing: 0.5 }}>#{code}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 5 : 10, flexWrap: isMobile ? 'wrap' : 'nowrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: "0.75rem", color: connected ? '#10b981' : '#ef4444' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#10b981' : '#ef4444', display: 'inline-block' }} />
            {connected ? '已连接' : '连接断开'}
          </div>
          {/* 当前登录用户姓名标签 */}
          {selectedStudent?.name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', background: '#eef2ff', borderRadius: 20, fontSize: "0.813rem", color: 'var(--primary)', fontWeight: 600, border: '1px solid #c7d2fe' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: "0.688rem" }}>
                {selectedStudent.avatarId && avatarSvgs[selectedStudent.avatarId] ? (
                  <div style={{ width: 22, height: 22 }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(avatarSvgs[selectedStudent.avatarId]).replace('<svg', '<svg width="22" height="22"') }} />
                ) : selectedStudent.name[0]}
              </div>
              {selectedStudent.name}
              {avatarTokenCount > 0 && (
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
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                border: '1px solid #e0e7ff', borderRadius: 8,
                background: 'white', cursor: 'pointer',
                color: teacherMsgs.length > 0 ? '#4338ca' : '#94a3b8',
                fontSize: "0.813rem", fontWeight: 500,
                fontFamily: 'inherit', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
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
          <button onClick={handleSwitchIdentity} disabled={waitingAI} title={waitingAI ? '请等待 AI 回答完成' : '切换用户'}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: waitingAI ? '#f9fafb' : 'white', cursor: waitingAI ? 'not-allowed' : 'pointer', color: waitingAI ? '#d1d5db' : '#6b7280', fontSize: "0.813rem", fontWeight: 500, transition: 'all .15s' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>
            </svg>
            切换
          </button>
          {/* 退出按钮 */}
          <button onClick={handleExit} disabled={waitingAI} title={waitingAI ? '请等待 AI 回答完成' : '退出课堂'}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: waitingAI ? '#f9fafb' : 'white', cursor: waitingAI ? 'not-allowed' : 'pointer', color: waitingAI ? '#d1d5db' : '#6b7280', fontSize: "0.813rem", fontWeight: 500, transition: 'all .15s' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            退出
          </button>
        </div>
      </div>

      {/* === 消息区域 === */}
      <div ref={chatContainerRef} onScroll={handleChatScroll}
        style={{ flex: 1, overflow: 'auto', padding: '20px 24px 20px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800, width: '100%', margin: '0 auto' }}>

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
              <button onClick={() => {
                const tryRestore = async () => {
                  const codeFromUrl = new URLSearchParams(window.location.search).get('code') || '';
                  setLoadError(null);
                  const cr = await loadClassroom(codeFromUrl);
                  if (cr) {
                    try {
                      const saved = localStorage.getItem(`chat_session_${codeFromUrl}`);
                      if (saved) {
                        const session = JSON.parse(saved);
                        loadMessages(cr.id, session.studentId);
                        startChatSession(session.studentId, session.studentName, codeFromUrl);
                        api.getAvatarsAll('student').then(data => {
                          const m: Record<number, string> = {};
                          data.forEach((a: any) => { m[a.id] = fixSvgUrl(a.svgContent); });
                          setAvatarSvgs(m);
                        }).catch(() => {});
                      } else {
                        setStep('identity');
                      }
                    } catch {
                      setStep('identity');
                    }
                  }
                };
                tryRestore();
              }}
                style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: "0.813rem", cursor: 'pointer' }}>
                重试
              </button>
              <button onClick={handleExit}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: "0.813rem", cursor: 'pointer' }}>
                返回首页
              </button>
            </div>
          </div>
        )}

        {/* 空状态：欢迎语 */}
        {messages.length === 0 && !waitingAI && !loadError && (
          <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ marginBottom: 20, boxShadow: '0 8px 24px rgba(102,126,234,0.25)', borderRadius: 24, width: 80, height: 80, overflow: 'hidden', opacity: getCurrentAgent()?.enabled === false ? 0.5 : 1 }}>
              {renderAgentAvatar(80, 24, 20)}
            </div>
            <h2 style={{ fontSize: "1.375rem", fontWeight: 700, color: '#1a1a2e', margin: '0 0 8px' }}>
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
              <div style={{ fontSize: "0.938rem", color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
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

          {/* 消息列表 */}
        {(() => {
          const memoAgent = getCurrentAgent();
          const studentAvatarSvg = selectedStudent?.avatarId && avatarSvgs[selectedStudent.avatarId] ? avatarSvgs[selectedStudent.avatarId] : undefined;
          return messages.map((msg, i) => (
            <MessageItem key={msg.roundIndex ? `${msg.role}-${msg.roundIndex}` : `msg-${i}`} msg={msg} studentName={selectedStudent?.name || ''} agent={memoAgent} apiBase={SOCKET_URL} avatarSvg={studentAvatarSvg} onImageClick={setFullscreenImg} />
          ));
        })()}

        {/* AI 思考中/流式输出 */}
        {waitingAI && (
          <StreamingIndicator streamingContent={streamingContent} agent={getCurrentAgent()} apiBase={SOCKET_URL} />
        )}

        {/* 底部锚点 */}
        <div ref={messagesEndRef} />
      </div>

      {/* 回到底部按钮 */}
      {showScrollBtn && messages.length > 0 && (
        <button onClick={scrollToBottom}
          style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 76, width: 40, height: 40, borderRadius: '50%', border: '1px solid #e5e7eb', background: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667eea', zIndex: 10, transition: 'all .15s' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      )}

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
      <div style={{ padding: '10px 20px 14px', background: 'white', borderTop: '1px solid #eef2f6', position: 'relative' }}>
        {/* 附件预览 */}
        {attachedFiles.length > 0 && (
          <div style={{ maxWidth: 800, width: '100%', margin: '0 auto 8px auto', display: 'flex', gap: 8, overflow: 'auto', paddingBottom: 2 }}>
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
            <span dangerouslySetInnerHTML={{ __html: shieldWarning }} />
            <button onClick={() => setShieldWarning(null)}
              style={{ marginLeft: 4, flexShrink: 0, width: 18, height: 18, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991b1b', opacity: 0.6, padding: 0, lineHeight: 1, fontSize: "0.875rem" }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#fecaca'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
            >×</button>
          </div>
        )}

        {/* 输入工具条 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 800, width: '100%', margin: '0 auto' }}>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileSelect} style={{ display: 'none' }} />

          {!blacklisted && (<>
          {/* 附件按钮 */}
          <button onClick={() => fileInputRef.current?.click()} disabled={waitingAI || uploading || paused || agentDisabled}
            title="上传图片或文件"
            style={{ flexShrink: 0, width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e5e7eb', borderRadius: 12, background: 'white', cursor: 'pointer', color: '#6b7280', opacity: (waitingAI || uploading || paused || agentDisabled) ? 0.4 : 1, transition: 'all .15s' }}>
            {uploading ? (
              <span style={{ fontSize: "1rem" }}>⏳</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            )}
          </button>


          </>)}
          {/* 输入框 + 发送按钮（整合在一行） */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#f3f4f6', borderRadius: 12, border: '1px solid #e5e7eb', transition: 'border-color .15s' }}>
            <input ref={inputRef} type="text" value={input} onInput={e => setInput((e.target as HTMLInputElement).value)} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if ((e.nativeEvent as any).isComposing) return;
                e.preventDefault();
                sendMessage();
              }
            }} placeholder={blacklisted ? '你已被黑屏处理...' : paused ? '课堂已暂停...' : agentDisabled ? '智能体已停用...' : '输入你的问题...'} disabled={waitingAI || paused || agentDisabled || blacklisted} autoFocus autoComplete="off"
              style={{ flex: 1, fontSize: "1rem", padding: '12px 16px', background: 'transparent', border: 'none', outline: 'none', color: '#1a1a2e' }} />
            <button type="button" onClick={sendMessage} disabled={(!input.trim() && attachedFiles.length === 0) || waitingAI || paused || agentDisabled || blacklisted}
              style={{ flexShrink: 0, height: 36, width: 36, margin: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', background: (!input.trim() && attachedFiles.length === 0) || waitingAI || paused || agentDisabled ? '#d1d5db' : 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', cursor: (!input.trim() && attachedFiles.length === 0) || waitingAI || paused || agentDisabled ? 'default' : 'pointer', transition: 'all .15s' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      {/* 头像更换弹窗 */}
      {showAvatarChanger && (
        <div className="modal-overlay" onClick={() => setShowAvatarChanger(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: '0 0 4px' }}>🎨 更换头像</h3>
            <p style={{ fontSize: "0.75rem", color: '#64748b', margin: '0 0 4px' }}>
              剩余 <strong style={{ color: '#d97706' }}>{avatarTokenCount}</strong> 次更换机会，由教师奖励获得
            </p>
            <p style={{ fontSize: "0.688rem", color: '#94a3b8', margin: '0 0 16px' }}>
              可从教师头像库中选择，也可粘贴自定义 SVG 代码
            </p>
            <AvatarChangerContent
              studentId={selectedStudent?.id}
              avatars={allStudentAvatars}
              avatarSvgs={avatarSvgs}
              onChanged={async () => {
                setShowAvatarChanger(false);
                fetchStudentTokens();
                try {
                  const [allAv, teacherAv] = await Promise.all([
                    api.getAvatarsAll('student'),
                    api.getAvatars('student'),
                  ]);
                  const m: Record<number, string> = {};
                  allAv.forEach((a: any) => { m[a.id] = fixSvgUrl(a.svgContent); });
                  setAvatarSvgs(m);
                  setAllStudentAvatars(teacherAv);
                  // 重新加载 classroom students 更新 selectedStudent
                  if (classroom?.id && selectedStudent?.id) {
                    const sts = await api.getClassroomStudents(classroom.id);
                    const updated = sts.find((s: any) => s.id === selectedStudent.id);
                    if (updated) setSelectedStudent(updated);
                  }
                } catch {}
              }}
              setToast={setToast}
            />
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
    </div>
  );
}

/** 学生自助换头像组件 */
function AvatarChangerContent({ studentId, avatars, avatarSvgs, onChanged, setToast }: {
  studentId: string; avatars: any[]; avatarSvgs: Record<number, string>;
  onChanged: () => void; setToast: (t: any) => void;
}) {
  const [tab, setTab] = useState<'library' | 'custom' | 'image'>('library');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [svgInput, setSvgInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadSvg, setUploadSvg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    // 本地预览
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setUploadSvg(null);
    // 自动上传
    setUploading(true);
    try {
      const result = await api.uploadAvatarImage(file);
      if (result.svgContent) {
        setUploadSvg(result.svgContent);
      }
    } catch { setToast({ msg: '图片上传失败', type: 'error' }); }
    setUploading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (tab === 'library' && selectedId) {
        await api.studentSelfChangeAvatar(studentId, { avatarId: selectedId });
      } else if (tab === 'custom' && svgInput.trim()) {
        await api.studentSelfChangeAvatar(studentId, { svgContent: svgInput.trim(), gender: 'neutral' });
      } else if (tab === 'image' && uploadSvg) {
        await api.studentSelfChangeAvatar(studentId, { svgContent: uploadSvg, gender: 'neutral' });
      } else {
        setToast({ msg: '请选择或上传一个头像', type: 'error' }); setSaving(false); return;
      }
      setToast({ msg: '头像已更新！', type: 'success' });
      onChanged();
    } catch (e: any) {
      setToast({ msg: e.message || '更换失败', type: 'error' });
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid #e2e8f0' }}>
        {[
          { key: 'library' as const, label: '选择头像' },
          { key: 'custom' as const, label: '自定义 SVG' },
          { key: 'image' as const, label: '上传图片' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: "0.813rem", fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#2563eb' : '#64748b', background: 'transparent', border: 'none',
              cursor: 'pointer', borderBottom: `2px solid ${tab === t.key ? '#2563eb' : 'transparent'}`,
              marginBottom: -2,
            }}>{t.label}</button>
        ))}
      </div>

      {tab === 'library' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
          {avatars.length === 0 ? (
            <p style={{ fontSize: "0.813rem", color: '#94a3b8', padding: 20 }}>暂无可选头像</p>
          ) : avatars.map(av => (
            <div key={av.id} onClick={() => setSelectedId(selectedId === av.id ? null : av.id)}
              style={{
                width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
                border: `2px solid ${selectedId === av.id ? '#2563eb' : '#e2e8f0'}`,
              }}
              dangerouslySetInnerHTML={{ __html: fixSvgUrl(av.svgContent).replace('<svg', '<svg width="40" height="40"') }} />
          ))}
        </div>
      ) : tab === 'custom' ? (
        <div style={{ marginBottom: 16 }}>
          <textarea className="input" value={svgInput} onChange={e => setSvgInput(e.target.value)}
            rows={5} style={{ fontFamily: 'monospace', fontSize: "0.688rem", resize: 'vertical' }}
            placeholder={'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">\n  ...\n</svg>'} />
          <p style={{ fontSize: "0.625rem", color: '#94a3b8', marginTop: 4 }}>
            需要包含 viewBox="0 0 40 40" 的完整 SVG 代码
          </p>
          {svgInput.trim() && (
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', background: '#f8fafc', borderRadius: 8, padding: 12 }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', overflow: 'hidden' }}
                dangerouslySetInnerHTML={{ __html: svgInput.replace('<svg', '<svg width="60" height="60"') }} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect}
            style={{ display: 'none' }} />
          {!imagePreview ? (
            <div onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #cbd5e1', borderRadius: 12, padding: '30px 20px',
                textAlign: 'center', cursor: 'pointer', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.background = '#f8faff'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = 'transparent'; }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: 8 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
              <p style={{ fontSize: "0.813rem", fontWeight: 600, color: '#475569', margin: '0 0 4px' }}>点击上传头像图片</p>
              <p style={{ fontSize: "0.688rem", color: '#94a3b8', margin: 0 }}>支持 JPG、PNG、WebP 格式</p>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ width: 80, height: 80, borderRadius: '50%', overflow: 'hidden', border: '3px solid #e2e8f0' }}>
                  <img src={imagePreview} alt="预览" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
              {uploading ? (
                <p style={{ fontSize: "0.75rem", color: '#94a3b8' }}>上传中...</p>
              ) : uploadSvg ? (
                <p style={{ fontSize: "0.75rem", color: '#10b981', fontWeight: 600 }}>✅ 上传成功，点击确认更换</p>
              ) : null}
              <button onClick={() => { setImageFile(null); setImagePreview(null); setUploadSvg(null); }}
                style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: "0.75rem", cursor: 'pointer', marginTop: 4 }}>
                重新选择
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={saving || (tab === 'library' && !selectedId) || (tab === 'custom' && !svgInput.trim()) || (tab === 'image' && !uploadSvg)}>
          {saving ? '更换中...' : '确认更换'}
        </button>
      </div>
    </div>
  );
}

export default function StudentChatPage() {
  return (
    <>
      <style>{`
        :root { --primary: #667eea; --text-secondary: #6b7280; --border: #e5e7eb; --bg: #f3f4f6; --danger: #ef4444; --primary-light: #eef2ff; }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @keyframes typing { 0%,60%,100% { transform: translateY(0) } 30% { transform: translateY(-5px) } }
        @keyframes teacherBubbleIn { from { opacity:0; transform: translateY(-8px) scale(0.96); } to { opacity:1; transform: translateY(0) scale(1); } }
        @keyframes notifSlideUp { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
      <Suspense fallback={<div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',color:'white'}}>加载中...</div>}>
        <StudentChatContent />
      </Suspense>
    </>
  );
}
