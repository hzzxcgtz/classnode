import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AvatarSummary } from '@/lib/types';
import { SvgAvatar } from './svg-avatar';

export interface AvatarChangerContentProps {
  studentId: string;
  avatars: AvatarSummary[];
  onChanged: (result: { avatarId: number; svgContent: string }) => void;
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
}

/** 学生自助换头像组件 */
export function AvatarChangerContent({ studentId, avatars, onChanged, setToast }: AvatarChangerContentProps) {
  const [tab, setTab] = useState<'library' | 'custom' | 'image'>('library');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [svgInput, setSvgInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadSvg, setUploadSvg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearImagePreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setImagePreview(null);
  };

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 本地预览
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setImagePreview(url);
    setUploadSvg(null);
    // 自动上传
    setUploading(true);
    try {
      const result = await api.uploadAvatarImage(file);
      if (result.svgContent) {
        setUploadSvg(result.svgContent);
      }
    } catch { setToast({ msg: '图片上传失败', type: 'error' }); }
    setUploading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let result: { avatarId: number; svgContent: string };
      if (tab === 'library' && selectedId) {
        result = await api.studentSelfChangeAvatar(studentId, { avatarId: selectedId });
      } else if (tab === 'custom' && svgInput.trim()) {
        result = await api.studentSelfChangeAvatar(studentId, { svgContent: svgInput.trim(), gender: 'neutral' });
      } else if (tab === 'image' && uploadSvg) {
        result = await api.studentSelfChangeAvatar(studentId, { svgContent: uploadSvg, gender: 'neutral' });
      } else {
        setToast({ msg: '请选择或上传一个头像', type: 'error' }); setSaving(false); return;
      }
      setToast({ msg: '头像已更新！', type: 'success' });
      onChanged(result);
    } catch (error: unknown) {
      setToast({ msg: error instanceof Error ? error.message : '更换失败', type: 'error' });
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid #e2e8f0' }}>
        {[
          { key: 'library' as const, label: '选择头像' },
          { key: 'custom' as const, label: '自定义 SVG' },
          { key: 'image' as const, label: '上传图片' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: "0.813rem", fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#2563eb' : '#64748b', background: 'transparent', border: 'none',
              cursor: 'pointer', borderBottom: `2px solid ${tab === t.key ? '#2563eb' : 'transparent'}`,
              marginBottom: -2,
            }}>{t.label}</button>
        ))}
      </div>

      {tab === 'library' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
          {avatars.length === 0 ? (
            <p style={{ fontSize: "0.813rem", color: '#94a3b8', padding: 20 }}>暂无可选头像</p>
          ) : avatars.map(av => (
            <div key={av.id} onClick={() => setSelectedId(selectedId === av.id ? null : av.id)}
              style={{
                width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
                border: `2px solid ${selectedId === av.id ? '#2563eb' : '#e2e8f0'}`,
              }}>
              <SvgAvatar svg={av.svgContent} size={40} />
            </div>
          ))}
        </div>
      ) : tab === 'custom' ? (
        <div style={{ marginBottom: 16 }}>
          <textarea className="input" value={svgInput} onChange={e => setSvgInput(e.target.value)}
            rows={5} style={{ fontFamily: 'monospace', fontSize: "0.688rem", resize: 'vertical' }}
            placeholder={'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">\n  ...\n</svg>'} />
          <p style={{ fontSize: "0.625rem", color: '#94a3b8', marginTop: 4 }}>
            {'需要包含 viewBox="0 0 40 40" 的完整 SVG 代码'}
          </p>
          {svgInput.trim() && (
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', background: '#f8fafc', borderRadius: 8, padding: 12 }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', overflow: 'hidden' }}>
                <SvgAvatar svg={svgInput} size={60} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect}
            style={{ display: 'none' }} />
          {!imagePreview ? (
            <div onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #cbd5e1', borderRadius: 12, padding: '30px 20px',
                textAlign: 'center', cursor: 'pointer', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.background = '#f8faff'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = 'transparent'; }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: 8 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
              <p style={{ fontSize: "0.813rem", fontWeight: 600, color: '#475569', margin: '0 0 4px' }}>点击上传头像图片</p>
              <p style={{ fontSize: "0.688rem", color: '#94a3b8', margin: 0 }}>支持 JPG、PNG、WebP 格式</p>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ width: 80, height: 80, borderRadius: '50%', overflow: 'hidden', border: '3px solid #e2e8f0' }}>
                  <img src={imagePreview} alt="预览" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
              {uploading ? (
                <p style={{ fontSize: "0.75rem", color: '#94a3b8' }}>上传中...</p>
              ) : uploadSvg ? (
                <p style={{ fontSize: "0.75rem", color: '#10b981', fontWeight: 600 }}>✅ 上传成功，点击确认更换</p>
              ) : null}
              <button onClick={() => { clearImagePreview(); setUploadSvg(null); }}
                style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: "0.75rem", cursor: 'pointer', marginTop: 4 }}>
                重新选择
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={saving || (tab === 'library' && !selectedId) || (tab === 'custom' && !svgInput.trim()) || (tab === 'image' && !uploadSvg)}>
          {saving ? '更换中...' : '确认更换'}
        </button>
      </div>
    </div>
  );
}
