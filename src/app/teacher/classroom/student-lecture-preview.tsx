'use client';
import { useState, type ComponentProps } from 'react';
import { LectureTabs } from './lecture-tabs';
import { StudentTaskPreview } from './student-task-preview';
import { ReviewFullscreen } from './review-preview';
export function StudentLecturePreview({initialMode='answer',...props}:ComponentProps<typeof StudentTaskPreview>&{initialMode?:'answer'|'review'}) {
 const [mode,setMode]=useState(initialMode);
 return <><StudentTaskPreview viewTabs={props.reason||props.advice?<LectureTabs mode={mode} onChange={setMode}/>:undefined} visible={mode==='answer'} {...props} onSwitchToReview={props.reason||props.advice?()=>setMode('review'):undefined}/>{(props.reason||props.advice)&&<ReviewFullscreen viewTabs={<LectureTabs mode={mode} onChange={setMode}/>} visible={mode==='review'} title={`${props.studentName} · AI 评价与建议`} annotationId={`${props.classroomId}:${props.worksheetId}:${props.questionId}:${props.participantId}`} reason={props.reason} advice={props.advice} score={props.score} maxScore={props.maxScore} unit={props.unit} onClose={props.onClose} onSwitch={()=>setMode('answer')}/>}</>;
}
