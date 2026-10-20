import { resolveApiKey } from "@/lib/api-key-resolver";
import { PROVIDER_REGISTRY } from "@/lib/ai/provider-registry";
import { PROVIDER_FACTORIES } from "@/lib/ai/provider-registry.server";
import { CODEX_NOT_ALLOWED, isCodexAllowed } from "@/lib/ai/codex.server";

export type ProviderType = "openai" | "ollama" | "deepseek" | "openrouter" | "gemini" | "codex";

export async function getModel(
  provider: ProviderType,
  modelName: string,
  userId?: string,
) {
  const entry = PROVIDER_REGISTRY[provider];
  if (!entry) throw new Error(`Unknown AI provider: ${provider}`);

  const factory = PROVIDER_FACTORIES[provider];
  if (!factory) throw new Error(`No factory for provider: ${provider}`);

  // Signed in outside JobSync; there is no credential to look up.
  if (entry.credentialType === "login") {
    if (!(await isCodexAllowed(userId))) throw new Error(CODEX_NOT_ALLOWED);
    return factory("", modelName);
  }

  const credential = await resolveApiKey(userId, provider);
  if (!credential)
    throw new Error(`${entry.displayName} credential not configured`);

  return factory(credential, modelName);
}
