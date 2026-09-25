'use client';

import { useState } from 'react';
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
    if (editingId === '' && token.trim() === '') { onError('请填写 API Token'); return; }
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

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="api-token-title"
        style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 24, width: 560, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

        <h3 id="api-token-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px' }}>API Token</h3>
        <p style={{ fontSize: '0.813rem', color: '#64748b', margin: '0 0 16px', lineHeight: 1.7 }}>
          Coze 低代码的 Token 属于<strong>扣子账号</strong>，同一个号做出来的智能体共用一份。
          在这里存好，接入智能体时直接选。
        </p>

        {tokens.length === 0 && editingId === null && (
          <div style={{ padding: '18px 16px', background: '#f8fafc', borderRadius: 10, fontSize: '0.813rem', color: '#94a3b8', textAlign: 'center', marginBottom: 14 }}>
            还没有 API Token
          </div>
        )}

        {tokens.map((row) => {
          const expiry = tokenExpiryView(row.expiresAt, new Date());
          return (
            <div key={row.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: '0.875rem', wordBreak: 'break-all' }}>{row.label}</span>
                <ExpiryChip level={expiry.level} text={expiry.text} />
                {row.agentCount > 0 && (
                  <span style={{ fontSize: '0.688rem', color: '#64748b' }}>{row.agentCount} 个智能体在用</span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => startEdit(row)}>改</button>
                  {confirming === row.id ? (
                    <>
                      <button type="button" className="btn btn-secondary" disabled={busy}
                        style={{ fontSize: '0.75rem', padding: '3px 10px', color: '#ef4444', borderColor: '#fecaca' }}
                        onClick={() => void remove(row)}>{busy ? '处理中…' : '确定删除'}</button>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => setConfirming(null)}>取消</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '3px 10px', color: '#ef4444' }}
                      onClick={() => setConfirming(row.id)}>删</button>
                  )}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {row.maskedToken}
              </div>
            </div>
          );
        })}

        {editingId === null ? (
          <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: 4 }} onClick={startCreate}>
            + 新建一份
          </button>
        ) : (
          <div style={{ border: '1px solid #c7d2fe', background: '#f8faff', borderRadius: 10, padding: 14, marginTop: 4 }}>
            <div style={{ fontSize: '0.813rem', fontWeight: 600, marginBottom: 10 }}>
              {editingId === '' ? '新建一份' : `修改「${editingRow?.label ?? ''}」`}
            </div>

            <label style={{ display: 'block', fontSize: '0.75rem', color: '#475569', marginBottom: 4 }}>备注（这是谁的账号）</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="例如：张老师的号" style={{ fontSize: '0.813rem', marginBottom: 10 }} />

            <label style={{ display: 'block', fontSize: '0.75rem', color: '#475569', marginBottom: 4 }}>
              API Token {editingId !== '' && <span style={{ color: '#94a3b8' }}>（留空 = 不改）</span>}
            </label>
            <input className="input" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={editingId === '' ? '在扣子平台获取' : '留空则沿用原来的'}
              style={{ fontSize: '0.813rem', marginBottom: 10, fontFamily: 'monospace' }} autoComplete="off" />

            <label style={{ display: 'block', fontSize: '0.75rem', color: '#475569', marginBottom: 4 }}>
              有效期 <span style={{ color: '#94a3b8' }}>（扣子目前最长 30 天；默认已填好，按实际改）</span>
            </label>
            <input type="date" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              style={{ fontSize: '0.813rem', marginBottom: 12 }} />

            {/* 🔴 影响面提示：一份被多个智能体用着的凭据，改它就是同时改那几个的钥匙。 */}
            {editingRow && editingRow.agentCount > 0 && token.trim() !== '' && (
              <div style={{ fontSize: '0.75rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.6 }}>
                改这个 Token 会同时影响 <strong>{editingRow.agentCount} 个</strong>正在用它的智能体。
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)} disabled={busy}>取消</button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </>
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
    ok: { bg: '#f8fafc', fg: '#94a3b8', border: '#e2e8f0' },
    soon: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
    urgent: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
    expired: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  }[level];
  return (
    <span style={{ fontSize: '0.688rem', fontWeight: 600, padding: '1px 7px', borderRadius: 6, background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}
