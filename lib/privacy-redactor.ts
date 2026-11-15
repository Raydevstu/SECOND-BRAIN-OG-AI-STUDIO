// Deterministic privacy guard for Brain & Librarian ingestion.
// Redacts common API tokens, private keys, and connection strings before
// content is persisted or sent to any LLM.

const REDACTION_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  {
    name: 'OpenAI / Project Secret Key',
    regex: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'GitHub Token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  {
    name: 'Bearer Authorization Header',
    regex: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: '$1[REDACTED_BEARER_TOKEN]',
  },
  {
    name: 'Private Key Block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY_BLOCK]',
  },
  {
    name: 'Env Secret Assignment',
    regex: /^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*)(["']?)(?!\[REDACTED)[^\r\n"']{8,}\2/gm,
    replacement: '$1"[REDACTED_ENV_SECRET]"',
  },
];

export interface RedactionResult {
  text: string;
  redactionCount: number;
  matchedRules: string[];
}

export function redactSecretsInText(input: string): RedactionResult {
  let text = input;
  let redactionCount = 0;
  const matchedRules: string[] = [];

  for (const rule of REDACTION_PATTERNS) {
    const matches = text.match(rule.regex);
    if (matches && matches.length > 0) {
      redactionCount += matches.length;
      matchedRules.push(rule.name);
      text = text.replace(rule.regex, rule.replacement);
    }
  }

  return { text, redactionCount, matchedRules };
}
