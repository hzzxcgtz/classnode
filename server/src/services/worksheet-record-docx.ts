import { Document, Packer, Paragraph } from 'docx';
import type { ClassroomArchiveData } from './classroom-archive-data.js';
import { flattenAnswerable } from './worksheet-heading.js';
import type { QuestionNode } from './worksheet-questions.js';
import { aiScoringConfigOf } from './analysis-scoring.js';
import { answerCell, gradeLabel, REPORT_TEXT } from './worksheet-report.js';
import { inkHasContent } from './ink-path.js';
import { inkToPng } from './ink-render.js';
import { resolveMaterialTargetId } from './group-material-resolve.js';
import { WORD_PAGE, WORD_STYLES, wordFooter, wordParagraph, wordMeta, readWordImage, wordImage } from './worksheet-docx-layout.js';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const when = (v: Date | null) => v ? v.toLocaleString('zh-CN', { hour12: false }) : '未记录';
/** Resolve only the student's selected entries; reference answers are never inserted into this document. */
export function studentAnswerText(value: unknown, node?: QuestionNode): string | null {
  const row = record(value), data = record(node?.data);
  const names = (items: unknown) => new Map(array(items).map(record).map(item => [String(item.id ?? item.key), String(item.text ?? item.label ?? '')]));
  const lookup = (items: unknown, id: unknown) => names(items).get(String(id)) || '原条目已无法关联';
  if (row.format === 'order/v1') return array(row.order).map((id, i) => `${i + 1}. ${lookup(data.items, id)}`).join('\n') || '未排列条目';
  if (row.format === 'match/v1') return array(row.pairs).map(record).map(pair => `${lookup(data.left, pair.leftId)} → ${lookup(data.right, pair.rightId)}`).join('\n') || '未连线';
  if (row.format === 'categorize/v1') return Object.entries(record(row.assignment)).map(([id, zone]) => `${lookup(data.items, id)} → ${lookup(data.zones, zone)}`).join('\n') || '未归类';
  if (row.format === 'choice/v1') return array(row.selected).map(String).map(key => node?.type === 'true-false' ? key === 'T' ? '对' : key === 'F' ? '错' : key : key).join('、') || '未选择';
  if (row.format === 'fill-multi/v1') return array(row.texts).map((text, i) => `第 ${i + 1} 空：${String(text)}`).join('\n');
  return null;
}
export async function buildWorksheetRecordDocx(data: ClassroomArchiveData): Promise<Buffer> {
  const c = data.classroom;
  const blocks: Paragraph[] = [
    wordParagraph('学生作答记录', { style: 'Title' }),
    wordParagraph(c.title || '未命名课堂', { spacing: { after: 100 }, keepNext: true }),
    wordMeta(`${c.classes.map(item => item.class.name).join('、') || '未关联班级'}　课堂结束 ${when(c.endedAt)}`, { spacing: { after: 180 } }),
    wordMeta('题号与随附教师参考学习单一致。以下保留学生作答及已有评价；小组记录为共同作答。', { spacing: { after: 180 } }),
  ];
  const writeAnswer = async (value: unknown, node?: QuestionNode) => {
    const readable = studentAnswerText(value, node);
    if (readable !== null) { blocks.push(wordParagraph(readable)); return; }
    const cell = answerCell(value);
    if (cell.kind === 'text') blocks.push(wordParagraph(cell.text));
    else if (cell.kind === 'unanswered') blocks.push(wordParagraph(REPORT_TEXT.unanswered));
    else if (cell.kind === 'cleared') blocks.push(wordParagraph(REPORT_TEXT.cleared));
    else {
      const png = cell.kind === 'image' ? await readWordImage(cell.url) : inkHasContent(cell.ink) ? await inkToPng(cell.ink) : null;
      if (png) blocks.push(wordImage(png, '学生作品'));
      else blocks.push(wordParagraph(cell.kind === 'image' ? REPORT_TEXT.imageFallback : inkHasContent(cell.ink) ? REPORT_TEXT.inkFallback : REPORT_TEXT.inkEmpty));
    }
  };
  if (!data.participants.length) blocks.push(wordParagraph('本堂课没有已保存的学生参与记录。'));
  for (const [index, p] of data.participants.entries()) {
    const group = c.groups.find(group => group.id === p.groupId);
    const name = p.student?.name || group?.name || '未命名参与者';
    blocks.push(wordParagraph(name, { style: 'Heading1', pageBreakBefore: index > 0 }));
    if (p.type === 'group') blocks.push(wordMeta(`小组共同作答　组员：${group?.members.map(member => `${member.name}${member.studentNo ? `（${member.studentNo}）` : ''}`).join('、') || '未记录'}`, { keepNext: true }));
    else if (p.student?.studentNo) blocks.push(wordMeta(`学号 ${p.student.studentNo}`, { keepNext: true }));
    const assigned = resolveMaterialTargetId({ mode: c.mode, studentGroupId: p.groupId, groupMaterials: c.groups.flatMap(g => g.materials.map(m => ({ groupId: g.id, kind: m.kind, targetId: m.targetId }))), classroomLevelId: c.worksheets[0]?.worksheetId || null, kind: 'worksheet' });
    const responses = data.responses.filter(r => r.participantId === p.id);
    const sheetIds = [...new Set([assigned, ...responses.map(r => r.worksheetId)].filter((id): id is string => !!id))];
    if (!sheetIds.length) blocks.push(wordParagraph('没有可作答的学习单，也没有已保存的历史作答。'));
    for (const sheetId of sheetIds) {
      const sheet = data.worksheets.find(s => s.id === sheetId);
      blocks.push(wordParagraph(`学习单　${sheet?.title || '原学习单已无法关联'}`, { style: 'Heading2' }));
      const response = responses.find(r => r.worksheetId === sheetId);
      const source = record(sheet?.content);
      let questions: { node: QuestionNode; heading: string }[] = [];
      try { questions = flattenAnswerable(array(source.nodes) as QuestionNode[]); } catch { /* Saved answer rows below still export. */ }
      const ids = [...new Set([...questions.map(q => q.node.id), ...(response?.answers.map(a => a.questionId) || [])])];
      if (!ids.length) blocks.push(wordParagraph('本学习单没有可导出的任务或作答记录。'));
      for (const id of ids) {
        const q = questions.find(q => q.node.id === id);
        const a = response?.answers.find(a => a.questionId === id);
        const result = q?.node.autoGrade === false && !aiScoringConfigOf(q.node).enabled ? '信息收集，不计分' : a ? `${gradeLabel(a)}${a.score === null ? '' : `　得分 ${a.score}`}` : '未作答';
        blocks.push(wordParagraph(`${q?.heading || '原任务'}　${result}`, { style: 'Heading2' }));
        await writeAnswer(a ? a.value : undefined, q?.node);
        if (a) blocks.push(wordMeta(`${a.status === 'submitted' ? '已提交' : '草稿'}　${a.submittedAt ? `提交 ${when(a.submittedAt)}` : `保存 ${when(a.savedAt)}`}`, { spacing: { after: 120 } }));
        for (const analysis of data.analyses.filter(row => row.worksheetId === sheetId && row.questionId === id)) {
          const stored = record(analysis.perStudent);
          const matches = (row: Record<string, unknown>) => row.studentId === p.id || Boolean(p.studentId && row.studentId === p.studentId);
          const score = array(stored.scores).map(record).find(matches);
          const feedback = array(record(stored.analysisFeedback).students).map(record).find(matches);
          if (score || feedback) {
            blocks.push(wordMeta(`教师分析中的评价　${when(analysis.analyzedAt)}`, { keepNext: true }));
            if (score && typeof score.reason === 'string') blocks.push(wordParagraph(`评价：${score.reason}`));
            const advice = feedback?.advice || score?.advice;
            if (typeof advice === 'string') blocks.push(wordParagraph(`建议：${advice}`));
          }
        }
        for (const [reviewIndex, review] of (a?.reviews || []).entries()) {
          blocks.push(wordParagraph(`第 ${reviewIndex + 1} 次作品与评价　${when(review.createdAt)}`, { keepNext: true, spacing: { before: 160, after: 80 } }));
          await writeAnswer(review.value, (record(review.question).node || review.question) as QuestionNode);
          blocks.push(wordParagraph(`${({ pending: '评价中', succeeded: '评价成功', failed: '评价失败', superseded: '历史评价，不计入当前成绩' } as Record<string, string>)[review.status] || review.status}${review.score === null ? '' : `　${review.score} / ${review.maxScore} ${review.unit}`}`));
          if (review.reason) blocks.push(wordParagraph(`评价：${review.reason}`));
          if (review.advice) blocks.push(wordParagraph(`建议：${review.advice}`));
          if (review.error) blocks.push(wordParagraph(`评价未完成：${review.error}`));
        }
      }
    }
  }
  return Packer.toBuffer(new Document({ title: `${c.title || '课堂'} 学生作答记录`, creator: '支点课堂 ClassNode', styles: WORD_STYLES, sections: [{ properties: { page: WORD_PAGE }, children: blocks, footers: { default: wordFooter() } }] }));
}
