# Pillar 1–2 implementation blueprint

I can't give you everything at once as finished, tested code. I haven't seen OBA's `src/`, so I can't compile or run any of this. I wrote it against the `AgentDefinition` v2 field names from earlier. I put every OBA-specific dependency behind one of three seams: `db`, `requireOwner` and `KnowledgePort`.

This batch is the server side, which carries the security-critical logic. It covers all 15 capabilities except the UI parts. For the UI, I list what to build and which endpoints it calls at the end.

## Build order

| Step | Capability | Why it comes here |
|---|---|---|
| 0 | Prisma models | Everything else stores state. |
| 1 | Instruction hierarchy | The runtime needs it to build prompts. |
| 2 | Provider router | The runtime needs it to call models. |
| 3 | Tool registry and permission gate | The runtime can't run tools without it. |
| 4 | Skills and compaction | They plug into the prompt builder. |
| 5 | Runtime: durable runs, plan→approve, subagents, judge, structured output | Needs steps 0–4. |
| 6 | Checkpoints and undo | Hooks into tool execution. |
| 7 | MCP server and client | Needs the tool registry. |
| 8 | API routes and UI wiring | Needs everything above. |

Install: `pnpm add zod @modelcontextprotocol/sdk gray-matter`

## Step 0: `prisma/schema.prisma` (append)

```prisma
model AgentRun {
  id          String   @id @default(cuid())
  agentId     String
  parentRunId String?
  depth       Int      @default(0)
  task        String
  status      String   // planning|awaiting_plan|running|awaiting_tool|succeeded|failed|cancelled
  plan        String?
  budgetJson  String
  stateJson   String   @default("{}")   // pendingToolCall, judgeRounds
  tokensUsed  Int      @default(0)
  costUsd     Float    @default(0)
  result      String?
  error       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  steps       RunStep[]
  checkpoints Checkpoint[]
  artifacts   Artifact[]
  @@index([status])
  @@index([parentRunId])
}

model RunStep {
  id         String   @id @default(cuid())
  runId      String
  idx        Int
  kind       String   // model|tool|plan|judge|delegate|compact
  name       String?
  inputJson  String
  outputJson String
  decision   String?  // allow|ask|deny
  tokens     Int      @default(0)
  costUsd    Float    @default(0)
  latencyMs  Int      @default(0)
  createdAt  DateTime @default(now())
  run        AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@unique([runId, idx])
}

model Checkpoint {
  id         String   @id @default(cuid())
  runId      String
  stepIdx    Int
  tool       String
  targetId   String
  beforeJson String
  restoredAt DateTime?
  createdAt  DateTime @default(now())
  run        AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
}

model Artifact {
  id        String   @id @default(cuid())
  runId     String
  key       String   // stable id across versions
  version   Int
  title     String
  kind      String   // markdown|code|mermaid
  content   String
  createdAt DateTime @default(now())
  run       AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@unique([runId, key, version])
}

model PermissionAudit {
  id        String   @id @default(cuid())
  runId     String
  agentId   String
  tool      String
  decision  String
  reason    String
  argsHash  String
  createdAt DateTime @default(now())
  @@index([runId])
}
```

Then run `npx prisma migrate dev -n agent_runtime`.

## Step 1: `src/lib/instructions/compile.ts`

Layers are global, then project, then agent. The result is hashed so a run can record which instructions it used.

```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.env.CORTEX_INSTRUCTIONS_DIR ?? path.resolve(process.cwd(), "instructions");
const MAX_LAYER_CHARS = 12_000;

export type CompiledInstructions = { text: string; hash: string; layers: string[] };

async function readIfExists(p: string): Promise<string | null> {
  try { return (await fs.readFile(p, "utf8")).slice(0, MAX_LAYER_CHARS); } catch { return null; }
}
const safeId = (s: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(s) ? s : (() => { throw new Error("bad id"); })();

export async function compileInstructions(opts: {
  projectId?: string | null;
  agentPrompt: string;
}): Promise<CompiledInstructions> {
  const layers: { name: string; body: string }[] = [];
  const g = await readIfExists(path.join(ROOT, "global.md"));
  if (g) layers.push({ name: "global", body: g });
  if (opts.projectId) {
    const p = await readIfExists(path.join(ROOT, "projects", safeId(opts.projectId), "AGENTS.md"));
    if (p) layers.push({ name: "project", body: p });
  }
  layers.push({ name: "agent", body: opts.agentPrompt.slice(0, MAX_LAYER_CHARS) });
  // later layers win on conflict: say so explicitly
  const text = layers
    .map((l) => `## Instructions (${l.name})\n${l.body.trim()}`)
    .join("\n\n") + "\n\nIf layers conflict, the later layer wins. Never override safety limits given by the system.";
  const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  return { text, hash, layers: layers.map((l) => l.name) };
}

/** Export for other tools (Claude Code, Codex). */
export async function exportAgentsMd(projectId: string): Promise<string> {
  const c = await compileInstructions({ projectId, agentPrompt: "" });
  return c.text;
}
```

## Step 2: `src/lib/providers/router.ts`

This covers the OpenAI-compatible adapter, which also works for Ollama, LM Studio, OpenRouter, DeepSeek and others. A native Anthropic or Gemini adapter is a follow-up batch. Both vendors offer OpenAI-compatible endpoints, so you can use those meanwhile.

```ts
export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type ChatResult = { text: string; tokensIn: number; tokensOut: number; costUsd: number; model: string };
export type TaskType = "plan" | "act" | "judge" | "summarize";
export type Privacy = "local-only" | "any";

export type ProviderConfig = {
  id: string;
  baseUrl: string;            // e.g. https://openrouter.ai/api/v1
  apiKeyEnv?: string;         // env var NAME, never the key itself
  local: boolean;
  models: { name: string; inPerMTok: number; outPerMTok: number; tasks: TaskType[]; ctx: number }[];
};

export type RouteRequest = {
  task: TaskType;
  privacy: Privacy;
  preferred?: { provider: string; model: string };
  fallbacks?: { provider: string; model: string }[];
  maxCostUsd?: number;
};

export class ProviderRouter {
  constructor(private providers: ProviderConfig[], private timeoutMs = 60_000) {}

  /** Ordered candidate list: preferred, fallbacks, then cheapest fit for the task. */
  candidates(req: RouteRequest) {
    const out: { p: ProviderConfig; model: string }[] = [];
    const add = (pid: string, model: string) => {
      const p = this.providers.find((x) => x.id === pid);
      if (!p || !p.models.some((m) => m.name === model)) return;
      if (req.privacy === "local-only" && !p.local) return;
      if (!out.some((o) => o.p.id === pid && o.model === model)) out.push({ p, model });
    };
    if (req.preferred) add(req.preferred.provider, req.preferred.model);
    for (const f of req.fallbacks ?? []) add(f.provider, f.model);
    const rest = this.providers
      .flatMap((p) => p.models.filter((m) => m.tasks.includes(req.task)).map((m) => ({ p, m })))
      .sort((a, b) => a.m.inPerMTok + a.m.outPerMTok - (b.m.inPerMTok + b.m.outPerMTok));
    for (const r of rest) add(r.p.id, r.m.name);
    return out;
  }

  async chat(req: RouteRequest, messages: Msg[], opts: { json?: boolean } = {}): Promise<ChatResult> {
    const errors: string[] = [];
    for (const { p, model } of this.candidates(req)) {
      try { return await this.call(p, model, messages, opts); }
      catch (e) { errors.push(`${p.id}/${model}: ${(e as Error).message}`); }
    }
    throw new Error(`All providers failed or none allowed: ${errors.join(" | ") || "no candidates"}`);
  }

  private async call(p: ProviderConfig, model: string, messages: Msg[], opts: { json?: boolean }): Promise<ChatResult> {
    const key = p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined;
    if (p.apiKeyEnv && !key) throw new Error(`missing env ${p.apiKeyEnv}`);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model, messages, temperature: 0.2,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const text: string = j.choices?.[0]?.message?.content ?? "";
      const tin: number = j.usage?.prompt_tokens ?? Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
      const tout: number = j.usage?.completion_tokens ?? Math.ceil(text.length / 4);
      const m = p.models.find((x) => x.name === model)!;
      const costUsd = (tin * m.inPerMTok + tout * m.outPerMTok) / 1e6;
      return { text, tokensIn: tin, tokensOut: tout, costUsd, model: `${p.id}/${model}` };
    } finally { clearTimeout(t); }
  }
}
```

`src/lib/providers/index.ts` is where you build the router from config. No keys go in the file, only env var names:

```ts
import { ProviderRouter } from "./router";
export const router = new ProviderRouter([
  { id: "ollama", baseUrl: "http://127.0.0.1:11434/v1", local: true,
    models: [{ name: "llama3.1", inPerMTok: 0, outPerMTok: 0, ctx: 128000, tasks: ["plan","act","judge","summarize"] }] },
  { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", local: false,
    models: [{ name: "deepseek/deepseek-chat", inPerMTok: 0.3, outPerMTok: 1.2, ctx: 64000, tasks: ["plan","act","judge","summarize"] }] },
]);
```

Check the model names and prices against each provider's current docs. I made these up as examples.

## Step 3: Tool registry and permission gate

### `src/lib/tools/registry.ts`

```ts
import { z, ZodTypeAny } from "zod";

export type Risk = "read" | "write" | "network" | "shell" | "spawn";

export type ToolCtx = { runId: string; agentId: string; projectId?: string | null };
export type ToolDef<S extends ZodTypeAny = ZodTypeAny> = {
  name: string;                 // e.g. "brain.search"
  description: string;
  risk: Risk;
  input: S;
  /** Memory scope this tool touches, for scope checks. */
  scope?: "personal" | "project" | "knowledge" | "agent";
  /** Return state needed to undo this call. Called BEFORE run for write tools. */
  snapshot?: (args: z.infer<S>, ctx: ToolCtx) => Promise<{ targetId: string; before: unknown } | null>;
  run: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown>;
};

class Registry {
  private tools = new Map<string, ToolDef>();
  register(t: ToolDef) {
    if (this.tools.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
    this.tools.set(t.name, t);
  }
  get(name: string) { return this.tools.get(name); }
  list() { return [...this.tools.values()]; }
}
export const registry = new Registry();
```

### `src/lib/tools/gate.ts`

```ts
import crypto from "node:crypto";
import { db } from "@/lib/db";
import type { ToolDef } from "./registry";

export type Decision = { decision: "allow" | "ask" | "deny"; reason: string };

export type GateAgent = {
  id: string;
  tools: string[];
  permissions: { fs: "none" | "read-only" | "project-only"; network: boolean; shell: "deny" | "ask" | "allow" };
  memory: { read: string[]; write: string[] };
  delegation: { canSpawn: boolean };
};

/** Pure decision. Deny wins. Anything not explicitly permitted is denied or asked. */
export function decide(agent: GateAgent, tool: ToolDef, opts: { preApproved?: boolean } = {}): Decision {
  if (!agent.tools.includes(tool.name) && !agent.tools.includes(tool.name.split(".")[0] + ".*"))
    return { decision: "deny", reason: "tool not granted to agent" };

  if (tool.scope) {
    const list = tool.risk === "write" ? agent.memory.write : agent.memory.read;
    if (!list.includes(tool.scope)) return { decision: "deny", reason: `memory scope '${tool.scope}' not permitted` };
  }
  switch (tool.risk) {
    case "read": return { decision: "allow", reason: "read-only tool" };
    case "write":
      if (agent.permissions.fs === "none" && !tool.scope) return { decision: "deny", reason: "writes disabled" };
      return opts.preApproved ? { decision: "allow", reason: "user approved" } : { decision: "ask", reason: "write needs approval" };
    case "network":
      if (!agent.permissions.network) return { decision: "deny", reason: "network disabled" };
      return opts.preApproved ? { decision: "allow", reason: "user approved" } : { decision: "ask", reason: "network needs approval" };
    case "shell":
      if (agent.permissions.shell === "deny") return { decision: "deny", reason: "shell denied" };
      if (agent.permissions.shell === "allow" || opts.preApproved) return { decision: "allow", reason: "shell permitted" };
      return { decision: "ask", reason: "shell needs approval" };
    case "spawn":
      return agent.delegation.canSpawn ? { decision: "allow", reason: "delegation permitted" } : { decision: "deny", reason: "spawning disabled" };
  }
}

export async function audit(runId: string, agentId: string, tool: string, d: Decision, args: unknown) {
  const argsHash = crypto.createHash("sha256").update(JSON.stringify(args ?? null)).digest("hex").slice(0, 16);
  await db.permissionAudit.create({ data: { runId, agentId, tool, decision: d.decision, reason: d.reason, argsHash } });
}
```

I log a hash of the arguments instead of the arguments themselves, so secrets don't end up in the audit table.

### `src/lib/tools/builtin.ts`

`KnowledgePort` is your seam into OBA's search and note functions. Implement it once against the real engine.

```ts
import { z } from "zod";
import { registry } from "./registry";

export interface KnowledgePort {
  search(q: string, k: number): Promise<{ id: string; title: string; snippet: string }[]>;
  getNote(id: string): Promise<{ id: string; title: string; body: string } | null>;
  updateNote(id: string, body: string): Promise<void>;
  createNote(title: string, body: string): Promise<{ id: string }>;
}
let port: KnowledgePort | null = null;
export const setKnowledgePort = (p: KnowledgePort) => { port = p; };
const kp = () => { if (!port) throw new Error("KnowledgePort not configured"); return port; };

registry.register({
  name: "brain.search", description: "Search the second brain. Returns ids, titles, snippets.",
  risk: "read", scope: "knowledge", input: z.object({ query: z.string().min(1).max(300), k: z.number().int().min(1).max(10).default(5) }),
  run: async ({ query, k }) => kp().search(query, k),
});
registry.register({
  name: "brain.get", description: "Read one note by id.",
  risk: "read", scope: "knowledge", input: z.object({ id: z.string().max(100) }),
  run: async ({ id }) => kp().getNote(id),
});
registry.register({
  name: "brain.update", description: "Replace a note's body.",
  risk: "write", scope: "project", input: z.object({ id: z.string().max(100), body: z.string().max(50_000) }),
  snapshot: async ({ id }) => { const n = await kp().getNote(id); return n ? { targetId: id, before: n.body } : null; },
  run: async ({ id, body }) => { await kp().updateNote(id, body); return { ok: true }; },
});
registry.register({
  name: "artifact.save", description: "Save a document, code or diagram as a versioned artifact.",
  risk: "read", input: z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/), title: z.string().max(120), kind: z.enum(["markdown","code","mermaid"]), content: z.string().max(100_000) }),
  run: async (a, ctx) => {
    const { db } = await import("@/lib/db");
    const last = await db.artifact.findFirst({ where: { runId: ctx.runId, key: a.key }, orderBy: { version: "desc" } });
    const row = await db.artifact.create({ data: { ...a, runId: ctx.runId, version: (last?.version ?? 0) + 1 } });
    return { id: row.id, version: row.version };
  },
});
```

`artifact.save` is marked `read` because it writes only to its own run, which is inert. That gives you the versioned side panel (step 8) with no extra permission.

## Step 4: Skills and compaction

### `src/lib/skills/skills.ts`

```ts
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { registry } from "@/lib/tools/registry";

const DIR = process.env.CORTEX_SKILLS_DIR ?? path.resolve(process.cwd(), "skills");
const NAME = /^[a-z0-9-]{1,48}$/;

export async function skillCatalog(allowed: string[]) {
  const out: { name: string; description: string }[] = [];
  for (const name of allowed) {
    if (!NAME.test(name)) continue;
    try {
      const raw = await fs.readFile(path.join(DIR, name, "SKILL.md"), "utf8");
      out.push({ name, description: String(matter(raw).data.description ?? "").slice(0, 200) });
    } catch { /* missing skill ignored */ }
  }
  return out;
}

registry.register({
  name: "skill.load", description: "Load the full instructions of a skill by name.",
  risk: "read", input: z.object({ name: z.string().regex(NAME) }),
  run: async ({ name }) => {
    const raw = await fs.readFile(path.join(DIR, name, "SKILL.md"), "utf8");
    return matter(raw).content.slice(0, 20_000);
  },
});
```

The gate only lets an agent call `skill.load` if the tool is in its `tools`. The runtime also rejects any skill name that is not in `agent.skills`.

### `src/lib/runtime/compact.ts`

```ts
import type { Msg } from "@/lib/providers/router";
import { router } from "@/lib/providers";

export const estimateTokens = (m: Msg[]) => Math.ceil(m.reduce((n, x) => n + x.content.length, 0) / 4);

/** Keep system + first user message + last `keep` turns. Summarize the middle. */
export async function compact(messages: Msg[], opts: { maxTokens: number; keep?: number; privacy: "local-only" | "any" }) {
  if (estimateTokens(messages) <= opts.maxTokens) return { messages, compacted: false, usage: null };
  const keep = opts.keep ?? 6;
  const head = messages.slice(0, 2);
  const tail = messages.slice(-keep);
  const middle = messages.slice(2, messages.length - keep);
  if (middle.length === 0) return { messages, compacted: false, usage: null };
  const r = await router.chat(
    { task: "summarize", privacy: opts.privacy },
    [
      { role: "system", content: "Summarize this agent transcript. Keep: decisions, facts found, tool results that matter, open questions. Under 300 words." },
      { role: "user", content: middle.map((m) => `${m.role}: ${m.content.slice(0, 2000)}`).join("\n") },
    ]
  );
  return {
    messages: [...head, { role: "user" as const, content: `[Summary of earlier steps]\n${r.text}` }, ...tail],
    compacted: true, usage: r,
  };
}
```

## Step 5: Runtime

### `src/lib/runtime/types.ts`

```ts
import { z } from "zod";

export type RunnableAgent = {
  id: string; name: string; systemPrompt: string;
  provider: string; model: string; fallbackModels: string[];
  tools: string[]; skills: string[]; mcpServers: string[];
  permissions: { fs: "none" | "read-only" | "project-only"; network: boolean; shell: "deny" | "ask" | "allow" };
  delegation: { canSpawn: boolean; maxDepth: number; maxConcurrent: number; allowed: string[] };
  memory: { read: string[]; write: string[] };
  budget: { maxTokensPerRun: number; maxCostUsd: number; maxSteps?: number };
  requirePlanApproval?: boolean;
  acceptance?: string;           // criteria for the judge
  privacy?: "local-only" | "any";
};

export const ModelAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tool"), tool: z.string(), args: z.record(z.any()).default({}) }),
  z.object({ action: z.literal("delegate"), agentId: z.string(), task: z.string().max(4000) }),
  z.object({ action: z.literal("final"), result: z.string().max(100_000) }),
]);
export type ModelAction = z.infer<typeof ModelAction>;
```

`loadRunnableAgent(agentId)` is the function from my AgentDefinition v2 files. It must load by id from the database and verify the agent is approved. Import it in the runtime below.

### `src/lib/runtime/runtime.ts`

```ts
import { db } from "@/lib/db";
import { router } from "@/lib/providers";
import type { Msg } from "@/lib/providers/router";
import { registry } from "@/lib/tools/registry";
import { decide, audit } from "@/lib/tools/gate";
import { compileInstructions } from "@/lib/instructions/compile";
import { skillCatalog } from "@/lib/skills/skills";
import { compact } from "./compact";
import { ModelAction, type RunnableAgent } from "./types";
import { loadRunnableAgent } from "@/lib/agents/load"; // from AgentDefinition v2 files; must verify approval

const HARD_MAX_STEPS = 40;
const GLOBAL_MAX_DEPTH = 3;
const MAX_JUDGE_ROUNDS = 2;

type State = { pending?: { tool: string; args: Record<string, unknown>; stepIdx: number }; judgeRounds?: number };
const getState = (r: { stateJson: string }): State => JSON.parse(r.stateJson || "{}");

async function addStep(runId: string, idx: number, d: {
  kind: string; name?: string; input: unknown; output: unknown; decision?: string;
  tokens?: number; costUsd?: number; latencyMs?: number;
}) {
  await db.runStep.create({ data: {
    runId, idx, kind: d.kind, name: d.name, decision: d.decision,
    inputJson: JSON.stringify(d.input), outputJson: JSON.stringify(d.output),
    tokens: d.tokens ?? 0, costUsd: d.costUsd ?? 0, latencyMs: d.latencyMs ?? 0,
  }});
}

/** Start a run. Only agentId + task cross the API boundary. */
export async function startRun(input: { agentId: string; task: string; projectId?: string | null; parentRunId?: string; depth?: number; budgetOverride?: Partial<RunnableAgent["budget"]> }) {
  const agent = await loadRunnableAgent(input.agentId);
  const depth = input.depth ?? 0;
  if (depth > Math.min(agent.delegation.maxDepth + (input.parentRunId ? 1 : 0), GLOBAL_MAX_DEPTH + 1)) throw new Error("depth limit");
  const budget = { ...agent.budget, ...input.budgetOverride };
  const run = await db.agentRun.create({ data: {
    agentId: agent.id, task: input.task.slice(0, 8000), depth, parentRunId: input.parentRunId,
    status: agent.requirePlanApproval ? "planning" : "running", budgetJson: JSON.stringify(budget),
    stateJson: JSON.stringify({ projectId: input.projectId ?? null }),
  }});
  return run.id;
}

/** Drive a run until it finishes or needs a human. Safe to call again to resume. */
export async function advance(runId: string): Promise<void> {
  // claim: prevent two workers advancing the same run
  const claimed = await db.agentRun.updateMany({
    where: { id: runId, status: { in: ["planning", "running"] } },
    data: { updatedAt: new Date() },
  });
  if (claimed.count === 0) return;

  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { steps: { orderBy: { idx: "asc" } } } });
  const agent = await loadRunnableAgent(run.agentId);
  const budget = JSON.parse(run.budgetJson) as RunnableAgent["budget"];
  const projectId = (JSON.parse(run.stateJson).projectId ?? null) as string | null;
  const ctx = { runId, agentId: agent.id, projectId };
  const privacy = agent.privacy ?? "any";
  const route = (task: "plan" | "act" | "judge") => ({
    task, privacy,
    preferred: { provider: agent.provider, model: agent.model },
    fallbacks: agent.fallbackModels.map((m) => { const [provider, ...rest] = m.split("/"); return { provider, model: rest.join("/") }; }),
  });

  const fail = async (error: string) =>
    db.agentRun.update({ where: { id: runId }, data: { status: "failed", error } });

  // ---- PLAN phase
  if (run.status === "planning") {
    const inst = await compileInstructions({ projectId, agentPrompt: agent.systemPrompt });
    const r = await router.chat(route("plan"), [
      { role: "system", content: inst.text },
      { role: "user", content: `Task: ${run.task}\nWrite a short numbered plan. Tools available: ${agent.tools.join(", ")}. Do not execute anything.` },
    ]);
    await addStep(runId, run.steps.length, { kind: "plan", input: run.task, output: r.text, tokens: r.tokensIn + r.tokensOut, costUsd: r.costUsd });
    await db.agentRun.update({ where: { id: runId }, data: { plan: r.text, status: "awaiting_plan",
      tokensUsed: { increment: r.tokensIn + r.tokensOut }, costUsd: { increment: r.costUsd } } });
    return;
  }

  // ---- ACT loop
  const inst = await compileInstructions({ projectId, agentPrompt: agent.systemPrompt });
  const skills = await skillCatalog(agent.skills);
  const toolDocs = agent.tools
    .map((n) => registry.get(n)).filter(Boolean)
    .map((t) => `- ${t!.name}: ${t!.description} args=${JSON.stringify(Object.keys((t!.input as any).shape ?? {}))}`).join("\n");

  const system = `${inst.text}

You act in a loop. Reply with ONE JSON object per turn, no other text:
{"action":"tool","tool":"<name>","args":{...}} | {"action":"delegate","agentId":"<id>","task":"..."} | {"action":"final","result":"..."}
Tools:
${toolDocs}
${skills.length ? `Skills (load with skill.load):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}` : ""}
${run.plan ? `Approved plan:\n${run.plan}` : ""}`;

  let messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: run.task }];
  for (const s of run.steps) {
    if (s.kind === "model") messages.push({ role: "assistant", content: JSON.parse(s.outputJson) });
    if (s.kind === "tool" || s.kind === "delegate") messages.push({ role: "user", content: `Tool result (${s.name}): ${JSON.stringify(JSON.parse(s.outputJson)).slice(0, 6000)}` });
    if (s.kind === "judge") messages.push({ role: "user", content: `Reviewer feedback: ${JSON.parse(s.outputJson).feedback}` });
  }

  let idx = run.steps.length;
  let tokens = run.tokensUsed, cost = run.costUsd;
  const maxSteps = Math.min(budget.maxSteps ?? 25, HARD_MAX_STEPS);

  while (true) {
    if (idx >= maxSteps) return void (await fail("step limit"));
    if (tokens >= budget.maxTokensPerRun) return void (await fail("token budget exceeded"));
    if (cost >= budget.maxCostUsd) return void (await fail("cost budget exceeded"));

    const c = await compact(messages, { maxTokens: 24_000, privacy });
    if (c.compacted) {
      messages = c.messages;
      await addStep(runId, idx++, { kind: "compact", input: null, output: "context compacted", tokens: c.usage!.tokensIn + c.usage!.tokensOut, costUsd: c.usage!.costUsd });
    }

    const t0 = Date.now();
    let r;
    try { r = await router.chat(route("act"), messages, { json: true }); }
    catch (e) { return void (await fail((e as Error).message)); }
    tokens += r.tokensIn + r.tokensOut; cost += r.costUsd;
    await addStep(runId, idx++, { kind: "model", name: r.model, input: null, output: r.text, tokens: r.tokensIn + r.tokensOut, costUsd: r.costUsd, latencyMs: Date.now() - t0 });
    await db.agentRun.update({ where: { id: runId }, data: { tokensUsed: tokens, costUsd: cost } });
    messages.push({ role: "assistant", content: r.text });

    // structured output: validate, allow one repair retry
    let act: ModelAction | null = null;
    for (let attempt = 0; attempt < 2 && !act; attempt++) {
      try { act = ModelAction.parse(JSON.parse(r.text)); }
      catch {
        if (attempt === 1) break;
        messages.push({ role: "user", content: "Invalid format. Reply with exactly one valid JSON action object." });
        r = await router.chat(route("act"), messages, { json: true });
        tokens += r.tokensIn + r.tokensOut; cost += r.costUsd;
        await addStep(runId, idx++, { kind: "model", name: r.model + " (repair)", input: null, output: r.text, tokens: r.tokensIn + r.tokensOut, costUsd: r.costUsd });
        messages.push({ role: "assistant", content: r.text });
      }
    }
    if (!act) return void (await fail("model produced invalid action twice"));

    if (act.action === "final") {
      // judge (max 2 rounds)
      const st = getState(run);
      const rounds = st.judgeRounds ?? 0;
      if (agent.acceptance && rounds < MAX_JUDGE_ROUNDS) {
        const jr = await router.chat(route("judge"), [
          { role: "system", content: 'You review work against acceptance criteria. Reply JSON: {"pass":boolean,"feedback":string}.' },
          { role: "user", content: `Criteria:\n${agent.acceptance}\n\nTask:\n${run.task}\n\nResult:\n${act.result}` },
        ], { json: true });
        tokens += jr.tokensIn + jr.tokensOut; cost += jr.costUsd;
        let verdict = { pass: true, feedback: "" };
        try { verdict = JSON.parse(jr.text); } catch { /* treat unparseable as pass; logged below */ }
        await addStep(runId, idx++, { kind: "judge", input: null, output: verdict, tokens: jr.tokensIn + jr.tokensOut, costUsd: jr.costUsd });
        if (!verdict.pass) {
          await db.agentRun.update({ where: { id: runId }, data: { stateJson: JSON.stringify({ ...st, judgeRounds: rounds + 1, projectId }) } });
          messages.push({ role: "user", content: `Reviewer feedback: ${verdict.feedback}. Revise and reply with a new final action.` });
          run.stateJson = JSON.stringify({ ...st, judgeRounds: rounds + 1, projectId });
          continue;
        }
      }
      await db.agentRun.update({ where: { id: runId }, data: { status: "succeeded", result: act.result, tokensUsed: tokens, costUsd: cost } });
      return;
    }

    if (act.action === "delegate") {
      const spawn = registry.get("agent.spawn") ?? null; // optional tool; gate on agent config instead
      void spawn;
      if (!agent.delegation.canSpawn) { messages.push({ role: "user", content: "Denied: spawning disabled." }); await addStep(runId, idx++, { kind: "delegate", name: act.agentId, input: act, output: { error: "spawning disabled" }, decision: "deny" }); continue; }
      if (!agent.delegation.allowed.includes(act.agentId)) { messages.push({ role: "user", content: "Denied: agent not in allowed list." }); await addStep(runId, idx++, { kind: "delegate", name: act.agentId, input: act, output: { error: "not allowed" }, decision: "deny" }); continue; }
      const active = await db.agentRun.count({ where: { parentRunId: runId, status: { in: ["running", "planning", "awaiting_tool", "awaiting_plan"] } } });
      if (active >= agent.delegation.maxConcurrent || run.depth + 1 > agent.delegation.maxDepth) {
        await addStep(runId, idx++, { kind: "delegate", name: act.agentId, input: act, output: { error: "limit" }, decision: "deny" });
        messages.push({ role: "user", content: "Denied: delegation limit." }); continue;
      }
      // child gets at most half of the remaining budget
      const childBudget = { maxTokensPerRun: Math.floor((budget.maxTokensPerRun - tokens) / 2), maxCostUsd: (budget.maxCostUsd - cost) / 2 };
      const childId = await startRun({ agentId: act.agentId, task: act.task, projectId, parentRunId: runId, depth: run.depth + 1, budgetOverride: childBudget });
      await advance(childId);
      const child = await db.agentRun.findUniqueOrThrow({ where: { id: childId } });
      tokens += child.tokensUsed; cost += child.costUsd;
      // parent sees only the summary, never the child's transcript
      const summary = { status: child.status, result: child.result?.slice(0, 4000) ?? null, error: child.error };
      await addStep(runId, idx++, { kind: "delegate", name: act.agentId, input: act, output: summary, decision: "allow", tokens: child.tokensUsed, costUsd: child.costUsd });
      messages.push({ role: "user", content: `Tool result (${act.agentId}): ${JSON.stringify(summary)}` });
      continue;
    }

    // ---- TOOL call
    const tool = registry.get(act.tool);
    if (!tool) { messages.push({ role: "user", content: `Unknown tool ${act.tool}.` }); await addStep(runId, idx++, { kind: "tool", name: act.tool, input: act.args, output: { error: "unknown tool" }, decision: "deny" }); continue; }
    if (tool.name === "skill.load" && !agent.skills.includes(String((act.args as any).name))) {
      messages.push({ role: "user", content: "Skill not granted." }); continue;
    }
    const parsed = tool.input.safeParse(act.args);
    if (!parsed.success) { const e = parsed.error.issues.map((i) => i.message).join("; "); messages.push({ role: "user", content: `Bad args: ${e}` }); await addStep(runId, idx++, { kind: "tool", name: tool.name, input: act.args, output: { error: e } }); continue; }

    const d = decide(agent, tool);
    await audit(runId, agent.id, tool.name, d, parsed.data);
    if (d.decision === "deny") {
      await addStep(runId, idx++, { kind: "tool", name: tool.name, input: parsed.data, output: { error: d.reason }, decision: "deny" });
      messages.push({ role: "user", content: `Denied: ${d.reason}` }); continue;
    }
    if (d.decision === "ask") {
      // pause: durable state, human decides
      await addStep(runId, idx, { kind: "tool", name: tool.name, input: parsed.data, output: { pending: true }, decision: "ask" });
      await db.agentRun.update({ where: { id: runId }, data: { status: "awaiting_tool",
        stateJson: JSON.stringify({ ...getState(run), projectId, pending: { tool: tool.name, args: parsed.data, stepIdx: idx } }) } });
      return;
    }
    const out = await executeTool(tool.name, parsed.data, ctx, idx);
    await addStep(runId, idx++, { kind: "tool", name: tool.name, input: parsed.data, output: out, decision: "allow" });
    messages.push({ role: "user", content: `Tool result (${tool.name}): ${JSON.stringify(out).slice(0, 6000)}` });
  }
}

async function executeTool(name: string, args: any, ctx: { runId: string; agentId: string; projectId?: string | null }, stepIdx: number) {
  const tool = registry.get(name)!;
  try {
    if (tool.snapshot) {
      const snap = await tool.snapshot(args, ctx);
      if (snap) await db.checkpoint.create({ data: { runId: ctx.runId, stepIdx, tool: name, targetId: snap.targetId, beforeJson: JSON.stringify(snap.before) } });
    }
    return await tool.run(args, ctx);
  } catch (e) { return { error: (e as Error).message }; }
}

/** Human approves/rejects the plan. */
export async function resolvePlan(runId: string, approve: boolean, editedPlan?: string) {
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "awaiting_plan") throw new Error("not awaiting plan");
  if (!approve) { await db.agentRun.update({ where: { id: runId }, data: { status: "cancelled" } }); return; }
  await db.agentRun.update({ where: { id: runId }, data: { status: "running", plan: (editedPlan ?? run.plan ?? "").slice(0, 8000) } });
  await advance(runId);
}

/** Human approves/rejects a pending tool call. Re-checks the gate server-side. */
export async function resolveTool(runId: string, approve: boolean) {
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "awaiting_tool") throw new Error("not awaiting tool");
  const st = getState(run); const p = st.pending; if (!p) throw new Error("no pending call");
  const agent = await loadRunnableAgent(run.agentId);
  const tool = registry.get(p.tool)!;
  const ctx = { runId, agentId: agent.id, projectId: (st as any).projectId ?? null };
  let output: unknown = { error: "rejected by user" };
  if (approve) {
    const d = decide(agent, tool, { preApproved: true });
    await audit(runId, agent.id, tool.name, d, p.args);
    output = d.decision === "allow" ? await executeTool(tool.name, p.args, ctx, p.stepIdx) : { error: d.reason };
  }
  // replace the pending step with the real result
  await db.runStep.update({ where: { runId_idx: { runId, idx: p.stepIdx } }, data: { outputJson: JSON.stringify(output), decision: approve ? "allow" : "deny" } });
  await db.agentRun.update({ where: { id: runId }, data: { status: "running", stateJson: JSON.stringify({ ...st, pending: undefined }) } });
  await advance(runId);
}

export async function cancelRun(runId: string) {
  await db.agentRun.updateMany({ where: { id: runId, status: { in: ["planning", "running", "awaiting_plan", "awaiting_tool"] } }, data: { status: "cancelled" } });
}
```

Things to know about this file:
- **Durability:** the model messages are rebuilt from `RunStep` rows. A restart or resume loses nothing.
- **Pause and resume:** `awaiting_plan` and `awaiting_tool` are the pause states. Calling `advance` again resumes.
- **Child budget:** a child gets at most half of the remaining budget, and the parent sees only its summary.
- **Concurrency:** the `updateMany` claim is a light guard, not a real lock. On Postgres, use `SELECT ... FOR UPDATE SKIP LOCKED`. Calling `advance` in a request handler holds that request open for the whole run, so call it from your job runner in production.
- **`agent.spawn` lines:** these are leftovers from an earlier design. Delete the two lines that reference `spawn`.

## Step 6: Checkpoints and undo

`src/lib/runtime/undo.ts`:

```ts
import { db } from "@/lib/db";
import { setKnowledgePort } from "@/lib/tools/builtin";
import type { KnowledgePort } from "@/lib/tools/builtin";

let kp: KnowledgePort | null = null;
export const bindUndoPort = (p: KnowledgePort) => { kp = p; setKnowledgePort(p); };

/** Roll back all checkpoints for a run, newest first. */
export async function undoRun(runId: string) {
  if (!kp) throw new Error("port not bound");
  const cps = await db.checkpoint.findMany({ where: { runId, restoredAt: null }, orderBy: { stepIdx: "desc" } });
  const restored: string[] = [];
  for (const cp of cps) {
    if (cp.tool === "brain.update") await kp.updateNote(cp.targetId, JSON.parse(cp.beforeJson));
    await db.checkpoint.update({ where: { id: cp.id }, data: { restoredAt: new Date() } });
    restored.push(cp.targetId);
  }
  return { restored };
}
```

To make a new write tool undoable, add a `snapshot` function to it and a branch for it in `undoRun`.

## Step 7: MCP

### Server: `src/mcp/server.ts`

This server is read-only. Run it with `npx tsx src/mcp/server.ts`.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { port } from "./port"; // your KnowledgePort implementation, exported here

const server = new McpServer({ name: "cortex-brain", version: "0.1.0" });

server.tool("brain_search", "Search the Cortex second brain",
  { query: z.string().min(1).max(300), k: z.number().int().min(1).max(10).default(5) },
  async ({ query, k }) => ({ content: [{ type: "text", text: JSON.stringify(await port.search(query, k)) }] }));

server.tool("brain_get", "Read a note by id",
  { id: z.string().max(100) },
  async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify(await port.getNote(id)) }] }));

// NO write tools in v0. Add them later behind the same permission gate and an approval queue.
await server.connect(new StdioServerTransport());
```

Over stdio the server inherits your local user's access. Never expose it over HTTP without authentication.

### Client: `src/lib/mcp/client.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { registry } from "@/lib/tools/registry";

// Servers are SERVER-SIDE config only. Never accept a command from the browser.
const SERVERS: Record<string, { command: string; args: string[] }> = JSON.parse(process.env.CORTEX_MCP_SERVERS ?? "{}");

export async function connectMcp(name: string) {
  const cfg = SERVERS[name];
  if (!cfg) throw new Error(`MCP server '${name}' not configured`);
  const client = new Client({ name: "cortex", version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args }));
  const { tools } = await client.listTools();
  for (const t of tools) {
    registry.register({
      name: `mcp.${name}.${t.name}`,
      description: (t.description ?? "").slice(0, 300),
      risk: "network",                     // unknown external tool: treat as needing approval
      input: z.record(z.any()),
      run: async (args) => (await client.callTool({ name: t.name, arguments: args })).content,
    });
  }
  return client;
}
```

Every MCP tool is registered as `network` risk. That makes it need approval and requires `permissions.network` on the agent. Only loosen this per tool, and only after you've reviewed that tool.

## Step 8: API routes

Every route calls `requireOwner` first. Replace the import with OBA's real auth function.

`src/app/api/runs/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { startRun, advance } from "@/lib/runtime/runtime";

const Body = z.object({ agentId: z.string().max(100), task: z.string().min(1).max(8000), projectId: z.string().max(64).nullish() });

export async function POST(req: Request) {
  const denied = await requireOwner(req); if (denied) return denied;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const id = await startRun(b.data);       // only agentId + task. Definition is loaded server-side.
  void advance(id).catch(() => {});        // production: enqueue in your job runner instead
  return NextResponse.json({ id });
}
```

`src/app/api/runs/[id]/route.ts` (GET returns the run with steps, artifacts and checkpoints):
```ts
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = await requireOwner(req); if (denied) return denied;
  const run = await db.agentRun.findUnique({ where: { id: params.id }, include: { steps: { orderBy: { idx: "asc" } }, artifacts: true, checkpoints: true } });
  return run ? NextResponse.json(run) : NextResponse.json({ error: "not found" }, { status: 404 });
}
```

`src/app/api/runs/[id]/action/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { resolvePlan, resolveTool, cancelRun } from "@/lib/runtime/runtime";
import { undoRun } from "@/lib/runtime/undo";

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan"), approve: z.boolean(), editedPlan: z.string().max(8000).optional() }),
  z.object({ type: z.literal("tool"), approve: z.boolean() }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("undo") }),
]);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = await requireOwner(req); if (denied) return denied;
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    if (b.data.type === "plan") await resolvePlan(params.id, b.data.approve, b.data.editedPlan);
    else if (b.data.type === "tool") await resolveTool(params.id, b.data.approve);
    else if (b.data.type === "cancel") await cancelRun(params.id);
    else return NextResponse.json(await undoRun(params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 409 }); }
}
```

Also register built-ins and the knowledge port once at server start (for example in `src/lib/runtime/boot.ts`, imported by your routes):

```ts
import "@/lib/tools/builtin"; import "@/lib/skills/skills";
import { bindUndoPort } from "./undo"; import { port } from "@/mcp/port";
bindUndoPort(port);
```

### UI to build (Gemini task)

This part is mock-first, using the existing shell:

| UI | Reads | Acts |
|---|---|---|
| Run-log panel (trace) | `GET /api/runs/:id`, polled every 1.5s | Shows steps, tokens, cost, decision and latency per step |
| Plan approval card | Run with `status: awaiting_plan` | `POST action {type:"plan", approve, editedPlan}` |
| Tool approval card | Run with `status: awaiting_tool` and the pending step | `POST action {type:"tool", approve}` |
| Artifacts in the inspector | `run.artifacts`, grouped by `key`, version picker | None |
| Undo button | `run.checkpoints` | `POST action {type:"undo"}` |
| Ctrl+K | Add entries "Run agent X" and "Open run" | Calls `POST /api/runs` |

## Verification, which you must do locally

1. Run `npx prisma generate && npx tsc --noEmit`. Expect type errors on the seams (`loadRunnableAgent`, `requireOwner`, `port`). That's normal. Fix those first.
2. Write `scripts/verify-runtime.ts` with a fake provider and check these:
   - **Gate:** `decide` denies a tool that isn't in `agent.tools`, and asks for write, network and shell tools. Shell `deny` always denies.
   - **Budgets:** a run fails at the token limit, the cost limit and the step limit.
   - **Plan flow:** a `requirePlanApproval` agent stops at `awaiting_plan`. After approval it reaches `succeeded`.
   - **Pause and resume:** a write call stops at `awaiting_tool`, and `resolveTool` resumes it. The checkpoint exists, and `undoRun` restores the note.
   - **Delegation:** depth 0 refuses to spawn. A child's budget is no more than half of what the parent has left. The parent sees only the summary.
   - **Judge:** it runs at most 2 rounds.
   - **Resume:** kill the process mid-run, call `advance` again, and check that the run continues from its last step.
3. Test the API with a missing cookie. Every route should answer 401 or 403.

## Not done in this batch

- Native Anthropic and Gemini adapters, which are only needed if you want their non-compatible features.
- Streaming of tokens to the UI.
- A proper job queue and locking.
- MCP write tools and an HTTP transport with auth.
- Evaluation sets for the retrieval and judge logic.

Next, I'd write `loadRunnableAgent` against your `AgentDefinition` v2 Prisma models, because step 5 depends on it. Do you want that, or the `verify-runtime.ts` test file first?