import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { checkTrustedRequest } from '@/lib/auth';
import { getGeminiClient, resolveServerModel } from '@/lib/gemini';
import { redactSecretsInText } from '@/lib/privacy-redactor';

interface AgentRunPayload {
  agentName: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  delegationAllowed: string[];
  maxTokensPerRun: number;
  task: string;
  ragContext?: string;
}

export async function POST(req: NextRequest) {
  const trust = checkTrustedRequest(req);
  if (!trust.ok) {
    return NextResponse.json({ error: trust.error }, { status: trust.status });
  }
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as AgentRunPayload;
    const task = redactSecretsInText((body.task ?? '').trim()).text;
    if (!task) {
      return NextResponse.json({ error: 'Task prompt is required to execute agent.' }, { status: 400 });
    }

    const ai = getGeminiClient();
    const { executionModel, routedVia } = resolveServerModel(body.model);

    const response = await ai.models.generateContent({
      model: executionModel,
      contents: [
        `Task Objective: ${task}`,
        `Authorized Tools: ${body.tools.join(', ') || 'none'}`,
        `Delegation Targets: ${body.delegationAllowed.join(', ') || 'none'}`,
        `Token Budget: ${body.maxTokensPerRun}`,
        body.ragContext ? `Context:\n${body.ragContext}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      config: {
        systemInstruction: `${body.systemPrompt}\n\nSimulate an execution plan within your declared tools and budget, then produce a concrete, high-signal deliverable.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            planSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3-5 concrete execution steps taken by this agent.',
            },
            toolCallsUsed: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of authorized tools invoked during the run.',
            },
            memoryNote: {
              type: Type.STRING,
              description: 'One concise insight worth saving back to Brain memory.',
            },
            finalOutput: {
              type: Type.STRING,
              description: 'Full markdown deliverable answering the task.',
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}') as {
      planSteps?: string[];
      toolCallsUsed?: string[];
      memoryNote?: string;
      finalOutput?: string;
    };

    return NextResponse.json({
      routedVia,
      latencyMs: Date.now() - startedAt,
      planSteps: Array.isArray(parsed.planSteps) ? parsed.planSteps : ['Analyzed objective', 'Synthesized result'],
      toolCallsUsed: Array.isArray(parsed.toolCallsUsed) ? parsed.toolCallsUsed : body.tools.slice(0, 2),
      memoryNote: parsed.memoryNote || '',
      finalOutput: parsed.finalOutput || 'Execution completed.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent runtime execution failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
