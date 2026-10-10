/** 按题保存累计成功调用，重新生成或更换智能体不覆盖已有计数。 */
export interface AnalysisUsageEntry { agentId: string; calls: number; chars: number }
export interface AnalysisUsage { version: 1; agents: AnalysisUsageEntry[] }
export function readAnalysisUsage(raw: unknown, legacyAgentId: string | null, narrative: string | null): AnalysisUsage {
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const usage = object.analysisUsage as Partial<AnalysisUsage> | undefined;
  if (usage?.version === 1 && Array.isArray(usage.agents)) {
    const agents = new Map<string, AnalysisUsageEntry>();
    for (const row of usage.agents) {
      if (!row || typeof row.agentId !== 'string' || !row.agentId || !Number.isSafeInteger(row.calls) || row.calls < 1 || !Number.isSafeInteger(row.chars) || row.chars < 0) continue;
      if (!agents.has(row.agentId)) agents.set(row.agentId, { agentId: row.agentId, calls: row.calls, chars: row.chars });
    }
    return { version: 1, agents: [...agents.values()] };
  }
  // 旧版本只留下最近一次结果；不猜测已经被覆盖的历史调用。
  return { version: 1, agents: legacyAgentId && narrative?.trim() ? [{ agentId: legacyAgentId, calls: 1, chars: narrative.length }] : [] };
}
export function recordAnalysisUsage(raw: unknown, legacyAgentId: string | null, narrative: string | null, agentId: string, chars: number): AnalysisUsage {
  const usage = readAnalysisUsage(raw, legacyAgentId, narrative);
  const entry = usage.agents.find(row => row.agentId === agentId);
  if (entry) { entry.calls++; entry.chars += chars; }
  else usage.agents.push({ agentId, calls: 1, chars });
  return usage;
}
