'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FieldError } from '@/lib/components';

const SESSION_KEY = 'teacher_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 天

const navItems = [
  { path: '/teacher/dashboard', label: '仪表盘', icon: 'gauge' },
  { path: '/teacher/agents', label: 'AI智能体', icon: 'bot' },
  { path: '/teacher/classes', label: '班级管理', icon: 'users' },
  { path: '/teacher', label: '课堂管理', icon: 'dashboard' },
  { path: '/teacher/history', label: '历史数据', icon: 'clock' },
  { path: '/teacher/about', label: '关于', icon: 'info' },
];

function getSession(): { verified: boolean; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.verified && Date.now() - session.timestamp < SESSION_DURATION) {
      return session;
    }
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    verified: true,
    timestamp: Date.now(),
  }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
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
  const [logoError, setLogoError] = useState(false);

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

      // 系统已初始化，再检查本地 session
      const session = getSession();
      if (session) {
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

  const handleLogin = async () => {
    try {
      const result = await api.verifyPassword(password);
      if (result.verified) {
        saveSession();
        setAuthState('authenticated');
        setFieldErrors({});
      } else {
        setFieldErrors({ password: '密码错误' });
      }
    } catch (e: any) {
      setFieldErrors({ password: e.message || '验证失败' });
    }
  };

  const handleLogout = () => {
    clearSession();
    setAuthState('login');
    setPassword('');
  };

  const handleSetup = async () => {
    const errors: Record<string, string> = {};
    if (setupPwd.length < 6) errors.setupPwd = '密码至少6位';
    if (setupPwd !== setupConfirm) errors.setupConfirm = '两次密码输入不一致';
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    try {
      await api.setAdminPassword(setupPwd);
      setFieldErrors({});
      setSetupPwd('');
      setSetupConfirm('');
      saveSession();
      setAuthState('authenticated');
    } catch (e: any) {
      setFieldErrors({ submit: e.message });
    }
  };

  const clearPwdError = (field: string) => {
    setPwdFieldErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  };

  const handleChangePassword = async () => {
    setPwdFieldErrors({});
    setPwdSuccess('');
    const errors: Record<string, string> = {};
    if (!oldPwd) errors.oldPwd = '请输入当前密码';
    if (!newPwd || newPwd.length < 6) errors.newPwd = '新密码至少6位';
    if (newPwd !== confirmPwd) errors.confirmPwd = '两次输入的新密码不一致';
    if (Object.keys(errors).length > 0) { setPwdFieldErrors(errors); return; }
    setChangingPwd(true);
    try {
      const result = await api.verifyPassword(oldPwd);
      if (!result.verified) { setPwdFieldErrors({ oldPwd: '当前密码错误' }); setChangingPwd(false); return; }
      await api.setAdminPassword(newPwd);
      setPwdSuccess('密码修改成功');
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setTimeout(() => { setShowChangePwd(false); setPwdSuccess(''); }, 1500);
    } catch (e: any) {
      setPwdFieldErrors({ submit: e.message || '修改失败' });
    }
    setChangingPwd(false);
  };

  // 认证加载中
  if (authState === 'loading') {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: '#6b7280' }}>加载中...</div>
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
            <img src="/logo.png" alt="ClassNode" style={{ width: 48, height: 48, borderRadius: 10, display: 'block', margin: '0 auto 16px' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>教师身份验证</h1>
            <p style={{ color: '#6b7280', fontSize: 14, marginTop: 6 }}>请输入管理密码以进入控制台</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              className="input"
              placeholder="管理密码"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => { const n = { ...prev }; delete n.password; return n; }); }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              style={{ borderColor: fieldErrors.password ? '#ef4444' : undefined }}
              autoFocus
            />
            {fieldErrors.password && (
              <FieldError message={fieldErrors.password} />
            )}
          </div>
          <button className="btn btn-primary btn-lg" onClick={handleLogin} style={{ width: '100%', fontSize: 15 }}>
            进入控制台
          </button>
          <button onClick={() => router.push('/')} style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer' }}>
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
            <img src="/logo.png" alt="ClassNode" style={{ width: 48, height: 48, borderRadius: 10, display: 'block', margin: '0 auto 16px' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>欢迎使用 AI互动课堂</h1>
            <p style={{ color: '#6b7280', fontSize: 14, marginTop: 6 }}>首次使用，请设置管理密码以保护教师控制台</p>
          </div>
          <div style={{ marginBottom: 14 }}>
            <input type="password" className="input" placeholder="设置管理密码（至少6位）" value={setupPwd}
              onChange={e => { setSetupPwd(e.target.value); setFieldErrors(prev => { const n = { ...prev }; delete n.setupPwd; return n; }); }}
              onKeyDown={e => e.key === 'Enter' && handleSetup()}
              style={{ borderColor: fieldErrors.setupPwd ? '#ef4444' : undefined }} autoFocus />
            {fieldErrors.setupPwd && <FieldError message={fieldErrors.setupPwd} />}
          </div>
          <div style={{ marginBottom: 14 }}>
            <input type="password" className="input" placeholder="再次确认密码" value={setupConfirm}
              onChange={e => { setSetupConfirm(e.target.value); setFieldErrors(prev => { const n = { ...prev }; delete n.setupConfirm; return n; }); }}
              onKeyDown={e => e.key === 'Enter' && handleSetup()}
              style={{ borderColor: fieldErrors.setupConfirm ? '#ef4444' : undefined }} />
            {fieldErrors.setupConfirm && <FieldError message={fieldErrors.setupConfirm} />}
          </div>
          {fieldErrors.submit && <FieldError message={fieldErrors.submit} style={{ marginBottom: 8 }} />}
          <button className="btn btn-primary btn-lg" onClick={handleSetup} style={{ width: '100%' }}>确认并进入</button>
        </div>
      </div>
    );
  }

  // 已认证 — 正常显示
  return (
    <div className="teacher-layout">
      <nav style={{
        width: 240, background: '#ffffff',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        padding: '24px 14px', position: 'fixed',
        top: 0, left: 0, bottom: 0, zIndex: 50,
      }}>
        {/* 品牌标识 */}
        <div style={{ marginBottom: 28, paddingLeft: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {logoError ? (
              <div style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: 14,
              }}>C</div>
            ) : (
              <img src="/logo.png" alt="ClassNode"
                style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0 }}
                onError={() => setLogoError(true)}
              />
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>ClassNode</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>AI 互动课堂系统</div>
            </div>
          </div>
        </div>

        {/* 服务状态 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', marginBottom: 24,
          background: serverOnline ? '#f0fdf4' : '#fef2f2',
          borderRadius: 8, fontSize: 12,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: serverOnline ? '#22c55e' : '#ef4444',
            boxShadow: serverOnline ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
            flexShrink: 0,
          }} />
          <span style={{ color: serverOnline ? '#16a34a' : '#dc2626' }}>
            服务{serverOnline ? '运行中' : '已断开'}
          </span>
        </div>

        {/* 导航标题 */}
        <div style={{
          fontSize: 10, fontWeight: 600, color: '#94a3b8',
          letterSpacing: 0.8, textTransform: 'uppercase',
          marginBottom: 6, paddingLeft: 12,
        }}>
          导航菜单
        </div>

        {/* 导航项 */}
        {navItems.map(item => {
          const p = pathname || '';
          const isActive = item.path === '/teacher'
            ? p === '/teacher' || p.startsWith('/teacher/classroom')
            : p.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8, width: '100%',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                fontSize: 13, fontWeight: isActive ? 600 : 400,
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
              <span style={{ flexShrink: 0, display: 'flex' }}>
                {item.icon === 'dashboard' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                )}
                {item.icon === 'bot' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                )}
                {item.icon === 'gauge' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10" />
                    <path d="M12 12l4-4" />
                    <path d="M12 8v4" />
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                )}
                {item.icon === 'clock' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                )}
                {item.icon === 'info' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}

        {/* 底部区域 */}
        <div style={{ marginTop: 'auto' }}>
          <div style={{
            borderTop: '1px solid #eef2f6',
            paddingTop: 12,
          }}>
            <button
              onClick={() => setShowChangePwd(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8, width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, color: '#94a3b8', textAlign: 'left',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#475569'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>修改密码</span>
            </button>
            <button
              onClick={handleLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8, width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, color: '#94a3b8', textAlign: 'left',
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
              <span>退出登录</span>
            </button>
            <div style={{
              fontSize: 11, color: '#cbd5e1',
              padding: '10px 12px 0',
            }}>
              v1.0.0
            </div>
          </div>
        </div>
      </nav>

      <main className="teacher-main">
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
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>修改管理密码</h3>

            {pwdSuccess ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#10b981', fontSize: 15 }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginBottom: 12 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div>{pwdSuccess}</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, color: '#475569', fontWeight: 500, display: 'block', marginBottom: 4 }}>当前密码</label>
                  <input type="password" className="input" value={oldPwd}
                    onChange={e => { setOldPwd(e.target.value); clearPwdError('oldPwd'); }}
                    placeholder="输入当前管理密码" autoFocus
                    style={{ borderColor: pwdFieldErrors.oldPwd ? '#ef4444' : undefined }} />
                  {pwdFieldErrors.oldPwd && <FieldError message={pwdFieldErrors.oldPwd} />}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, color: '#475569', fontWeight: 500, display: 'block', marginBottom: 4 }}>新密码</label>
                  <input type="password" className="input" value={newPwd}
                    onChange={e => { setNewPwd(e.target.value); clearPwdError('newPwd'); }}
                    placeholder="至少6位"
                    style={{ borderColor: pwdFieldErrors.newPwd ? '#ef4444' : undefined }} />
                  {pwdFieldErrors.newPwd && <FieldError message={pwdFieldErrors.newPwd} />}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: '#475569', fontWeight: 500, display: 'block', marginBottom: 4 }}>确认新密码</label>
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
    </div>
  );
}
