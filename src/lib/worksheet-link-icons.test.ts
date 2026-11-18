import test from 'node:test';
import assert from 'node:assert/strict';
import { insertPromptLink, readPromptRuns, remapRuns, setStyleOnRange } from './worksheet-prompt-marks.ts';
import { normalizeWorksheetLinkIcon, WORKSHEET_LINK_ICONS, worksheetLinkIconImage } from './worksheet-link-icons.ts';

test('手选图标随链接保存回填，局部格式和链接内输入保留图标', () => {
  const q=insertPromptLink([], '',0,0,'教学设计','https://abc.feishu.cn/file/token','pdf')!;
  const runs=readPromptRuns(JSON.parse(JSON.stringify(q.runs)),q.text);
  assert.equal(runs[0].linkIcon,'pdf');
  const styled=setStyleOnRange(runs,q.text,1,3,{bold:true});
  assert.ok(styled.every(r=>r.linkIcon==='pdf'));
  const typed=remapRuns(runs,q.text,'教学新设计');
  assert.ok(typed.every(r=>r.linkIcon==='pdf'));
  const renamed=insertPromptLink(runs,q.text,0,q.text.length,'本课教案','https://example.com/new','word')!;
  assert.equal(renamed.runs[0].linkIcon,'word');
});
test('只改图标不改文字，默认附件和非法图标安全降级，不污染填空', () => {
  const q=insertPromptLink([], '',0,0,'教学设计','https://abc.feishu.cn/file/token','pdf')!;
  const changed=insertPromptLink(q.runs,q.text,0,q.text.length,q.text,q.runs[0].href!,'slides')!;
  assert.equal(changed.text,q.text);assert.equal(changed.runs[0].linkIcon,'slides');
  const cleared=insertPromptLink(changed.runs,q.text,0,q.text.length,q.text,q.runs[0].href!,'attachment')!;
  assert.equal(cleared.runs[0].linkIcon,undefined);
  assert.equal(readPromptRuns([{...q.runs[0],linkIcon:'<svg>bad</svg>'}],q.text)[0].linkIcon,undefined);
  assert.equal(readPromptRuns([{...q.runs[0],href:undefined}],q.text)[0].linkIcon,undefined);
  assert.equal(readPromptRuns([{...q.runs[0],blank:'blank_1'}],q.text)[0].linkIcon,undefined);
  assert.equal(normalizeWorksheetLinkIcon('unknown'),'attachment');
});
test('图标素材为统一尺寸的固定SVG，非法输入不会进入SVG', () => {
  for(const item of WORKSHEET_LINK_ICONS){const svg=decodeURIComponent(worksheetLinkIconImage(item.value));assert.match(svg,/viewBox="0 0 24 24"/);assert.match(svg,/stroke-width="1.4"/);}
  assert.equal(worksheetLinkIconImage('<script>'),worksheetLinkIconImage('attachment'));
});

test('图标进入学习单保存载荷，单独修改图标可整体撤销与重做', async () => {
  const {buildPayload,createHistory,contentReducer,DEFAULT_SETTINGS,newQuestion}=await import('../app/teacher/worksheets/edit/worksheet-editor-core.ts');
  const q=newQuestion('short-answer');
  const original=insertPromptLink([], '',0,0,'教案','https://example.com/file','pdf')!;
  q.prompt=original.text;q.data.promptRuns=original.runs;
  const content={schemaVersion:1 as const,nodes:[q]};
  const changed=insertPromptLink(original.runs,original.text,0,original.text.length,original.text,'https://example.com/file','word')!;
  const history=contentReducer(createHistory(content),{kind:'updatePrompt',id:q.id,prompt:changed.text,data:{promptRuns:changed.runs}});
  assert.equal(history.past.length,1);
  const payload=buildPayload('链接图标测试','',DEFAULT_SETTINGS,history.present);
  const saved=JSON.parse(JSON.stringify(payload));
  assert.equal(saved.content.nodes[0].data.promptRuns[0].linkIcon,'word');
  assert.equal((contentReducer(history,{kind:'undo'}).present.nodes[0].data.promptRuns as typeof original.runs)[0].linkIcon,'pdf');
  const redone=contentReducer(contentReducer(history,{kind:'undo'}),{kind:'redo'});
  assert.equal((redone.present.nodes[0].data.promptRuns as typeof original.runs)[0].linkIcon,'word');
});
