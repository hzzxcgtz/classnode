import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

type LegacyGroup = { id: string; classroomId: string; name: string };
type ClassroomClassRow = { classId: string };
type ClassGroupRow = { id: string; studentIds: string };
type StudentRow = { id: string; name: string; studentNo: string | null };

/**
 * 将旧版“虚拟小组 Student”转换为真正的小组参与者。
 *
 * ClassroomStudent 的 id 一直是消息所引用的稳定参与者 ID；迁移只把其
 * studentId 置空并标记 type=group，因此历史消息无需搬表也不会丢失。
 */
export async function migrateClassroomParticipants(prisma: PrismaClient): Promise<void> {
  const groupMemberTable = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='ClassroomGroupMember'`,
  );
  if (groupMemberTable.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomGroupMember" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "classroomId" TEXT NOT NULL REFERENCES "Classroom"("id") ON DELETE CASCADE,
      "groupId" TEXT NOT NULL REFERENCES "ClassroomGroup"("id") ON DELETE CASCADE,
      "studentId" TEXT,
      "name" TEXT NOT NULL,
      "studentNo" TEXT
    )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomGroupMember_groupId_studentId_key" ON "ClassroomGroupMember"("groupId", "studentId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroupMember_classroomId_idx" ON "ClassroomGroupMember"("classroomId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroupMember_groupId_idx" ON "ClassroomGroupMember"("groupId")`);
  }

  const groupColumns = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('ClassroomGroup')`);
  if (!groupColumns.some(column => column.name === 'sourceClassGroupId')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ClassroomGroup" ADD COLUMN "sourceClassGroupId" TEXT`);
  }

  // Interaction 的旧 studentId 保存的是 Student.id；新的语义为课堂参与者 ID。
  // 在改造 ClassroomStudent 前完成映射，标准模式与小组模式都可无损转换。
  await prisma.$executeRawUnsafe(`UPDATE "Interaction"
    SET "studentId" = (
      SELECT cs."id" FROM "ClassroomStudent" cs
      WHERE cs."classroomId" = "Interaction"."classroomId"
        AND cs."studentId" = "Interaction"."studentId"
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM "ClassroomStudent" cs
      WHERE cs."classroomId" = "Interaction"."classroomId"
        AND cs."studentId" = "Interaction"."studentId"
    )`);

  // 警告与定向通知同样曾保存 Student.id；统一改为课堂参与者 ID，
  // 否则迁移后历史警告会显示“未知”，离线通知也无法被目标参与者恢复。
  await prisma.$executeRawUnsafe(`UPDATE "ShieldWarning"
    SET "studentId" = (
      SELECT cs."id" FROM "ClassroomStudent" cs
      WHERE cs."classroomId" = "ShieldWarning"."classroomId"
        AND cs."studentId" = "ShieldWarning"."studentId"
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM "ClassroomStudent" cs
      WHERE cs."classroomId" = "ShieldWarning"."classroomId"
        AND cs."studentId" = "ShieldWarning"."studentId"
    )`);
  await prisma.$executeRawUnsafe(`UPDATE "TeacherNotification"
    SET "studentId" = (
      SELECT cs."id" FROM "ClassroomStudent" cs
      WHERE cs."classroomId" = "TeacherNotification"."classroomId"
        AND cs."studentId" = "TeacherNotification"."studentId"
      LIMIT 1
    )
    WHERE "studentId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "ClassroomStudent" cs
      WHERE cs."classroomId" = "TeacherNotification"."classroomId"
        AND cs."studentId" = "TeacherNotification"."studentId"
    )`);

  const studentColumns = await prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>(`PRAGMA table_info('ClassroomStudent')`);
  const needsParticipantShape = !studentColumns.some(column => column.name === 'type')
    || studentColumns.find(column => column.name === 'studentId')?.notnull === 1;

  if (needsParticipantShape) {
    // SQLite 不支持直接移除 NOT NULL，使用保留 ID 的重建方式迁移。
    await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "new_ClassroomStudent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "classroomId" TEXT NOT NULL REFERENCES "Classroom"("id") ON DELETE CASCADE,
      "type" TEXT NOT NULL DEFAULT 'student',
      "studentId" TEXT REFERENCES "Student"("id") ON DELETE CASCADE,
      "groupId" TEXT REFERENCES "ClassroomGroup"("id"),
      "joinTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "status" TEXT NOT NULL DEFAULT 'offline',
      "totalRounds" INTEGER NOT NULL DEFAULT 0,
      "warningCount" INTEGER NOT NULL DEFAULT 0,
      "blacklisted" BOOLEAN NOT NULL DEFAULT 0
    )`);
    await prisma.$executeRawUnsafe(`INSERT INTO "new_ClassroomStudent" (
      "id", "classroomId", "type", "studentId", "groupId", "joinTime", "status", "totalRounds", "warningCount", "blacklisted"
    ) SELECT cs."id", cs."classroomId",
      CASE WHEN s."tag" = '__group__' THEN 'group' ELSE 'student' END,
      CASE WHEN s."tag" = '__group__' THEN NULL ELSE cs."studentId" END,
      cs."groupId", cs."joinTime", cs."status", cs."totalRounds", cs."warningCount", cs."blacklisted"
    FROM "ClassroomStudent" cs
    LEFT JOIN "Student" s ON s."id" = cs."studentId"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "ClassroomStudent"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "new_ClassroomStudent" RENAME TO "ClassroomStudent"`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomStudent_classroomId_studentId_key" ON "ClassroomStudent"("classroomId", "studentId")`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomStudent_classroomId_groupId_key" ON "ClassroomStudent"("classroomId", "groupId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomStudent_classroomId_status_idx" ON "ClassroomStudent"("classroomId", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomStudent_studentId_idx" ON "ClassroomStudent"("studentId")`);
    await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  }

  // 旧课堂没有成员快照：首次迁移时从同班级、同名的 ClassGroup 建立快照。
  // 若教师后来修改过分组，无法凭空恢复历史，只能冻结当前可获得的数据。
  const groups = await prisma.$queryRawUnsafe<LegacyGroup[]>(`SELECT "id", "classroomId", "name" FROM "ClassroomGroup"`);
  for (const group of groups) {
    const existing = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*) AS count FROM "ClassroomGroupMember" WHERE "groupId" = ?`, group.id,
    );
    if (Number(existing[0]?.count || 0) > 0) continue;

    const classroomClass = await prisma.$queryRawUnsafe<ClassroomClassRow[]>(
      `SELECT "classId" FROM "ClassroomClass" WHERE "classroomId" = ? LIMIT 1`, group.classroomId,
    );
    const classId = classroomClass[0]?.classId;
    if (!classId) continue;
    const sourceGroup = await prisma.$queryRawUnsafe<ClassGroupRow[]>(
      `SELECT "id", "studentIds" FROM "ClassGroup" WHERE "classId" = ? AND "name" = ? LIMIT 1`, classId, group.name,
    );
    const classGroup = sourceGroup[0];
    if (!classGroup) continue;

    await prisma.$executeRawUnsafe(`UPDATE "ClassroomGroup" SET "sourceClassGroupId" = COALESCE("sourceClassGroupId", ?) WHERE "id" = ?`, classGroup.id, group.id);
    let memberIds: string[] = [];
    try { memberIds = JSON.parse(classGroup.studentIds || '[]'); } catch { memberIds = []; }
    for (const studentId of memberIds.filter((id): id is string => typeof id === 'string')) {
      const students = await prisma.$queryRawUnsafe<StudentRow[]>(
        `SELECT "id", "name", "studentNo" FROM "Student" WHERE "id" = ? LIMIT 1`, studentId,
      );
      const student = students[0];
      if (!student) continue;
      await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO "ClassroomGroupMember" ("id", "classroomId", "groupId", "studentId", "name", "studentNo") VALUES (?, ?, ?, ?, ?, ?)`,
        randomUUID(), group.classroomId, group.id, student.id, student.name, student.studentNo,
      );
    }
  }

  // 迁移后已没有业务关联，清理旧虚拟账号，避免它再次被任何通用学生功能误用。
  await prisma.$executeRawUnsafe(`DELETE FROM "Student" WHERE "tag" = '__group__' AND NOT EXISTS (
    SELECT 1 FROM "ClassroomStudent" cs WHERE cs."studentId" = "Student"."id"
  )`);
}
