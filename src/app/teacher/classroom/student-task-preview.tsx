'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { IconPencil, IconCheck } from '@tabler/icons-react';
import { api } from '@/lib/api';
import type { WorksheetBoardAnswerRow, WorksheetQuestionNode } from '@/lib/types';
import { flattenQuestions } from '@/lib/worksheet-questions';
import { LectureHeading } from './lecture-heading';
import { FullscreenPreview } from './fullscreen-preview';
import { AnswerViewBody } from './answer-view';
import { ClassroomImagePreview } from './image-preview';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { TaskAnnotationSurface } from './task-annotation-surface';
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
  const [fontSize,setFontSize]=useState(32);
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
  if (view?.kind === 'photo') return <ClassroomImagePreview studentName={studentName} viewTabs={viewTabs} visible={visible} allowAnnotations src={worksheetAssetUrl(view.url)} quickAction={!viewTabs&&onSwitchToReview&&<button onClick={onSwitchToReview}>查看评价</button>} onClose={onClose}/>;
  return <><FullscreenPreview viewTabs={viewTabs} visible={visible} switchAnimation slideFrom="left" quickAction={!viewTabs&&onSwitchToReview&&<button onClick={onSwitchToReview}>查看评价</button>} floatingControls title={`${studentName} · 本题作答`} heading={<LectureHeading studentName={studentName} mode="answer"/>} onClose={onClose} controls={<>
      {kind !== 'photo' && kind !== 'ink' && <div className={styles.fontControls}><button disabled={active||fontSize<=14} onClick={()=>setFontSize(value=>value-2)} aria-label="缩小作答文字">A−</button><output>{fontSize}px</output><button disabled={active||fontSize>=48} onClick={()=>setFontSize(value=>value+2)} aria-label="放大作答文字">A＋</button></div>}
      <button className={styles.annotationAction} disabled={!data} onClick={()=>setActive(value=>!value)}>{active?<IconCheck size={19} aria-hidden="true"/>:<IconPencil size={19} aria-hidden="true"/>}<span>{active?'结束批注':'开始批注'}</span></button>
    </>}>
    <div className={styles.viewport} style={{'--task-text-size':`${fontSize}px`} as React.CSSProperties}>
      <article className={styles.card}>
        {error ? <div role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>重新加载</button></div>
          : !data ? <p role="status">正在读取本题作答…</p> : <>
            <div className={`${styles.layout} ${styles.answerOnly}`}>
              <section className={styles.answer}>
                <div className={styles.answerContent} data-photo={answerView(data.node,data.answer?.value).kind === 'photo'}>
                  <TaskAnnotationSurface target={JSON.stringify(['task-answer',worksheetId,questionId,participantId,data.answer?.value])} active={active} standaloneTools textSize={fontSize} onFoundMarks={()=>setActive(true)} onRestore={setFontSize}><div className={styles.lectureBody}><div className={styles.lectureAnswer} data-kind={kind}><AnswerViewBody node={data.node} value={data.answer?.value} transcriptionActions={false}/></div></div></TaskAnnotationSurface>
                </div>
              </section>

            </div>
          </>}
      </article>
    </div>

  </FullscreenPreview>

  </>;
}
