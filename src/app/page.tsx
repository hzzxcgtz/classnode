'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function StudentHomePage() {
  const router = useRouter();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);

  useEffect(() => {
    api.health().then(() => setServerOnline(true)).catch(() => setServerOnline(false));
    const timer = window.setTimeout(() => inputRefs.current[0]?.focus(), 500);
    return () => window.clearTimeout(timer);
  }, []);

  const fullCode = digits.join('');

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError('');
    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    // 输完第4位数字时自动提交
    if (digit && index === 3) {
      const code = newDigits.join('');
      if (code.length === 4) {
        setLoading(true);
        api.getClassroomByCode(code)
          .then(() => router.push(`/classroom?code=${code}`))
          .catch((error: unknown) => {
            setError(getErrorMessage(error, '互动码无效，请确认后重试'));
            setDigits(['', '', '', '']);
            inputRefs.current[0]?.focus();
          })
          .finally(() => setLoading(false));
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length === 4) {
      setDigits(pasted.split(''));
      setLoading(true);
      api.getClassroomByCode(pasted)
        .then(() => router.push(`/classroom?code=${pasted}`))
        .catch((error: unknown) => {
          setError(getErrorMessage(error, '互动码无效，请确认后重试'));
          setDigits(['', '', '', '']);
          inputRefs.current[0]?.focus();
        })
        .finally(() => setLoading(false));
      e.preventDefault();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (fullCode.length !== 4) {
      setError('请输入完整的4位互动码');
      return;
    }
    setLoading(true);
    try {
      await api.getClassroomByCode(fullCode);
      router.push(`/classroom?code=${fullCode}`);
    } catch (error: unknown) {
      setError(getErrorMessage(error, '互动码无效，请确认后重试'));
      setDigits(['', '', '', '']);
      inputRefs.current[0]?.focus();
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
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: "0.813rem" }}>
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
          padding: '6px 14px', borderRadius: 6, fontSize: "0.75rem",
          textDecoration: 'none',
        }}
      >
        教师入口
      </a>

      <div style={{ background: 'white', borderRadius: 20, padding: 40, maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          {logoErr ? (
            <div style={{ width: 96, height: 96, borderRadius: 20, margin: '0 auto 16px', background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: "2.25rem" }}>C</div>
          ) : (
            <img src="/logo.png" alt="ClassNode" style={{ width: 96, height: 96, borderRadius: 20, display: 'block', margin: '0 auto 16px' }} onError={() => setLogoErr(true)} />
          )}
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>
            AI互动课堂
          </h1>
          <p style={{ color: '#6b7280', fontSize: "0.875rem", marginTop: 6 }}>
            请输入老师下发的4位互动码
          </p>
        </div>

        {/* 4 位独立输入框 */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 24 }}>
          {digits.map((d, i) => (
            <input key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="tel" maxLength={1} required
              inputMode="numeric" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              value={d}
              onChange={e => handleDigitChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              style={{
                width: 64, height: 72, fontSize: "2rem", fontWeight: 700,
                textAlign: 'center', borderRadius: 12,
                border: `2px solid ${d ? '#667eea' : '#e2e8f0'}`,
                background: d ? 'rgba(102,126,234,0.06)' : '#f8fafc',
                color: '#0f172a', outline: 'none', caretColor: 'transparent',
                transition: 'all 0.15s',
              }}
              onFocus={e => {
                e.target.style.borderColor = '#667eea';
                e.target.style.background = 'rgba(102,126,234,0.06)';
              }}
              onBlur={e => {
                e.target.style.borderColor = d ? '#667eea' : '#e2e8f0';
                e.target.style.background = d ? 'rgba(102,126,234,0.06)' : '#f8fafc';
              }}
            />
          ))}
        </div>

        {error && (
          <p style={{ color: '#ef4444', fontSize: "0.875rem", marginBottom: 16, textAlign: 'center' }}>{error}</p>
        )}

        <button type="submit" className="btn btn-primary btn-lg"
          disabled={fullCode.length !== 4 || loading}
          style={{
            width: '100%', fontSize: "0.938rem",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '验证中...' : '进入课堂'}
        </button>
      </div>
    </form>
  );
}
