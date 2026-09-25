'use client';

/**
 * ★ M7a：分析载荷的预览浮层。
 *
 * 🔴 **层级 270**（用户 2026-09-25 裁定 2）：在 `MatrixOverlay` 的 250 **之上**、
 * 学习单抽屉的 290/291 **之下**，给以后可能的插队留出 250–270 与 270–290 两段。
 * ⚠️ 这是**教师端**的浮层，**不要**去复用学生端外壳的 `layer-overlays` 机制 ——
 * 那条「非前台层的浮层不得浮在上面」的不变量属于学生端的三层结构，与这里无关。
 *
 * 🔴 **本版零外发**：底部那个「发给 AI 分析」按钮**是禁用的**，并且旁边逐字写着
 * 「尚未接入第三方 AI」。它存在的意义是让那道缝看得见、且只有**一处**
 * （将来接上时只改那一个调用点，合规审查才只看一处）。
 *
 * ⚠️ 本机**看不见界面** ⇒ 这个文件没有任何回归网。所以这里**不写判断**：
 * 单位来自 `moduleCountUnit`（纯函数、有用例），新鲜度来自服务端的 `stale`，
 * 形态来自服务端的 `payloadKind`。这个文件只负责画。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { moduleCountUnit } from './worksheet-tile-state';

export function AnalysisOverlay({
  classroomId,
  worksheetId,
  questionId,
  mode,
  onClose,
}: {
  /** 🔴 必填：同一份学习单可以被多个课堂引用，服务端不许猜（猜错就把别的班的数据给这个班看）。 */
  classroomId: string;
  worksheetId: string;
  questionId: string;
  /** 课堂 mode —— **只**用来定「已交 N/M」的单位（分组 / 高级模式下是「组」）。 */
  mode: string;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<WorksheetAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 打开时先读已存的（不重算）；没算过则算一次。 */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        setPayload(await api.getWorksheetAnalysis(classroomId, worksheetId, questionId));
      } catch {
        // 还没算过（404）⇒ 由「打开即算」承接。其他错误由第二次调用抛出并显示。
        setPayload(await api.computeWorksheetAnalysis(classroomId, worksheetId, questionId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取分析失败');
    } finally {
      setLoading(false);
    }
  }, [classroomId, worksheetId, questionId]);

  useEffect(() => { void load(); }, [load]);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      setPayload(await api.computeWorksheetAnalysis(classroomId, worksheetId, questionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const unit = moduleCountUnit(mode);
  const sheets = payload?.sheetLayouts ?? [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 270, background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: '1px solid #e2e8f0', background: '#fff', flex: '0 0 auto',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
            {payload ? `${payload.questionLabel} · ${payload.typeLabel}` : '分析载荷'}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {payload ? payload.prompt || '（题干为空）' : '正在读取…'}
          </div>
        </div>
        {/* 🔴 分母必须显眼：载荷只覆盖一部分人，而一份没有分母的名单会被读成「全班就这些人」。 */}
        {payload && (
          <div style={{ fontSize: '0.85rem', color: '#0f172a', whiteSpace: 'nowrap' }}>
            已交 <b>{payload.covered}</b>/{payload.total} {unit}
          </div>
        )}
        <button type="button" onClick={onClose}
          style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', color: '#334155' }}>
          关闭
        </button>
      </div>

      {/* 「算完之后又有人交了」—— 服务端算的，必须显眼。否则教师会把一份不完整的名单当成当前的。 */}
      {payload?.stale && (
        <div style={{ padding: '8px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: '0.82rem', flex: '0 0 auto' }}>
          ⚠️ 有新的作答，结果可能已过期 —— 点「重新生成」以纳入。
        </div>
      )}
      {error && (
        <div role="alert" style={{ padding: '8px 18px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', color: '#b91c1c', fontSize: '0.82rem', flex: '0 0 auto' }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {loading && <div style={{ color: '#64748b' }}>正在读取…</div>}

        {!loading && payload && payload.covered === 0 && (
          // 零份已提交是教师最可能踩的一步（全班还没交就点开了）——说清楚，别给一张空图。
          <div style={{ color: '#64748b' }}>这道题还没有已提交的作答。</div>
        )}

        {!loading && payload && payload.payloadKind === 'mixed' && (
          <div style={{ marginBottom: 12, color: '#92400e', fontSize: '0.82rem' }}>
            ⚠️ 本题有两种作答方式（部分文字、部分笔迹）—— 下面文档与联系表各是一部分。
          </div>
        )}

        {!loading && payload?.text !== null && payload?.text !== undefined && payload.text !== '' && (
          <pre style={{
            margin: '0 0 18px', padding: 14, background: '#fff', border: '1px solid #e2e8f0',
            borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: '0.85rem', lineHeight: 1.7, color: '#0f172a', fontFamily: 'inherit',
          }}>{payload.text}</pre>
        )}

        {!loading && payload && sheets.length > 0 && (
          <>
            {payload.labeled === false && (
              // 缺 fontconfig 时图上**没有**标签 —— 必须说清，并给出编号对照，否则认不出哪格是谁。
              <div style={{ marginBottom: 10, color: '#92400e', fontSize: '0.82rem' }}>
                ⚠️ 这张图上**没有标签**（本机渲染不出文字）—— 请按下面的编号对照表：
              </div>
            )}
            {sheets.map((sheet) => (
              <div key={sheet.sheetIndex} style={{ marginBottom: 16 }}>
                {sheets.length > 1 && (
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>
                    第 {sheet.sheetIndex + 1} 张 / 共 {sheets.length} 张
                  </div>
                )}
                <img
                  src={api.worksheetAnalysisSheetUrl(classroomId, worksheetId, questionId, sheet.sheetIndex)}
                  alt={`第 ${payload.questionLabel} 的联系表（第 ${sheet.sheetIndex + 1} 张）`}
                  style={{ maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}
                />
              </div>
            ))}
            {payload.labeled === false && (
              <ol style={{ margin: '0 0 18px', paddingLeft: 22, fontSize: '0.82rem', color: '#334155' }}>
                {payload.entries.map((entry) => (
                  <li key={entry.studentId}>{entry.anonLabel} · 第 {payload.entries.indexOf(entry) + 1} 格</li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderTop: '1px solid #e2e8f0', background: '#fff', flex: '0 0 auto',
      }}>
        {/* 本版零外发：唯一会重算的动作是「重新生成」（重渲 + 重新聚合，全在本机）。 */}
        <button type="button" onClick={regenerate} disabled={busy}
          style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10, padding: '8px 16px', cursor: busy ? 'default' : 'pointer', color: '#334155', opacity: busy ? 0.5 : 1 }}>
          {busy ? '生成中…' : '重新生成'}
        </button>
        <button type="button" disabled
          style={{ border: '1px solid #e2e8f0', background: '#f1f5f9', borderRadius: 10, padding: '8px 16px', cursor: 'not-allowed', color: '#94a3b8' }}>
          发给 AI 分析
        </button>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
          尚未接入第三方 AI（本版不外发任何数据）
        </span>
      </div>
    </div>
  );
}
