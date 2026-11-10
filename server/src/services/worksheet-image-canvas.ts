export type CanvasWidgetKind = 'answer' | 'label' | 'hint';
export type CanvasRect = { x: number; y: number; width: number; height: number };
export const CANVAS_ANSWER_MODES = ['photo', 'audio', 'keyboard', 'handwriting', 'peer-audio', 'star-rating', 'region-match'] as const;
export const CANVAS_LINE_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none'] as const;
export type CanvasAnswerMode = typeof CANVAS_ANSWER_MODES[number];
export type CanvasLineStyle = typeof CANVAS_LINE_STYLES[number];
type DeskReview = { maxStars: 3 | 5; instruction: string };
export type CanvasMatchChoice = { id: string; text: string; source?: CanvasRect; color?: string; textColor?: string };
export type CanvasStarRating = { format: 'canvas-stars/v1'; stars: number; maxStars: number };
export const CANVAS_STAR_LIMIT = 5;
export const CANVAS_STAR_LABEL = '星级评价';
export const CANVAS_MATCH_FEEDBACK = { correct: '配对正确！', incorrect: '这里不匹配，再试一次。' } as const;
type CanvasMatchConfig = CanvasMatchChoice & { correct: string; incorrect: string };
export type CanvasMatchResult = { format: 'canvas-match/v1'; targetId: string; targetNumber: number; correct: boolean; feedback: string };
export type CanvasMatchMiss = { correct: false; feedback: string };
export type CanvasWidget = CanvasRect & { id: string; kind: CanvasWidgetKind; label: string; detail: string; borderColor?: string; backgroundColor?: string; textColor?: string; mode?: CanvasAnswerMode; deskReview?: DeskReview; maxStars?: number; matchConfig?: CanvasMatchConfig; matchShape?: 'rectangle' | 'ellipse'; borderStyle?: CanvasLineStyle; canvasEvaluation?: { mode: 'ai' | 'collect'; criteria: string; evaluationImages?: string[] } };
export type WorksheetImageCanvas = { url: string; width: number; height: number; widgets: CanvasWidget[]; matchTitle?: string; matchChoices?: CanvasMatchChoice[] };
export type DeskRating = { stars: number; maxStars: 3 | 5 };

export const CANVAS_WIDGET_LIMIT = 16;
export const CANVAS_MIN_WIDTH = 8;
export const CANVAS_MIN_HEIGHT = 5;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readCanvasColor(value: unknown): string | undefined {
  return typeof value === 'string' && (value === 'transparent' || /^#[\da-f]{6}$/i.test(value)) ? value : undefined;
}

function readDeskReview(value: unknown): DeskReview | null {
  const { maxStars, instruction } = record(value);
  return maxStars === 3 || maxStars === 5 ? { maxStars, instruction: typeof instruction === 'string' ? instruction.slice(0, 600) : '' } : null;
}

function validCanvasId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z\d-]{1,80}$/i.test(value) && !Object.prototype.hasOwnProperty.call(Object.prototype, value);
}

function validStarCount(count: unknown): count is number {
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= CANVAS_STAR_LIMIT;
}

export function readCanvasStarRating(value: unknown): CanvasStarRating | null {
  const { format, stars, maxStars } = record(value);
  return format === 'canvas-stars/v1' && validStarCount(maxStars) && validStarCount(stars) && stars <= maxStars
    ? { format, stars, maxStars } : null;
}

export function canvasStarText(rating: CanvasStarRating): string {
  return `${rating.stars} / ${rating.maxStars} 星`;
}

function readCanvasRect(value: unknown): CanvasRect | null {
  const { x, y, width, height } = record(value);
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || ![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < CANVAS_MIN_WIDTH || height < CANVAS_MIN_HEIGHT
    || x + width > 100.000001 || y + height > 100.000001) return null;
  return { x, y, width, height };
}

function readMatchChoice(value: unknown): CanvasMatchChoice | null {
  const { id, text, source, color, textColor } = record(value);
  const rect = readCanvasRect(source);
  const tint = readCanvasColor(color);
  const ink = readCanvasTextColor(textColor);
  return validCanvasId(id) && typeof text === 'string' ? { id, text: text.slice(0, 100), ...(rect ? { source: rect } : {}),
    ...(tint ? { color: tint } : {}), ...(ink ? { textColor: ink } : {}) } : null;
}

function readCanvasTextColor(value: unknown): string | undefined {
  return value === 'transparent' ? undefined : readCanvasColor(value);
}

function isCanvasImageUrl(url: unknown): url is string {
  return typeof url === 'string' && /^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))\/chat-[a-f0-9-]+\.(?:png|jpg|jpeg|webp)$/i.test(url);
}

export function isExpressionTask(type: string): boolean {
  return type === 'short-answer' || type === 'open-ended';
}

export function readImageCanvas(value: unknown): WorksheetImageCanvas | null {
  const { url, width, height, widgets, matchTitle, matchChoices } = record(value);
  if (!isCanvasImageUrl(url)
    || typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 20000
    || typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > 20000
    || !Array.isArray(widgets) || widgets.length > CANVAS_WIDGET_LIMIT) return null;
  const items: CanvasWidget[] = [];
  const ids = new Set<string>();
  let hasLegacyAnswer = false;
  for (const raw of widgets) {
    const widget = record(raw);
    const { id, kind, label, detail } = widget;
    const rect = readCanvasRect(widget);
    if (!validCanvasId(id) || ids.has(id)
      || (kind !== 'answer' && kind !== 'label' && kind !== 'hint')
      || (kind === 'answer' && (widget.mode === undefined ? hasLegacyAnswer : !CANVAS_ANSWER_MODES.includes(widget.mode as CanvasAnswerMode)))
      || !rect) return null;
    ids.add(id);
    const mode = kind === 'answer' ? widget.mode as CanvasAnswerMode | undefined : undefined;
    hasLegacyAnswer ||= kind === 'answer' && !mode;
    const borderStyle = CANVAS_LINE_STYLES.find(style => style === widget.borderStyle);
    const evaluation = record(widget.canvasEvaluation);
    const evaluationImages = evaluation.mode === 'ai' && Array.isArray(evaluation.evaluationImages)
      ? [...new Set(evaluation.evaluationImages.filter(isCanvasImageUrl))].slice(0, 6) : [];
    const canvasEvaluation = kind === 'answer' && mode !== 'region-match' && mode !== 'star-rating' && (evaluation.mode === 'ai' || evaluation.mode === 'collect')
      ? { mode: evaluation.mode, criteria: typeof evaluation.criteria === 'string' ? evaluation.criteria.slice(0, 4000) : '',
        ...(evaluationImages.length ? { evaluationImages } : {}) } as const
      : undefined;
    const borderColor = readCanvasColor(widget.borderColor);
    const backgroundColor = readCanvasColor(widget.backgroundColor);
    const textColor = readCanvasTextColor(widget.textColor);
    const deskReview = mode === 'peer-audio' ? readDeskReview(widget.deskReview) ?? { maxStars: 3 as const, instruction: '' } : null;
    const config = record(widget.matchConfig);
    const choice = mode === 'region-match' ? readMatchChoice(config) : null;
    const matchConfig = choice ? { ...choice, correct: typeof config.correct === 'string' ? config.correct.slice(0, 600) : '',
      incorrect: typeof config.incorrect === 'string' ? config.incorrect.slice(0, 600) : '' } : undefined;
    const widgetLabel = mode !== 'region-match' && typeof label === 'string' ? label.slice(0, 100) : '';
    items.push({ id, kind, ...rect, label: mode === 'star-rating' && widgetLabel.trim() === '同桌评星' ? CANVAS_STAR_LABEL : widgetLabel,
      detail: kind === 'hint' && typeof detail === 'string' ? detail.slice(0, 600) : '',
      ...(deskReview ? { deskReview } : {}),
      ...(mode === 'star-rating' ? { maxStars: validStarCount(widget.maxStars) ? widget.maxStars : CANVAS_STAR_LIMIT } : {}),
      ...(mode === 'region-match' ? { matchShape: widget.matchShape === 'ellipse' ? 'ellipse' as const : 'rectangle' as const } : {}),
      ...(matchConfig ? { matchConfig } : {}),
      ...(mode ? { mode } : {}), ...(canvasEvaluation ? { canvasEvaluation } : {}), ...(borderStyle ? { borderStyle } : {}),
      ...(borderColor ? { borderColor } : {}), ...(backgroundColor ? { backgroundColor } : {}), ...(textColor ? { textColor } : {}) });
  }
  const choices = Array.isArray(matchChoices) ? matchChoices.slice(0, CANVAS_WIDGET_LIMIT).map(readMatchChoice)
    .filter((choice): choice is CanvasMatchChoice => Boolean(choice?.text)) : [];
  return { url, width, height, widgets: items, ...(typeof matchTitle === 'string' ? { matchTitle: matchTitle.slice(0, 80) } : {}), ...(choices.length ? { matchChoices: choices } : {}) };
}

export function readDeskRating(value: unknown): DeskRating | null {
  const { stars, maxStars } = record(value);
  return (maxStars === 3 || maxStars === 5) && typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= maxStars
    ? { stars, maxStars } : null;
}

export function deskReviewSettings(node: { type: string; inputMode?: string; data: Record<string, unknown> }): { maxStars: 3 | 5; instruction: string } | null {
  if (!isExpressionTask(node.type) && node.type !== 'image-canvas') return null;
  const widgets = canvasAnswerWidgets(node);
  if (widgets.length ? !widgets.some(widget => canvasAnswerMode(node, widget) === 'audio') : node.inputMode !== 'audio') return null;
  return readDeskReview(node.data.deskReview);
}

type CanvasNode = { type: string; inputMode?: string; data: Record<string, unknown> };

export function canvasAnswerWidgets(node: CanvasNode): CanvasWidget[] {
  return readImageCanvas(node.data.imageCanvas)?.widgets.filter(widget => widget.kind === 'answer') ?? [];
}

export function usesCanvasAnswers(node: CanvasNode): boolean {
  return canvasAnswerWidgets(node).some(widget => widget.mode !== undefined);
}

export function canvasAnswerMode(node: Pick<CanvasNode, 'inputMode'>, widget: CanvasWidget): CanvasAnswerMode {
  return widget.mode ?? CANVAS_ANSWER_MODES.find(mode => mode === node.inputMode) ?? 'keyboard';
}

export function supportsCanvasAiReview(mode: CanvasAnswerMode): boolean {
  return mode === 'photo' || mode === 'audio' || mode === 'keyboard' || mode === 'handwriting';
}

export function canvasAutoReviewIds(node: CanvasNode): string[] {
  if (node.type !== 'image-canvas') return [];
  return canvasAnswerWidgets(node).filter(widget =>
    supportsCanvasAiReview(canvasAnswerMode(node, widget)) && widget.canvasEvaluation?.mode === 'ai'
    && widget.canvasEvaluation.criteria.trim(),
  ).map(widget => widget.id);
}

export function canvasDeskReviewSettings(node: CanvasNode, widget: CanvasWidget): DeskReview | null {
  const mode = canvasAnswerMode(node, widget);
  if (mode === 'peer-audio') return widget.deskReview ?? { maxStars: 3, instruction: '' };
  return mode === 'audio' ? deskReviewSettings(node) : null;
}

export function canvasMatchChoices(canvas: WorksheetImageCanvas): CanvasMatchChoice[] {
  return canvas.matchChoices ?? canvas.widgets.flatMap(widget => widget.matchConfig?.text.trim()
    ? [{ id: widget.matchConfig.id, text: widget.matchConfig.text.trim(),
      ...(widget.matchConfig.source ? { source: widget.matchConfig.source } : {}),
      ...(widget.matchConfig.color ? { color: widget.matchConfig.color } : {}),
      ...(widget.textColor ? { textColor: widget.textColor } : {}) }] : []).sort((a, b) => a.id.localeCompare(b.id));
}

export function canvasMatchSource(choice: CanvasMatchChoice, index: number): CanvasRect {
  return choice.source ?? { x: 4 + (index % 4) * 23, y: 4 + Math.floor(index / 4) * 7, width: 19, height: 6 };
}

export function canvasResponseKey(widget: CanvasWidget): string {
  return widget.matchConfig?.id ?? widget.id;
}

export function checkCanvasMatch(widgets: CanvasWidget[], choiceId: unknown, targetId: unknown): CanvasMatchResult | null {
  const targets = widgets.filter(widget => widget.mode === 'region-match');
  const source = targets.find(widget => widget.matchConfig?.id === choiceId);
  const targetIndex = targets.findIndex(widget => widget.id === targetId);
  if (!source?.matchConfig || typeof targetId !== 'string' || targetIndex < 0) return null;
  const correct = source.id === targetId;
  const outcome = correct ? 'correct' : 'incorrect';
  const feedback = source.matchConfig[outcome].trim() || CANVAS_MATCH_FEEDBACK[outcome];
  return { format: 'canvas-match/v1', targetId, targetNumber: targetIndex + 1, correct, feedback };
}

export function checkCanvasMatchAttempt(widgets: CanvasWidget[], choiceId: unknown, targetId: unknown): CanvasMatchResult | CanvasMatchMiss | null {
  if (targetId !== null) return checkCanvasMatch(widgets, choiceId, targetId);
  const config = widgets.find(widget => widget.mode === 'region-match' && widget.matchConfig?.id === choiceId)?.matchConfig;
  return config ? { correct: false, feedback: config.incorrect.trim() || CANVAS_MATCH_FEEDBACK.incorrect } : null;
}

export function readCanvasMatch(value: unknown): CanvasMatchResult | null {
  const { format, targetId, targetNumber, correct, feedback } = record(value);
  return format === 'canvas-match/v1' && validCanvasId(targetId) && typeof targetNumber === 'number' && Number.isInteger(targetNumber)
    && targetNumber > 0 && targetNumber <= CANVAS_WIDGET_LIMIT && typeof correct === 'boolean' && typeof feedback === 'string'
    ? { format, targetId, targetNumber, correct, feedback } : null;
}

export function canvasMatchText(result: CanvasMatchResult): string {
  return `区域 ${result.targetNumber} · ${result.correct ? '配对正确' : '配对错误'} · ${result.feedback}`;
}

export function readCanvasAnswers(value: unknown): Record<string, unknown> | null {
  const row = record(value);
  return row.format === 'image-canvas/v1' ? record(row.answers) : null;
}

export function canvasAnswerFormatMatches(mode: CanvasAnswerMode, value: unknown): boolean {
  const format = record(value).format;
  switch (mode) {
    case 'star-rating': return format === 'canvas-stars/v1';
    case 'region-match': return format === 'canvas-match/v1';
    case 'photo': return format === 'photo/v1';
    case 'peer-audio':
    case 'audio': return format === 'audio/v1';
    case 'handwriting': return format === 'ink/v1';
    case 'keyboard': return format === 'text/v1';
  }
}

export function canvasAnswerEntries(node: CanvasNode | undefined, value: unknown) {
  const parts = readCanvasAnswers(value);
  if (!parts) return null;
  const canvas = node ? readImageCanvas(node.data.imageCanvas) : null;
  const widgets = canvas?.widgets.filter(widget => widget.kind === 'answer') ?? [];
  const choices = canvas ? canvasMatchChoices(canvas) : [];
  return Object.entries(parts).filter(([, part]) => !readCanvasAnswers(part)).map(([id, part], index) => {
    const position = widgets.findIndex(widget => canvasResponseKey(widget) === id);
    const result = readCanvasMatch(part);
    const label = choices.find(choice => choice.id === id)?.text || widgets[position]?.label || (widgets[position]?.mode === 'star-rating' ? CANVAS_STAR_LABEL : '') || `作答区 ${position < 0 ? index + 1 : position + 1}`;
    const rating = readCanvasStarRating(part);
    return { id, label, value: rating ? { format: 'text/v1', text: canvasStarText(rating) } : result ? { format: 'text/v1', text: canvasMatchText(result) } : part };
  });
}
