"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toastSuccess, toastError } from "@/lib/toast";
import { Button } from "../ui/button";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";
import {
  getUserSettings,
  updateDisplaySettings,
} from "@/actions/userSettings.actions";

// The "follow this browser" choice, and the default on purpose: a stored zone
// that silently disagrees with the reader is how fourteen applications made on
// the evening of 31 August ended up on 1 September with 31 August missing from
// the chart entirely. A word rather than "", which Radix rejects as an item
// value, and never a real IANA name.
const BROWSER_ZONE = "browser";

const appearanceFormSchema = z.object({
  theme: z.enum(["light", "dark", "system"], {
    error: "Please select a theme.",
  }),
  timeZone: z.string(),
});

// Intl.supportedValuesOf lands in every browser this app runs in, but the
// fallback keeps the form usable rather than empty where it does not.
const zoneOptions = (): string[] => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
};

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

type AppearanceFormValues = z.infer<typeof appearanceFormSchema>;

function DisplaySettings() {
  const { setTheme, theme, systemTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceFormSchema),
    defaultValues: {
      theme: "system",
      timeZone: BROWSER_ZONE,
    },
  });
  // Read once on the client: on the server this is the server's zone, which is
  // the one answer that must never reach the form.
  const [detectedZone, setDetectedZone] = useState("UTC");
  useEffect(() => setDetectedZone(browserZone()), []);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const result = await getUserSettings();
        const savedZone = result?.data?.settings?.display?.timeZone ?? BROWSER_ZONE;
        if (result.success && result.data?.settings?.display?.theme) {
          const savedTheme = result.data.settings.display.theme;
          form.reset({ theme: savedTheme, timeZone: savedZone });
          setTheme(savedTheme);
        } else if (theme) {
          form.reset({
            theme: theme as "light" | "dark" | "system",
            timeZone: savedZone,
          });
        }
      } catch (error) {
        console.error("Error fetching display settings:", error);
        if (theme) {
          form.reset({ theme: theme as "light" | "dark" | "system" });
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(data: AppearanceFormValues) {
    setIsSaving(true);
    try {
      const result = await updateDisplaySettings({
        theme: data.theme,
        // Stored as undefined rather than "", so the dashboard can tell "follow
        // this browser" from a zone the user actually chose.
        timeZone: data.timeZone === BROWSER_ZONE ? undefined : data.timeZone,
      });
      if (result.success) {
        setTheme(data.theme);
        toastSuccess("Your selected theme has been saved.");
      } else {
        toastError(result.message || "Failed to save display settings.");
      }
    } catch (error) {
      console.error("Error saving display settings:", error);
      toastError("Failed to save display settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium">Appearance</h3>
          <p className="text-sm text-muted-foreground">
            Customize the look and feel of the application.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Appearance</h3>
        <p className="text-sm text-muted-foreground">
          Customize the look and feel of the application.
        </p>
      </div>
      <div className="@container">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="theme"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel>Theme</FormLabel>
                  <FormDescription>
                    Select the theme for the app.
                  </FormDescription>
                  <FormMessage />
                  <RadioGroup
                    onValueChange={field.onChange}
                    value={field.value}
                    className="grid max-w-lg @md:grid-cols-3 gap-8 pt-2"
                  >
                    <FormItem>
                      <FormLabel className="[&:has([data-state=checked])>div]:border-primary">
                        <FormControl>
                          <RadioGroupItem value="light" className="sr-only" />
                        </FormControl>
                        <LightThemeElement />
                        <span className="block w-full p-2 text-center font-normal">
                          Light
                        </span>
                      </FormLabel>
                    </FormItem>
                    <FormItem>
                      <FormLabel className="[&:has([data-state=checked])>div]:border-primary">
                        <FormControl>
                          <RadioGroupItem value="dark" className="sr-only" />
                        </FormControl>
                        <DarkThemeElement />
                        <span className="block w-full p-2 text-center font-normal">
                          Dark
                        </span>
                      </FormLabel>
                    </FormItem>
                    <FormItem>
                      <FormLabel className="[&:has([data-state=checked])>div]:border-primary">
                        <FormControl>
                          <RadioGroupItem value="system" className="sr-only" />
                        </FormControl>
                        {systemTheme === "dark" ? (
                          <DarkThemeElement />
                        ) : (
                          <LightThemeElement />
                        )}
                        <span className="block w-full p-2 text-center font-normal">
                          System
                        </span>
                      </FormLabel>
                    </FormItem>
                  </RadioGroup>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timeZone"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel>Time zone</FormLabel>
                  <FormDescription>
                    Which day an application counts as on the dashboard. The
                    moment is stored as it happened; only the day is recomputed
                    here.
                  </FormDescription>
                  <FormMessage />
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger
                      className="w-[280px]"
                      aria-label="Select time zone"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BROWSER_ZONE}>
                        This browser ({detectedZone})
                      </SelectItem>
                      {zoneOptions().map((zone) => (
                        <SelectItem key={zone} value={zone}>
                          {zone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}

export default DisplaySettings;

function LightThemeElement() {
  return (
    <div className="cursor-pointer items-center rounded-md border-2 border-muted p-1 hover:border-accent">
      <div className="space-y-2 rounded-sm bg-[#ecedef] p-2">
        <div className="space-y-2 rounded-md bg-white p-2 shadow-xs">
          <div className="h-2 w-4/5 rounded-lg bg-[#ecedef]" />
          <div className="h-2 w-full rounded-lg bg-[#ecedef]" />
        </div>
        <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-xs">
          <div className="h-4 w-4 rounded-full bg-[#ecedef]" />
          <div className="h-2 w-full rounded-lg bg-[#ecedef]" />
        </div>
        <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-xs">
          <div className="h-4 w-4 rounded-full bg-[#ecedef]" />
          <div className="h-2 w-full rounded-lg bg-[#ecedef]" />
        </div>
      </div>
    </div>
  );
}
function DarkThemeElement() {
  return (
    <div className="cursor-pointer items-center rounded-md border-2 border-muted bg-popover p-1 hover:bg-accent hover:text-accent-foreground">
      <div className="space-y-2 rounded-sm bg-slate-950 p-2">
        <div className="space-y-2 rounded-md bg-slate-800 p-2 shadow-xs">
          <div className="h-2 w-4/5 rounded-lg bg-slate-400" />
          <div className="h-2 w-full rounded-lg bg-slate-400" />
        </div>
        <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-xs">
          <div className="h-4 w-4 rounded-full bg-slate-400" />
          <div className="h-2 w-full rounded-lg bg-slate-400" />
        </div>
        <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-xs">
          <div className="h-4 w-4 rounded-full bg-slate-400" />
          <div className="h-2 w-full rounded-lg bg-slate-400" />
        </div>
      </div>
    </div>
  );
}
