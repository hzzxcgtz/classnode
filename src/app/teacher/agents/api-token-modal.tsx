'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { PlatformTokenSummary } from '@/lib/types';
import { defaultExpiryDate, tokenExpiryView } from '@/lib/platform-token-expiry';

/**
 * ★ 2026-09-25：**共享 API Token 的管理弹窗**（spec §三①）。
 *
 * Coze 低代码的 Token 属于**扣子账号**、不属于 Bot —— 同一个号做出来的多个智能体
 * 从前各存一份，换一次要改 N 遍。这里维护若干份「某账号的 Token」，建/改智能体时选一份。
 *
 * ── 三条纪律（都写在界面上，不是只写在代码里）────────────────────────────
 *
 * 1. 🔴 **明文 Token 不回显。** 列表里给的是掩码（用来认「你填的是不是这个」）；
 *    编辑时 Token 那一格**留空 = 不改**，填了才替换。**绝不把掩码提交回去** ——
 *    那会把一份好凭据覆盖成掩码字符串的密文，而那个错误任何地方都不会报。
 *
 * 2. 🔴 **有智能体在用的凭据删不掉**，而且要说清是**哪几个**。
 *    服务端的删除守卫会给出名字（`routes/platform-tokens.ts`），这里原样展示。
 *
 * 3. 🔴 **改 Token 的值要提示影响面**：一份被 3 个智能体用着的凭据，改它就是同时改那 3 个
 *    的钥匙。提交前把这句话摆在按钮旁边。
 */
export function ApiTokenModal({ tokens, onRefresh, onClose, onError }: {
  tokens: PlatformTokenSummary[];
  /** 增删改之后让**页面**重新拉一次 —— 页面还拿着同一份列表画那条临期横幅。 */
  onRefresh: () => Promise<void> | void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  /** `null` = 不在编辑；`''` = 新建；其它 = 编辑那一份的 id。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => defaultExpiryDate(new Date()));
  const [busy, setBusy] = useState(false);
  /** 正在确认删除的那一份（两段式：先点「删除」，再点「确定」——不用 window.confirm）。 */
  const [confirming, setConfirming] = useState<string | null>(null);

  const startCreate = () => {
    setEditingId('');
    setLabel('');
    setToken('');
    setExpiresAt(defaultExpiryDate(new Date()));
  };
  const startEdit = (row: PlatformTokenSummary) => {
    setEditingId(row.id);
    setLabel(row.label);
    // ⚠️ **刻意留空**：掩码不是 Token。留空 = 不改（服务端那条 PUT 也是这么读的）。
    setToken('');
    setExpiresAt(row.expiresAt ? row.expiresAt.slice(0, 10) : '');
  };

  const submit = async () => {
    if (busy) return;
    if (label.trim() === '') { onError('请填写备注（这是谁的账号）'); return; }
    if (editingId === '' && token.trim() === '') { onError('请填写扣子访问令牌'); return; }
    setBusy(true);
    try {
      if (editingId === '') {
        await api.createPlatformToken({ label: label.trim(), token: token.trim(), expiresAt: expiresAt || null });
      } else {
        await api.updatePlatformToken(editingId!, {
          label: label.trim(),
          // ⚠️ 只在**填了**的时候才把 token 发出去：空着 = 这次不改它。
          ...(token.trim() ? { token: token.trim() } : {}),
          expiresAt: expiresAt || null,
        });
      }
      setEditingId(null);
      await onRefresh();
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: PlatformTokenSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      // 🔴 先查引用面：被用着时服务端会 400 并给出名字，这里原样展示那句话。
      //    直接在界面上拦是**第二道**（服务端那道才是权威）—— 但两道都必要：
      //    界面这道让教师不必先点一次才知道，服务端那道防并发与手改的库。
      await api.deletePlatformToken(row.id);
      setConfirming(null);
      await onRefresh();
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const editingRow = editingId && editingId !== '' ? tokens.find((t) => t.id === editingId) : null;

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    if (editingId !== null) dialogRef.current?.querySelector<HTMLInputElement>('#api-token-label')?.focus();
  }, [editingId]);

  return (
    <div className="modal-overlay api-token-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div ref={dialogRef} className="modal-content teacher-dialog api-token-dialog" role="dialog" aria-modal="true" aria-labelledby="api-token-title" onClick={event => event.stopPropagation()}>
        <header className="api-token-header">
          <div>
            <h3 id="api-token-title">扣子访问令牌</h3>
            <p>同一个扣子账号的智能体可共用一份令牌。保存后，接入智能体时直接选择。</p>
          </div>
          <button type="button" className="btn btn-secondary api-token-close" onClick={onClose} disabled={busy} aria-label="关闭令牌管理">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="api-token-body">
          <div className="api-token-list-heading">
            <strong>已保存的令牌 <span>{tokens.length}</span></strong>
            {editingId === null && <button type="button" className="btn btn-primary" onClick={startCreate} disabled={busy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              新建令牌
            </button>}
          </div>
          {tokens.length === 0 && <div className="api-token-empty">还没有扣子访问令牌</div>}
          <div className="api-token-list">
            {tokens.map(row => {
              const expiry = tokenExpiryView(row.expiresAt, new Date());
              return <div key={row.id} className="api-token-item">
                <div className="api-token-item-main">
                  <div className="api-token-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" /></svg>
                  </div>
                  <div className="api-token-item-copy">
                    <div className="api-token-item-title"><strong>{row.label}</strong><ExpiryChip level={expiry.level} text={expiry.text} /></div>
                    <div className="api-token-mask">{row.maskedToken}</div>
                    <div className="api-token-usage">{row.agentCount > 0 ? `${row.agentCount} 个智能体在用` : '尚未使用'}</div>
                  </div>
                  <div className="api-token-item-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => { setConfirming(null); startEdit(row); }} disabled={busy}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5" /></svg>编辑
                    </button>
                    <button type="button" className="btn btn-secondary api-token-delete" onClick={() => setConfirming(row.id)} disabled={busy}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>删除
                    </button>
                  </div>
                </div>
                {confirming === row.id && <div className="api-token-confirmation">
                  <span>确定删除这份令牌？</span>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>取消</button>
                  <button type="button" className="btn btn-danger" onClick={() => void remove(row)} disabled={busy}>{busy ? '处理中…' : '确定删除'}</button>
                </div>}
              </div>;
            })}
          </div>
          {editingId !== null && <form className="api-token-editor" onSubmit={event => { event.preventDefault(); void submit(); }}>
            <h4>{editingId === '' ? '新建令牌' : `编辑「${editingRow?.label ?? ''}」`}</h4>
            <label htmlFor="api-token-label">备注（这是谁的账号）</label>
            <input id="api-token-label" className="input" value={label} onChange={event => setLabel(event.target.value)} placeholder="例如：张老师的号" />
            <label htmlFor="api-token-value">个人访问令牌{editingId !== '' && <span>（留空沿用原令牌）</span>}</label>
            <input id="api-token-value" className="input" value={token} onChange={event => setToken(event.target.value)} placeholder={editingId === '' ? '在扣子平台获取，以 pat_ 开头' : '填写新令牌以替换原值'} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            <label htmlFor="api-token-expiry">有效期</label>
            <input id="api-token-expiry" type="date" className="input" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
            <p className="api-token-field-hint">按扣子平台显示的实际有效期填写。</p>
            {editingRow && editingRow.agentCount > 0 && token.trim() !== '' && <div className="api-token-impact">替换令牌会影响正在使用它的 <strong>{editingRow.agentCount} 个智能体</strong>。</div>}
            <div className="api-token-editor-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)} disabled={busy}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
            </div>
          </form>}
        </div>
        {editingId === null && <footer className="api-token-footer"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>关闭</button></footer>}
      </div>
    </div>
  );
}

/**
 * 倒计时那一枚小标签。
 *
 * ⚠️ `none`（未设置有效期）**必须有自己的样子**（灰 + 「未设置有效期」），
 * 不能退化成「还剩 0 天」那种红 —— 后者会让教师以为今天就到期，
 * 而事实是我们根本不知道（有效期是**教师手工填的**，扣子没有查询 API）。
 */
export function ExpiryChip({ level, text }: { level: ReturnType<typeof tokenExpiryView>['level']; text: string }) {
  const tone = {
    none: { bg: '#f1f5f9', fg: '#64748b', border: '#e2e8f0' },
    ok: { bg: '#e8eef5', fg: '#475569', border: '#cdd5e0' },
    soon: { bg: '#faf4eb', fg: '#b45309', border: '#fde68a' },
    urgent: { bg: '#f8eeee', fg: '#b91c1c', border: '#fecaca' },
    expired: { bg: '#f8eeee', fg: '#b91c1c', border: '#fecaca' },
  }[level];
  return (
    <span style={{ fontSize: "0.75rem", fontWeight: 600, padding: '1px 7px', borderRadius: 6, background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}
