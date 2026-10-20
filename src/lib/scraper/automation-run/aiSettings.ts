import pLimit from "p-limit";
import db from "@/lib/db";
import { APP_CONSTANTS } from "@/lib/constants";
import {
  AiProvider,
  OllamaModel,
  OpenaiModel,
  DeepseekModel,
  GeminiModel,
  CodexModel,
  GeminiCliModel,
} from "@/models/ai.model";
import {
  defaultUserSettings,
  type AiSettings,
} from "@/models/userSettings.model";

// Ollama serializes on the GPU, Codex and Gemini CLI on a plan's usage window
// or daily quota, so they process matches one at a time; others fan out.
export function getAutomationMatchLimit(provider: AiProvider) {
  const concurrency =
    provider === AiProvider.OLLAMA || provider === AiProvider.CODEX || provider === AiProvider.GEMINI_CLI
      ? 1
      : APP_CONSTANTS.AUTOMATION_MATCH_CONCURRENCY;
  return pLimit(concurrency);
}

export function getDefaultModelForProvider(provider: AiProvider): string {
  switch (provider) {
    case AiProvider.OLLAMA:
      return OllamaModel.QWEN3_5_9B;
    case AiProvider.OPENAI:
      return OpenaiModel.GPT4O_MINI;
    case AiProvider.DEEPSEEK:
      return DeepseekModel.DEEPSEEK_CHAT;
    case AiProvider.GEMINI:
      return GeminiModel.GEMINI_2_0_FLASH;
    case AiProvider.OPENROUTER:
      return "anthropic/claude-3.5-sonnet";
    case AiProvider.CODEX:
      return process.env.CODEX_MODEL || CodexModel.GPT_6_1_SOL;
    case AiProvider.GEMINI_CLI:
      // flash: automation matching is volume work, and the quota is per request.
      return process.env.GEMINI_MODEL || GeminiCliModel.FLASH;
  }
}

export async function getUserAiSettings(userId: string): Promise<AiSettings> {
  const userSettings = await db.userSettings.findUnique({
    where: { userId },
  });

  if (!userSettings) {
    return defaultUserSettings.ai;
  }

  const settings = JSON.parse(userSettings.settings);
  return {
    ...defaultUserSettings.ai,
    ...settings.ai,
  };
}
