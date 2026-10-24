import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export class AnnotationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function annotationTarget(value: unknown): { target: string; targetKey: string } {
  if (typeof value !== 'string' || !value || value.length > 100000) throw new AnnotationError('批注对象无效');
  return { target: value, targetKey: crypto.createHash('sha256').update(value).digest('hex') };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Never store HTML or executable content. Limits also bound the cost of SVG rendering. */
export function annotationDocument(value: unknown): Prisma.InputJsonObject {
  if (!record(value) || value.version !== 1 || !['image', 'text'].includes(String(value.kind)) || !Array.isArray(value.strokes) || value.strokes.length > 2000) throw new AnnotationError('批注数据无效');
  let points = 0;
  const ids = new Set<number>();
  const strokes = value.strokes.map(stroke => {
    if (!record(stroke) || !Number.isSafeInteger(stroke.id) || (stroke.id as number) < 1 || ids.has(stroke.id as number) || !['pen', 'highlight'].includes(String(stroke.tool)) || typeof stroke.color !== 'string' || !/^#[\da-f]{6}$/i.test(stroke.color) || !number(stroke.width, .001, 1000) || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 10000) throw new AnnotationError('笔迹数据无效');
    ids.add(stroke.id as number);
    points += stroke.points.length;
    if (points > 100000) throw new AnnotationError('批注过多，请适当清理后重试');
    return { id: stroke.id as number, tool: stroke.tool as string, color: stroke.color, width: stroke.width, points: stroke.points.map(point => {
      if (!record(point) || !number(point.x, -100000, 100000) || !number(point.y, -100000, 100000)) throw new AnnotationError('笔迹坐标无效');
      return { x: point.x, y: point.y };
    }) };
  });
  let frame: Prisma.InputJsonObject | undefined;
  if (value.kind === 'text' && strokes.length) {
    const f = value.frame;
    if (!record(f) || !number(f.width, 1, 20000) || !number(f.height, 1, 20000) || !number(f.textSize, 18, 48) || !Array.isArray(f.scroll) || f.scroll.length > 10000) throw new AnnotationError('文字批注画面无效');
    frame = { width: f.width, height: f.height, textSize: f.textSize, scroll: f.scroll.map(position => {
      if (!record(position) || !number(position.top, 0, 10000000) || !number(position.left, 0, 10000000)) throw new AnnotationError('批注滚动位置无效');
      return { top: position.top, left: position.left };
    }) };
  }
  return { version: 1, kind: value.kind as string, strokes, ...(frame ? {frame} : {}) };
}

export async function readAnnotation(prisma: PrismaClient, classroomId: string, target: unknown) {
  const { targetKey } = annotationTarget(target);
  if (!await prisma.classroom.findUnique({where:{id:classroomId},select:{id:true}})) throw new AnnotationError('课堂不存在', 404);
  const row = await prisma.classroomAnnotation.findUnique({where:{classroomId_targetKey:{classroomId,targetKey}}});
  return { document: row?.document ?? null, revision: row?.revision ?? 0 };
}

export async function saveAnnotation(prisma: PrismaClient, classroomId: string, targetValue: unknown, value: unknown, revision: unknown) {
  const {target, targetKey} = annotationTarget(targetValue);
  const document = annotationDocument(value);
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new AnnotationError('批注版本无效');
  if (!await prisma.classroom.findUnique({where:{id:classroomId},select:{id:true}})) throw new AnnotationError('课堂不存在', 404);
  if (revision === 0) {
    try { await prisma.classroomAnnotation.create({data:{classroomId,targetKey,target,document}}); }
    catch (error) { if ((error as {code?:string}).code === 'P2002') throw new AnnotationError('批注已在其他窗口更新，请重新打开后再批注', 409); throw error; }
  } else {
    const result = await prisma.classroomAnnotation.updateMany({where:{classroomId,targetKey,revision:revision as number},data:{document,revision:{increment:1}}});
    if (!result.count) throw new AnnotationError('批注已在其他窗口更新，请重新打开后再批注', 409);
  }
  return { revision: (revision as number) + 1 };
}
