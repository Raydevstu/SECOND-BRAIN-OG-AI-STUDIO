import assert from 'node:assert/strict';
import { ProviderRouter, type Msg, type ProviderConfig } from '../lib/providers/router';

const BASE_MSGS: Msg[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello world' },
];

async function withFakeFetch(
  impl: typeof fetch,
  fn: () => Promise<void>
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

async function main() {
  const providers: ProviderConfig[] = [
    {
      id: 'expensive',
      baseUrl: 'https://expensive.example/v1',
      apiKeyEnv: 'TEST_EXPENSIVE_KEY',
      local: false,
      models: [
        { name: 'big-model', inPerMTok: 5, outPerMTok: 15, ctx: 100_000, tasks: ['plan', 'act'] },
      ],
    },
    {
      id: 'cheap',
      baseUrl: 'https://cheap.example/v1',
      apiKeyEnv: 'TEST_CHEAP_KEY',
      local: false,
      jsonMode: false,
      models: [
        { name: 'small-model', inPerMTok: 0.1, outPerMTok: 0.2, ctx: 32_000, tasks: ['plan', 'act', 'summarize'] },
      ],
    },
    {
      id: 'local-ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      local: true,
      models: [
        { name: 'local-7b', inPerMTok: 0, outPerMTok: 0, ctx: 32_000, tasks: ['plan', 'act', 'judge', 'summarize'] },
      ],
    },
  ];

  process.env.TEST_EXPENSIVE_KEY = 'dummy-test-env-val-1';
  process.env.TEST_CHEAP_KEY = 'dummy-test-env-val-2';

  try {
    const r = new ProviderRouter(providers, 50);

    // 1. Candidate ordering: preferred -> fallback -> cheapest
    const ordered = r.candidates({
      task: 'act',
      privacy: 'any',
      preferred: { provider: 'expensive', model: 'big-model' },
      fallbacks: [{ provider: 'cheap', model: 'small-model' }],
    });
    assert.deepEqual(
      ordered.map((c) => `${c.p.id}/${c.model}`),
      ['expensive/big-model', 'cheap/small-model', 'local-ollama/local-7b']
    );

    // 2. local-only excludes non-local providers
    const localOnly = r.candidates({
      task: 'act',
      privacy: 'local-only',
      preferred: { provider: 'expensive', model: 'big-model' },
      fallbacks: [{ provider: 'cheap', model: 'small-model' }],
    });
    assert.deepEqual(
      localOnly.map((c) => `${c.p.id}/${c.model}`),
      ['local-ollama/local-7b']
    );

    // 3. Timeout falls through to the next candidate
    const calledUrls: string[] = [];
    await withFakeFetch(
      async (input, init) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.includes('expensive.example')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      async () => {
        const res = await r.chat(
          {
            task: 'act',
            privacy: 'any',
            preferred: { provider: 'expensive', model: 'big-model' },
            fallbacks: [{ provider: 'cheap', model: 'small-model' }],
          },
          BASE_MSGS
        );
        assert.equal(res.model, 'cheap/small-model');
        assert.equal(calledUrls.length, 2);
      }
    );

    // 4. Missing env key skips that provider
    delete process.env.TEST_EXPENSIVE_KEY;
    const skippedUrls: string[] = [];
    await withFakeFetch(
      async (input) => {
        skippedUrls.push(String(input));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      async () => {
        const res = await r.chat(
          {
            task: 'act',
            privacy: 'any',
            preferred: { provider: 'expensive', model: 'big-model' },
            fallbacks: [{ provider: 'cheap', model: 'small-model' }],
          },
          BASE_MSGS
        );
        assert.equal(res.model, 'cheap/small-model');
        assert.equal(skippedUrls.length, 1);
        assert.ok(skippedUrls[0].includes('cheap.example'));
      }
    );
    process.env.TEST_EXPENSIVE_KEY = 'dummy-test-env-val-1';

    // 5. D11: maxCostUsd skips candidates whose worst-case estimated cost exceeds limit
    // expensive/big-model worst-case ~ $1.50; cheap/small-model worst-case ~ $0.0064
    const budgetUrls: string[] = [];
    await withFakeFetch(
      async (input) => {
        budgetUrls.push(String(input));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'within budget' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      async () => {
        const res = await r.chat(
          {
            task: 'act',
            privacy: 'any',
            preferred: { provider: 'expensive', model: 'big-model' },
            fallbacks: [{ provider: 'cheap', model: 'small-model' }],
            maxCostUsd: 0.05,
          },
          BASE_MSGS
        );
        assert.equal(res.model, 'cheap/small-model');
        assert.equal(budgetUrls.length, 1);
        assert.ok(budgetUrls[0].includes('cheap.example'));
      }
    );

    // 6. D11: jsonMode:false omits response_format; default sends it
    const bodies: Array<Record<string, unknown>> = [];
    await withFakeFetch(
      async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      async () => {
        await r.chat(
          { task: 'act', privacy: 'any', preferred: { provider: 'cheap', model: 'small-model' } },
          BASE_MSGS,
          { json: true }
        );
        await r.chat(
          { task: 'act', privacy: 'local-only' },
          BASE_MSGS,
          { json: true }
        );
        assert.equal(bodies[0].response_format, undefined, 'jsonMode:false must omit response_format');
        assert.deepEqual(bodies[1].response_format, { type: 'json_object' });
      }
    );

    // 7. D11: 429 falls through to next candidate, while other 4xx (e.g. 400) does NOT retry
    const retryUrls: string[] = [];
    await withFakeFetch(
      async (input) => {
        const url = String(input);
        retryUrls.push(url);
        if (url.includes('expensive.example')) {
          return new Response('rate limited', { status: 429 });
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'recovered from 429' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      async () => {
        const res = await r.chat(
          {
            task: 'act',
            privacy: 'any',
            preferred: { provider: 'expensive', model: 'big-model' },
            fallbacks: [{ provider: 'cheap', model: 'small-model' }],
          },
          BASE_MSGS
        );
        assert.equal(res.model, 'cheap/small-model');
        assert.equal(retryUrls.length, 2);
      }
    );

    const noRetryUrls: string[] = [];
    await withFakeFetch(
      async (input) => {
        noRetryUrls.push(String(input));
        return new Response('bad request', { status: 400 });
      },
      async () => {
        await assert.rejects(
          () =>
            r.chat(
              {
                task: 'act',
                privacy: 'any',
                preferred: { provider: 'expensive', model: 'big-model' },
                fallbacks: [{ provider: 'cheap', model: 'small-model' }],
              },
              BASE_MSGS
            ),
          /HTTP 400/
        );
        assert.equal(noRetryUrls.length, 1, 'must never retry on 4xx other than 429');
      }
    );

    // 8. All-fail throws a combined error
    await withFakeFetch(
      async () => new Response('upstream error', { status: 503 }),
      async () => {
        await assert.rejects(
          () =>
            r.chat(
              {
                task: 'act',
                privacy: 'any',
                preferred: { provider: 'expensive', model: 'big-model' },
                fallbacks: [{ provider: 'cheap', model: 'small-model' }],
              },
              BASE_MSGS
            ),
          (err: Error) => {
            assert.match(err.message, /All providers failed or none allowed:/);
            assert.match(err.message, /expensive\/big-model: HTTP 503/);
            assert.match(err.message, /cheap\/small-model: HTTP 503/);
            assert.match(err.message, /local-ollama\/local-7b: HTTP 503/);
            return true;
          }
        );
      }
    );

    console.log('verify-step2: all assertions passed');
  } finally {
    delete process.env.TEST_EXPENSIVE_KEY;
    delete process.env.TEST_CHEAP_KEY;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
