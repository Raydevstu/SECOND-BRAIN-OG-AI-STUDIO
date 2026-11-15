import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { getGeminiClient } from '@/lib/gemini';
import { redactSecretsInText } from '@/lib/privacy-redactor';

interface LibrarianPayload {
  title?: string;
  rawText: string;
  sourceType?: string;
  projectName?: string | null;
  redactSecrets?: boolean;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as LibrarianPayload;
    const raw = (body.rawText ?? '').trim();
    if (!raw) {
      return NextResponse.json({ error: 'Input text is required for the Librarian pipeline.' }, { status: 400 });
    }

    const shouldRedact = body.redactSecrets !== false;
    const privacy = shouldRedact
      ? redactSecretsInText(raw)
      : { text: raw, redactionCount: 0, matchedRules: [] };

    if (!privacy.text.trim()) {
      return NextResponse.json({ error: 'Content was empty after privacy redaction.' }, { status: 400 });
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [
        `Document Title Hint: ${body.title || 'Untitled Capture'}`,
        `Source Type: ${body.sourceType || 'Inbox Drop'}`,
        body.projectName ? `Project Space: ${body.projectName}` : 'Scope: Global Knowledge',
        '',
        'Content:',
        privacy.text.slice(0, 24000),
      ].join('\n'),
      config: {
        systemInstruction:
          'You are the CORTEX Librarian Agent. Classify incoming notes or documents into a Second Brain folder, compile a concise LLM Wiki summary, suggest 3-5 lowercase tags, and extract key entities and graph relations.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Clean concise title for the captured note.' },
            folder: {
              type: Type.STRING,
              description: 'One of: Memories, People, Ideas, Tasks, Goals, Notes, Bookmarks, Journal',
            },
            summary: { type: Type.STRING, description: '2-3 sentence executive summary.' },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 to 5 concise lowercase tags.',
            },
            wikiCategory: {
              type: Type.STRING,
              description:
                'One of: Models, Providers, Frameworks, Agents, Prompting, RAG, Vector DBs, MCP Servers, Tutorials',
            },
            wikiTopicTitle: { type: Type.STRING, description: 'Title for the compiled LLM Wiki topic entry.' },
            wikiMarkdown: { type: Type.STRING, description: 'Structured markdown summary for the LLM Wiki.' },
            entities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  nodeType: {
                    type: Type.STRING,
                    description: 'One of: Person, Project, Document, Prompt, Agent, Workflow, Model, Concept',
                  },
                  relation: {
                    type: Type.STRING,
                    description: 'One of: USES, OWNS, RELATES_TO, BUILT_WITH, REFERENCES, DEPENDS_ON',
                  },
                  summary: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}') as {
      title?: string;
      folder?: string;
      summary?: string;
      tags?: string[];
      wikiCategory?: string;
      wikiTopicTitle?: string;
      wikiMarkdown?: string;
      entities?: Array<{ label: string; nodeType: string; relation: string; summary: string }>;
    };

    const approxChunks = Math.max(1, Math.ceil(privacy.text.length / 800));

    return NextResponse.json({
      redactedContent: privacy.text,
      redactionCount: privacy.redactionCount,
      matchedRules: privacy.matchedRules,
      chunksCount: approxChunks,
      latencyMs: Date.now() - startedAt,
      result: {
        title: parsed.title || body.title || 'Captured Knowledge Note',
        folder: parsed.folder || 'Notes',
        summary: parsed.summary || privacy.text.slice(0, 180),
        tags: Array.isArray(parsed.tags) && parsed.tags.length > 0 ? parsed.tags.slice(0, 5) : ['captured'],
        wikiCategory: parsed.wikiCategory || 'Frameworks',
        wikiTopicTitle: parsed.wikiTopicTitle || parsed.title || 'Compiled Note',
        wikiMarkdown: parsed.wikiMarkdown || `## Overview\n\n${parsed.summary || privacy.text.slice(0, 400)}`,
        entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 5) : [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Librarian ingestion failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
