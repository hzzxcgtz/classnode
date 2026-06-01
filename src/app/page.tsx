'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function StudentHomePage() {
  const router = useRouter();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    api.health().then(() => setServerOnline(true)).catch(() => setServerOnline(false));
    setTimeout(() => inputRefs.current[0]?.focus(), 500);
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
          .catch((e: any) => {
            setError(e.message || '互动码无效，请确认后重试');
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
        .catch((e: any) => {
          setError(e.message || '互动码无效，请确认后重试');
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
    } catch (e: any) {
      setError(e.message || '互动码无效，请确认后重试');
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
          <img src="/logo.png" alt="ClassNode"
            style={{ width: 72, height: 72, borderRadius: 16, display: 'block', margin: '0 auto 20px' }}
          />
          <h1 style={{ color: 'white', fontSize: 28, fontWeight: 700, margin: 0 }}>
            AI互动课堂
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: 8, fontSize: 15 }}>
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
                width: 64, height: 72, fontSize: 32, fontWeight: 700,
                textAlign: 'center', borderRadius: 12,
                border: '2px solid rgba(255,255,255,0.3)',
                background: d ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
                color: 'white', outline: 'none', caretColor: 'transparent',
                transition: 'all 0.15s',
              }}
              onFocus={e => {
                e.target.style.borderColor = 'white';
                e.target.style.background = 'rgba(255,255,255,0.3)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'rgba(255,255,255,0.3)';
                e.target.style.background = d ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)';
              }}
            />
          ))}
        </div>

        {error && (
          <p style={{ color: '#fca5a5', fontSize: 14, marginBottom: 16 }}>{error}</p>
        )}

        <button type="submit"
          disabled={hydrated && (fullCode.length !== 4 || loading)}
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
