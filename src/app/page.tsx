'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function StudentHomePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    api.health().then(() => setServerOnline(true)).catch(() => setServerOnline(false));
    setTimeout(() => inputRef.current?.focus(), 500);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const fullCode = code.replace(/\D/g, '').slice(0, 4);
    if (fullCode.length !== 4) {
      setError('请输入完整的4位互动码');
      return;
    }
    setLoading(true);
    try {
      await api.getClassroomByCode(fullCode);
      router.push(`/classroom?code=${fullCode}`);
    } catch (e: any) {
      setError(e.message || '互动码无效，请确认后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form action="/classroom" method="get" onSubmit={handleSubmit}
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '24px', position: 'relative', margin: 0,
      }}
    >
      {/* 服务状态 */}
      <div style={{ position: 'absolute', top: 20, right: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`status-dot ${serverOnline ? 'online' : 'offline'}`} />
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
          {serverOnline ? '服务在线' : '连接中...'}
        </span>
      </div>

      {/* 教师入口：<a> 标签不需要 JS，点击即跳转 */}
      <a href="/teacher"
        style={{
          position: 'absolute', bottom: 24, right: 24,
          background: 'rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(255,255,255,0.15)',
          padding: '6px 14px', borderRadius: 6, fontSize: 12,
          textDecoration: 'none',
        }}
      >
        教师入口
      </a>

      <div style={{ textAlign: 'center', maxWidth: 480, width: '100%' }}>
        <div style={{ marginBottom: 48 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', fontSize: 36, fontWeight: 700, color: 'white',
          }}>
            AI
          </div>
          <h1 style={{ color: 'white', fontSize: 28, fontWeight: 700, margin: 0 }}>
            AI互动课堂
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: 8, fontSize: 15 }}>
            请输入老师下发的4位互动码
          </p>
        </div>

        {/* 4 位码输入框：原生可见可交互，JS 不可用也能填写提交 */}
        <input ref={inputRef} name="code" type="tel" maxLength={4} required
          inputMode="numeric" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="输入4位互动码"
          style={{
            width: 280, height: 72, fontSize: 36, fontWeight: 700,
            letterSpacing: 8, textAlign: 'center',
            borderRadius: 12, border: '2px solid rgba(255,255,255,0.3)',
            background: 'rgba(255,255,255,0.15)', color: 'white',
            outline: 'none', caretColor: 'white',
            display: 'block', margin: '0 auto 24px',
          }}
        />

        {error && (
          <p style={{ color: '#fca5a5', fontSize: 14, marginBottom: 16 }}>{error}</p>
        )}

        {/* type="submit" 的 button，无 JS 时始终可点，由 <form action> 兜底提交 */}
        <button type="submit"
          disabled={hydrated && (code.length !== 4 || loading)}
          style={{
            background: 'white', color: '#667eea', fontWeight: 600, fontSize: 16,
            padding: '14px 40px', borderRadius: 12, border: 'none',
            opacity: hydrated && loading ? 0.7 : 1,
            cursor: 'pointer',
          }}
        >
          {loading ? '验证中...' : '进入课堂'}
        </button>
      </div>
    </form>
  );
}
