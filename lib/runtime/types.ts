import { z } from 'zod';

export type RunnableAgent = {
  id: string;
  name: string;
  systemPrompt: string;
  provider: string;
  model: string;
  fallbackModels: string[];
  tools: string[];
  skills: string[];
  mcpServers: string[];
  permissions: {
    fs: 'none' | 'read-only' | 'project-only';
    network: boolean;
    shell: 'deny' | 'ask' | 'allow';
  };
  delegation: {
    canSpawn: boolean;
    maxDepth: number;
    maxConcurrent: number;
    allowed: string[];
  };
  memory: { read: string[]; write: string[] };
  budget: { maxTokensPerRun: number; maxCostUsd: number; maxSteps?: number };
  requirePlanApproval?: boolean;
  acceptance?: string; // criteria for the judge
  privacy?: 'local-only' | 'any';
};

export const ModelAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('tool'),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal('delegate'),
    agentId: z.string(),
    task: z.string().max(4000),
  }),
  z.object({
    action: z.literal('final'),
    result: z.string().max(100_000),
  }),
]);
export type ModelAction = z.infer<typeof ModelAction>;

export type PendingToolCall = {
  tool: string;
  args: Record<string, unknown>;
  stepIdx: number;
};

export type RunState = {
  projectId?: string | null;
  pending?: PendingToolCall;
  judgeRounds?: number;
};
