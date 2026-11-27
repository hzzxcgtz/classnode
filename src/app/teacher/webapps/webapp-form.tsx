'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { WEBAPP_IFRAME_SANDBOX } from '@/lib/webapp-sandbox';
import { externalWebappHref } from '@/lib/external-webapp';
import { FieldError, Toast } from '@/lib/components';
import type { WebappSummary, WebappUploadResult } from '@/lib/types';
import { WebappExternalDepsNotice, WebappMissingRefsNotice } from './webapp-overlays';

import styles from './webapp-form.module.css';

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
  const [replacing, setReplacing] = useState(false);
  const [name, setName] = useState(webapp?.name ?? '');
  const [source, setSource] = useState<'upload' | 'external'>(webapp?.externalUrl ? 'external' : 'upload');
  const external = source === 'external';
  const [externalUrl, setExternalUrl] = useState(webapp?.externalUrl ?? '');
  const validUrl = externalWebappHref(externalUrl);
  const [externalMode, setExternalMode] = useState(webapp?.externalMode === 'camera' ? 'embed' : webapp?.externalMode ?? 'link');
  const [cameraEnabled, setCameraEnabled] = useState(webapp?.cameraEnabled ?? webapp?.externalMode === 'camera');
  const [microphoneEnabled, setMicrophoneEnabled] = useState(webapp?.microphoneEnabled ?? false);
  const [previewUrl, setPreviewUrl] = useState('');
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
    if (!editing || !webapp || webapp.externalUrl) return;
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
    if (external) {
      if (!validUrl) errors.externalUrl = '请输入有效的 HTTPS 发布链接，网址中不能包含用户名或密码';
    } else if (!editing || replacing) {
      if (mode === 'html' && !page) errors.file = '请选择网页文件（.html）';
      if (mode === 'archive' && !archive) errors.file = '请选择网页压缩包（ZIP / RAR / 7Z）';
    }
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }

    savingRef.current = true;
    setSaving(true);
    try {
      if (external && validUrl) {
        const payload = { name: name.trim(), externalUrl: validUrl, externalMode,
          cameraEnabled: externalMode === 'embed' && cameraEnabled,
          microphoneEnabled: externalMode === 'embed' && microphoneEnabled };
        if (webapp) await api.updateWebapp(webapp.id, payload);
        else await api.createExternalWebapp(payload);
        onSaved();
        onClose();
      } else if (webapp && !replacing) {
        const payload: { name?: string; entryPath?: string; cameraEnabled?: boolean; microphoneEnabled?: boolean } = {};
        if (name.trim() !== webapp.name) payload.name = name.trim();
        if (entryPath && entryPath !== webapp.entryPath) payload.entryPath = entryPath;
        if (cameraEnabled !== (webapp.cameraEnabled ?? false)) payload.cameraEnabled = cameraEnabled;
        if (microphoneEnabled !== (webapp.microphoneEnabled ?? false)) payload.microphoneEnabled = microphoneEnabled;
        if (Object.keys(payload).length === 0) { onSaved(); return; }
        await api.updateWebapp(webapp.id, payload);
        onSaved();
        onClose();
      } else {
        const form = new FormData();
        form.append('name', name.trim());
        if (mode === 'html' && page) form.append('page', page);
        if (mode === 'archive' && archive) form.append('archive', archive);
        if (entryHint.trim()) form.append('entryHint', entryHint.trim());
        if (!webapp) {
          form.append('cameraEnabled', String(cameraEnabled));
          form.append('microphoneEnabled', String(microphoneEnabled));
        }
        const created = webapp ? await api.replaceWebapp(webapp.id, form) : await api.createWebapp(form);
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

  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectFile = (files: File[]) => {
    if (savingRef.current) return;
    if (files.length !== 1) { setFieldErrors(prev => ({ ...prev, file: '请一次选择一个 HTML 文件或网页压缩包' })); return; }
    const file = files[0];
    const nextMode = /\.html?$/i.test(file.name) ? 'html' : /\.(zip|rar|7z)$/i.test(file.name) ? 'archive' : null;
    if (!nextMode) { setFieldErrors(prev => ({ ...prev, file: '支持 HTML、HTM、ZIP、RAR、7Z 文件' })); return; }
    setMode(nextMode);
    if (nextMode === 'html') { setPage(file); setArchive(null); } else { setArchive(file); setPage(null); }
    clearError('file');
  };
  const selectedFile = mode === 'html' ? page : archive;

  return (
    <div className="modal-overlay">
      <div className="modal-content teacher-dialog teacher-form-dialog webapp-form-modal" role="dialog" aria-modal="true" aria-labelledby="webapp-form-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, padding: 0, borderRadius: 14 }}>
        <div style={{ padding: '22px 24px 4px', background: '#f5f8fc', borderBottom: '1px solid var(--border)', position: 'relative' }}>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭网页表单" style={{ position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-muted, #64748b)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
          <h2 id="webapp-form-title" style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 2px' }}>{created ? '上传成功' : editing ? '编辑探究网页' : '添加探究网页'}</h2>
          <p style={{ fontSize: "0.8125rem", color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            {created ? `「${created.name}」已经可以用在课堂里了。` : editing ? '修改网页名称及打开设置。' : '上传静态网页，或添加已发布的应用链接。'}
          </p>
        </div>

        {created ? (
          <div style={{ padding: '18px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '12px 14px', fontSize: '0.813rem', color: '#065f46' }}>
              {replacing ? '网页已更新，课堂关联和权限已保留。' : <>入口是 <strong>{created.entryPath}</strong>。创建课堂时可以在「关联探究网页」里勾选它。</>}
            </div>
            {deps && <WebappExternalDepsNotice deps={deps} />}
            {created.missingRefs && <WebappMissingRefsNotice refs={created.missingRefs} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={onClose} style={{ fontSize: "0.875rem", padding: '7px 20px' }}>完成</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ padding: '18px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className={styles.field}>
            <label htmlFor="webapp-name">网页名称 <span className={styles.required}>*</span></label>
            <input id="webapp-name" className="input" value={name} onChange={e => { setName(e.target.value); clearError('name'); }} placeholder="如：太阳系模拟实验"
              aria-invalid={Boolean(fieldErrors.name)} />
            {fieldErrors.name && <FieldError message={fieldErrors.name} />}
          </div>

          {!editing && (
            <div className={styles.sourceOptions} role="group" aria-label="网页来源">
              {([['upload', '上传网页'], ['external', '外部链接']] as const).map(([value, label]) => (
                <button key={value} type="button" className="btn btn-secondary" aria-pressed={source === value} disabled={saving}
                  onClick={() => { setSource(value); setFieldErrors({}); }}>{label}</button>
              ))}
            </div>
          )}

          {external ? (
            <div className={styles.field}>
              <label htmlFor="webapp-external-url">应用发布链接 <span className={styles.required}>*</span></label>
              <input id="webapp-external-url" type="url" className="input" value={externalUrl} placeholder="https://…"
                disabled={saving} aria-invalid={Boolean(fieldErrors.externalUrl)} maxLength={4096}
                onChange={e => { setExternalUrl(e.target.value); setPreviewUrl(''); setCameraEnabled(false); setMicrophoneEnabled(false); clearError('externalUrl'); }} />
              {fieldErrors.externalUrl && <FieldError message={fieldErrors.externalUrl} />}
              <p className={styles.help}>填写学生可以访问的发布链接，勿粘贴带个人令牌的地址。建议先用未登录的浏览器检查。</p>
              <label htmlFor="webapp-external-mode">学生打开方式</label>
              <select id="webapp-external-mode" className="input" value={externalMode} disabled={saving}
                onChange={e => setExternalMode(e.target.value)}>
                <option value="link">在新标签页打开</option>
                <option value="embed">在课堂内嵌入</option>
              </select>
              <p className={styles.help}>嵌入需要发布网站允许。申请摄像头或麦克风的外部网页需要加入服务端的媒体权限信任名单。</p>
              {validUrl && externalMode !== 'link' && <button type="button" className="btn btn-secondary"
                onClick={() => setPreviewUrl(previewUrl ? '' : new URL(validUrl).origin === window.location.origin ? '' : validUrl)}>
                {previewUrl ? '关闭预览' : '试预览嵌入'}
              </button>}
              {previewUrl && externalMode !== 'link' && <iframe className={styles.externalPreview} title="外部网页嵌入预览"
                src={previewUrl} sandbox={WEBAPP_IFRAME_SANDBOX} allow="camera 'none'; microphone 'none'; geolocation 'none'" referrerPolicy="no-referrer" />}
              {validUrl && <a className={`btn btn-secondary ${styles.externalOpen}`} href={validUrl} target="_blank" rel="noopener noreferrer">在新标签页打开 ↗</a>}
            </div>
          ) : editing && webapp && !replacing ? (
            <div className={styles.field}>
              <label htmlFor="webapp-entry">入口页面</label>
              {entries.length > 0 ? (
                <select id="webapp-entry" className="input" value={entryPath} onChange={e => setEntryPath(e.target.value)} disabled={saving}>
                  {entries.map(entry => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              ) : (
                <input id="webapp-entry" className="input" value={entryPath} onChange={e => setEntryPath(e.target.value)} disabled={saving} />
              )}
              <p className={styles.help}>
                {entriesError
                  ? `${entriesError}（可以先按原入口保存）`
                  : entries.length > 0
                    ? `这个网页包里有 ${entries.length} 个 HTML，选哪个作为学生打开时的首页。`
                    : '这个网页包里没有可选的 HTML。'}
              </p>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setReplacing(true)}>替换网页文件</button>
            </div>
          ) : (
            <>
              {replacing && <p className={styles.help}>已打开的学生页面继续使用原版。新打开或刷新页面时使用新版，课堂关联和设备权限会保留。</p>}
              <div className={styles.field}>
                <div className={styles.fieldLabel}>网页文件 <span className={styles.required}>*</span></div>
                <div role="radiogroup" aria-label="上传方式" className={styles.sourceOptions}>
{([['html', '单个 HTML 文件（推荐）'], ['archive', '上传压缩包']] as Array<[UploadMode, string]>).map(([value, label]) => (
                    <button key={value} type="button" className="btn btn-secondary" role="radio" aria-checked={mode === value}
                      disabled={saving} onClick={() => { setMode(value); clearError('file'); }}>
                      {label}
                    </button>
                  ))}
                </div>

<input ref={fileInput} type="file" accept=".html,.htm,.zip,.rar,.7z" aria-label="选择网页或压缩包" className={styles.fileInput} disabled={saving}
  onChange={e => { selectFile(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
<button type="button" className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`} disabled={saving}
  onClick={() => fileInput.current?.click()}
  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
  onDrop={e => { e.preventDefault(); setDragging(false); selectFile(Array.from(e.dataTransfer.files)); }}>
  <span className={styles.uploadIcon}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg></span>
  <strong>{dragging ? '松开即可选择文件' : selectedFile ? selectedFile.name : '拖拽网页或压缩包到这里'}</strong>
  <span>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 点击或拖入文件以更换` : '也可以点击选择文件'}</span>
  <small>HTML / HTM · ZIP / RAR / 7Z</small>
</button>
<p className={styles.help}>{mode === 'html' ? '单个 HTML 适合样式与脚本内嵌的网页。含图片、CSS、JS 等独立资源时，请将整个网页文件夹打包上传。' : '压缩包保留网页目录结构，支持包含图片、CSS、JS 等资源。默认自动查找 index.html。'}</p>
                {fieldErrors.file && <FieldError message={fieldErrors.file} />}
              </div>

              {/* ⚠️ **只在压缩包模式渲染。** 单 HTML 包里只有一个文件，服务端直接取它当入口 ——
                  留着这个框只是给教师一个填错的机会。 */}
              {mode === 'archive' && (
                <div className={styles.field}>
                  <label htmlFor="webapp-entry-hint">入口文件（选填）</label>
                  <input id="webapp-entry-hint" className="input" value={entryHint} onChange={e => setEntryHint(e.target.value)} placeholder="例如 index.html" disabled={saving} />
                </div>
              )}
            </>
          )}

          {!replacing && (!external || externalMode === 'embed') && (
            <fieldset className={styles.mediaPermissions} disabled={saving}>
              <legend>课堂内设备权限</legend>
              <button type="button" className={styles.permissionSwitch} role="switch" aria-checked={cameraEnabled}
                onClick={() => setCameraEnabled(enabled => !enabled)}>
                允许摄像头 <span aria-hidden="true" />
              </button>
              <button type="button" className={styles.permissionSwitch} role="switch" aria-checked={microphoneEnabled}
                onClick={() => setMicrophoneEnabled(enabled => !enabled)}>
                允许麦克风 <span aria-hidden="true" />
              </button>
              <p className={styles.help}>学生需通过可信 HTTPS 进入课堂，并在浏览器中授权。修改后请刷新已打开的学生课堂页面。</p>
            </fieldset>
          )}
          {fieldErrors.submit && <div role="alert" style={{ fontSize: '0.75rem', color: '#a85d5d' }}>{fieldErrors.submit}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving} style={{ fontSize: "0.875rem", padding: '7px 18px' }}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: "0.875rem", padding: '7px 20px' }}>
              {saving ? '保存中...' : replacing ? '上传并替换' : editing ? '保存修改' : external ? '添加网页' : '上传网页'}
            </button>
          </div>
        </form>
        )}
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
