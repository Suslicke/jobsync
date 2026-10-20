import prisma from "@/lib/db";
import { buildFitData, buildInitialReach } from "@/lib/fit/store";
import { resolveStageTypeForStatusId } from "@/lib/jobs/resolve";
import { jobFieldsForStage } from "@/actions/jobStage/shared";

type StageClient = {
  jobStage: { create: (args: any) => Promise<any> };
};

// The nested payload that writes the job and its first stage as one statement,
// so a job can never commit without its timeline. The stage type is resolved
// BEFORE the create on purpose: a nested create is an implicit transaction,
// and the resolver writes through the base client (D4).
export async function firstStageCreate(
  statusId: string,
  userId: string,
  occurredAt: Date,
) {
  const stageTypeId = await resolveStageTypeForStatusId(statusId, userId);
  return { create: { stageTypeId, occurredAt, isCurrent: true } };
}

// The separate-statement form, still used by the dev-only mock generator.
export async function createFirstStage(
  client: StageClient,
  jobId: string,
  statusId: string,
  userId: string,
  occurredAt: Date,
): Promise<void> {
  const stageTypeId = await resolveStageTypeForStatusId(statusId, userId);
  await client.jobStage.create({
    data: { jobId, stageTypeId, occurredAt, isCurrent: true },
  });
}

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
  const createdAt = new Date();
  const stages = await firstStageCreate(fields.statusId, fields.userId, createdAt);
  const status = await prisma.jobStatus.findUnique({
    where: { id: fields.statusId },
    select: { value: true },
  });
  return await prisma.job.create({
    data: {
      ...rest,
      fitData,
      ...reach,
      ...jobFieldsForStage(
        status?.value ?? "",
        fields.statusId,
        null,
        fields.appliedDate ?? null,
      ),
      createdAt,
      ...(tagIds.length > 0 ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
      stages,
    },
  });
}
