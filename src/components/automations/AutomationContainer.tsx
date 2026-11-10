"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { ResponsiveCardHeader } from "@/components/ResponsiveCardHeader";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import { toastError } from "@/lib/toast";
import { getAutomationsList } from "@/actions/automation.actions";
import type { AutomationWithResume } from "@/models/automation.model";
import { AutomationList } from "./AutomationList";
import { AutomationWizard } from "./AutomationWizard";
import { AllDiscoveredJobs } from "./AllDiscoveredJobs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabQueryParam } from "@/hooks/useTabQueryParam";
import Loading from "@/components/Loading";

interface Resume {
  id: string;
  title: string;
  sectionCount: number;
}

interface AutomationContainerProps {
  resumes: Resume[];
}

export function AutomationContainer({ resumes }: AutomationContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [automations, setAutomations] = useState<AutomationWithResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editAutomation, setEditAutomation] =
    useState<AutomationWithResume | null>(null);
  const autoOpenHandled = useRef(false);
  const [activeTab, setActiveTab] = useTabQueryParam(
    ["automations", "jobs"],
    "automations",
  );

  const loadAutomations = useCallback(async () => {
    setLoading(true);
    const result = await getAutomationsList();

    if (result.success && result.data) {
      setAutomations(result.data);
    } else {
      toastError(result.message || "Failed to load automations");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    if (autoOpenHandled.current) return;
    if (searchParams.get("add-automation") === "true") {
      autoOpenHandled.current = true;
      setWizardOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("add-automation");
      const newPath = params.toString()
        ? `?${params.toString()}`
        : window.location.pathname;
      router.replace(newPath);
    }
  }, [router, searchParams]);

  const handleEdit = (automation: AutomationWithResume) => {
    setEditAutomation(automation);
    setWizardOpen(true);
  };

  const handleWizardClose = (open: boolean) => {
    setWizardOpen(open);
    if (!open) {
      setEditAutomation(null);
    }
  };

  const handleSuccess = () => {
    loadAutomations();
  };

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="jobs">Discovered Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="automations" className="mt-4">
          <Card>
            <ResponsiveCardHeader>
              <CardTitle>Automations</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="icon" onClick={loadAutomations}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => setWizardOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Automation
                </Button>
              </div>
            </ResponsiveCardHeader>
            <CardContent>
              {loading ? (
                <Loading />
              ) : (
                <AutomationList
                  automations={automations}
                  onEdit={handleEdit}
                  onRefresh={loadAutomations}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* Mounted only while open: the combined list is a query over every
            automation's pile, not worth running behind the other tab. */}
        <TabsContent value="jobs" className="mt-4">
          <AllDiscoveredJobs automations={automations} />
        </TabsContent>
      </Tabs>

      <AutomationWizard
        open={wizardOpen}
        onOpenChange={handleWizardClose}
        resumes={resumes}
        automations={automations}
        onSuccess={handleSuccess}
        editAutomation={editAutomation}
      />
    </>
  );
}
