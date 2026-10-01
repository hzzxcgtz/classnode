import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorksheetAnalysisMarkdown } from './worksheet-analysis-markdown.ts';

test('修正结束标记前带空格的加粗文本', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('**作答结构： **整体分为三层'),
    '**作答结构：** 整体分为三层',
  );
});

test('字段标签的闭合星号后紧接中文时补空格，避免跨片段错误加粗', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('**主要表现：**学生掌握**45×2=90**、**125×8=1000**两组口算。'),
    '**主要表现：** 学生掌握**45×2=90**、**125×8=1000**两组口算。',
  );
});

test('只修正冒号标签，不扩大普通加粗范围', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('这是**只记结论不理解逻辑**的表现，结论为**正确**。'),
    '这是**只记结论不理解逻辑**的表现，结论为**正确**。',
  );
});

test('压缩连续空行并保留正常段落', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('### 作答解读\n\n\n\n第一段\n\n第二段   '),
    '### 作答解读\n\n第一段\n\n第二段',
  );
});

test('兼容 CRLF 且不改动正常 Markdown', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('### 标题\r\n\r\n- **结论：** 内容'),
    '### 标题\n\n- **结论：** 内容',
  );
});
