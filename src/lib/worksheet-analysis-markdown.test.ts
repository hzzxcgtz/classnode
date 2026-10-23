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

 test('截图中的括号结尾标题紧接箭头时可以正确闭合加粗', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('- **表现二：漏选D选项（部分正确）**→作答证据：11名学生只选AB\n- **表现三：错选C选项（答错） **→作答证据：7名学生选AC'),
    '- **表现二：漏选D选项（部分正确）** →作答证据：11名学生只选AB\n- **表现三：错选C选项（答错）** →作答证据：7名学生选AC',
  );
});

test('旧报告总标题隐藏，核心结论与正文保留', () => {
  assert.equal(normalizeWorksheetAnalysisMarkdown('## 一、班级分析\n\n### 核心结论\n保留**关键概念**。'), '### 核心结论\n保留**关键概念**。');
});

test('引号包裹的重点紧接中文与冒号时补齐强调边界', () => {
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('写记事小短文要**“选小事、抓细节”**：先确定一件课间发生的小事。'),
    '写记事小短文要 **“选小事、抓细节”** ：先确定一件课间发生的小事。',
  );
  assert.equal(
    normalizeWorksheetAnalysisMarkdown('先用**“动作”**写具体，再用**“语言”**补细节。'),
    '先用 **“动作”** 写具体，再用 **“语言”** 补细节。',
  );
});

test('智能体返回普通文字或引用中的小节名时仍显示为标题', () => {
  assert.equal(normalizeWorksheetAnalysisMarkdown('> 核心结论\n> 保留正文。\n\n典型表现与作答依据\n正文\n\n关键认识或方法\n正文\n\n课堂讲评方案\n正文\n\n讲评后检查\n正文'), '### 核心结论\n> 保留正文。\n\n### 典型表现与作答依据\n正文\n\n### 关键认识或方法\n正文\n\n### 课堂讲评方案\n正文\n\n### 讲评后检查\n正文');
});


test('信息收集报告的小节保留专用结构，不改写为教学讲评标题', () => {
  for (const title of ['主要发现', '值得关注的差异', '后续建议']) {
    assert.equal(normalizeWorksheetAnalysisMarkdown(title + '\n实际内容'), '### ' + title + '\n实际内容');
  }
});

test('报告内独立列项分行，连续引用保留段落、学生名单链接与代码', () => {
  const input = '典型表现与作答依据\n优秀作答：[查看名单](#classnode-group-g1) 的作答：①“调整风车”是具体小事；②“举着跑”是具体动作；③有心情。\n\n课堂讲评方案\n1. 阅读[查看名单](#classnode-group-g1)的作答；2. 对比第①项；3. 学生修改。\n\n示例：`1.5；2.5`';
  const formatted = normalizeWorksheetAnalysisMarkdown(input);
  assert.ok(formatted.includes('的作答：①“调整风车”是具体小事；②“举着跑”是具体动作；③有心情。'));
  assert.ok(formatted.includes('\n2. 对比第①项\n3. 学生修改。'));
  assert.ok(formatted.includes('[查看名单](#classnode-group-g1)'));
  assert.ok(formatted.includes('`1.5；2.5`'));
  assert.equal(normalizeWorksheetAnalysisMarkdown(formatted),formatted);
});

test('作答实例、问题实例和追问各起一段，并保持格式稳定', () => {
  const input = '优秀作答实例：[罗同学](#classnode-group-g1)的作答：①“风车”具体；②“举着跑”是动作；③有心情。主要问题实例：[丁同学](#classnode-group-g2)的第①项笼统。可验证追问：“具体玩了哪件小事？”';
  const result = normalizeWorksheetAnalysisMarkdown(input);
  assert.ok(result.includes('。\n\n主要问题实例：'));
  assert.ok(result.includes('。\n\n可验证追问：'));
  assert.ok(result.includes('①“风车”具体；②“举着跑”是动作；③有心情。'));
  assert.ok(result.includes('[丁同学](#classnode-group-g2)'));
  assert.equal(normalizeWorksheetAnalysisMarkdown(result), result);
  assert.equal(normalizeWorksheetAnalysisMarkdown('**优秀作答实例：** 好。 **主要问题实例：** 待改。 **可验证追问：** 为什么？'), '**优秀作答实例：** 好。\n\n**主要问题实例：** 待改。\n\n**可验证追问：** 为什么？');
});
