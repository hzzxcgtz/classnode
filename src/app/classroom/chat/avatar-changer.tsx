import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { api } from '@/lib/api';
import type { AvatarSummary } from '@/lib/types';
import type { ClassroomInfo, StudentSession } from '../classroom-types';
import { fixSvgUrl } from '../avatar-utils';
import { SvgAvatar } from '@/components/svg-avatar';

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
              color: tab === t.key ? '#527198' : '#64748b', background: 'transparent', border: 'none',
              cursor: 'pointer', borderBottom: `2px solid ${tab === t.key ? '#527198' : 'transparent'}`,
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
                border: `2px solid ${selectedId === av.id ? '#527198' : '#e2e8f0'}`,
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
                style={{ background: 'transparent', border: 'none', color: '#a85d5d', fontSize: "0.75rem", cursor: 'pointer', marginTop: 4 }}>
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

export interface AvatarChangerModalProps {
  /**
   * 标题元素的 id，用于 `aria-labelledby`。
   *
   * 必须是入参而不是常量：首页层与学伴层**同时挂载**，两层各开一次弹窗时 DOM 里会同时存在
   * 两个标题元素，共用一个 id 会让 `aria-labelledby` 解析到先出现的那个（并且是非法 HTML）。
   */
  titleId: string;
  avatarTokenCount: number;
  studentId: string;
  avatars: AvatarSummary[];
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
  onChanged: (result: { avatarId: number; svgContent: string }) => void;
  onClose: () => void;
}

/**
 * 头像更换弹窗的**外壳**：遮罩 + 卡片 + 关闭按钮 + 标题 + 两段说明。
 *
 * 首页与学伴面板此前各有一份逐字相同的拷贝（约 15 行 HTML 与内联样式）。拷贝出来的不只是
 * 重复，还有「改了一处标题字号、另一处还是旧的」这类**没有编译期信号**的漂移。内容
 * （`AvatarChangerContent`）与收尾（`finishAvatarChange`）各自也只有一份，外壳一并收在这里。
 */
export function AvatarChangerModal({
  titleId, avatarTokenCount, studentId, avatars, setToast, onChanged, onClose,
}: AvatarChangerModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: 480, padding: 24 }}
      >
        <button
          type="button"
          aria-label="关闭更换头像窗口"
          onClick={onClose}
          style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.25rem', color: '#64748b', lineHeight: 1 }}
        >
          ×
        </button>
        <h3 id={titleId} style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 4px' }}>🎨 更换头像</h3>
        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 4px' }}>
          剩余 <strong style={{ color: '#956834' }}>{avatarTokenCount}</strong> 次更换机会，由教师奖励获得
        </p>
        <p style={{ fontSize: '0.688rem', color: '#94a3b8', margin: '0 0 16px' }}>
          可从教师头像库中选择，也可粘贴自定义 SVG 代码
        </p>
        <AvatarChangerContent
          studentId={studentId}
          avatars={avatars}
          onChanged={onChanged}
          setToast={setToast}
        />
      </div>
    </div>
  );
}

/**
 * 换头像成功后的收尾所依赖的那部分外壳状态。首页与学伴面板的 props 都**结构性地**满足它，
 * 所以两处可以直接把自己的 props 名字传进来。
 */
export interface AvatarChangeHost {
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  setAvatarSvgs: Dispatch<SetStateAction<Record<number, string>>>;
  setSelectedStudent: Dispatch<SetStateAction<StudentSession | null>>;
  setAllStudentAvatars: Dispatch<SetStateAction<AvatarSummary[]>>;
  fetchStudentTokens: () => Promise<void>;
}

/**
 * 换头像成功后的收尾：先写透当前会话，再拉一次服务端权威数据。
 *
 * 两处入口（首页的头像位、学伴面板顶部栏）此前各写了一份**逐字相同**的实现，连注释都一样。
 * 那不只是重复，是会漂移的重复：任何一处改了 await 顺序或漏掉一次 `setAllStudentAvatars`，
 * 两边的头像就会在切层之后对不上，而且没有任何编译期信号。
 *
 * `onDone` 由调用方给（两处都是关掉自己的那个弹窗）。
 */
export async function finishAvatarChange(
  host: AvatarChangeHost,
  result: { avatarId: number; svgContent: string },
  onDone: () => void,
): Promise<void> {
  // 接口返回的是服务端最终保存（并已清理）的头像，先立即更新当前会话。
  host.setAvatarSvgs((current) => ({ ...current, [result.avatarId]: fixSvgUrl(result.svgContent) }));
  host.setSelectedStudent((current) => current ? { ...current, avatarId: result.avatarId } : current);
  onDone();
  void host.fetchStudentTokens();
  try {
    const [allAvatars, teacherAvatars] = await Promise.all([
      api.getAvatarsAll('student'),
      api.getAvatars('student'),
    ]);
    const svgMap: Record<number, string> = {};
    allAvatars.forEach((avatar) => { svgMap[avatar.id] = fixSvgUrl(avatar.svgContent); });
    host.setAvatarSvgs(svgMap);
    host.setAllStudentAvatars(teacherAvatars);
    // 重新加载 classroom students 更新 selectedStudent
    if (host.classroom?.id && host.selectedStudent?.id) {
      const students = await api.getClassroomStudents(host.classroom.id);
      const updated = students.find((student) => student.id === host.selectedStudent?.id);
      if (updated) host.setSelectedStudent(updated);
    }
  } catch {}
}
