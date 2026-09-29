import { logger } from '../utils/logger';

// ─── LLM client ─────────────────────────────────────────────────────────────
// A thin wrapper around a single OpenAI-compatible /v1/chat/completions-style
// endpoint, shared by three features: ad moderation (routes/listings.ts),
// cataloging/SEO tag suggestions (routes/listings.ts), and the support chat
// (routes/support.ts). One client, one place to point at a different
// provider or adjust the request/response shape.
//
// Provider resolution — three ways to configure this, checked in order:
//
//   1. LLM_API_URL + LLM_API_KEY (+ optional LLM_MODEL) — an explicit,
//      fully custom endpoint (self-hosted vLLM/Ollama/text-generation-
//      inference, or any other OpenAI-compatible host). Takes priority over
//      everything below when set, so this always wins if you want to point
//      at something specific.
//
//   2. LLM_PROVIDER=openai (or unset, with OPENAI_API_KEY present and
//      HF_API_TOKEN absent) — uses OPENAI_API_KEY against
//      https://api.openai.com/v1/chat/completions, model defaults to
//      "gpt-4o-mini" (override with LLM_MODEL).
//
//   3. LLM_PROVIDER=huggingface (or unset, with HF_API_TOKEN present) —
//      uses HF_API_TOKEN against Hugging Face's OpenAI-compatible router
//      (https://router.huggingface.co/v1/chat/completions), model defaults
//      to "meta-llama/Llama-3.2-3B-Instruct" (override with LLM_MODEL — HF's
//      router expects "org/model" or "org/model:provider" for some models,
//      so double-check the exact string in the HF model page's "API"
//      widget if the default 404s for your account).
//
// Default precedence when both OPENAI_API_KEY and HF_API_TOKEN are set and
// LLM_PROVIDER is unset: Hugging Face wins, since the moderation and
// cataloging prompts this powers (see the spec this was built from)
// explicitly call for "an open-source LLM (e.g., Llama 3.2)" rather than a
// hosted proprietary model. Set LLM_PROVIDER=openai to flip that — this
// resolution is centralized in resolveConfig() below, so that's the only
// place a precedence change needs to happen.
//
// Every function in this file is a safe no-op (returns null) when none of
// the above is configured, so the app runs fine — moderation, tagging, and
// support chat simply skip themselves — in any environment with no LLM
// wired up yet.

const LLM_TIMEOUT_MS = 15_000;

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface LLMConfig {
  url: string;
  apiKey: string | undefined;
  model: string | undefined;
}

function resolveConfig(): LLMConfig | null {
  if (process.env.LLM_API_URL) {
    return { url: process.env.LLM_API_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  }

  const provider = process.env.LLM_PROVIDER
    || (process.env.HF_API_TOKEN ? 'huggingface' : process.env.OPENAI_API_KEY ? 'openai' : null);

  if (provider === 'huggingface' && process.env.HF_API_TOKEN) {
    return {
      url: 'https://router.huggingface.co/v1/chat/completions',
      apiKey: process.env.HF_API_TOKEN,
      model: process.env.LLM_MODEL || 'meta-llama/Llama-3.2-3B-Instruct',
    };
  }

  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    };
  }

  return null;
}

function isConfigured(): boolean {
  return resolveConfig() !== null;
}

/**
 * Calls the configured LLM with a system + user message pair and returns the
 * raw text of the model's reply, or null if the LLM isn't configured, times
 * out, or errors. Callers decide what "no answer" means for their feature
 * (skip moderation, skip tag suggestions, fall back to the human-transfer
 * message) — this function never throws.
 */
async function callLLM(messages: ChatMessage[]): Promise<string | null> {
  const config = resolveConfig();
  if (!config) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        ...(config.model && { model: config.model }),
        messages,
        temperature: 0.2, // low temperature — these are classification/extraction tasks, not creative writing
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(`LLM call failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    logger.error('LLM call errored', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Strips the markdown code-fence wrapping (```json ... ``` or ``` ... ```)
 * that some models add even when told not to, then JSON.parses the result.
 * Returns null (never throws) on anything that doesn't parse — callers
 * treat a null result the same as "LLM unavailable".
 */
function parseJsonResponse<T>(raw: string): T | null {
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    logger.error('Failed to parse LLM JSON response', { raw, err });
    return null;
  }
}

/**
 * Calls the LLM with a system + user prompt and parses the reply as JSON.
 * Returns null if the LLM isn't configured, the call fails, or the reply
 * isn't valid JSON — every caller must handle a null result by skipping the
 * feature rather than blocking on it (see each call site's own comment for
 * its specific fail-open behavior).
 */
export async function callLLMJson<T>(systemPrompt: string, userPrompt: string): Promise<T | null> {
  const raw = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  if (raw == null) return null;
  return parseJsonResponse<T>(raw);
}

/**
 * Calls the LLM with a system + user prompt and returns the plain text
 * reply (no JSON parsing) — used by the support chat, whose reply is a
 * sentence or two of prose, not structured data.
 */
export async function callLLMText(systemPrompt: string, userPrompt: string): Promise<string | null> {
  return callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
}

export function isLLMConfigured(): boolean {
  return isConfigured();
}
