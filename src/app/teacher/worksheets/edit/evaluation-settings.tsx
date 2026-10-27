'use client';

import { useRef, useState } from 'react';
import { IconCheck, IconSparkles, IconInbox, IconPhotoPlus, IconX } from '@tabler/icons-react';
import { normalizePastedText } from '@/lib/worksheet-text-normalize';
import { api } from '@/lib/api';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { evaluationImages, evaluationMode, evaluationRequirements, hasEvaluation, type EvaluationMode } from '@/lib/worksheet-evaluation';

/** One editor for question-level and per-blank evaluation; input mode is independent. */
export function EvaluationSettings({ data, legacyMode, legacyScored, allowAnswer = true, reference, maxScore = 1, scoreLimit = 99, unit = '分', template, onChange, automatic, limit, onTriggerChange, onNotice, onImagesUploaded }: {
  data: Record<string, unknown>; legacyMode: EvaluationMode; legacyScored: boolean; allowAnswer?: boolean;
  reference?: unknown; maxScore?: number; scoreLimit?: number; unit?: string; template?: string; onChange: (patch: Record<string, unknown>) => void;
  automatic: boolean; limit: number; onTriggerChange: (patch: Record<string, unknown>) => void;
  onImagesUploaded: (urls:string[]) => void;
  onNotice?: (message: string, type: 'success' | 'error') => void;
}) {
  const mode = evaluationMode(data, legacyMode);
  const scored = hasEvaluation(data) ? data.evaluationScored === true : legacyScored;
  const requirements = evaluationRequirements(data, reference);
  const images = evaluationImages(data);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const change = (patch: Record<string, unknown>) => onChange({evaluationVersion: 1, evaluationMode: mode, evaluationScored: scored, evaluationText: requirements, evaluationImages: images, maxScore, aiScoringMaxScore:maxScore, ...patch});
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setError('');
    try {
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, 6 - images.length)) urls.push((await api.uploadWorksheetImage(file)).url);
      onImagesUploaded(urls);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '图片上传失败，请重试';
      setError(message); onNotice?.(message, 'error');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  return <div className="worksheet-evaluation">
    <div className="worksheet-evaluation-modes" role="group" aria-label="评价方式">
      {([{key:'answer', label:'自动核对答案', Icon:IconCheck}, {key:'ai', label:'AI 评价', Icon:IconSparkles}, {key:'collect', label:'仅收集', Icon:IconInbox}] as const).filter(item => allowAnswer || item.key !== 'answer').map(({key,label,Icon}) => <button type="button" key={key} aria-pressed={mode===key} className={mode===key?'is-selected':''} onClick={() => {if(key !== mode) change({evaluationMode:key, evaluationScored:key==='answer' ? true : false});}}><Icon size={18}/>{label}</button>)}
    </div>
    {mode === 'collect' && <p className="worksheet-evaluation-help">保存学生作答，不自动评价、不计分。教师仍可在课堂看板发起内容分析。</p>}
    {mode === 'answer' && <p className="worksheet-evaluation-help">按下方标准答案核对，不调用 AI。主观表达可改选“AI 评价”。</p>}
    {mode === 'ai' && <>
      <label className="worksheet-evaluation-requirements"><strong>AI 评价要求</strong><span>文字、图片可单独使用，也可共同作为依据。</span><textarea className="input" rows={4} maxLength={12000} value={requirements} onPaste={event=>{const raw=event.clipboardData.getData('text/plain');if(!raw)return;event.preventDefault();const input=event.currentTarget;change({evaluationText:input.value.slice(0,input.selectionStart)+normalizePastedText(raw)+input.value.slice(input.selectionEnd)});}} onChange={event => change({evaluationText:event.target.value})} placeholder="例如：说清观察到的变化，并说明依据。关注表达是否完整，给出一条可操作的建议。计分时请写清给分条件，或上传评分量表。"/></label>
      {template && <button type="button" className="btn btn-secondary" onClick={()=>change({evaluationText:requirements ? `${requirements}\n${template}` : template})}>插入结构要点模板</button>}
      <div className="worksheet-evaluation-images">{images.map((url,index)=><figure key={url}><img src={worksheetAssetUrl(url)} alt={`评价依据 ${index+1}`}/><button type="button" aria-label={`移除评价依据图片 ${index+1}`} onClick={()=>change({evaluationImages:images.filter(item=>item!==url)})}><IconX size={16}/></button></figure>)}
        <button type="button" disabled={uploading || images.length>=6} className="worksheet-evaluation-upload" onClick={()=>fileRef.current?.click()}><IconPhotoPlus size={20}/>{uploading?'正在上传…':'添加图片'}<small>{images.length}/6</small></button>
        <input hidden ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event=>void upload(event.target.files)}/>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="worksheet-evaluation-options">
        <div><label><input type="checkbox" checked={scored} onChange={event=>change({evaluationScored:event.target.checked})}/>计入成绩</label><span>{scored?'AI 按给分条件评分，同时给出建议。':'只给评价与建议，不产生分数。'}</span>{scored && <label className="worksheet-evaluation-number">满分<input className="input" type="number" min={1} max={scoreLimit} value={maxScore} onChange={event=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=scoreLimit)change({maxScore:n,aiScoringMaxScore:n});}}/><span>{unit}</span></label>}</div>
        <div><label><input type="checkbox" checked={automatic} onChange={event=>onTriggerChange({studentAiReviewEnabled:event.target.checked})}/>提交整题后自动评价</label><span>关闭后由教师发起；同题多个 AI 空合并评价。</span>{automatic && <label className="worksheet-evaluation-number">每人评价次数<input className="input" type="number" min={1} max={20} value={limit} onChange={event=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=20)onTriggerChange({aiReviewLimit:n});}}/></label>}</div>
      </div>
      {scored && !requirements.trim() && !images.length && <p className="worksheet-evaluation-validation" role="status">请补充给分条件或上传评分量表，再保存。</p>}
    </>}
  </div>;
}
