import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveredJobsList } from "@/components/automations/DiscoveredJobsList";
import type { DiscoveredJob } from "@/models/automation.model";
import {
  dismissOldDiscoveredJobs,
  setDiscoveredJobsStatus,
} from "@/actions/automation.actions";

vi.mock("@/actions/automation.actions", () => ({
  acceptDiscoveredJob: vi.fn(),
  dismissDiscoveredJob: vi.fn(),
  analyzeDiscoveredJob: vi.fn(),
  clearDiscoveredJobs: vi.fn(),
  dismissOldDiscoveredJobs: vi.fn(),
  setDiscoveredJobsStatus: vi.fn(),
}));

let intersectionCallback: IntersectionObserverCallback;
global.IntersectionObserver = class IntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

function makeJob(overrides: Partial<DiscoveredJob> = {}): DiscoveredJob {
  return {
    id: "job-1",
    userId: "user-1",
    automationId: "automation-1",
    jobUrl: null,
    description: "desc",
    jobType: "full-time",
    createdAt: new Date("2024-06-01"),
    jobTitleId: "title-1",
    companyId: "company-1",
    locationId: "location-1",
    matchScore: 80,
    matchData: null,
    discoveryStatus: "new",
    discoveredAt: new Date("2024-06-01"),
    JobTitle: { label: "Software Engineer" },
    Company: { label: "Acme Corp" },
    Location: { label: "Remote" },
    ...overrides,
  };
}

function renderList(
  overrides: Partial<React.ComponentProps<typeof DiscoveredJobsList>> = {},
) {
  const onLoadMore = vi.fn();
  const onRefresh = vi.fn();
  const onQueryChange = vi.fn();
  const props: React.ComponentProps<typeof DiscoveredJobsList> = {
    jobs: [makeJob()],
    totalJobs: 1,
    loadingMore: false,
    onLoadMore,
    dismissedCount: 0,
    newCount: 1,
    acceptedCount: 0,
    query: {
      statusFilter: ["new", "accepted"],
      sortBy: "matchScore",
      maxAgeDays: 0,
      only: [],
    },
    onQueryChange,
    automationId: "automation-1",
    onRefresh,
    ...overrides,
  };
  const result = render(<DiscoveredJobsList {...props} />);
  return {
    ...result,
    onLoadMore,
    onRefresh,
    onQueryChange,
  };
}

describe("DiscoveredJobsList", () => {
  it("renders jobs and the records-count summary", () => {
    const { container } = renderList({
      jobs: [makeJob(), makeJob({ id: "job-2", JobTitle: { label: "Backend Engineer" } })],
      totalJobs: 5,
    });

    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(
      container.textContent?.replace(/\s+/g, " "),
    ).toContain("Showing 1 to 2 of 5 jobs");
  });

  it("does not render the load-more sentinel once every job is loaded", () => {
    renderList({ jobs: [makeJob()], totalJobs: 1 });

    expect(
      screen.queryByTestId("jobs-load-more-sentinel"),
    ).not.toBeInTheDocument();
  });

  it("calls onLoadMore when the sentinel scrolls into view and more jobs remain", async () => {
    const { onLoadMore } = renderList({
      jobs: [makeJob()],
      totalJobs: 5,
      loadingMore: false,
    });

    expect(screen.getByTestId("jobs-load-more-sentinel")).toBeInTheDocument();

    await act(async () => {
      intersectionCallback(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onLoadMore while a page is already loading", async () => {
    const { onLoadMore } = renderList({
      jobs: [makeJob()],
      totalJobs: 5,
      loadingMore: true,
    });

    expect(screen.getByTestId("jobs-load-more-spinner")).toBeInTheDocument();

    await act(async () => {
      intersectionCallback(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not call onLoadMore when the sentinel is not intersecting", async () => {
    const { onLoadMore } = renderList({
      jobs: [makeJob()],
      totalJobs: 5,
      loadingMore: false,
    });

    await act(async () => {
      intersectionCallback(
        [{ isIntersecting: false }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("shows the true empty state (no header/filter) when there are no jobs at all", () => {
    renderList({
      jobs: [],
      totalJobs: 0,
      dismissedCount: 0,
      newCount: 0,
      acceptedCount: 0,
    });

    expect(screen.getByText("No discovered jobs")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("keeps the status filter visible when the current filter matches no jobs but some exist", () => {
    renderList({
      jobs: [],
      totalJobs: 0,
      dismissedCount: 3,
      newCount: 0,
      acceptedCount: 0,
    });

    expect(screen.getByText("No jobs match this filter")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("checks New and Accepted but not Dismissed by default", async () => {
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Status" }));

    expect(
      screen.getByRole("menuitemcheckbox", { name: "New" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Accepted" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Dismissed" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("adds Dismissed to the filter when checked", async () => {
    const { onQueryChange } = renderList();

    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Dismissed" }),
    );

    expect(onQueryChange).toHaveBeenCalledWith({
      statusFilter: ["new", "accepted", "dismissed"],
    });
  });

  it("removes New from the filter when unchecked", async () => {
    const { onQueryChange } = renderList();

    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "New" }),
    );

    expect(onQueryChange).toHaveBeenCalledWith({ statusFilter: ["accepted"] });
  });

  it("narrows the list to a date range", async () => {
    const { onQueryChange } = renderList();

    await userEvent.click(screen.getByRole("button", { name: "Any time" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Last 7 days" }));

    expect(onQueryChange).toHaveBeenCalledWith({ maxAgeDays: 7 });
  });

  it("dismisses old jobs only after the confirmation, then refreshes", async () => {
    (dismissOldDiscoveredJobs as any).mockResolvedValue({ success: true, dismissed: 3 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const { onRefresh } = renderList();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss old" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "30 days" }));
    expect(dismissOldDiscoveredJobs).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss old" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "30 days" }));

    expect(dismissOldDiscoveredJobs).toHaveBeenCalledWith({
      automationId: "automation-1",
      olderThanDays: 30,
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("narrows to postings that say they are remote", async () => {
    const { onQueryChange } = renderList();

    await userEvent.click(screen.getByRole("button", { name: "Only" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Remote" }));

    expect(onQueryChange).toHaveBeenCalledWith({ only: ["remote"] });
  });

  it("accepts the ticked rows in one go and offers nothing until one is ticked", async () => {
    (setDiscoveredJobsStatus as any).mockResolvedValue({ success: true, updated: 2 });
    const { onRefresh } = renderList({
      jobs: [
        makeJob({ id: "a", JobTitle: { label: "Alpha" } }),
        makeJob({ id: "b", JobTitle: { label: "Beta" } }),
        // Already decided: not selectable, and "select all" must skip it.
        makeJob({ id: "c", JobTitle: { label: "Gamma" }, discoveryStatus: "accepted" }),
      ],
      totalJobs: 3,
    });
    expect(screen.queryByRole("button", { name: /^Accept \d/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Gamma" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select all new jobs shown" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept 2" }));

    expect(setDiscoveredJobsStatus).toHaveBeenCalledWith({
      ids: ["a", "b"],
      status: "accepted",
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Accept \d/ })).not.toBeInTheDocument();
  });

  it("as the combined list, names the automation and narrows to one", async () => {
    const { onQueryChange } = renderList({
      automationId: undefined,
      automations: [{ id: "automation-1", name: "Greenhouse" }],
      jobs: [makeJob({ automation: { id: "automation-1", name: "Greenhouse" } })],
      dismissedCount: 2,
    });

    expect(screen.getByRole("link", { name: "Greenhouse" })).toHaveAttribute(
      "href",
      "/dashboard/automations/automation-1?tab=jobs",
    );
    // Clear deletes one automation's rows; there is no one automation here.
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All automations" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Greenhouse" }));
    expect(onQueryChange).toHaveBeenCalledWith({ automationId: "automation-1" });
  });
});
