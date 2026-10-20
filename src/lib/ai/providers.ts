import { resolveApiKey } from "@/lib/api-key-resolver";
import { PROVIDER_REGISTRY } from "@/lib/ai/provider-registry";
import { PROVIDER_FACTORIES } from "@/lib/ai/provider-registry.server";
import { CODEX_NOT_ALLOWED, isCodexAllowed } from "@/lib/ai/codex.server";
import { GEMINI_NOT_ALLOWED, isGeminiAllowed } from "@/lib/ai/gemini.server";

// Who may spend each subscription CLI's sign-in: one person's plan or quota.
const LOGIN_GATES: Record<string, [(userId?: string) => Promise<boolean>, string]> = {
  codex: [isCodexAllowed, CODEX_NOT_ALLOWED],
  "gemini-cli": [isGeminiAllowed, GEMINI_NOT_ALLOWED],
};

export type ProviderType = "openai" | "ollama" | "deepseek" | "openrouter" | "gemini" | "codex" | "gemini-cli";

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
    const [allowed, refusal] = LOGIN_GATES[provider] ?? [async () => false, `${entry.displayName} is not enabled`];
    if (!(await allowed(userId))) throw new Error(refusal);
    return factory("", modelName);
  }

  const credential = await resolveApiKey(userId, provider);
  if (!credential)
    throw new Error(`${entry.displayName} credential not configured`);

  return factory(credential, modelName);
}
