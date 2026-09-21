'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { FieldError, Toast } from '@/lib/components';
import type { WebappSummary } from '@/lib/types';
import { WebappExternalDepsNotice } from './webapp-overlays';

type UploadMode = 'archive' | 'files';

/**
 * 上传 / 编辑探究网页。
 *
 * ⚠️ **文案把教师往 ZIP 上引，这不是偏好而是正确性**：浏览器在选择多个文件时
 * **不提供** `webkitRelativePath`（那需要 `webkitdirectory`，而它只给目录、不给混选），
 * multer 那边也不暴露 —— 也就是说多选 `index.html + app.js + style.css` 时，
 * 三个文件都落在根目录。凡是 `css/`、`js/` 子目录里放资源的网页（绝大多数），
 * 多选上传的结果是**「上传成功但样式全没了」**：服务端无从知道它们原本在哪，
 * 教师也没有任何提示。
 *
 * 所以两种入口都留着（只有一个 HTML 的极简网页用多选更省事），但 ZIP 是主推，
 * 多选那条带一句说得具体的警告。
 */
export function WebappForm({ webapp, onClose, onSaved }: { webapp: WebappSummary | null; onClose: () => void; onSaved: () => void }) {
  const editing = webapp !== null;
  const [name, setName] = useState(webapp?.name ?? '');
  const [mode, setMode] = useState<UploadMode>('archive');
  const [archive, setArchive] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [entryHint, setEntryHint] = useState('');
  const [entryPath, setEntryPath] = useState(webapp?.entryPath ?? '');
  const [entries, setEntries] = useState<string[]>([]);
  const [entriesError, setEntriesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [deps, setDeps] = useState<{ count: number; files: string[] } | null>(null);
  /** 上传成功后停在弹窗里展示外部依赖提醒用的；非 null 时表单主体换成结果面板。 */
  const [created, setCreated] = useState<WebappSummary | null>(null);
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
      if (mode === 'archive' && !archive) errors.archive = '请选择网页压缩包（.zip）';
      if (mode === 'files' && files.length === 0) errors.archive = '请选择网页文件';
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
        if (mode === 'archive' && archive) form.append('archive', archive);
        if (mode === 'files') for (const file of files) form.append('files', file);
        if (entryHint.trim()) form.append('entryHint', entryHint.trim());
        const created = await api.createWebapp(form);
        // 先刷新列表（`onSaved` 只做刷新，不关窗），再决定要不要留在本弹窗里。
        onSaved();
        // ⚠️ **有外部依赖时留在弹窗里**：`WebappExternalDepsNotice` 是教师唯一一次能看到
        // 「这个网页依赖 N 个外部资源」的机会，而它恰恰是「课堂网络连不上外网就白屏」
        // 这类问题的唯一线索。上传成功就静默关窗，等于把这条提醒做成了装饰。
        if (created.externalDeps.count > 0) {
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
  const filesSummary = files.length === 0 ? '' : files.map(f => f.name).join('、');

  return (
    <div className="modal-overlay">
      <div className="modal-content webapp-form-modal" role="dialog" aria-modal="true" aria-labelledby="webapp-form-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, padding: 0, borderRadius: 14 }}>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={onClose} style={{ fontSize: '0.813rem', padding: '7px 20px' }}>完成</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ padding: '18px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="webapp-name" style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>网页名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input id="webapp-name" className="input" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="如：太阳系模拟实验"
              style={{ fontSize: '0.813rem', padding: '8px 12px', borderColor: fieldErrors.name ? '#ef4444' : undefined }} />
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
                  {([['archive', '上传 ZIP 压缩包（推荐）'], ['files', '多选文件']] as Array<[UploadMode, string]>).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => { setMode(value); clearError('archive'); }}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: '0.813rem', fontWeight: mode === value ? 600 : 400, border: `1.5px solid ${mode === value ? '#2563eb' : '#e2e8f0'}`, background: mode === value ? '#eef2ff' : 'white', color: mode === value ? '#1d4ed8' : '#475569' }}>
                      {label}
                    </button>
                  ))}
                </div>

                {mode === 'archive' ? (
                  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#0c4a6e', lineHeight: 1.7, marginBottom: 8 }}>
                      <strong>请把网页文件夹压成 ZIP 再上传。</strong>压缩包解压后目录结构会原样保留，
                      网页里的 <code>css/</code>、<code>js/</code>、<code>images/</code> 子目录都能正常加载。
                    </div>
                    <input type="file" accept=".zip,application/zip" aria-label="选择网页压缩包"
                      onChange={e => { setArchive(e.target.files?.[0] ?? null); clearError('archive'); }}
                      style={{ fontSize: '0.75rem' }} />
                    {archiveName && <div style={{ fontSize: '0.688rem', color: '#0369a1', marginTop: 6 }}>已选择：{archiveName}</div>}
                  </div>
                ) : (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#92400e', lineHeight: 1.7, marginBottom: 8 }}>
                      <strong>⚠️ 多选文件只能选到文件，选不到文件夹。</strong>所有文件都会被放进同一层目录，
                      网页原本的 <code>css/</code>、<code>js/</code> 结构会丢失 —— 结果是
                      <strong>上传成功、但样式和脚本全都没了</strong>。只要网页里有子目录（绝大多数网页都有），请改用 ZIP。
                    </div>
                    <input type="file" multiple aria-label="选择网页文件"
                      onChange={e => { setFiles(Array.from(e.target.files ?? [])); clearError('archive'); }}
                      style={{ fontSize: '0.75rem' }} />
                    {filesSummary && <div style={{ fontSize: '0.688rem', color: '#b45309', marginTop: 6, wordBreak: 'break-all' }}>已选择 {files.length} 个：{filesSummary}</div>}
                  </div>
                )}
                {fieldErrors.archive && <FieldError message={fieldErrors.archive} />}
              </div>

              <div>
                <label htmlFor="webapp-entry-hint" style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: 4, display: 'block' }}>入口文件（选填）</label>
                <input id="webapp-entry-hint" className="input" value={entryHint} onChange={e => setEntryHint(e.target.value)} placeholder="如 index.html；留空则自动找 index.html"
                  style={{ fontSize: '0.813rem', padding: '8px 12px' }} />
              </div>
            </>
          )}

          {fieldErrors.submit && <div role="alert" style={{ fontSize: '0.75rem', color: '#ef4444' }}>{fieldErrors.submit}</div>}

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
