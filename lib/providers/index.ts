import { ProviderRouter } from './router';

// VERIFY AGAINST PROVIDER DOCS: example model names, context sizes, and prices below are placeholders.
export const router = new ProviderRouter([
  {
    id: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    local: true,
    models: [
      {
        name: 'llama3.1',
        inPerMTok: 0,
        outPerMTok: 0,
        ctx: 128_000,
        tasks: ['plan', 'act', 'judge', 'summarize'],
      },
    ],
  },
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    local: false,
    models: [
      {
        name: 'deepseek/deepseek-chat',
        inPerMTok: 0.3,
        outPerMTok: 1.2,
        ctx: 64_000,
        tasks: ['plan', 'act', 'judge', 'summarize'],
      },
    ],
  },
]);
