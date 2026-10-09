import type { PrismaClient } from '@prisma/client';
export interface AnswerGeneration { all: number; questions: Record<string, number> }
const keyOf = (classroomId: string, worksheetId: string, participantId: string) => `answer-generation:${classroomId}:${worksheetId}:${participantId}`;
export async function readAnswerGeneration(prisma: PrismaClient, classroomId: string, worksheetId: string, participantId: string): Promise<AnswerGeneration> {
  const row = await prisma.setting.findUnique({ where: { key: keyOf(classroomId, worksheetId, participantId) } });
  if (!row) return { all: 0, questions: {} };
  const value = JSON.parse(row.value) as AnswerGeneration;
  if (!Number.isSafeInteger(value.all) || value.all < 0 || !value.questions || typeof value.questions !== 'object' || Array.isArray(value.questions) || Object.values(value.questions).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('作答版本数据无效');
  return value;
}
export function answerGenerationFor(state: AnswerGeneration, questionId: string): string {
  return `${state.all}:${Object.hasOwn(state.questions, questionId) ? state.questions[questionId] : 0}`;
}
export async function advanceAnswerGeneration(prisma: PrismaClient, classroomId: string, worksheetId: string, participantId: string, questionId: string | null): Promise<AnswerGeneration> {
  const state = await readAnswerGeneration(prisma, classroomId, worksheetId, participantId);
  if (questionId) state.questions = { ...state.questions, [questionId]: (Object.hasOwn(state.questions, questionId) ? state.questions[questionId] : 0) + 1 };
  else { state.all++; state.questions = {}; }
  const key = keyOf(classroomId, worksheetId, participantId);
  await prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
  return state;
}
