import { AiProvider } from "./ai.model";

export interface AiSettings {
  provider: AiProvider;
  model: string | undefined;
}

export interface DisplaySettings {
  theme: "light" | "dark" | "system";
  // IANA zone the dashboard counts days in. Undefined means "whatever browser
  // is reading", which is the only default that cannot be silently wrong: the
  // server's own zone bucketed fourteen applications made on the evening of
  // 31 August into 1 September and dropped 31 August from the chart.
  timeZone?: string;
}

export interface UserSettingsData {
  ai: AiSettings;
  display: DisplaySettings;
}

export interface UserSettings {
  userId: string;
  settings: UserSettingsData;
}

export const defaultUserSettings: UserSettingsData = {
  ai: {
    provider: AiProvider.OLLAMA,
    model: undefined,
  },
  display: {
    theme: "system",
    timeZone: undefined,
  },
};
