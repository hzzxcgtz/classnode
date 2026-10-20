import type { PrismaClient } from '@prisma/client';

export class ClassroomArchiveError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** One read transaction: never mix records from two database revisions. Credentials are never selected. */
export async function loadClassroomArchive(prisma: PrismaClient, classroomId: string, options: { requireEnded?: boolean } = {}) {
  return prisma.$transaction(async tx => {
    const classroom = await tx.classroom.findUnique({
      where: { id: classroomId },
      include: {
        classes: { include: { class: { select: { id: true, name: true } } } },
        groups: { include: { members: true, materials: true }, orderBy: { id: 'asc' } },
        modules: true,
        classroomAgents: { select: { agentId: true } },
        worksheets: { select: { worksheetId: true }, orderBy: { createdAt: 'asc' } },
        webapps: { select: { webappId: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!classroom) throw new ClassroomArchiveError('课堂不存在', 404);
    if (options.requireEnded !== false && classroom.status !== 'ended') throw new ClassroomArchiveError('请先结束课堂，再导出课堂资料包。', 409);
    const participants = await tx.classroomStudent.findMany({
      where: { classroomId },
      include: { student: { select: { id: true, name: true, studentNo: true, gender: true, classId: true } }, messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ joinTime: 'asc' }, { id: 'asc' }],
    });
    const responses = await tx.worksheetResponse.findMany({ where: { classroomId }, include: { answers: { include: { reviews: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }, orderBy: { questionId: 'asc' } } }, orderBy: { id: 'asc' } });
    const analyses = await tx.worksheetQuestionAnalysis.findMany({ where: { classroomId }, orderBy: { computedAt: 'asc' } });
    const usages = await tx.webappUsage.findMany({ where: { classroomId }, orderBy: { createdAt: 'asc' } });
    const notifications = await tx.teacherNotification.findMany({ where: { classroomId }, orderBy: { createdAt: 'asc' } });
    const warnings = await tx.shieldWarning.findMany({ where: { classroomId }, orderBy: { createdAt: 'asc' } });
    const interactions = await tx.interaction.findMany({ where: { classroomId }, orderBy: { createdAt: 'asc' } });
    const groupMaterials = classroom.groups.flatMap(g => g.materials);
    const ids = (values: (string | null | undefined)[]) => [...new Set(values.filter((id): id is string => Boolean(id)))];
    const worksheets = await tx.worksheet.findMany({ where: { id: { in: ids([...classroom.worksheets.map(w => w.worksheetId), ...responses.map(r => r.worksheetId), ...analyses.map(a => a.worksheetId), ...groupMaterials.filter(m => m.kind === 'worksheet').map(m => m.targetId)]) } } });
    const webapps = await tx.webapp.findMany({ where: { id: { in: ids([...classroom.webapps.map(w => w.webappId), ...usages.map(u => u.webappId), ...groupMaterials.filter(m => m.kind === 'webapp').map(m => m.targetId)]) } } });
    const agents = await tx.agent.findMany({ where: { id: { in: ids([...classroom.classroomAgents.map(a => a.agentId), ...participants.flatMap(p => p.messages.map(m => m.agentId)), ...analyses.map(a => a.agentId), ...groupMaterials.filter(m => m.kind === 'agent').map(m => m.targetId)]) } }, select: { id: true, name: true, platform: true, purpose: true, greeting: true, createdAt: true, updatedAt: true } });
    return { classroom, participants, responses, analyses, usages, notifications, warnings, interactions, worksheets, webapps, agents };
  }, { timeout: 60000 });
}
export type ClassroomArchiveData = Awaited<ReturnType<typeof loadClassroomArchive>>;
