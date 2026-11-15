import type { AgentDefinition, ProviderId } from '@/lib/types';

export const MAX_IMPORT_BYTES = 64 * 1024;

export const VALID_PROVIDERS: readonly ProviderId[] = [
  'gemini',
  'openai',
  'anthropic',
  'grok',
  'hermes',
  'deepseek',
  'qwen',
  'ollama',
];

export const VALID_MEMORY_SCOPES = [
  'personal',
  'project',
  'agent',
  'conversation',
  'knowledge',
] as const;

export const VALID_FS_PERMISSIONS = ['read-only', 'project-only', 'none'] as const;
export const VALID_SHELL_PERMISSIONS = ['deny', 'ask', 'allow'] as const;
export const VALID_PROTOCOLS = ['native', 'a2a', 'mcp'] as const;

export type MemoryScope = (typeof VALID_MEMORY_SCOPES)[number];
export type RiskLevel = 'low' | 'medium' | 'high';

export type ParseImportResult =
  | { ok: true; agent: AgentDefinition }
  | { ok: false; errors: string[] };

export interface PermissionDiffItem {
  field: string;
  from: string;
  to: string;
  risk: RiskLevel;
}

export interface IdConflictResult {
  hasConflict: boolean;
  originalId: string;
  resolvedId: string;
  conflictingAgentName?: string;
}

const SAFE_BASELINE = {
  provider: 'gemini' as ProviderId,
  memory: {
    read: ['knowledge'] as MemoryScope[],
    write: ['agent'] as MemoryScope[],
  },
  permissions: {
    fs: 'read-only' as const,
    network: false,
    shell: 'deny' as const,
  },
  delegation: {
    canSpawn: false,
    allowed: [] as string[],
    maxDepth: 0,
    maxConcurrent: 1,
  },
  budget: {
    maxTokensPerRun: 100000,
    maxCostUsd: 0.25,
  },
  mcpServers: ['cortex-brain'],
  tools: [] as string[],
};

const HIGH_RISK_TOOL_TOKENS = new Set<string>([
  'shell',
  'exec',
  'write',
  'delete',
  'http',
  'https',
  'net',
  'fetch',
  'browser',
]);

function isHighRiskTool(toolName: string): boolean {
  const trimmed = toolName.trim();
  // Prototype policy choice: 'memory.write' only writes to the Brain and is governed by memory permissions.
  if (trimmed.toLowerCase() === 'memory.write') {
    return false;
  }
  const splitCamel = trimmed.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const tokens = splitCamel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => HIGH_RISK_TOOL_TOKENS.has(token));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function getUtf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

export function parseImport(text: string): ParseImportResult {
  if (!text.trim()) {
    return { ok: false, errors: ['JSON input cannot be empty.'] };
  }

  if (getUtf8ByteLength(text) > MAX_IMPORT_BYTES) {
    return { ok: false, errors: ['JSON payload exceeds the 64 KB limit.'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON syntax.';
    return { ok: false, errors: [`Invalid JSON: ${message}`] };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, errors: ['Imported JSON must be a top-level object.'] };
  }

  const errors: string[] = [];

  // Required: name
  let name = '';
  if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
    errors.push('Field "name" is required and must be a non-empty string.');
  } else {
    name = parsed.name.trim();
  }

  // Optional string fields
  let id = `imported-${Date.now().toString().slice(-4)}`;
  if (parsed.id !== undefined) {
    if (typeof parsed.id !== 'string' || parsed.id.trim().length === 0) {
      errors.push('Field "id" must be a non-empty string.');
    } else {
      id = parsed.id.trim();
    }
  }

  let version = '1.0.0';
  if (parsed.version !== undefined) {
    if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
      errors.push('Field "version" must be a non-empty string.');
    } else {
      version = parsed.version.trim();
    }
  }

  let description = 'Imported AgentDefinition JSON.';
  if (parsed.description !== undefined) {
    if (typeof parsed.description !== 'string') {
      errors.push('Field "description" must be a string.');
    } else {
      description = parsed.description;
    }
  }

  let roleTag = 'Imported Preset';
  if (parsed.roleTag !== undefined) {
    if (typeof parsed.roleTag !== 'string') {
      errors.push('Field "roleTag" must be a string.');
    } else {
      roleTag = parsed.roleTag;
    }
  }

  let provider: ProviderId = 'gemini';
  if (parsed.provider !== undefined) {
    if (
      typeof parsed.provider !== 'string' ||
      !VALID_PROVIDERS.includes(parsed.provider as ProviderId)
    ) {
      errors.push(`Field "provider" must be one of: ${VALID_PROVIDERS.join(', ')}.`);
    } else {
      provider = parsed.provider as ProviderId;
    }
  }

  let model = 'gemini-4-hydrogen';
  if (parsed.model !== undefined) {
    if (typeof parsed.model !== 'string' || parsed.model.trim().length === 0) {
      errors.push('Field "model" must be a non-empty string.');
    } else {
      model = parsed.model.trim();
    }
  }

  let systemPrompt = name ? `You are ${name}.` : 'You are an imported agent.';
  if (parsed.systemPrompt !== undefined) {
    if (typeof parsed.systemPrompt !== 'string') {
      errors.push('Field "systemPrompt" must be a string.');
    } else {
      systemPrompt = parsed.systemPrompt;
    }
  }

  let protocol: AgentDefinition['protocol'] = 'native';
  if (parsed.protocol !== undefined) {
    if (
      typeof parsed.protocol !== 'string' ||
      !VALID_PROTOCOLS.includes(parsed.protocol as (typeof VALID_PROTOCOLS)[number])
    ) {
      errors.push(`Field "protocol" must be one of: ${VALID_PROTOCOLS.join(', ')}.`);
    } else {
      protocol = parsed.protocol as AgentDefinition['protocol'];
    }
  }

  // String array fields
  let fallbackModels = ['gemini-3.1-flash-lite'];
  if (parsed.fallbackModels !== undefined) {
    if (!isStringArray(parsed.fallbackModels)) {
      errors.push('Field "fallbackModels" must be an array of strings.');
    } else {
      fallbackModels = [...parsed.fallbackModels];
    }
  }

  let skills: string[] = [];
  if (parsed.skills !== undefined) {
    if (!isStringArray(parsed.skills)) {
      errors.push('Field "skills" must be an array of strings.');
    } else {
      skills = [...parsed.skills];
    }
  }

  let tools: string[] = ['memory.read'];
  if (parsed.tools !== undefined) {
    if (!isStringArray(parsed.tools)) {
      errors.push('Field "tools" must be an array of strings.');
    } else {
      tools = [...parsed.tools];
    }
  }

  let mcpServers: string[] = ['cortex-brain'];
  if (parsed.mcpServers !== undefined) {
    if (!isStringArray(parsed.mcpServers)) {
      errors.push('Field "mcpServers" must be an array of strings.');
    } else {
      mcpServers = [...parsed.mcpServers];
    }
  }

  // Memory
  let memoryRead: MemoryScope[] = ['knowledge'];
  let memoryWrite: MemoryScope[] = ['agent'];
  if (parsed.memory !== undefined) {
    if (!isPlainObject(parsed.memory)) {
      errors.push('Field "memory" must be an object.');
    } else {
      if (parsed.memory.read !== undefined) {
        if (!isStringArray(parsed.memory.read)) {
          errors.push('Field "memory.read" must be an array of strings.');
        } else if (
          !parsed.memory.read.every((s) => VALID_MEMORY_SCOPES.includes(s as MemoryScope))
        ) {
          errors.push(
            `Field "memory.read" entries must be one of: ${VALID_MEMORY_SCOPES.join(', ')}.`
          );
        } else {
          memoryRead = [...(parsed.memory.read as MemoryScope[])];
        }
      }
      if (parsed.memory.write !== undefined) {
        if (!isStringArray(parsed.memory.write)) {
          errors.push('Field "memory.write" must be an array of strings.');
        } else if (
          !parsed.memory.write.every((s) => VALID_MEMORY_SCOPES.includes(s as MemoryScope))
        ) {
          errors.push(
            `Field "memory.write" entries must be one of: ${VALID_MEMORY_SCOPES.join(', ')}.`
          );
        } else {
          memoryWrite = [...(parsed.memory.write as MemoryScope[])];
        }
      }
    }
  }

  // Delegation (safest defaults for missing fields)
  let canSpawn = SAFE_BASELINE.delegation.canSpawn;
  let delegationAllowed: string[] = [...SAFE_BASELINE.delegation.allowed];
  let maxDepth = SAFE_BASELINE.delegation.maxDepth;
  let maxConcurrent = SAFE_BASELINE.delegation.maxConcurrent;
  if (parsed.delegation !== undefined) {
    if (!isPlainObject(parsed.delegation)) {
      errors.push('Field "delegation" must be an object.');
    } else {
      if (parsed.delegation.canSpawn !== undefined) {
        if (typeof parsed.delegation.canSpawn !== 'boolean') {
          errors.push('Field "delegation.canSpawn" must be a boolean.');
        } else {
          canSpawn = parsed.delegation.canSpawn;
        }
      }
      if (parsed.delegation.allowed !== undefined) {
        if (!isStringArray(parsed.delegation.allowed)) {
          errors.push('Field "delegation.allowed" must be an array of strings.');
        } else {
          delegationAllowed = [...parsed.delegation.allowed];
        }
      }
      if (parsed.delegation.maxDepth !== undefined) {
        if (
          typeof parsed.delegation.maxDepth !== 'number' ||
          !Number.isInteger(parsed.delegation.maxDepth) ||
          parsed.delegation.maxDepth < 0 ||
          parsed.delegation.maxDepth > 5
        ) {
          errors.push('Field "delegation.maxDepth" must be an integer between 0 and 5.');
        } else {
          maxDepth = parsed.delegation.maxDepth;
        }
      }
      if (parsed.delegation.maxConcurrent !== undefined) {
        if (
          typeof parsed.delegation.maxConcurrent !== 'number' ||
          !Number.isInteger(parsed.delegation.maxConcurrent) ||
          parsed.delegation.maxConcurrent <= 0
        ) {
          errors.push('Field "delegation.maxConcurrent" must be a positive integer.');
        } else {
          maxConcurrent = parsed.delegation.maxConcurrent;
        }
      }
    }
  }

  // Budget (positive numbers)
  let maxTokensPerRun = SAFE_BASELINE.budget.maxTokensPerRun;
  let maxCostUsd = SAFE_BASELINE.budget.maxCostUsd;
  if (parsed.budget !== undefined) {
    if (!isPlainObject(parsed.budget)) {
      errors.push('Field "budget" must be an object.');
    } else {
      if (parsed.budget.maxTokensPerRun !== undefined) {
        if (
          typeof parsed.budget.maxTokensPerRun !== 'number' ||
          !Number.isFinite(parsed.budget.maxTokensPerRun) ||
          parsed.budget.maxTokensPerRun <= 0
        ) {
          errors.push('Field "budget.maxTokensPerRun" must be a positive number.');
        } else {
          maxTokensPerRun = parsed.budget.maxTokensPerRun;
        }
      }
      if (parsed.budget.maxCostUsd !== undefined) {
        if (
          typeof parsed.budget.maxCostUsd !== 'number' ||
          !Number.isFinite(parsed.budget.maxCostUsd) ||
          parsed.budget.maxCostUsd <= 0
        ) {
          errors.push('Field "budget.maxCostUsd" must be a positive number.');
        } else {
          maxCostUsd = parsed.budget.maxCostUsd;
        }
      }
    }
  }

  // Permissions (safest defaults for missing fields)
  let fsPerm: AgentDefinition['permissions']['fs'] = SAFE_BASELINE.permissions.fs;
  let networkPerm = SAFE_BASELINE.permissions.network;
  let shellPerm: AgentDefinition['permissions']['shell'] = SAFE_BASELINE.permissions.shell;
  if (parsed.permissions !== undefined) {
    if (!isPlainObject(parsed.permissions)) {
      errors.push('Field "permissions" must be an object.');
    } else {
      if (parsed.permissions.fs !== undefined) {
        if (
          typeof parsed.permissions.fs !== 'string' ||
          !VALID_FS_PERMISSIONS.includes(
            parsed.permissions.fs as (typeof VALID_FS_PERMISSIONS)[number]
          )
        ) {
          errors.push(`Field "permissions.fs" must be one of: ${VALID_FS_PERMISSIONS.join(', ')}.`);
        } else {
          fsPerm = parsed.permissions.fs as AgentDefinition['permissions']['fs'];
        }
      }
      if (parsed.permissions.network !== undefined) {
        if (typeof parsed.permissions.network !== 'boolean') {
          errors.push('Field "permissions.network" must be a boolean.');
        } else {
          networkPerm = parsed.permissions.network;
        }
      }
      if (parsed.permissions.shell !== undefined) {
        if (
          typeof parsed.permissions.shell !== 'string' ||
          !VALID_SHELL_PERMISSIONS.includes(
            parsed.permissions.shell as (typeof VALID_SHELL_PERMISSIONS)[number]
          )
        ) {
          errors.push(
            `Field "permissions.shell" must be one of: ${VALID_SHELL_PERMISSIONS.join(', ')}.`
          );
        } else {
          shellPerm = parsed.permissions.shell as AgentDefinition['permissions']['shell'];
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const agent: AgentDefinition = {
    id,
    version,
    name,
    description,
    roleTag,
    provider,
    model,
    fallbackModels,
    systemPrompt,
    skills,
    tools,
    mcpServers,
    memory: {
      read: memoryRead,
      write: memoryWrite,
    },
    delegation: {
      canSpawn,
      allowed: delegationAllowed,
      maxDepth,
      maxConcurrent,
    },
    budget: {
      maxTokensPerRun,
      maxCostUsd,
    },
    permissions: {
      fs: fsPerm,
      network: networkPerm,
      shell: shellPerm,
    },
    protocol,
  };

  return { ok: true, agent };
}

export function diffPermissions(
  existingOrNull: AgentDefinition | null,
  imported: AgentDefinition
): PermissionDiffItem[] {
  const diffs: PermissionDiffItem[] = [];
  const seenFields = new Set<string>();
  const pushDiff = (item: PermissionDiffItem) => {
    if (seenFields.has(item.field)) return;
    seenFields.add(item.field);
    diffs.push(item);
  };

  const baseFs = existingOrNull ? existingOrNull.permissions.fs : SAFE_BASELINE.permissions.fs;
  if (imported.permissions.fs !== baseFs) {
    pushDiff({
      field: 'permissions.fs',
      from: baseFs,
      to: imported.permissions.fs,
      risk: imported.permissions.fs === 'project-only' ? 'high' : 'low',
    });
  }

  const baseNetwork = existingOrNull
    ? existingOrNull.permissions.network
    : SAFE_BASELINE.permissions.network;
  if (imported.permissions.network !== baseNetwork) {
    pushDiff({
      field: 'permissions.network',
      from: String(baseNetwork),
      to: String(imported.permissions.network),
      risk: imported.permissions.network ? 'high' : 'low',
    });
  }

  const baseShell = existingOrNull
    ? existingOrNull.permissions.shell
    : SAFE_BASELINE.permissions.shell;
  if (imported.permissions.shell !== baseShell) {
    pushDiff({
      field: 'permissions.shell',
      from: baseShell,
      to: imported.permissions.shell,
      risk: imported.permissions.shell !== 'deny' ? 'high' : 'low',
    });
  }

  const baseCanSpawn = existingOrNull
    ? existingOrNull.delegation.canSpawn
    : SAFE_BASELINE.delegation.canSpawn;
  if (imported.delegation.canSpawn !== baseCanSpawn) {
    pushDiff({
      field: 'delegation.canSpawn',
      from: String(baseCanSpawn),
      to: String(imported.delegation.canSpawn),
      risk: imported.delegation.canSpawn ? 'high' : 'low',
    });
  }

  const baseMaxDepth = existingOrNull
    ? existingOrNull.delegation.maxDepth
    : SAFE_BASELINE.delegation.maxDepth;
  if (imported.delegation.maxDepth !== baseMaxDepth) {
    pushDiff({
      field: 'delegation.maxDepth',
      from: String(baseMaxDepth),
      to: String(imported.delegation.maxDepth),
      risk: imported.delegation.maxDepth > 1 ? 'medium' : 'low',
    });
  }

  const baseMaxConcurrent = existingOrNull
    ? existingOrNull.delegation.maxConcurrent
    : SAFE_BASELINE.delegation.maxConcurrent;
  if (
    imported.delegation.maxConcurrent !== baseMaxConcurrent ||
    imported.delegation.maxConcurrent > 4
  ) {
    pushDiff({
      field: 'delegation.maxConcurrent',
      from: String(baseMaxConcurrent),
      to: String(imported.delegation.maxConcurrent),
      risk: imported.delegation.maxConcurrent > 4 ? 'medium' : 'low',
    });
  }

  const baseAllowed = existingOrNull
    ? existingOrNull.delegation.allowed
    : SAFE_BASELINE.delegation.allowed;
  const allowedChanged =
    imported.delegation.allowed.length !== baseAllowed.length ||
    imported.delegation.allowed.some((a, i) => a !== baseAllowed[i]);
  if (allowedChanged) {
    pushDiff({
      field: 'delegation.allowed',
      from: baseAllowed.join(', ') || '(none)',
      to: imported.delegation.allowed.join(', ') || '(none)',
      risk:
        imported.delegation.canSpawn && imported.delegation.allowed.length > 0 ? 'medium' : 'low',
    });
  }

  const baseMemWrite = existingOrNull ? existingOrNull.memory.write : SAFE_BASELINE.memory.write;
  const memWriteChanged =
    imported.memory.write.length !== baseMemWrite.length ||
    imported.memory.write.some((m, i) => m !== baseMemWrite[i]);
  if (memWriteChanged) {
    const memWriteRisk: RiskLevel = imported.memory.write.includes('personal')
      ? 'high'
      : imported.memory.write.includes('project') || imported.memory.write.includes('knowledge')
        ? 'medium'
        : 'low';
    pushDiff({
      field: 'memory.write',
      from: baseMemWrite.join(', ') || '(none)',
      to: imported.memory.write.join(', ') || '(none)',
      risk: memWriteRisk,
    });
  }

  const baseMemRead = existingOrNull ? existingOrNull.memory.read : SAFE_BASELINE.memory.read;
  const memReadChanged =
    imported.memory.read.length !== baseMemRead.length ||
    imported.memory.read.some((m, i) => m !== baseMemRead[i]);
  if (memReadChanged) {
    const addsPersonalRead =
      imported.memory.read.includes('personal') && !baseMemRead.includes('personal');
    pushDiff({
      field: 'memory.read',
      from: baseMemRead.join(', ') || '(none)',
      to: imported.memory.read.join(', ') || '(none)',
      risk: addsPersonalRead ? 'medium' : 'low',
    });
  }

  const baseProvider = existingOrNull ? existingOrNull.provider : SAFE_BASELINE.provider;
  if (imported.provider !== baseProvider) {
    pushDiff({
      field: 'provider',
      from: baseProvider,
      to: imported.provider,
      risk: imported.provider !== 'ollama' ? 'medium' : 'low',
    });
  }

  const baseMcp = existingOrNull ? existingOrNull.mcpServers : SAFE_BASELINE.mcpServers;
  const addedRiskyMcp = imported.mcpServers.filter(
    (s) => s !== 'cortex-brain' && !baseMcp.includes(s)
  );
  const mcpChanged =
    imported.mcpServers.length !== baseMcp.length ||
    imported.mcpServers.some((s, i) => s !== baseMcp[i]);
  if (mcpChanged) {
    pushDiff({
      field: 'mcpServers',
      from: baseMcp.join(', ') || '(none)',
      to: imported.mcpServers.join(', ') || '(none)',
      risk: addedRiskyMcp.length > 0 ? 'high' : 'low',
    });
  }

  const baseTools = existingOrNull ? existingOrNull.tools : SAFE_BASELINE.tools;
  const newTools = imported.tools.filter((t) => !baseTools.includes(t));
  const hasHighRiskNewTool = newTools.some((tool) => isHighRiskTool(tool));
  const toolsChanged =
    imported.tools.length !== baseTools.length ||
    imported.tools.some((t, i) => t !== baseTools[i]);
  if (toolsChanged) {
    pushDiff({
      field: 'tools',
      from: baseTools.join(', ') || '(none)',
      to: imported.tools.join(', ') || '(none)',
      risk: hasHighRiskNewTool ? 'high' : newTools.length > 0 ? 'medium' : 'low',
    });
  }

  const baseTokens = existingOrNull
    ? existingOrNull.budget.maxTokensPerRun
    : SAFE_BASELINE.budget.maxTokensPerRun;
  if (imported.budget.maxTokensPerRun !== baseTokens || imported.budget.maxTokensPerRun > 500000) {
    pushDiff({
      field: 'budget.maxTokensPerRun',
      from: baseTokens.toLocaleString(),
      to: imported.budget.maxTokensPerRun.toLocaleString(),
      risk: imported.budget.maxTokensPerRun > 500000 ? 'high' : 'low',
    });
  }

  const baseCost = existingOrNull
    ? existingOrNull.budget.maxCostUsd
    : SAFE_BASELINE.budget.maxCostUsd;
  if (imported.budget.maxCostUsd !== baseCost || imported.budget.maxCostUsd > 1) {
    pushDiff({
      field: 'budget.maxCostUsd',
      from: `$${baseCost.toFixed(2)}`,
      to: `$${imported.budget.maxCostUsd.toFixed(2)}`,
      risk: imported.budget.maxCostUsd > 1 ? 'high' : 'low',
    });
  }

  return diffs;
}

export function detectIdConflict(
  id: string,
  existingAgents: AgentDefinition[]
): IdConflictResult {
  const existingIds = new Set(existingAgents.map((a) => a.id));
  const conflicting = existingAgents.find((a) => a.id === id);
  if (!conflicting) {
    return {
      hasConflict: false,
      originalId: id,
      resolvedId: id,
    };
  }

  let counter = 1;
  let candidate = `${id}-imported-${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `${id}-imported-${counter}`;
  }

  return {
    hasConflict: true,
    originalId: id,
    resolvedId: candidate,
    conflictingAgentName: conflicting.name,
  };
}

export function flagPromptSignals(systemPrompt: string): string[] {
  const lower = systemPrompt.toLowerCase();
  const warnings: string[] = [];

  if (lower.includes('ignore previous')) {
    warnings.push(
      'Hint (substring check, not a security guarantee): prompt contains "ignore previous".'
    );
  }

  if (lower.includes('disable safety')) {
    warnings.push(
      'Hint (substring check, not a security guarantee): prompt contains "disable safety".'
    );
  }

  if (/send\b[^\n]{0,100}\bto\s+http/.test(lower)) {
    warnings.push(
      'Hint (substring check, not a security guarantee): prompt mentions sending content to an HTTP target.'
    );
  }

  if (lower.includes('exfiltrate')) {
    warnings.push(
      'Hint (substring check, not a security guarantee): prompt contains "exfiltrate".'
    );
  }

  return warnings;
}
