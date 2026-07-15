'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { APP_VERSION } from '@/lib/version';
import { checkForUpdates, getCachedCheckResult, cacheCheckResult, UPDATE_CHECK_INTERVAL } from '@/lib/upgrade-check';
import { FieldError, Toast } from '@/lib/components';

const navItems = [
  { path: '/teacher/dashboard', label: '仪表盘', icon: 'gauge' },
  { path: '/teacher/agents', label: 'AI智能体', icon: 'bot' },
  { path: '/teacher/classes', label: '班级管理', icon: 'users' },
  { path: '/teacher', label: '课堂管理', icon: 'dashboard' },
  { path: '/teacher/avatars', label: '头像管理', icon: 'avatar' },
  { path: '/teacher/shield', label: '屏蔽管理', icon: 'shield' },
  { path: '/teacher/history', label: '数据管理', icon: 'clock' },
  { path: '/teacher/guide', label: '使用指南', icon: 'book' },
  { path: '/teacher/about', label: '关于', icon: 'info' },
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [serverOnline, setServerOnline] = useState(true);
  const [authState, setAuthState] = useState<'loading' | 'login' | 'setup' | 'authenticated'>('loading');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [setupPwd, setSetupPwd] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdFieldErrors, setPwdFieldErrors] = useState<Record<string, string>>({});
  const [pwdSuccess, setPwdSuccess] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const dismissedRef = useRef<string[]>([]);
  const loginRef = useRef(false);
  const setupRef = useRef(false);
  const changePwdRef = useRef(false);
  const logoutRef = useRef(false);
  const pwdCloseTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('teacher_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });
  const [hasUpdate, setHasUpdate] = useState(() => getCachedCheckResult()?.hasUpdate === true);
  const [updateChecking, setUpdateChecking] = useState(false);

  // 检查服务状态和认证
  useEffect(() => {
    const init = async () => {
      try {
        await api.health();
        setServerOnline(true);
      } catch {
        setServerOnline(false);
      }

      // 先检查初始化状态（未初始化时显示设置密码页面，不检查 session）
      try {
        const status = await api.getInitStatus();
        if (!status.initialized) {
          setAuthState('setup');
          return;
        }
      } catch {
        // 无法检查时继续
      }

      const session = await api.getSession();
      if (session.authenticated) {
        setAuthState('authenticated');
        return;
      }

      setAuthState('login');
    };
    init();
  }, []);

  // 健康检查轮询
  useEffect(() => {
    const interval = setInterval(async () => {
      try { await api.health(); setServerOnline(true); }
      catch { setServerOnline(false); }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // 监听智能体连接异常通知
  useEffect(() => {
    let cancelled = false;
    let socket: { disconnect: () => void } | undefined;
    (async () => {
      const { io } = await import('socket.io-client');
      const sk = io(getApiBaseUrl(), { transports: ['websocket', 'polling'], reconnection: true, withCredentials: true });
      socket = sk;
      sk.on('agents-checked', (data: { failed?: unknown }) => {
        if (!cancelled) {
          const allFailed = Array.isArray(data?.failed) ? data.failed.filter((item): item is string => typeof item === 'string') : [];
          const visible = allFailed.filter(a => !dismissedRef.current.includes(a));
          if (visible.length > 0) setToast({ msg: visible.join('、') + ' 连接异常', type: 'error' });
        }
      });
      sk.on('agent-test-passed', (agentName: string) => {
        if (!cancelled) {
          dismissedRef.current = dismissedRef.current.filter(name => name !== agentName);
        }
      });
      // 学生端 AI 调用失败时，实时收到智能体异常通知
      sk.on('agent-connection-lost', (data: { agentId: string; agentName: string }) => {
        if (!cancelled) {
          setToast({ msg: `${data.agentName} 连接异常`, type: 'error' });
        }
      });
    })();
    return () => { cancelled = true; socket?.disconnect(); };
  }, []);

  useEffect(() => {
    const onSessionExpired = () => {
      setAuthState('login');
      setPassword('');
      setToast({ msg: '登录已过期，请重新输入管理密码', type: 'error' });
    };
    window.addEventListener('classnode-teacher-session-expired', onSessionExpired);
    return () => window.removeEventListener('classnode-teacher-session-expired', onSessionExpired);
  }, []);

  // 页面加载时立即从缓存恢复检测结果 + 监听手动检测事件
  useEffect(() => {
    const onUpdateFound = (e: Event) => {
      void (e as CustomEvent<{ version: string }>).detail.version;
      setHasUpdate(true);
    };
    window.addEventListener('classnode-update-found', onUpdateFound);
    return () => window.removeEventListener('classnode-update-found', onUpdateFound);
  }, []);

  // 定时自动检查更新（首次延迟 8s，之后每 24h）
  useEffect(() => {
    const doCheck = async () => {
      if (updateChecking) return;
      setUpdateChecking(true);
      try {
        const result = await checkForUpdates();
        // 缓存检测结果，刷新页面后仍能立即显示
        cacheCheckResult(result);
        if (result.hasUpdate) {
          setHasUpdate(true);
        } else {
          setHasUpdate(false);
        }
      } catch {
        // 静默失败，下次再试；清除缓存避免页面加载时仍显示过期版本提示
        try { localStorage.removeItem('classnode_update_cache'); } catch {}
      }
      setUpdateChecking(false);
    };

    // 首次延迟检查，避免启动时干扰
    const timer = setTimeout(doCheck, 8000);
    // 之后每 24h 检查一次
    const interval = setInterval(doCheck, UPDATE_CHECK_INTERVAL);

    return () => { clearTimeout(timer); clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('teacher_sidebar_collapsed', String(next));
      return next;
    });
  };

  useEffect(() => () => {
    if (pwdCloseTimerRef.current) window.clearTimeout(pwdCloseTimerRef.current);
  }, []);

  const handleLogin = async () => {
    if (loginRef.current) return;
    loginRef.current = true;
    setLoggingIn(true);
    try {
      const result = await api.verifyPassword(password);
      if (result.verified) {
        setAuthState('authenticated');
        setFieldErrors({});
      } else {
        setFieldErrors({ password: '密码错误' });
      }
    } catch (error: unknown) {
      setFieldErrors({ password: errorMessage(error, '验证失败') });
    } finally {
      loginRef.current = false;
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (logoutRef.current) return;
    logoutRef.current = true;
    setLoggingOut(true);
    try {
      await api.logout();
      setAuthState('login');
      setPassword('');
    } catch (error) {
      setToast({ msg: `退出登录失败：${errorMessage(error, '请求异常')}`, type: 'error' });
    } finally {
      logoutRef.current = false;
      setLoggingOut(false);
    }
  };

  const handleSetup = async () => {
    if (setupRef.current) return;
    const errors: Record<string, string> = {};
    if (setupPwd.length < 8) errors.setupPwd = '密码至少8位';
    if (setupPwd !== setupConfirm) errors.setupConfirm = '两次密码输入不一致';
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setupRef.current = true;
    setSettingUp(true);
    try {
      await api.setAdminPassword(setupPwd);
      setFieldErrors({});
      setSetupPwd('');
      setSetupConfirm('');
      setAuthState('authenticated');
    } catch (error: unknown) {
      setFieldErrors({ submit: errorMessage(error, '设置失败') });
    } finally {
      setupRef.current = false;
      setSettingUp(false);
    }
  };

  const clearPwdError = (field: string) => {
    setPwdFieldErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  };

  const openChangePassword = () => {
    if (pwdCloseTimerRef.current) {
      window.clearTimeout(pwdCloseTimerRef.current);
      pwdCloseTimerRef.current = null;
    }
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setPwdFieldErrors({});
    setPwdSuccess('');
    setShowChangePwd(true);
  };

  const handleChangePassword = async () => {
    if (changePwdRef.current) return;
    setPwdFieldErrors({});
    setPwdSuccess('');
    const errors: Record<string, string> = {};
    if (!oldPwd) errors.oldPwd = '请输入当前密码';
    if (!newPwd || newPwd.length < 8) errors.newPwd = '新密码至少8位';
    if (newPwd !== confirmPwd) errors.confirmPwd = '两次输入的新密码不一致';
    if (Object.keys(errors).length > 0) { setPwdFieldErrors(errors); return; }
    changePwdRef.current = true;
    setChangingPwd(true);
    try {
      await api.changePassword(oldPwd, newPwd);
      setPwdSuccess('密码修改成功');
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      if (pwdCloseTimerRef.current) window.clearTimeout(pwdCloseTimerRef.current);
      pwdCloseTimerRef.current = window.setTimeout(() => { setShowChangePwd(false); setPwdSuccess(''); }, 1500);
    } catch (error: unknown) {
      setPwdFieldErrors({ submit: errorMessage(error, '修改失败') });
    }
    changePwdRef.current = false;
    setChangingPwd(false);
  };

  // 认证加载中
  if (authState === 'loading') {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: "0.938rem", color: '#6b7280' }}>加载中...</div>
        </div>
      </div>
    );
  }

  // 登录页
  if (authState === 'login') {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div style={{ background: 'white', borderRadius: 20, padding: 40, maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            {logoErr ? (
              <div style={{ width: 96, height: 96, borderRadius: 20, margin: '0 auto 16px', background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: "2.25rem" }}>C</div>
            ) : (
              <img src="/logo.png" alt="ClassNode" style={{ width: 96, height: 96, borderRadius: 20, display: 'block', margin: '0 auto 16px' }} onError={() => setLogoErr(true)} />
            )}
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>教师身份验证</h1>
            <p style={{ color: '#6b7280', fontSize: "0.875rem", marginTop: 6 }}>请输入管理密码以进入控制台</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              className="input"
              placeholder="管理密码"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => { const n = { ...prev }; delete n.password; return n; }); }}
              onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
              disabled={loggingIn}
              style={{ borderColor: fieldErrors.password ? '#ef4444' : undefined }}
              autoFocus
            />
            {fieldErrors.password && (
              <FieldError message={fieldErrors.password} />
            )}
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => void handleLogin()} disabled={loggingIn} style={{ width: '100%', fontSize: "0.938rem" }}>
            {loggingIn ? '验证中...' : '进入控制台'}
          </button>
          <div style={{ marginTop: 16, textAlign: 'center', fontSize: "0.75rem", color: '#9ca3af', lineHeight: 1.6 }}>
            遗忘密码？请在桌面端<strong style={{ color: '#818cf8' }}>「控制面板」</strong>窗口中重置
          </div>
          <button onClick={() => router.push('/')} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: '#6b7280', fontSize: "0.813rem", cursor: 'pointer' }}>
            返回学生页面
          </button>
        </div>
      </div>
    );
  }

  // 首次设置密码
  if (authState === 'setup') {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div style={{ background: 'white', borderRadius: 20, padding: 40, maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            {logoErr ? (
              <div style={{ width: 96, height: 96, borderRadius: 20, margin: '0 auto 16px', background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: "2.25rem" }}>C</div>
            ) : (
              <img src="/logo.png" alt="ClassNode" style={{ width: 96, height: 96, borderRadius: 20, display: 'block', margin: '0 auto 16px' }} onError={() => setLogoErr(true)} />
            )}
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>欢迎使用 AI互动课堂</h1>
            <p style={{ color: '#6b7280', fontSize: "0.875rem", marginTop: 6 }}>首次使用，请设置管理密码以保护教师控制台</p>
          </div>
          <div style={{ marginBottom: 14 }}>
            <input type="password" className="input" placeholder="设置管理密码（至少8位）" value={setupPwd}
              onChange={e => { setSetupPwd(e.target.value); setFieldErrors(prev => { const n = { ...prev }; delete n.setupPwd; return n; }); }}
              onKeyDown={e => e.key === 'Enter' && void handleSetup()}
              disabled={settingUp}
              style={{ borderColor: fieldErrors.setupPwd ? '#ef4444' : undefined }} autoFocus />
            {fieldErrors.setupPwd && <FieldError message={fieldErrors.setupPwd} />}
          </div>
          <div style={{ marginBottom: 14 }}>
            <input type="password" className="input" placeholder="再次确认密码" value={setupConfirm}
              onChange={e => { setSetupConfirm(e.target.value); setFieldErrors(prev => { const n = { ...prev }; delete n.setupConfirm; return n; }); }}
              onKeyDown={e => e.key === 'Enter' && void handleSetup()}
              disabled={settingUp}
              style={{ borderColor: fieldErrors.setupConfirm ? '#ef4444' : undefined }} />
            {fieldErrors.setupConfirm && <FieldError message={fieldErrors.setupConfirm} />}
          </div>
          {fieldErrors.submit && <FieldError message={fieldErrors.submit} style={{ marginBottom: 8 }} />}
          <button className="btn btn-primary btn-lg" onClick={() => void handleSetup()} disabled={settingUp} style={{ width: '100%' }}>{settingUp ? '设置中...' : '确认并进入'}</button>
        </div>
      </div>
    );
  }

  // 已认证 — 正常显示
  const iconSize = sidebarCollapsed ? 22 : 18;
  return (
    <div className="teacher-layout" data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}>
      <nav className="teacher-sidebar" style={{
        width: sidebarCollapsed ? 68 : 220, background: '#ffffff',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        padding: sidebarCollapsed ? '24px 4px' : '24px 12px', position: 'fixed',
        top: 0, left: 0, bottom: 0, zIndex: 50,
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}>
        {/* 品牌标识 */}
        <div className="teacher-sidebar-brand" style={{ marginBottom: 24, textAlign: sidebarCollapsed ? 'center' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: sidebarCollapsed ? 'center' : undefined }}>
            {logoErr ? (
              <div style={{ width: sidebarCollapsed ? 36 : 44, height: sidebarCollapsed ? 36 : 44, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: sidebarCollapsed ? "0.875rem" : "1.125rem" }}>C</div>
            ) : (
              <img src="/logo.png" alt="ClassNode" style={{ width: sidebarCollapsed ? 36 : 44, height: sidebarCollapsed ? 36 : 44, borderRadius: 10, flexShrink: 0 }} onError={() => setLogoErr(true)} />
            )}
            {!sidebarCollapsed && (
              <div className="teacher-sidebar-brand-copy">
                <div style={{ fontWeight: 700, fontSize: "1.25rem", color: '#0f172a' }}>ClassNode</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>AI 互动课堂系统</span>
                  <span style={{
                    fontSize: "0.625rem", fontWeight: 600, padding: '0 5px', lineHeight: '16px',
                    borderRadius: 100, background: 'rgba(79,70,229,0.08)', color: '#6366f1',
                    border: '1px solid rgba(79,70,229,0.15)',
                  }}>v{APP_VERSION}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 服务状态 */}
        {sidebarCollapsed ? (
          <div className="teacher-service-status teacher-service-status-collapsed" style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <span title={serverOnline ? '服务运行中' : '服务已断开'} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: serverOnline ? '#22c55e' : '#ef4444',
              boxShadow: serverOnline ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
            }} />
          </div>
        ) : (
          <div className="teacher-service-status" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', marginBottom: 24,
            background: serverOnline ? '#f0fdf4' : '#fef2f2',
            borderRadius: 8, fontSize: "0.75rem",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: serverOnline ? '#22c55e' : '#ef4444',
              boxShadow: serverOnline ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
              flexShrink: 0,
            }} />
            <span className="teacher-service-status-label" style={{ color: serverOnline ? '#16a34a' : '#dc2626' }}>
              服务{serverOnline ? '运行中' : '已断开'}
            </span>
          </div>
        )}

        {/* 导航标题 */}
        {!sidebarCollapsed && <div className="teacher-nav-title" style={{
          fontSize: "0.625rem", fontWeight: 600, color: '#94a3b8',
          letterSpacing: 0.8, textTransform: 'uppercase',
          marginBottom: 6, paddingLeft: 12,
        }}>
          导航菜单
        </div>}

        {/* 导航项 */}
        {navItems.map(item => {
          const p = pathname || '';
          const isActive = item.path === '/teacher'
            ? p.replace(/\/$/, '') === '/teacher' || p.startsWith('/teacher/classroom')
            : p.replace(/\/$/, '') === item.path || p.startsWith(item.path + '/');
          return (
            <button
              className="teacher-nav-button"
              key={item.path}
              onClick={() => router.push(item.path)}
              title={sidebarCollapsed ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : undefined,
                gap: 10,
                padding: sidebarCollapsed ? '10px 0' : '9px 12px', borderRadius: 8, width: '100%',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                fontSize: "0.875rem", fontWeight: isActive ? 600 : 400,
                color: isActive ? '#2563eb' : '#475569',
                background: isActive ? '#eef2ff' : 'transparent',
                position: 'relative', marginBottom: 2,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = '#f8fafc';
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* 激活指示条 */}
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3, height: 18,
                  background: '#2563eb',
                  borderRadius: '0 2px 2px 0',
                }} />
              )}
              <span style={{ flexShrink: 0, display: 'flex', position: 'relative' }}>
                {item.icon === 'dashboard' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                )}
                {item.icon === 'bot' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="3" />
                    <path d="M9 12h6" />
                    <path d="M12 9v6" />
                    <path d="M8 4V2" />
                    <path d="M16 4V2" />
                    <path d="M8 20v2" />
                    <path d="M16 20v2" />
                  </svg>
                )}
                {item.icon === 'users' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                )}
                {item.icon === 'gauge' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10" />
                    <path d="M12 12l4-4" />
                    <path d="M12 8v4" />
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                )}
                {item.icon === 'avatar' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                    <path d="M18 8l2 2 4-4"/>
                  </svg>
                )}
                {item.icon === 'clock' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                )}
                {item.icon === 'info' && (
                  <>
                    <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    {hasUpdate && (
                      <span style={{
                        position: 'absolute', top: -2, right: sidebarCollapsed ? -2 : -4,
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#ef4444',
                        border: '2px solid #ffffff',
                      }} />
                    )}
                  </>
                )}
                {item.icon === 'book' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                )}
                {item.icon === 'shield' && (
                  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                )}
              </span>
              {!sidebarCollapsed && <span className="teacher-nav-label">{item.label}</span>}
            </button>
          );
        })}

        {/* 底部区域 */}
        <div className="teacher-sidebar-footer" style={{ marginTop: 'auto' }}>
          {/* 新版本通知 — 只在不折叠时显示 */}
          <div style={{
            borderTop: '1px solid #eef2f6',
            paddingTop: 12,
          }}>
            <button
              onClick={() => window.open('https://classnode.icu/', '_blank')}
              title={sidebarCollapsed ? '打开官网' : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : undefined,
                gap: 10,
                padding: sidebarCollapsed ? '8px 0' : '8px 12px', borderRadius: 8, width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: "0.875rem", color: '#94a3b8', textAlign: 'left',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#2563eb'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              {!sidebarCollapsed && <span>打开官网</span>}
            </button>
            <button
              type="button"
              onClick={openChangePassword}
              title={sidebarCollapsed ? '修改密码' : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : undefined,
                gap: 10,
                padding: sidebarCollapsed ? '8px 0' : '8px 12px', borderRadius: 8, width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: "0.875rem", color: '#94a3b8', textAlign: 'left',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#475569'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {!sidebarCollapsed && <span>修改密码</span>}
            </button>
            <button
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              title={sidebarCollapsed ? '退出登录' : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : undefined,
                gap: 10,
                padding: sidebarCollapsed ? '8px 0' : '8px 12px', borderRadius: 8, width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: "0.875rem", color: '#94a3b8', textAlign: 'left',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {!sidebarCollapsed && <span>{loggingOut ? '退出中...' : '退出登录'}</span>}
            </button>
            {!sidebarCollapsed && <div style={{
              fontSize: "0.688rem", color: '#cbd5e1',
              padding: '10px 12px 0',
            }}>
              v{APP_VERSION}
            </div>}
          </div>
        </div>
      </nav>

      {/* 折叠/展开按钮 — 侧边突起 */}
      <button
        className="teacher-sidebar-toggle"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
        style={{
          position: 'fixed',
          left: sidebarCollapsed ? 68 : 220,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 20,
          height: 52,
          borderRadius: '0 8px 8px 0',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderLeft: 'none',
          cursor: 'pointer',
          zIndex: 51,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          color: '#94a3b8',
          transition: 'left 0.2s ease, color 0.15s, background 0.15s',
          boxShadow: '2px 0 6px rgba(0,0,0,0.04)',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.background = '#f8faff'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = '#fff'; }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <main className="teacher-main" style={{
        marginLeft: sidebarCollapsed ? 68 : 220,
        maxWidth: sidebarCollapsed ? `min(calc(100vw - 68px), 1464px)` : undefined,
        transition: 'margin-left 0.2s ease',
      }}>
        {children}
      </main>

      {/* 修改密码弹窗 */}
      {showChangePwd && (
        <>
          <div onClick={() => { if (!changingPwd) { setShowChangePwd(false); setPwdFieldErrors({}); setPwdSuccess(''); } }}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 201, background: 'white', borderRadius: 16, padding: 32,
            width: 380, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 20px', fontSize: "1.125rem", fontWeight: 700 }}>修改管理密码</h3>

            {pwdSuccess ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#10b981', fontSize: "0.938rem" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginBottom: 12 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div>{pwdSuccess}</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: "0.813rem", color: '#475569', fontWeight: 500, display: 'block', marginBottom: 4 }}>当前密码</label>
                  <input type="password" className="input" value={oldPwd}
                    onChange={e => { setOldPwd(e.target.value); clearPwdError('oldPwd'); }}
                    placeholder="输入当前管理密码" autoFocus
                    style={{ borderColor: pwdFieldErrors.oldPwd ? '#ef4444' : undefined }} />
                  {pwdFieldErrors.oldPwd && <FieldError message={pwdFieldErrors.oldPwd} />}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: "0.813rem", color: '#475569', fontWeight: 500, display: 'block', marginBottom: 4 }}>新密码</label>
                  <input type="password" className="input" value={newPwd}
                    onChange={e => { setNewPwd(e.target.value); clearPwdError('newPwd'); }}
                    placeholder="至少8位"
                    style={{ borderColor: pwdFieldErrors.newPwd ? '#ef4444' : undefined }} />
                  {pwdFieldErrors.newPwd && <FieldError message={pwdFieldErrors.newPwd} />}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: "0.813rem", color: '#475569', fontWeight: 500, display: 'block', marginBottom: 4 }}>确认新密码</label>
                  <input type="password" className="input" value={confirmPwd}
                    onChange={e => { setConfirmPwd(e.target.value); clearPwdError('confirmPwd'); }}
                    placeholder="再次输入新密码"
                    onKeyDown={e => { if (e.key === 'Enter') handleChangePassword(); }}
                    style={{ borderColor: pwdFieldErrors.confirmPwd ? '#ef4444' : undefined }} />
                  {pwdFieldErrors.confirmPwd && <FieldError message={pwdFieldErrors.confirmPwd} />}
                  {pwdFieldErrors.submit && <FieldError message={pwdFieldErrors.submit} />}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-secondary btn-lg" style={{ flex: 1 }} onClick={() => { setShowChangePwd(false); setPwdFieldErrors({}); }} disabled={changingPwd}>取消</button>
                  <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={handleChangePassword} disabled={changingPwd}>
                    {changingPwd ? '修改中...' : '确认修改'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
