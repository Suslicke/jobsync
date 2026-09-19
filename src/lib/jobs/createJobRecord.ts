import prisma from "@/lib/db";
import { buildFitData, buildInitialReach } from "@/lib/fit/store";

export async function createJobRecord(fields: {
  jobTitleId: string;
  companyId: string;
  locationId?: string | null;
  statusId: string;
  jobSourceId?: string | null;
  salaryRange?: string | null;
  dueDate?: Date | null;
  appliedDate?: Date | null;
  appliedDatePrecision?: string | null;
  description: string;
  jobType: string;
  workplaceType?: string | null;
  userId: string;
  jobUrl?: string | null;
  applied?: boolean;
  resumeId?: string | null;
  coverLetterId?: string | null;
  tagIds?: string[];
  createdVia?: string | null;
  descriptionCompleteness?: string | null;
  /** Title text, when the caller already has it — saves a lookup. */
  title?: string | null;
  /** Location label, when the caller already has it — saves a lookup. */
  location?: string | null;
}) {
  const { tagIds = [], title, location, ...rest } = fields;
  // Every create passes through here, so the offline analysis is written once
  // and the list never has to ask "why is this row grey" at render time.
  const label =
    title ??
    (await prisma.jobTitle.findUnique({ where: { id: rest.jobTitleId }, select: { label: true } }))
      ?.label ??
    "";
  // The analysis reads the location as words ("Remote, US" is not remote for
  // someone without a US permit), so an id alone is not enough.
  const locationLabel =
    location ??
    (rest.locationId
      ? (
          await prisma.location.findUnique({
            where: { id: rest.locationId },
            select: { label: true },
          })
        )?.label
      : null) ??
    "";
  const fitData = await buildFitData(rest.userId, {
    title: label,
    description: rest.description,
    location: locationLabel,
  });
  const reach = await buildInitialReach(rest.userId, { fitData, title: label });
  return prisma.job.create({
    data: {
      ...rest,
      fitData,
      ...reach,
      createdAt: new Date(),
      ...(tagIds.length > 0 ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
    },
  });
}
