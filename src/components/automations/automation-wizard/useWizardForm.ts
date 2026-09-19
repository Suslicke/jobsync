"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreateAutomationSchema,
  type CreateAutomationInput,
} from "@/models/automation.schema";
import {
  createAutomation,
  updateAutomation,
} from "@/actions/automation.actions";
import { toastSuccess, toastError } from "@/lib/toast";
import { APP_CONSTANTS } from "@/lib/constants";
import { boardById } from "@/lib/scraper/boards";
import type {
  AnySourceConfig,
  AutomationWithResume,
  JobBoard,
} from "@/models/automation.model";
import {
  emptyConfigFor,
  STEPS,
  parseEditSourceConfig,
} from "./wizardConfig";

interface UseWizardFormArgs {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automations: AutomationWithResume[];
  onSuccess: () => void;
  editAutomation?: AutomationWithResume | null;
}

export function useWizardForm({
  open,
  onOpenChange,
  automations,
  onSuccess,
  editAutomation,
}: UseWizardFormArgs) {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CreateAutomationInput>({
    resolver: zodResolver(CreateAutomationSchema),
    mode: "onChange",
    defaultValues: {
      name: editAutomation?.name ?? "",
      jobBoard: (editAutomation?.jobBoard as JobBoard) ?? "greenhouse",
      keywords: editAutomation?.keywords ?? "",
      location: editAutomation?.location ?? "",
      sourceConfig: parseEditSourceConfig(editAutomation?.sourceConfig),
      resumeId: editAutomation?.resumeId ?? "",
      matchThreshold: editAutomation?.matchThreshold ?? 80,
      scheduleHour: editAutomation?.scheduleHour ?? 8,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: editAutomation?.name ?? "",
        jobBoard: (editAutomation?.jobBoard as JobBoard) ?? "greenhouse",
        keywords: editAutomation?.keywords ?? "",
        location: editAutomation?.location ?? "",
        sourceConfig: parseEditSourceConfig(editAutomation?.sourceConfig),
        resumeId: editAutomation?.resumeId ?? "",
        matchThreshold: editAutomation?.matchThreshold ?? 80,
        scheduleHour: editAutomation?.scheduleHour ?? 8,
      });
      setStep(0);
    }
  }, [open, editAutomation, form]);

  const formValues = form.watch();

  const onSubmit = async (data: CreateAutomationInput) => {
    setIsSubmitting(true);
    try {
      const result = editAutomation
        ? await updateAutomation(editAutomation.id, data)
        : await createAutomation(data);

      if (result.success) {
        toastSuccess(
          editAutomation
            ? "Your automation has been updated successfully."
            : "Your automation has been created and will run at the scheduled time.",
          editAutomation ? "Automation updated" : "Automation created",
        );
        form.reset();
        setStep(0);
        onOpenChange(false);
        onSuccess();
      } else {
        toastError(result.message || "Something went wrong");
      }
    } catch (error) {
      toastError("Failed to save automation");
    } finally {
      setIsSubmitting(false);
    }
  };

  const atsKey: JobBoard = formValues.jobBoard;
  const board = boardById(atsKey);
  const atsConfig: AnySourceConfig =
    (formValues.sourceConfig?.[atsKey] as AnySourceConfig | undefined) ??
    emptyConfigFor(board?.kind ?? "companies");

  // What "configured enough to continue" means depends on the kind. A feed has
  // nothing to configure — the feed itself is the target — so demanding a
  // company there would have made the board unusable.
  const searchStepReady = (): boolean => {
    const cfg = atsConfig as Record<string, unknown>;
    const len = (key: string) =>
      Array.isArray(cfg[key]) ? (cfg[key] as unknown[]).length : 0;
    switch (board?.kind) {
      case "query":
        return len("queries") > 0 && len("geos") > 0;
      case "channel":
        return len("channels") > 0;
      case "feed":
        return true;
      default:
        return len("companies") > 0;
    }
  };

  const canGoNext = () => {
    switch (step) {
      case 0:
        return (formValues.name?.trim().length ?? 0) > 0;
      case 1:
        return searchStepReady();
      case 2:
        return (formValues.resumeId?.length ?? 0) > 0;
      case 3:
      case 4:
        return true;
      default:
        return false;
    }
  };

  // Hours already full. Several automations may share a slot now — they run
  // one after another in the scheduler's sequential loop — so an hour is only
  // refused once AUTOMATIONS_PER_HOUR_MAX of them are already on it.
  const hourCounts = new Map<number, number>();
  automations
    .filter((a) => a.id !== editAutomation?.id)
    .forEach((a) =>
      hourCounts.set(a.scheduleHour, (hourCounts.get(a.scheduleHour) ?? 0) + 1),
    );
  const takenHours = new Set(
    [...hourCounts.entries()]
      .filter(([, count]) => count >= APP_CONSTANTS.AUTOMATIONS_PER_HOUR_MAX)
      .map(([hour]) => hour),
  );

  const nextStep = () => {
    if (step === 4 && takenHours.has(formValues.scheduleHour)) {
      form.setError("scheduleHour", {
        message: `${APP_CONSTANTS.AUTOMATIONS_PER_HOUR_MAX} automations already run at ${(
          formValues.scheduleHour ?? 8
        )
          .toString()
          .padStart(2, "0")}:00. Please choose a different time.`,
      });
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleClose = () => {
    form.reset();
    setStep(0);
    onOpenChange(false);
  };

  return {
    form,
    formValues,
    step,
    isSubmitting,
    atsKey,
    atsConfig,
    takenHours,
    canGoNext,
    nextStep,
    prevStep,
    handleClose,
    onSubmit,
  };
}
