import { GoogleGenAI } from '@google/genai';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Maps any UI provider/model choice to a valid server-side Gemini execution model
 * while preserving routing metadata for the Inspector and Run Log.
 */
export function resolveServerModel(requestedModelId?: string): {
  executionModel: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  routedVia: string;
} {
  if (requestedModelId === 'gemini-3.1-flash-lite') {
    return {
      executionModel: 'gemini-3.1-flash-lite',
      routedVia: 'Direct · gemini-3.1-flash-lite',
    };
  }
  if (!requestedModelId || requestedModelId === 'gemini-4-hydrogen') {
    return {
      executionModel: 'gemini-4-hydrogen',
      routedVia: 'Direct · gemini-4-hydrogen',
    };
  }
  return {
    executionModel: 'gemini-4-hydrogen',
    routedVia: `Provider Router (${requestedModelId} -> gemini-4-hydrogen)`,
  };
}
