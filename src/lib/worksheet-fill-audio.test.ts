import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerValue, draftFromValue, isDraftEmpty } from './worksheet-answer-value.ts';
import { fillSettingsFor, writeFillSettings } from './worksheet-fill-modes.ts';
import { answerView } from './worksheet-answer-view.ts';
import type { WorksheetQuestionNode } from './types.ts';
const url = '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.ogg';
const audio = {format:'audio/v1' as const,url,durationMs:2500};
const node: WorksheetQuestionNode = {id:'q',type:'fill-blank',prompt:'{填空域}{填空域}',inputMode:'keyboard',data:{promptRuns:[{start:0,end:5,blank:'a'},{start:5,end:10,blank:'b'}],answers:[['甲'],[]],fillBlankSettings:{a:{mode:'text',gradingMode:'auto',maxScore:2},b:{mode:'audio',gradingMode:'ai',maxScore:3,audioCriteria:'说清依据',audioReference:'参考要点'}}},children:[]};
test('mixed text/audio fills round trip by stable ID, including teacher playback',()=>{
 const value=buildAnswerValue(node,{kind:'fill',texts:['甲',''],audios:{b:audio}});
 assert.deepEqual(value,{format:'fill-multi/v1',texts:['甲',''],audios:{b:audio}});
 const draft=draftFromValue(node,value);
 assert.equal(isDraftEmpty(draft),false);
 const view=answerView(node,value);
 assert.equal(view.kind,'fill'); if(view.kind==='fill') assert.deepEqual(view.blanks[1].audio,audio);
 assert.deepEqual(buildAnswerValue(node,draft),value);
 const settings=fillSettingsFor(node,node.data.promptRuns as never);
 assert.equal(settings[1].mode,'audio');
 assert.equal(writeFillSettings(node,node.data.promptRuns as never,settings).b.audioCriteria,'说清依据');
});
test('recording or an unsaved upload cannot be submitted, including otherwise filled text',()=>{
 assert.equal(isDraftEmpty({kind:'fill',texts:['甲',''],pendingAudio:['b']}),true);
 assert.equal(buildAnswerValue(node,{kind:'fill',texts:['甲',''],pendingAudio:['b']}),null);
 assert.equal(isDraftEmpty({kind:'fill',texts:['',''],audios:{b:audio}}),false);
 assert.deepEqual(draftFromValue(node,{format:'fill-multi/v1',texts:['甲','']}),{kind:'fill',texts:['甲','']});
});
