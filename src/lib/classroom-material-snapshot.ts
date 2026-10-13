import type { StudentClassroom } from './types';

/** 只合并材料，保留实时权限和三态；拒绝晚到的旧版本快照。 */
export function mergeMaterialSnapshot(current: StudentClassroom | null, fresh: StudentClassroom): StudentClassroom | null {
  if (!current || current.id !== fresh.id) return current;
  if ((fresh.materialsRevision ?? 0) < (current.materialsRevision ?? 0)) return current;
  if ((fresh.materialsRevision ?? 0) === (current.materialsRevision ?? 0)
    && current.title === fresh.title
    && JSON.stringify([current.agents, current.webapps, current.groups]) === JSON.stringify([fresh.agents, fresh.webapps, fresh.groups])) return current;
  return { ...current, title: fresh.title, agents: fresh.agents, webapps: fresh.webapps,
    groups: fresh.groups, materialsRevision: fresh.materialsRevision };
}
