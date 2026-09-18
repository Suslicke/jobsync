import {
  getActivityCalendarData,
  getActivityDataForPeriod,
  getCampaignAnalytics,
  getJobsActivityForPeriod,
  getJobsActivitySummary,
  getRecentActivities,
  getRecentJobs,
} from "@/actions/dashboard.actions";
import { getUserSettings } from "@/actions/userSettings.actions";
import ActivityCalendar from "@/components/dashboard/ActivityCalendar";
import ApplicationsByDayCard from "@/components/dashboard/ApplicationsByDayCard";
import CampaignCard from "@/components/dashboard/CampaignCard";
import JobsActivityCard from "@/components/dashboard/JobsActivityCard";
import JobsApplied from "@/components/dashboard/JobsAppliedCard";
import RecentCardToggle from "@/components/dashboard/RecentCardToggle";
import TasteCard from "@/components/dashboard/TasteCard";
import WeeklyBarChartToggle from "@/components/dashboard/WeeklyBarChartToggle";

import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function Dashboard() {
  const [
    summary7Days,
    summary30Days,
    recentJobs,
    recentActivities,
    weeklyData,
    activitiesData,
    activityCalendarData,
    campaign,
    userSettings,
  ] = await Promise.all([
    getJobsActivitySummary(7),
    getJobsActivitySummary(30),
    getRecentJobs(),
    getRecentActivities(),
    getJobsActivityForPeriod(),
    getActivityDataForPeriod(),
    getActivityCalendarData(),
    getCampaignAnalytics(),
    getUserSettings(),
  ]);
  // Undefined means "follow whichever browser is reading", which is what the
  // card falls back to. The server's own zone is never an answer here.
  const timeZone: string | undefined =
    userSettings?.data?.settings?.display?.timeZone;
  const activityCalendarDataKeys = Object.keys(activityCalendarData);
  return (
    <>
      <div className="@container grid grid-cols-1 auto-rows-max items-start gap-2 md:gap-2 @3xl/main:col-span-2">
        <div className="grid gap-2 @lg:grid-cols-4">
          <JobsApplied />
          <JobsActivityCard
            data={[
              { label: "7d", summary: summary7Days },
              { label: "30d", summary: summary30Days },
            ]}
          />
        </div>
        <WeeklyBarChartToggle
          charts={[
            {
              label: "Jobs",
              data: weeklyData,
              keys: ["value"],
              axisLeftLegend: "JOBS APPLIED",
            },
            {
              label: "Activities",
              data: activitiesData.data,
              keys: activitiesData.keys,
              groupMode: "stacked",
              axisLeftLegend: "TIME SPENT (Hours)",
            },
          ]}
        />
      </div>
      <div className="@3xl/main:relative @3xl/main:self-stretch">
        <RecentCardToggle jobs={recentJobs} activities={recentActivities} />
      </div>
      <div className="w-full col-span-3">
        <TasteCard />
      </div>
      <div className="w-full col-span-3">
        <ActivityCalendar
          years={activityCalendarDataKeys}
          dataByYear={activityCalendarData}
        />
      </div>
      <div className="w-full col-span-3">
        <ApplicationsByDayCard
          applications={campaign.applications}
          timeZone={timeZone}
        />
      </div>
      <div className="w-full col-span-3">
        <CampaignCard data={campaign} />
      </div>
    </>
  );
}
