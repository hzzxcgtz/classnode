'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { FieldError, Toast } from '@/lib/components';
import type { WebappSummary, WebappUploadResult } from '@/lib/types';
import { WebappExternalDepsNotice, WebappMissingRefsNotice } from './webapp-overlays';

type UploadMode = 'html' | 'archive';

/**
 * 上传 / 编辑探究网页。
 *
 * ★ 2026-09-26（教师截图批注）：入口从「ZIP 为主推、多选为辅」改成**两栏** ——
 * 左栏**单个 HTML 文件**（默认、推荐，教师用得最多），右栏**压缩包**（zip / rar / 7z）。
 * 「多选文件」那条路**整条删掉**（教师原话：「为了避免出错，**不允许使用多选文件来上传**，
 * 只允许压缩包」）。
 *
 * 🔴 多选为什么被删、压缩包为什么保留目录结构 —— 是**同一条事实**：浏览器在选择多个文件时
 * **不提供** `webkitRelativePath`（那需要 `webkitdirectory`，而它只给目录、不给混选），
 * multer 那边也不暴露 ⇒ 多选 `index.html + app.js + style.css` 时三个文件都落在根目录。
 * 凡是 `css/`、`js/` 子目录里放资源的网页（绝大多数），多选上传的结果是
 * **「上传成功但样式全没了」**，而服务端无从知道它们原本在哪。压缩包没有这个问题
 * （解压后目录结构原样保留）。
 *
 * ⚠️ 单 HTML 那条路不涉及解压，但它有**另一个**静默失败：引用了同目录 / 子目录的
 * css / js，而那些文件不在这次上传里 ⇒ 同样是「上传成功、打开没样式」。
 * 那条由上传后的 `WebappMissingRefsNotice` 接住（服务端扫，**不阻断上传**）。
 */
export function WebappForm({ webapp, onClose, onSaved }: { webapp: WebappSummary | null; onClose: () => void; onSaved: () => void }) {
  const editing = webapp !== null;
  const [name, setName] = useState(webapp?.name ?? '');
  const [mode, setMode] = useState<UploadMode>('html');   // ★ 教师定的：左栏默认
  const [page, setPage] = useState<File | null>(null);    // 单 HTML
  const [archive, setArchive] = useState<File | null>(null);
  const [entryHint, setEntryHint] = useState('');
  const [entryPath, setEntryPath] = useState(webapp?.entryPath ?? '');
  const [entries, setEntries] = useState<string[]>([]);
  const [entriesError, setEntriesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [deps, setDeps] = useState<{ count: number; files: string[] } | null>(null);
  /** 上传成功后停在弹窗里展示外部依赖提醒用的；非 null 时表单主体换成结果面板。 */
  const [created, setCreated] = useState<WebappUploadResult | null>(null);
  const savingRef = useRef(false);

  // 改入口要能看到「包里有哪些 HTML 可选」。拉不到就退化成只读展示（不阻断改名）。
  useEffect(() => {
    if (!editing || !webapp) return;
    let cancelled = false;
    api.getWebappEntries(webapp.id)
      .then(result => { if (!cancelled) setEntries(result.entries); })
      .catch(error => { if (!cancelled) setEntriesError(error instanceof Error ? error.message : '入口列表加载失败'); });
    return () => { cancelled = true; };
  }, [editing, webapp]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const clearError = (field: string) => setFieldErrors(prev => {
    const next = { ...prev };
    delete next[field];
    return next;
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = '请输入网页名称';
    if (!editing) {
    if (mode === 'html' && !page) errors.file = '请选择网页文件（.html）';
    if (mode === 'archive' && !archive) errors.file = '请选择网页压缩包（ZIP / RAR / 7Z）';
    }
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }

    savingRef.current = true;
    setSaving(true);
    try {
      if (editing && webapp) {
        const payload: { name?: string; entryPath?: string } = {};
        if (name.trim() !== webapp.name) payload.name = name.trim();
        if (entryPath && entryPath !== webapp.entryPath) payload.entryPath = entryPath;
        if (Object.keys(payload).length === 0) { onSaved(); return; }
        await api.updateWebapp(webapp.id, payload);
        onSaved();
      } else {
        const form = new FormData();
        form.append('name', name.trim());
        if (mode === 'html' && page) form.append('page', page);
        if (mode === 'archive' && archive) form.append('archive', archive);
        if (entryHint.trim()) form.append('entryHint', entryHint.trim());
        const created = await api.createWebapp(form);
        // 先刷新列表（`onSaved` 只做刷新，不关窗），再决定要不要留在本弹窗里。
        onSaved();
        // ⚠️ **有外部依赖时留在弹窗里**：`WebappExternalDepsNotice` 是教师唯一一次能看到
        // 「这个网页依赖 N 个外部资源」的机会，而它恰恰是「课堂网络连不上外网就白屏」
        // 这类问题的唯一线索。上传成功就静默关窗，等于把这条提醒做成了装饰。
        // 🔴 **两条提醒任一命中都要留下来。** 只判 `externalDeps` 的话，「单个 HTML 引用了
        // 同目录的 style.css、且没有任何外链」这种最常见的情形会**直接关窗** ——
        // 而那恰恰是缺失引用告警存在的理由。两条提醒是两个不同的问题（见 missingRefs 的类型注释）。
        if (created.externalDeps.count > 0 || created.missingRefs.count > 0) {
          setCreated(created);
          setDeps(created.externalDeps);
        } else {
          onClose();
        }
      }
    } catch (error: unknown) {
      setToast({ msg: error instanceof Error ? error.message : '保存失败', type: 'error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const archiveName = archive?.name ?? '';

  return (
    <div className="modal-overlay">
      <div className="modal-content teacher-dialog teacher-form-dialog webapp-form-modal" role="dialog" aria-modal="true" aria-labelledby="webapp-form-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, padding: 0, borderRadius: 14 }}>
        <div style={{ padding: '16px 24px 0', background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '1px solid var(--border)', position: 'relative' }}>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭网页表单" style={{ position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
          <h2 id="webapp-form-title" style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 2px' }}>{created ? '上传成功' : editing ? '编辑探究网页' : '添加探究网页'}</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            {created ? `「${created.name}」已经可以用在课堂里了。` : editing ? '可以改显示名称，也可以改指包里的另一个 HTML 作为入口。' : '上传一个静态网页，课堂上学生就能打开它。'}
          </p>
        </div>

        {created ? (
          <div style={{ padding: '18px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '12px 14px', fontSize: '0.813rem', color: '#065f46' }}>
              入口是 <strong>{created.entryPath}</strong>。创建课堂时可以在「关联探究网页」里勾选它。
            </div>
            {deps && <WebappExternalDepsNotice deps={deps} />}
            {created.missingRefs && <WebappMissingRefsNotice refs={created.missingRefs} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={onClose} style={{ fontSize: '0.813rem', padding: '7px 20px' }}>完成</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ padding: '18px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="webapp-name" style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>网页名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input id="webapp-name" className="input" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="如：太阳系模拟实验"
              style={{ fontSize: '0.813rem', padding: '8px 12px', borderColor: fieldErrors.name ? '#a85d5d' : undefined }} />
            {fieldErrors.name && <FieldError message={fieldErrors.name} />}
          </div>

          {editing && webapp ? (
            <div>
              <label htmlFor="webapp-entry" style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>入口页面</label>
              {entries.length > 0 ? (
                <select id="webapp-entry" className="input" value={entryPath} onChange={e => setEntryPath(e.target.value)} style={{ fontSize: '0.813rem', padding: '8px 12px' }}>
                  {entries.map(entry => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              ) : (
                <input id="webapp-entry" className="input" value={entryPath} onChange={e => setEntryPath(e.target.value)} style={{ fontSize: '0.813rem', padding: '8px 12px' }} />
              )}
              <div style={{ fontSize: '0.688rem', color: '#94a3b8', marginTop: 4 }}>
                {entriesError
                  ? `${entriesError}（可以先按原入口保存）`
                  : entries.length > 0
                    ? `这个网页包里有 ${entries.length} 个 HTML，选哪个作为学生打开时的首页。`
                    : '这个网页包里没有可选的 HTML。'}
              </div>
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 6 }}>网页文件 <span style={{ color: 'var(--danger)' }}>*</span></div>
                <div role="radiogroup" aria-label="上传方式" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
{([['html', '单个 HTML 文件（推荐）'], ['archive', '上传压缩包']] as Array<[UploadMode, string]>).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => { setMode(value); clearError('file'); }}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: '0.813rem', fontWeight: mode === value ? 600 : 400, border: `1.5px solid ${mode === value ? 'var(--primary)' : '#e2e8f0'}`, background: mode === value ? 'var(--primary-tint)' : 'white', color: mode === value ? 'var(--primary-dark)' : '#475569' }}>
                      {label}
                    </button>
                  ))}
                </div>

{mode === 'html' ? (
  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 14px' }}>
    <div style={{ fontSize: '0.75rem', color: '#0c4a6e', lineHeight: 1.7, marginBottom: 8 }}>
      <strong>适合把 CSS / JS 都写在这一个文件里的网页。</strong>
      网页里有子目录（<code>css/</code>、<code>js/</code>、<code>images/</code>）的，请改用压缩包 ——
      单个 HTML 带不走那些文件。
    </div>
    <input type="file" accept=".html,.htm" aria-label="选择网页文件"
      onChange={e => { setPage(e.target.files?.[0] ?? null); clearError('file'); }}
      style={{ fontSize: '0.75rem' }} />
    {page && <div style={{ fontSize: '0.688rem', color: '#0369a1', marginTop: 6 }}>已选择：{page.name}</div>}
  </div>
) : (
  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 14px' }}>
    <div style={{ fontSize: '0.75rem', color: '#0c4a6e', lineHeight: 1.7, marginBottom: 8 }}>
      <strong>支持 ZIP / RAR / 7Z。</strong>压缩包解压后目录结构会原样保留，
      网页里的 <code>css/</code>、<code>js/</code>、<code>images/</code> 子目录都能正常加载。
      {/* ⚠️ 这一句从前写的是「请把网页文件夹压成 ZIP 再上传」—— 它会把教师往 zip 上引，
          而这次恰恰是要放开三种。 */}
    </div>
    <input type="file" accept=".zip,.rar,.7z" aria-label="选择网页压缩包"
      onChange={e => { setArchive(e.target.files?.[0] ?? null); clearError('file'); }}
      style={{ fontSize: '0.75rem' }} />
    {archiveName && <div style={{ fontSize: '0.688rem', color: '#0369a1', marginTop: 6 }}>已选择：{archiveName}</div>}
  </div>
)}
                {fieldErrors.file && <FieldError message={fieldErrors.file} />}
              </div>

              {/* ⚠️ **只在压缩包模式渲染。** 单 HTML 包里只有一个文件，服务端直接取它当入口 ——
                  留着这个框只是给教师一个填错的机会。 */}
              {mode === 'archive' && (
                <div>
                  <label htmlFor="webapp-entry-hint" style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>入口文件（选填）</label>
                  <input id="webapp-entry-hint" className="input" value={entryHint} onChange={e => setEntryHint(e.target.value)} placeholder="如 index.html；留空则自动找 index.html"
                    style={{ fontSize: '0.813rem', padding: '8px 12px' }} />
                </div>
              )}
            </>
          )}

          {fieldErrors.submit && <div role="alert" style={{ fontSize: '0.75rem', color: '#a85d5d' }}>{fieldErrors.submit}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving} style={{ fontSize: '0.813rem', padding: '7px 18px' }}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: '0.813rem', padding: '7px 20px' }}>
              {saving ? '保存中...' : editing ? '保存修改' : '上传网页'}
            </button>
          </div>
        </form>
        )}
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
