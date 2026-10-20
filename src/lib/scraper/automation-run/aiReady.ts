import "server-only";

import { PROVIDER_VERIFIERS } from "@/lib/ai/provider-registry.server";
import { getOllamaBaseUrl } from "@/actions/apiKey.actions";
import { AiProvider } from "@/models/ai.model";
import { CODEX_NOT_ALLOWED, isCodexAllowed } from "@/lib/ai/codex.server";
import { GEMINI_NOT_ALLOWED, isGeminiAllowed } from "@/lib/ai/gemini.server";

/**
 * Whether the chosen provider can answer right now, for the providers where
 * that is knowable before a run: a local Ollama, and a Codex or Gemini CLI
 * that must be installed and signed in. Null means "no check exists" — a cloud key is only
 * proven by calling it.
 */
export async function checkAiReady(
  provider: AiProvider,
  userId: string,
): Promise<{ success: boolean; error?: string } | null> {
  if (provider === AiProvider.OLLAMA) {
    return PROVIDER_VERIFIERS.ollama(await getOllamaBaseUrl(userId));
  }
  if (provider === AiProvider.CODEX) {
    if (!(await isCodexAllowed(userId))) return { success: false, error: CODEX_NOT_ALLOWED };
    return PROVIDER_VERIFIERS.codex("");
  }
  if (provider === AiProvider.GEMINI_CLI) {
    if (!(await isGeminiAllowed(userId))) return { success: false, error: GEMINI_NOT_ALLOWED };
    return PROVIDER_VERIFIERS["gemini-cli"]("");
  }
  return null;
}
