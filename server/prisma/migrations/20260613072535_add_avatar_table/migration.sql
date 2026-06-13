-- Create Avatar table
CREATE TABLE IF NOT EXISTS "Avatar" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "name" TEXT NOT NULL,
    "svgContent" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'student',
    "gender" TEXT NOT NULL DEFAULT 'neutral',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add avatarId to Class
ALTER TABLE "Class" ADD COLUMN "avatarId" INTEGER REFERENCES "Avatar"("id");

-- Add avatarId to Student
ALTER TABLE "Student" ADD COLUMN "avatarId" INTEGER REFERENCES "Avatar"("id");
