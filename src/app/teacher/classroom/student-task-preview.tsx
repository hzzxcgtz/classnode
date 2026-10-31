'use client';

import { useEffect, useState } from 'react';
import { IconClipboardText, IconMessageCircle, IconBulb, IconPencil } from '@tabler/icons-react';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { REWARD_STYLE_OPTIONS, pointsUnitLabel } from '@/lib/worksheet-reward';
import { api } from '@/lib/api';
import type { WorksheetBoardAnswerRow, WorksheetQuestionNode } from '@/lib/types';
import { flattenQuestions } from '@/lib/worksheet-questions';
import { PromptText } from '@/lib/worksheet-prompt-text';
import { formatReviewText } from '@/lib/worksheet-review-display';
import { FullscreenPreview } from './fullscreen-preview';
import { AnswerViewBody } from './answer-view';
import { ClassroomImagePreviewContext } from './answer-photo';
import { ClassroomImagePreview } from './image-preview';
import styles from './student-task-preview.module.css';

export function StudentTaskPreview({ classroomId, worksheetId, questionId, participantId, studentName, reason, advice, score, maxScore, unit, onClose }: {
  classroomId: string; worksheetId: string; questionId: string; participantId: string; studentName: string;
  score?: number | null; maxScore?: number; unit?: string; reason?: string | null; advice?: string | null; onClose: () => void;
}) {
  const [data, setData] = useState<{ node: WorksheetQuestionNode; answer?: WorksheetBoardAnswerRow } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    void Promise.all([api.getWorksheet(worksheetId), api.getWorksheetBoard(classroomId)]).then(([sheet, board]) => {
      if (cancelled) return;
      const node = flattenQuestions(sheet.content.nodes).find(row => row.id === questionId);
      if (!node) throw new Error('这道题已不存在，请关闭后刷新列表。');
      const participant = board.worksheets.find(row => row.id === worksheetId)?.participants.find(row => row.participantId === participantId);
      setData({ node, answer: participant?.answerRows.find(row => row.questionId === questionId) });
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : '暂时无法读取作答，请重试。'); });
    return () => { cancelled = true; };
  }, [classroomId, worksheetId, questionId, participantId, retry]);
  const reward = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === unit);
  const showRewards = reward && score != null && Number.isInteger(score) && maxScore != null && Number.isInteger(maxScore) && maxScore > 0 && maxScore <= 20;
  return <><FullscreenPreview title={`${studentName} · 本题作答`} onClose={onClose}>
    <div className={styles.viewport}>
      <article className={styles.card}>
        {error ? <div role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>重新加载</button></div>
          : !data ? <p role="status">正在读取本题作答…</p> : <>
            <section className={styles.prompt}>
              <h2><IconClipboardText size={19} aria-hidden="true" />题目要求</h2>
              <div className={styles.promptText}><PromptText text={data.node.prompt || '本题作答'} placeholder="题目" /></div>
            </section>
            <div className={`${styles.layout} ${!reason && !advice ? styles.answerOnly : ''}`}>
              <section className={styles.answer}>
                <div className={styles.sectionHeading}><h2><IconPencil size={20} aria-hidden="true" />学生作答</h2>
                  <span className={styles.status}>{data.answer?.status === 'submitted' ? '已提交' : data.answer ? '作答中' : '未作答'}</span>
                </div>
                <div className={styles.answerContent}>
                  <ClassroomImagePreviewContext.Provider value={setImage}><AnswerViewBody node={data.node} value={data.answer?.value} /></ClassroomImagePreviewContext.Provider>
                </div>
              </section>
              {(reason || advice) && <section className={styles.review}>
                <div className={styles.sectionHeading}><h2><IconMessageCircle size={20} aria-hidden="true" />AI 评价与建议</h2></div>
                {score != null && <div className={styles.rewardSummary}><span>本次获得</span>
                  {showRewards ? <span className={styles.rewards} role="img" aria-label={`${score} / ${maxScore} ${unit}`}>
                    {Array.from({length:maxScore}, (_, index) => <RewardIcon key={index} kind={reward.value} state={index < score ? 'earned' : 'empty'} size={28} />)}
                  </span> : <strong>{score}<small> / {maxScore} {unit}</small></strong>}
                </div>}
                {reason && <div className={styles.reason}><p className={styles.feedback}>{formatReviewText(reason)}</p></div>}
                {advice && <div className={styles.advice}><h3><IconBulb size={21} aria-hidden="true" />改进建议</h3><p className={styles.feedback}>{formatReviewText(advice)}</p></div>}
              </section>}
            </div>
          </>}
      </article>
    </div>
  </FullscreenPreview>
    {image && <ClassroomImagePreview allowAnnotations src={image} onClose={() => setImage(null)} />}
  </>;
}
