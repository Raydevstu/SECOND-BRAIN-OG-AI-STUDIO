import { NextRequest, NextResponse } from 'next/server';
import { checkTrustedRequest } from '@/lib/auth';
import { getGeminiClient, resolveServerModel } from '@/lib/gemini';
import { redactSecretsInText } from '@/lib/privacy-redactor';

interface ChatPayload {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  mode?: string;
  modelId?: string;
  agentName?: string;
  agentSystemPrompt?: string;
  projectName?: string | null;
  ragContext?: string;
}

export async function POST(req: NextRequest) {
  const trust = checkTrustedRequest(req);
  if (!trust.ok) {
    return NextResponse.json({ error: trust.error }, { status: trust.status });
  }
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as ChatPayload;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: 'At least one message is required.' }, { status: 400 });
    }

    const ai = getGeminiClient();
    const { executionModel, routedVia } = resolveServerModel(body.modelId);

    const systemParts = [
      body.agentSystemPrompt ||
        'You are CORTEX Harness, a unified AI engineering assistant with access to Second Brain memories, compiled Wiki pages, and Knowledge Graph context.',
      `Active Agent Persona: ${body.agentName || 'CORTEX'}`,
      `Chat Mode: ${body.mode || 'new'}`,
      body.projectName
        ? `Project Isolation Scope: "${body.projectName}". Keep answers grounded in this project space.`
        : 'Scope: Global Workspace',
      body.ragContext
        ? `Retrieved Knowledge Context (cite relevant entries naturally):\n${body.ragContext}`
        : '',
      'Format responses in crisp, scannable Markdown. Keep explanations direct and actionable.',
    ].filter(Boolean);

    const conversationText = messages
      .slice(-12)
      .map((m) => {
        const safe = redactSecretsInText(m.content).text;
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${safe}`;
      })
      .join('\n\n');

    const response = await ai.models.generateContent({
      model: executionModel,
      contents: conversationText,
      config: {
        systemInstruction: systemParts.join('\n\n'),
      },
    });

    const reply = response.text?.trim() || 'No response generated.';
    return NextResponse.json({
      reply,
      executionModel,
      routedVia,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat execution failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
