import type { StudentClassroom } from './types';

/** 只合并材料，保留实时权限和三态；拒绝晚到的旧版本快照。 */
export function mergeMaterialSnapshot(current: StudentClassroom | null, fresh: StudentClassroom): StudentClassroom | null {
  if (!current || current.id !== fresh.id) return current;
  if ((fresh.materialsRevision ?? 0) < (current.materialsRevision ?? 0)) return current;
  if ((fresh.materialsRevision ?? 0) === (current.materialsRevision ?? 0)
    && current.companionAvailable === fresh.companionAvailable
    && current.title === fresh.title
    && current.webappPort === fresh.webappPort && current.webappHttpsPort === fresh.webappHttpsPort
    && current.cameraWebapp?.id === fresh.cameraWebapp?.id && current.cameraWebapp?.port === fresh.cameraWebapp?.port
    && JSON.stringify([current.agents, current.webapps, current.groups, current.mediaWebapps]) === JSON.stringify([fresh.agents, fresh.webapps, fresh.groups, fresh.mediaWebapps])) return current;
  return { ...current, title: fresh.title, agents: fresh.agents, webapps: fresh.webapps,
    groups: fresh.groups, companionAvailable: fresh.companionAvailable, materialsRevision: fresh.materialsRevision,
    webappPort: fresh.webappPort, webappHttpsPort: fresh.webappHttpsPort, cameraWebapp: fresh.cameraWebapp,
    mediaWebapps: fresh.mediaWebapps };
}
