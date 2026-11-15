export type ModuleId =
  | 'home'
  | 'chat'
  | 'agents'
  | 'knowledge'
  | 'projects'
  | 'workflows'
  | 'plugins'
  | 'settings';

export type KnowledgeTab = 'brain' | 'wiki' | 'graph' | 'inbox';

export type ChatMode = 'new' | 'project' | 'multi-agent' | 'brain' | 'wiki';

export type ProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'grok'
  | 'hermes'
  | 'deepseek'
  | 'qwen'
  | 'ollama';

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  contextWindow: string;
  tier: 'fast' | 'reasoning' | 'local';
}

export interface AgentDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  roleTag: string;
  provider: ProviderId;
  model: string;
  fallbackModels: string[];
  systemPrompt: string;
  skills: string[];
  tools: string[];
  mcpServers: string[];
  memory: {
    read: Array<'personal' | 'project' | 'agent' | 'conversation' | 'knowledge'>;
    write: Array<'personal' | 'project' | 'agent' | 'conversation' | 'knowledge'>;
  };
  delegation: {
    canSpawn: boolean;
    allowed: string[];
    maxDepth: number;
    maxConcurrent: number;
  };
  budget: {
    maxTokensPerRun: number;
    maxCostUsd: number;
  };
  permissions: {
    fs: 'read-only' | 'project-only' | 'none';
    network: boolean;
    shell: 'deny' | 'ask' | 'allow';
  };
  protocol?: 'native' | 'a2a' | 'mcp';
}

export type BrainFolder =
  | 'Memories'
  | 'People'
  | 'Ideas'
  | 'Tasks'
  | 'Goals'
  | 'Notes'
  | 'Bookmarks'
  | 'Journal';

export interface BrainItem {
  id: string;
  title: string;
  folder: BrainFolder;
  projectId: string | null;
  tags: string[];
  content: string;
  backlinks: string[];
  pinned?: boolean;
  updatedAt: string;
  source?: string;
}

export interface WikiPage {
  id: string;
  title: string;
  category:
    | 'Models'
    | 'Providers'
    | 'Frameworks'
    | 'Agents'
    | 'Prompting'
    | 'RAG'
    | 'Vector DBs'
    | 'MCP Servers'
    | 'Tutorials';
  projectId: string | null;
  summary: string;
  content: string;
  citations: string[];
  updatedAt: string;
  compiledBy: string;
}

export type GraphNodeType =
  | 'Person'
  | 'Project'
  | 'Document'
  | 'Prompt'
  | 'Agent'
  | 'Workflow'
  | 'Model'
  | 'Concept';

export type GraphRelation =
  | 'USES'
  | 'OWNS'
  | 'RELATES_TO'
  | 'BUILT_WITH'
  | 'REFERENCES'
  | 'DEPENDS_ON';

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  projectId: string | null;
  summary: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  weight: number;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done';
  assigneeAgentId?: string;
}

export interface ProjectSpace {
  id: string;
  name: string;
  slug: string;
  description: string;
  rootPath: string;
  defaultAgentId: string;
  filesCount: number;
  updatedAt: string;
  isolated: boolean;
}

export interface ChatCitation {
  id: string;
  title: string;
  sourceType: 'brain' | 'wiki' | 'graph';
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  agentId?: string;
  agentName?: string;
  modelLabel?: string;
  citations?: ChatCitation[];
  latencyMs?: number;
}

export interface ChatThread {
  id: string;
  title: string;
  mode: ChatMode;
  projectId: string | null;
  agentId: string;
  modelId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  kind: 'Trigger' | 'Librarian' | 'Agent' | 'Condition' | 'Memory' | 'Notify';
  label: string;
  configSummary: string;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  triggerType: 'manual' | 'cron' | 'file-drop' | 'webhook';
  schedule?: string;
  enabled: boolean;
  projectId: string | null;
  steps: WorkflowStep[];
  lastRunAt?: string;
  runCount: number;
}

export interface PluginDef {
  id: string;
  name: string;
  category: 'Code' | 'Storage' | 'Messaging' | 'Creator' | 'Protocol';
  description: string;
  connected: boolean;
  scopes: string[];
  mcpExposed: boolean;
}

export interface RunLogEntry {
  id: string;
  timestamp: string;
  source: 'Router' | 'Librarian' | 'Agent' | 'Workflow' | 'Privacy' | 'RAG';
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  detail?: string;
}

export interface RouterSettings {
  theme: 'light' | 'dark';
  librarianModel: string;
  planningModel: string;
  privateNotesModel: string;
  redactSecretsOnIngest: boolean;
  strictScanRoots: boolean;
  allowedScanRoots: string[];
  localOnlyMode: boolean;
  mcpServerEnabled: boolean;
}

export interface CortexState {
  projects: ProjectSpace[];
  tasks: ProjectTask[];
  agents: AgentDefinition[];
  brainItems: BrainItem[];
  wikiPages: WikiPage[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  chats: ChatThread[];
  workflows: WorkflowDef[];
  plugins: PluginDef[];
  runLogs: RunLogEntry[];
  settings: RouterSettings;
}

export type InspectorTarget =
  | { kind: 'none' }
  | { kind: 'chat'; chatId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'brain'; itemId: string }
  | { kind: 'wiki'; pageId: string }
  | { kind: 'node'; nodeId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'workflow'; workflowId: string };
