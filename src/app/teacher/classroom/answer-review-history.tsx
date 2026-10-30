'use client';
import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base';
import type { WorksheetQuestionNode } from '@/lib/types';
import { ReviewEvidencePanel, type TeacherReviewEvidence } from './review-evidence-panel';
import { ReviewPreviewButton } from './review-preview';
import { ReviewHistory, type AnswerReview } from '@/app/classroom/worksheet/review-history';
export function TeacherReviewHistory({ classroomId, worksheetId, participantId, studentName, node }: { classroomId: string; worksheetId: string; participantId: string; studentName?: string; node: WorksheetQuestionNode }) {
  const [reviews, setReviews] = useState<Array<AnswerReview & {evidence?:TeacherReviewEvidence|null}>>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReviews([]); setError(false);
    const load = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(worksheetId)}/reviews?classroomId=${encodeURIComponent(classroomId)}&participantId=${encodeURIComponent(participantId)}`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) { setReviews((data.reviews ?? []).filter((r: AnswerReview) => r.questionId === node.id)); setError(false); }
      } catch { if (!cancelled) setError(true); }
    };
    void load(); const timer = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [classroomId, worksheetId, participantId, node.id]);
  return error ? <p role="status">提交历史暂时未能读取，正在重试。</p> : <ReviewHistory teacherView node={node} reviews={reviews} renderReviewDetails={review => <ReviewEvidencePanel evidence={reviews.find(row=>row.id===review.id)?.evidence}/>} renderReviewActions={review =>
    <ReviewPreviewButton annotationId={`${classroomId}:${worksheetId}:${participantId}:${node.id}:${review.id}`} title={`${studentName || '学生'} · AI 评价与建议`} reason={review.reason} advice={review.advice} score={review.score} maxScore={review.maxScore} unit={review.unit}
      note={review.status === 'superseded' ? (review.error || '历史评价，不计入当前成绩') : undefined} />
  } />;
}
