"use client";

import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { BOARDS, boardById, type BoardKind } from "@/lib/scraper/boards";
import type { CreateAutomationInput } from "@/models/automation.schema";

// Grouped by kind so the list reads as four ways of finding jobs rather than
// sixteen names. Generated from the board table: a hand-written <SelectItem>
// list is a board the scheduler can run and nobody can create.
const KIND_GROUPS: { kind: BoardKind; label: string }[] = [
  { kind: "companies", label: "Company boards" },
  { kind: "query", label: "Keyword search" },
  { kind: "feed", label: "Job feeds" },
  { kind: "channel", label: "Channels" },
];

export function StepBasics({
  form,
}: {
  form: UseFormReturn<CreateAutomationInput>;
}) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Automation Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g., Full Stack Jobs Calgary" {...field} />
            </FormControl>
            <FormDescription>
              A descriptive name to identify this automation
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="jobBoard"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Job Board</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select a job board" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {KIND_GROUPS.map(({ kind, label }) => (
                  <SelectGroup key={kind}>
                    <SelectLabel>{label}</SelectLabel>
                    {BOARDS.filter((b) => b.kind === kind).map((board) => (
                      <SelectItem key={board.id} value={board.id}>
                        {board.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {boardById(field.value)?.wizard.description ??
                "Where this automation looks for jobs"}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
