"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AiSettings from "@/components/settings/AiSettings";
import AiUsageSettings from "@/components/settings/AiUsageSettings";
import ApiKeySettings from "@/components/settings/ApiKeySettings";
import DataSettings from "@/components/settings/DataSettings";
import DisplaySettings from "@/components/settings/DisplaySettings";
import FitProfileSettings from "@/components/settings/FitProfileSettings";
import McpAccessSettings from "@/components/settings/McpAccessSettings";
import PocketIdSettings from "@/components/settings/PocketIdSettings";
import SettingsSidebar, { type SettingsSection } from "@/components/settings/SettingsSidebar";

function SettingsContent() {
  // Back from the Pocket ID connect flow -> open the Sign-in section.
  const searchParams = useSearchParams();
  const fromPocketId =
    searchParams.has("pocketId") || searchParams.has("pocketIdError");
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    fromPocketId ? "sign-in" : "ai-provider",
  );

  return (
    <div className="flex flex-col col-span-3">
      <h3 className="text-2xl font-semibold leading-none tracking-tight mb-4">
        Settings
      </h3>
      <div className="flex gap-3 sm:gap-6">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="flex-1 min-w-0">
          {activeSection === "ai-provider" && <AiSettings />}
          {activeSection === "ai-usage" && <AiUsageSettings />}
          {activeSection === "api-keys" && <ApiKeySettings />}
          {activeSection === "appearance" && <DisplaySettings />}
          {activeSection === "fit-profile" && <FitProfileSettings />}
          {activeSection === "mcp-access" && <McpAccessSettings />}
          {activeSection === "sign-in" && <PocketIdSettings />}
          {activeSection === "data" && <DataSettings />}
        </div>
      </div>
    </div>
  );
}

function Settings() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}

export default Settings;
