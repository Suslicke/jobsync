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
}) {
  const { tagIds = [], title, ...rest } = fields;
  // Every create passes through here, so the offline analysis is written once
  // and the list never has to ask "why is this row grey" at render time.
  const label =
    title ??
    (await prisma.jobTitle.findUnique({ where: { id: rest.jobTitleId }, select: { label: true } }))
      ?.label ??
    "";
  const fitData = await buildFitData(rest.userId, {
    title: label,
    description: rest.description,
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
