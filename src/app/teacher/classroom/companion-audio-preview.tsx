'use client';
import {VoiceAnswerPlayer} from '@/components/voice-answer-player';
import {worksheetAssetUrl} from '@/lib/worksheet-presentation';
export function companionAudioUrls(value:string|null|undefined):string[]{
 try{const urls=JSON.parse(value??'[]');return Array.isArray(urls)?urls.filter((url):url is string=>typeof url==='string'&&/^\/uploads\/.+\.(ogg|mp3|wav|m4a|webm)(?:[?#]|$)/i.test(url)):[];}catch{return [];}
}
export function CompanionAudioPreview({urls}:{urls:string[]}){return <div style={{marginTop:6,display:'grid',gap:6,minWidth:0}} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
 {urls.map(url=><VoiceAnswerPlayer key={url} src={worksheetAssetUrl(url)} durationMs={0} title="学生语音" compact review tone="blue" transcription={false} preload="metadata"/>)}
 </div>;}
