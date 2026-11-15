export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatResult = { text: string; tokensIn: number; tokensOut: number; costUsd: number; model: string };
export type TaskType = 'plan' | 'act' | 'judge' | 'summarize';
export type Privacy = 'local-only' | 'any';

export type ProviderModelConfig = {
  name: string;
  inPerMTok: number;
  outPerMTok: number;
  tasks: TaskType[];
  ctx: number;
};

export type ProviderConfig = {
  id: string;
  baseUrl: string; // e.g. https://openrouter.ai/api/v1
  apiKeyEnv?: string; // env var NAME, never the key itself
  local: boolean;
  jsonMode?: boolean; // D11: when false, do not send response_format
  models: ProviderModelConfig[];
};

export type RouteRequest = {
  task: TaskType;
  privacy: Privacy;
  preferred?: { provider: string; model: string };
  fallbacks?: { provider: string; model: string }[];
  maxCostUsd?: number;
};

class HttpStatusError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export function estimateWorstCaseCostUsd(model: ProviderModelConfig, messages: Msg[]): number {
  const estInTokens = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
  const worstCaseOutTokens = Math.max(0, model.ctx - estInTokens);
  return (estInTokens * model.inPerMTok + worstCaseOutTokens * model.outPerMTok) / 1_000_000;
}

export class ProviderRouter {
  constructor(private providers: ProviderConfig[], private timeoutMs = 60_000) {}

  /** Ordered candidate list: preferred, fallbacks, then cheapest fit for the task. */
  candidates(req: RouteRequest): { p: ProviderConfig; model: string }[] {
    const out: { p: ProviderConfig; model: string }[] = [];
    const add = (pid: string, model: string) => {
      const p = this.providers.find((x) => x.id === pid);
      if (!p || !p.models.some((m) => m.name === model)) return;
      if (req.privacy === 'local-only' && !p.local) return;
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
      const modelCfg = p.models.find((m) => m.name === model);
      if (req.maxCostUsd !== undefined && modelCfg) {
        const worstCost = estimateWorstCaseCostUsd(modelCfg, messages);
        if (worstCost > req.maxCostUsd) {
          errors.push(
            `${p.id}/${model}: skipped (estimated worst-case cost $${worstCost.toFixed(4)} > maxCostUsd $${req.maxCostUsd})`
          );
          continue;
        }
      }
      try {
        return await this.call(p, model, messages, opts);
      } catch (e) {
        if (e instanceof HttpStatusError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw new Error(`${p.id}/${model}: ${e.message}`);
        }
        errors.push(`${p.id}/${model}: ${(e as Error).message}`);
      }
    }
    throw new Error(`All providers failed or none allowed: ${errors.join(' | ') || 'no candidates'}`);
  }

  private async call(
    p: ProviderConfig,
    model: string,
    messages: Msg[],
    opts: { json?: boolean }
  ): Promise<ChatResult> {
    const key = p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined;
    if (p.apiKeyEnv && !key) throw new Error(`missing env ${p.apiKeyEnv}`);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const sendJsonFormat = Boolean(opts.json && p.jsonMode !== false);
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'content-type': 'application/json',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          ...(sendJsonFormat ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (!res.ok) throw new HttpStatusError(res.status);
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text: string = j.choices?.[0]?.message?.content ?? '';
      const tin: number =
        j.usage?.prompt_tokens ?? Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
      const tout: number = j.usage?.completion_tokens ?? Math.ceil(text.length / 4);
      const m = p.models.find((x) => x.name === model)!;
      const costUsd = (tin * m.inPerMTok + tout * m.outPerMTok) / 1_000_000;
      return { text, tokensIn: tin, tokensOut: tout, costUsd, model: `${p.id}/${model}` };
    } finally {
      clearTimeout(t);
    }
  }
}
