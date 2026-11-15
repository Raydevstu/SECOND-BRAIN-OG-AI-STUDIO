// S5: Screenshot asset persistence + provider-gated multimodal OCR with redaction.
// Cloud OCR runs ONLY when the effective LLM provider is explicitly cloud-allowed
// and BRAIN_DISABLE_CLOUD_OCR !== "1". All OCR text is redacted before return.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSetting } from '@/lib/db';
import { redactSecretsInText } from '@/lib/privacy-redactor';

export interface VisionOcrResult {
  extractedText: string;
  visualSemanticDescription: string;
  mimeType: string;
  detectedError?: {
    error: string;
    rootCause: string;
    suggestedFix: string;
  };
  savedAssetPath: string;
  providerUsed: string;
}

const OCR_TIMEOUT_MS = 20_000;

function splitImageUri(imageBase64: string): { ext: string; raw: string } {
  const match = imageBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (match) {
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    return { ext, raw: match[2] };
  }
  return { ext: 'png', raw: imageBase64 };
}

const redact = (text: string): string => redactSecretsInText(text).text;

function cloudOcrTarget(): { key: string; base: string } | null {
  if (process.env.BRAIN_DISABLE_CLOUD_OCR === '1') return null;
  const provider = (getSetting('llm_provider') || 'auto').trim();
  if (provider !== 'openai' && provider !== 'auto') return null;
  const key = getSetting('openai_api_key') || process.env.OPENAI_API_KEY || '';
  if (!key) return null;
  const base = getSetting('openai_base_url') || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  return { key, base };
}

export async function processScreenshotAndOcr(params: {
  imageBase64: string;
  projectSlug: string;
  itemId: string;
  windowTitle?: string;
  fallbackText?: string;
}): Promise<VisionOcrResult> {
  const { ext, raw } = splitImageUri(params.imageBase64);

  const relativeDir = params.projectSlug
    ? `ProjectBrainVault/Projects/${params.projectSlug}/assets`
    : 'ProjectBrainVault/Inbox/assets';
  const absDir = path.join(process.cwd(), ...relativeDir.split('/'));
  await mkdir(absDir, { recursive: true });
  const safeItemId = params.itemId.replace(/[^a-zA-Z0-9]/g, '').slice(-12) || 'cap';
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeItemId}.${ext}`;
  await writeFile(path.join(absDir, filename), Buffer.from(raw, 'base64'));
  const savedAssetPath = `${relativeDir}/${filename}`;

  const target = cloudOcrTarget();
  if (target) {
    const model = process.env.BRAIN_VISION_MODEL || 'gpt-4o-mini';
    try {
      const resp = await fetch(`${target.base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.key}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Extract all visible text/code from the screenshot as clean Markdown, provide a 1-sentence visualSemanticDescription, and if an error is visible include detectedError {error, rootCause, suggestedFix}. Return strict JSON.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: `Active window: ${params.windowTitle || 'Unknown'}` },
                { type: 'image_url', image_url: { url: `data:image/${ext};base64,${raw}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
      });

      if (resp.ok) {
        const json = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}') as {
          extractedText?: string;
          visualSemanticDescription?: string;
          detectedError?: { error?: string; rootCause?: string; suggestedFix?: string };
        };
        const detected = parsed.detectedError;
        return {
          extractedText: redact(parsed.extractedText || params.fallbackText || ''),
          visualSemanticDescription: redact(
            parsed.visualSemanticDescription || `Screenshot from ${params.windowTitle || 'workspace'}`
          ),
          detectedError:
            detected && detected.error
              ? {
                  error: redact(detected.error),
                  rootCause: redact(detected.rootCause ?? ''),
                  suggestedFix: redact(detected.suggestedFix ?? ''),
                }
              : undefined,
          savedAssetPath,
          mimeType: `image/${ext}`,
          providerUsed: 'openai-vision',
        };
      }
    } catch {
      // Fall through to local fallback
    }
  }

  return {
    extractedText: redact(params.fallbackText || `Screenshot captured from ${params.windowTitle || 'Desktop'}`),
    visualSemanticDescription: `Visual capture of ${params.windowTitle || 'application window'}`,
    savedAssetPath,
    mimeType: `image/${ext}`,
    providerUsed: 'local-asset-store',
  };
}
