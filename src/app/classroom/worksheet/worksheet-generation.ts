export interface WorksheetGeneration { all: number; questions: Record<string, number> }
export function normalizeGeneration(value: unknown): WorksheetGeneration {
  if (!value || typeof value !== 'object') return { all: 0, questions: {} };
  const row = value as WorksheetGeneration;
  return Number.isSafeInteger(row.all) && row.all >= 0 && row.questions && typeof row.questions === 'object' && !Array.isArray(row.questions) && Object.values(row.questions).every(n => Number.isSafeInteger(n) && n >= 0) ? row : { all: 0, questions: {} };
}
export function generationFor(state: WorksheetGeneration, questionId: string): string {
  return `${state.all}:${Object.prototype.hasOwnProperty.call(state.questions, questionId) ? state.questions[questionId] : 0}`;
}

export function retainCurrentGeneration<T extends { questionId: string; generation?: string }>(items: T[], state: WorksheetGeneration): T[] {
  return items.filter(item => (item.generation ?? '0:0') === generationFor(state, item.questionId));
}
