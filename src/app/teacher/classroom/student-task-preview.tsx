'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { IconPencil, IconHandMove, IconHighlight, IconEraser, IconTrash, IconEye, IconEyeOff, IconCheck } from '@tabler/icons-react';
import { api } from '@/lib/api';
import type { WorksheetBoardAnswerRow, WorksheetQuestionNode } from '@/lib/types';
import { flattenQuestions } from '@/lib/worksheet-questions';
import { FullscreenPreview } from './fullscreen-preview';
import { AnswerViewBody } from './answer-view';
import { ClassroomImagePreview } from './image-preview';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { TaskAnnotationSurface, type TaskDrawingTools } from './task-annotation-surface';
import { answerView } from '@/lib/worksheet-answer-view';
import styles from './student-task-preview.module.css';

export function StudentTaskPreview({ classroomId, worksheetId, questionId, participantId, studentName, onClose, onSwitchToReview, viewTabs, visible = true, answerSnapshot }: {
  classroomId: string; worksheetId: string; questionId: string; participantId: string; studentName: string;
  answerSnapshot?: { node: WorksheetQuestionNode; value: unknown };
  viewTabs?:ReactNode; visible?: boolean; onSwitchToReview?:()=>void; score?: number | null; maxScore?: number; unit?: string; reason?: string | null; advice?: string | null; onClose: () => void;
}) {
  const [data, setData] = useState<{ node: WorksheetQuestionNode; answer?: Pick<WorksheetBoardAnswerRow, 'value'> } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active,setActive]=useState(false);
  const [fontSize,setFontSize]=useState(18);
  const [tools,setTools]=useState<TaskDrawingTools>({tool:'pen',color:'#ef4444',width:2,visible:true,moving:false,clear:0});
  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    if (answerSnapshot) {
      setData({ node: answerSnapshot.node, answer: { value: answerSnapshot.value } });
      return;
    }
    void Promise.all([api.getWorksheet(worksheetId), api.getWorksheetBoard(classroomId)]).then(([sheet, board]) => {
      if (cancelled) return;
      const node = flattenQuestions(sheet.content.nodes).find(row => row.id === questionId);
      if (!node) throw new Error('这道题已不存在，请关闭后刷新列表。');
      const participant = board.worksheets.find(row => row.id === worksheetId)?.participants.find(row => row.participantId === participantId);
      setData({ node, answer: participant?.answerRows.find(row => row.questionId === questionId) });
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : '暂时无法读取作答，请重试。'); });
    return () => { cancelled = true; };
  }, [classroomId, worksheetId, questionId, participantId, retry, answerSnapshot]);
  const view = data ? answerView(data.node,data.answer?.value) : null;
  const kind = view?.kind;
  if (view?.kind === 'photo') return <ClassroomImagePreview viewTabs={viewTabs} visible={visible} allowAnnotations src={worksheetAssetUrl(view.url)} quickAction={!viewTabs&&onSwitchToReview&&<button onClick={onSwitchToReview}>查看评价</button>} onClose={onClose}/>;
  return <><FullscreenPreview viewTabs={viewTabs} visible={visible} switchAnimation slideFrom="left" quickAction={!viewTabs&&onSwitchToReview&&<button onClick={onSwitchToReview}>查看评价</button>} compactControls title={`${studentName} · 本题作答`} onClose={onClose} controls={<>
      {kind !== 'photo' && kind !== 'ink' && <div className={styles.fontControls}><button disabled={active||fontSize<=14} onClick={()=>setFontSize(value=>value-2)} aria-label="缩小作答文字">A−</button><output>{fontSize}px</output><button disabled={active||fontSize>=40} onClick={()=>setFontSize(value=>value+2)} aria-label="放大作答文字">A＋</button></div>}
      <button className={styles.annotationAction} disabled={!data} onClick={()=>setActive(value=>!value)}>{active?<IconCheck size={19} aria-hidden="true"/>:<IconPencil size={19} aria-hidden="true"/>}<span>{active?'结束批注':'开始批注'}</span></button>
    </>}>
    <div className={`${styles.viewport} ${active?styles.annotating:''}`} style={{'--task-text-size':`${fontSize}px`} as React.CSSProperties}>
      <article className={styles.card}>
        {error ? <div role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>重新加载</button></div>
          : !data ? <p role="status">正在读取本题作答…</p> : <>
            <div className={`${styles.layout} ${styles.answerOnly}`}>
              <section className={styles.answer}>
                <div className={styles.answerContent} data-photo={answerView(data.node,data.answer?.value).kind === 'photo'}>
                  <TaskAnnotationSurface target={JSON.stringify(['task-answer',worksheetId,questionId,participantId,data.answer?.value])} active={active} tools={tools} textSize={fontSize} onFoundMarks={()=>setActive(true)} onRestore={setFontSize}><AnswerViewBody node={data.node} value={data.answer?.value}/></TaskAnnotationSurface>
                </div>
              </section>

            </div>
          </>}
      </article>
    </div>
    {active&&<aside className={styles.toolbar} aria-label="统一批注工具栏"><div className={styles.toolRail} role="toolbar" aria-label="讲评批注工具" aria-orientation="vertical">
      <button title="拖动图片，笔迹随图片移动" onClick={()=>setTools(t=>({...t,moving:!t.moving}))} aria-pressed={tools.moving}><IconHandMove size={20} aria-hidden="true"/><span>移动图片</span></button>
      {([{tool:'pen',label:'画笔',icon:IconPencil},{tool:'highlight',label:'荧光笔',icon:IconHighlight},{tool:'eraser',label:'整笔擦除',icon:IconEraser}] as const).map(({tool,label,icon:Icon})=><button key={tool} aria-pressed={!tools.moving&&tools.tool===tool} onClick={()=>setTools(t=>({...t,tool,moving:false}))}><Icon size={20} aria-hidden="true"/><span>{label}</span></button>)}
      <div className={styles.toolColors} role="group" aria-label="画笔颜色">{['#ef4444','#2563eb','#16a34a','#eab308'].map((color,index)=><button key={color} aria-label={['红色','蓝色','绿色','黄色'][index]} aria-pressed={tools.color===color} onClick={()=>setTools(t=>({...t,color}))}><i style={{background:color}}/></button>)}</div>
      <div className={styles.toolWidths} role="group" aria-label="画笔粗细">{[2,4,7].map((width,index)=><button key={width} title={['细线','中线','粗线'][index]} aria-label={['细线','中线','粗线'][index]} aria-pressed={tools.width===width} onClick={()=>setTools(t=>({...t,width}))}><span aria-hidden="true" style={{height:width}}/></button>)}</div>
      <div className={styles.toolDivider}/>
      <button onClick={()=>setTools(t=>({...t,clear:t.clear+1}))}><IconTrash size={20} aria-hidden="true"/><span>清空批注</span></button>
      <button aria-pressed={!tools.visible} onClick={()=>setTools(t=>({...t,visible:!t.visible}))}>{tools.visible?<IconEyeOff size={20} aria-hidden="true"/>:<IconEye size={20} aria-hidden="true"/>}<span>{tools.visible?'隐藏批注':'显示批注'}</span></button>
    </div></aside>}
  </FullscreenPreview>

  </>;
}
