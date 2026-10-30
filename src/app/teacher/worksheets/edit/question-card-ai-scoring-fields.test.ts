import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const card=fs.readFileSync(new URL('./question-card.tsx',import.meta.url),'utf8');
const editor=fs.readFileSync(new URL('./evaluation-settings.tsx',import.meta.url),'utf8');
const fill=fs.readFileSync(new URL('./bodies/fill-blanks-body.tsx',import.meta.url),'utf8');
test('所有题型和逐空设置使用统一评价组件，去掉三个重复输入区',()=>{
 assert.match(card, /<EvaluationSettings/);assert.match(fill, /<EvaluationSettings/);
 for(const old of ['worksheet-editor-reference-block','worksheet-editor-evaluation-basis','analysis-focus-${node.id}']) assert.equal(card.includes(old),false);
 assert.equal((editor.match(/<textarea/g)||[]).length,1);
});
test('图片上传与文字要求同时显示，可以多张上传与单张移除',()=>{
 assert.match(editor,/api.uploadWorksheetImage/);assert.match(editor,/type="file" multiple/);
 assert.match(editor,/onImagesUploaded\(urls\)/);
 assert.ok(!editor.includes('latest.current'),'上传不能直接回写旧设置');
 assert.match(editor,/evaluationImages:images.filter/);assert.match(editor,/文字、图片可单独使用，也可共同作为依据/);
});
test('表达评价提交后自动进行，无需分数也能得到建议',()=>{
 assert.match(editor,/计入成绩/);assert.match(editor,/提交后自动评价/);
 assert.match(editor,/只给评价与建议，不产生分数/);assert.match(editor,/onTriggerChange/);
});
test('流程图结构模板仍按正确分支标注追加到统一要求中',()=>{
 assert.match(card,/readDrawingTool\(node\) === 'flowchart'/);
 assert.match(card,/标注 是\/否/);assert.match(editor,/requirements \? `\$\{requirements\}\\n\$\{template\}`/);
});
