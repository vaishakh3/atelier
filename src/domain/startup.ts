import type {Project} from './types';

/** Recover unsaved edits when available; otherwise reopen the newest disk project. */
export function resolveStartupProject(recovery: Project, saved: Project[], hasRecovery: boolean): Project {
  if (!hasRecovery) return [...saved].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0] ?? recovery;
  const disk = saved.find(project=>project.id===recovery.id);
  return disk && Date.parse(disk.updatedAt)>Date.parse(recovery.updatedAt) ? disk : recovery;
}
