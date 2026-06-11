'use client';

import { useState, useEffect, useRef, Suspense, memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { renderMarkdown, stripImages } from '@/lib/markdown';
import { getApiBaseUrl } from '@/lib/api-base';
import { Toast } from '@/lib/components';

const API_BASE_URL = getApiBaseUrl();

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
  msg, studentName, agent, apiBase,
}: {
  msg: any; studentName: string; agent: any; apiBase: string;
}) {
  const fileSources = msg.fileUrls || (msg.fileUrl ? [msg.fileUrl] : []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
      {msg.role === 'assistant' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, overflow: 'hidden' }}>
            <AgentAvatar size={26} borderRadius={8} fontSize={13} agent={agent} apiBase={apiBase} />
          </div>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: 'var(--primary)' }}>{agent?.name || 'AI助手'}</span>
        </div>
      )}
      {msg.role === 'user' && studentName && (
        <div style={{ paddingRight: 4 }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: '#94a3b8' }}>{studentName}</span>
        </div>
      )}
      <div style={{
        maxWidth: '78%',
        padding: msg.role === 'system' ? '10px 16px' : '14px 18px',
        borderRadius: msg.role === 'user' ? '18px 18px 6px 18px' : '6px 18px 18px 18px',
        background: msg.role === 'user' ? 'linear-gradient(135deg, #667eea, #764ba2)' : 'white',
        color: msg.role === 'user' ? 'white' : '#1a1a2e',
        border: msg.role === 'assistant' ? '1px solid #eef2f6' : 'none',
        boxShadow: msg.role === 'assistant' ? '0 2px 8px rgba(0,0,0,0.04)' : '0 4px 12px rgba(102,126,234,0.2)',
        lineHeight: 1.7,
        fontSize: "0.938rem",
        wordBreak: 'break-word',
        position: 'relative',
      }}>
        {fileSources.map((fu: string, fi: number) => (
          <div key={fi} style={{ marginBottom: 8 }}>
            {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
              <img src={`${apiBase}${fu}`} alt={(msg.fileNames?.[fi]) || msg.fileName || ''}
                style={{ maxWidth: 220, maxHeight: 160, borderRadius: 10, objectFit: 'cover', display: 'block' }} />
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
        <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, overflow: 'hidden' }}>
          <AgentAvatar size={26} borderRadius={8} fontSize={13} agent={agent} apiBase={apiBase} />
        </div>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: 'var(--primary)' }}>{agent?.name || 'AI助手'}</span>
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
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (Date.now() - session.timestamp < 7200000) {
          setSelectedStudent({ id: session.studentId, name: session.studentName });
          setStep('chat');
          loadClassroom(codeFromUrl, session.studentId).then(cr => {
            if (cr) { loadMessages(cr.id, session.studentId); startChatSession(session.studentId, session.studentName, codeFromUrl); }
          });
          return;
        }
      } catch {}
      localStorage.removeItem(`chat_session_${codeFromUrl}`);
    }
    loadClassroom(codeFromUrl).then(cr => { if (cr) setStep('identity'); });
  }, []);

  const [step, setStep] = useState<'loading' | 'identity' | 'chat'>('loading');
  const [classroom, setClassroom] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [waitingAI, setWaitingAI] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [connected, setConnected] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ url: string; name: string }[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [agentDisabled, setAgentDisabled] = useState(false);
  const [shieldWarning, setShieldWarning] = useState<string | null>(null);
  const [blacklisted, setBlacklisted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
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
      api.getClassroomStudents(classroom.id).then(setStudents).catch(() => {});
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
        setConnectionError('AI 回复遇到了问题，请稍后重试');
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


  const handleIdentityConfirm = async () => {
    if (!selectedStudent) return;
    setStep('chat');
    // 保存会话到 localStorage
    localStorage.setItem(`chat_session_${code}`, JSON.stringify({
      studentId: selectedStudent.id,
      studentName: selectedStudent.name,
      timestamp: Date.now(),
    }));
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

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setToast({ msg: '您的浏览器不支持语音输入，请使用 Chrome', type: 'info' });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (inputRef.current) {
        inputRef.current.value += transcript;
        setInput(inputRef.current.value);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.start();
    // 语音开始后聚焦输入框
    inputRef.current?.focus();
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
                      <div style={{ width: 42, height: 42, borderRadius: '50%', background: isOnline ? '#e5e7eb' : isSelected ? 'linear-gradient(135deg, #667eea, #764ba2)' : '#f3f4f6', color: isOnline ? '#d1d5db' : isSelected ? 'white' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: "1rem", flexShrink: 0 }}>
                        {s.name[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        {s.studentNo && <div style={{ fontSize: "0.75rem", fontWeight: 500, color: '#9ca3af', lineHeight: 1.3 }}>{s.studentNo}</div>}
                        <div style={{ fontSize: "1rem", fontWeight: 600, color: isOnline ? '#9ca3af' : '#1a1a2e', lineHeight: 1.4 }}>{s.name}</div>
                      </div>
                    </>
                  )}
                  {isOnline && <span style={{ fontSize: "0.688rem", color: '#9ca3af', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>已登录</span>}
                  {!isOnline && !isGroupMode && s.groupName && <span className="tag tag-blue" style={{ marginLeft: 'auto', flexShrink: 0 }}>{s.groupName}</span>}
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
      <div style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderBottom: '1px solid #eef2f6', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: "0.75rem", color: connected ? '#10b981' : '#ef4444' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#10b981' : '#ef4444', display: 'inline-block' }} />
            {connected ? '已连接' : '连接断开'}
          </div>
          {/* 当前登录用户姓名标签 */}
          {selectedStudent?.name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', background: '#eef2ff', borderRadius: 20, fontSize: "0.813rem", color: 'var(--primary)', fontWeight: 600, border: '1px solid #c7d2fe' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: "0.688rem" }}>
                {selectedStudent.name[0]}
              </div>
              {selectedStudent.name}
            </div>
          )}
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
          return messages.map((msg, i) => (
            <MessageItem key={msg.roundIndex ? `${msg.role}-${msg.roundIndex}` : `msg-${i}`} msg={msg} studentName={selectedStudent?.name || ''} agent={memoAgent} apiBase={SOCKET_URL} />
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

          {/* 语音按钮 */}
          <button onClick={startVoiceInput} disabled={waitingAI || paused || agentDisabled}
            title={isListening ? '正在聆听...' : '语音输入'}
            style={{ flexShrink: 0, width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${isListening ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 12, background: isListening ? '#fef2f2' : 'white', cursor: 'pointer', color: isListening ? '#ef4444' : '#6b7280', opacity: (waitingAI || paused || agentDisabled) ? 0.4 : 1, transition: 'all .15s' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
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
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
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
      `}</style>
      <Suspense fallback={<div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',color:'white'}}>加载中...</div>}>
        <StudentChatContent />
      </Suspense>
    </>
  );
}
