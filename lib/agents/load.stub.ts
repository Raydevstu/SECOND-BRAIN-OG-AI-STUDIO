// STAND-IN: replace in the real repo
// Mode B stand-in for loadRunnableAgent(agentId).
// In OBA-ultimate, load AgentDefinition v2 from Prisma and verify approved === true.

import type { RunnableAgent } from '@/lib/runtime/types';

export type StoredRunnableAgent = RunnableAgent & { approved: boolean };

const SEED_AGENTS: StoredRunnableAgent[] = [
  {
    id: 'agent-architect',
    name: 'System Architect',
    systemPrompt: 'Design clear, safe architectures using available tools.',
    provider: 'ollama',
    model: 'llama3.1',
    fallbackModels: [],
    tools: ['brain.*', 'artifact.save', 'skill.load'],
    skills: [],
    mcpServers: [],
    permissions: { fs: 'project-only', network: false, shell: 'deny' },
    delegation: { canSpawn: true, maxDepth: 2, maxConcurrent: 2, allowed: ['agent-coder', 'agent-librarian'] },
    memory: { read: ['knowledge', 'project'], write: ['project'] },
    budget: { maxTokensPerRun: 50_000, maxCostUsd: 2.0, maxSteps: 20 },
    privacy: 'local-only',
    approved: true,
  },
  {
    id: 'agent-coder',
    name: 'Implementation Coder',
    systemPrompt: 'Implement clean TypeScript modules.',
    provider: 'ollama',
    model: 'llama3.1',
    fallbackModels: [],
    tools: ['brain.*', 'artifact.save'],
    skills: [],
    mcpServers: [],
    permissions: { fs: 'project-only', network: false, shell: 'deny' },
    delegation: { canSpawn: false, maxDepth: 0, maxConcurrent: 0, allowed: [] },
    memory: { read: ['knowledge', 'project'], write: ['project'] },
    budget: { maxTokensPerRun: 30_000, maxCostUsd: 1.0, maxSteps: 15 },
    privacy: 'local-only',
    approved: true,
  },
  {
    id: 'agent-librarian',
    name: 'Knowledge Librarian',
    systemPrompt: 'Search and summarize knowledge notes accurately.',
    provider: 'ollama',
    model: 'llama3.1',
    fallbackModels: [],
    tools: ['brain.search', 'brain.get'],
    skills: [],
    mcpServers: [],
    permissions: { fs: 'read-only', network: false, shell: 'deny' },
    delegation: { canSpawn: false, maxDepth: 0, maxConcurrent: 0, allowed: [] },
    memory: { read: ['knowledge'], write: [] },
    budget: { maxTokensPerRun: 20_000, maxCostUsd: 0.5, maxSteps: 10 },
    privacy: 'local-only',
    approved: true,
  },
];

const globalForAgents = globalThis as unknown as {
  __cortexAgentStubMap?: Map<string, StoredRunnableAgent>;
};

function getMap(): Map<string, StoredRunnableAgent> {
  if (!globalForAgents.__cortexAgentStubMap) {
    globalForAgents.__cortexAgentStubMap = new Map(SEED_AGENTS.map((a) => [a.id, a]));
  }
  return globalForAgents.__cortexAgentStubMap;
}

export function registerStubAgent(agent: StoredRunnableAgent): void {
  getMap().set(agent.id, agent);
}

export function resetStubAgents(): void {
  globalForAgents.__cortexAgentStubMap = new Map(SEED_AGENTS.map((a) => [a.id, a]));
}

export async function loadRunnableAgent(agentId: string): Promise<RunnableAgent> {
  const found = getMap().get(agentId);
  if (!found) {
    throw new Error(`Agent '${agentId}' not found`);
  }
  if (!found.approved) {
    throw new Error(`Agent '${agentId}' is not approved`);
  }
  const { approved: _approved, ...runnable } = found;
  void _approved;
  return runnable;
}
