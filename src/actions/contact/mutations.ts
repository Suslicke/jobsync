"use server";
import { z } from "zod";
import prisma from "@/lib/db";
import { handleError } from "@/lib/utils";
import { linkedinProfileKey } from "@/lib/contacts";
import { requireUser } from "../shared";
import {
  AddContactFormSchema,
  type ContactFormValues,
} from "@/models/addContactForm.schema";

// An untouched optional field arrives as "" from react-hook-form; storing that
// makes "has an email" untestable, so empty means null in the database.
const nullable = (value?: string | null) =>
  value && value.trim() ? value.trim() : null;

const toContactData = (values: ContactFormValues) => ({
  name: values.name.trim(),
  title: nullable(values.title),
  email: nullable(values.email),
  phone: nullable(values.phone),
  linkedinUrl: nullable(values.linkedinUrl),
  companyId: nullable(values.company),
  locationId: nullable(values.location),
  relationship: nullable(values.relationship),
  workedAtCompanyId: nullable(values.workedAtCompany),
  workedFrom: values.workedFrom ?? null,
  workedTo: values.workedTo ?? null,
  roleId: nullable(values.contactRole),
  notes: nullable(values.notes),
  lastContactedAt: values.lastContactedAt ?? null,
});

// Foreign keys prove a row exists, not that the caller owns it, so every
// referenced id is counted against the caller before it is written.
const assertContactRefsOwned = async (
  userId: string,
  data: ReturnType<typeof toContactData>,
) => {
  const companyIds = [
    ...new Set(
      [data.companyId, data.workedAtCompanyId].filter(
        (id): id is string => !!id,
      ),
    ),
  ];

  const [companies, location, role] = await Promise.all([
    companyIds.length > 0
      ? prisma.company.count({
          where: { id: { in: companyIds }, createdBy: userId },
        })
      : 0,
    data.locationId
      ? prisma.location.count({
          where: { id: data.locationId, createdBy: userId },
        })
      : 1,
    data.roleId
      ? prisma.contactRole.count({
          where: { id: data.roleId, createdBy: userId },
        })
      : 1,
  ]);

  if (companies !== companyIds.length) throw new Error("Company not found");
  if (location === 0) throw new Error("Location not found");
  if (role === 0) throw new Error("Role not found");
};

export const createContact = async (
  values: ContactFormValues,
): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const contactData = toContactData(values);
    await assertContactRefsOwned(user.id, contactData);

    const data = await prisma.contact.create({
      data: { ...contactData, createdBy: user.id },
    });
    return { success: true, data };
  } catch (error) {
    return handleError(error, "Failed to create contact.");
  }
};

// Fields an import may know about a person. Kept narrow on purpose: an import
// fills a blank, it does not get to restate who someone is.
const IMPORTABLE = ["title", "email", "phone", "notes"] as const;

// Find-or-create a contact, keyed on their LinkedIn profile URL.
//
// The importer on the Mac carries people out of LinkedIn posts, and a person
// posts more than once. Contact has no unique constraint and createContact never
// looks, so a second run mints the same human again — JobContact's @@unique
// protects the link, not the row behind it. Nothing on the read side can repair
// that afterwards either: getAllContacts does not select linkedinUrl and
// getContactList searches name, email and title only, so a caller has no way to
// ask "is this person already here?" without this action.
//
// An existing contact is only FILLED IN, never overwritten. A headline scraped
// off a post is weaker than whatever the user has since typed in its place, and
// a nightly re-import that silently undoes an edit is the same failure as an
// upsert resetting a job's status.
export const upsertContactByLinkedinUrl = async (
  values: z.infer<typeof AddContactFormSchema>,
): Promise<any | undefined> => {
  try {
    const user = await requireUser();

    // Validated here, unlike createContact: that one leans on the zod resolver
    // inside the React form, and this action's callers are importers over MCP
    // which never run it. Without this a malformed URL or a 5000-character note
    // would be stored without a word of complaint.
    const parsed = AddContactFormSchema.safeParse(values);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "values"}: ${i.message}`)
          .join("; "),
      );
    }

    const key = linkedinProfileKey(parsed.data.linkedinUrl);
    if (!key) throw new Error("A linkedinUrl is required to match a contact.");

    const contactData = toContactData(parsed.data);
    await assertContactRefsOwned(user.id, contactData);

    // Matched in JS rather than by a WHERE: the stored URL keeps whatever form
    // its writer used, and SQLite offers Prisma no case-insensitive comparison
    // to fold it with. The candidate set is only the caller's own contacts that
    // carry a URL at all.
    const candidates = await prisma.contact.findMany({
      where: { createdBy: user.id, NOT: { linkedinUrl: null } },
      select: {
        id: true,
        linkedinUrl: true,
        title: true,
        email: true,
        phone: true,
        notes: true,
      },
    });
    const match = candidates.find(
      (c) => linkedinProfileKey(c.linkedinUrl) === key,
    );

    if (!match) {
      const data = await prisma.contact.create({
        data: { ...contactData, createdBy: user.id },
      });
      return { success: true, created: true, data };
    }

    const fill = Object.fromEntries(
      IMPORTABLE.filter((f) => !match[f] && contactData[f]).map((f) => [
        f,
        contactData[f],
      ]),
    );
    if (Object.keys(fill).length > 0) {
      await prisma.contact.updateMany({
        where: { id: match.id, createdBy: user.id },
        data: fill,
      });
    }

    return { success: true, created: false, data: { id: match.id, ...fill } };
  } catch (error) {
    return handleError(error, "Failed to upsert contact.");
  }
};

export const updateContact = async (
  values: ContactFormValues,
): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    if (!values.id) throw new Error("Please provide a contact id");

    const contactData = toContactData(values);
    await assertContactRefsOwned(user.id, contactData);

    // updateMany, not update: a unique-where cannot carry createdBy, and a
    // count of 0 is how a contact belonging to someone else surfaces.
    const res = await prisma.contact.updateMany({
      where: { id: values.id, createdBy: user.id },
      data: contactData,
    });
    if (res.count === 0) throw new Error("Contact not found");

    return { success: true, data: { id: values.id } };
  } catch (error) {
    return handleError(error, "Failed to update contact.");
  }
};

export const deleteContactById = async (
  contactId: string,
): Promise<any | undefined> => {
  try {
    const user = await requireUser();

    // JobContact cascades from Contact, so the links go with the person.
    const res = await prisma.contact.deleteMany({
      where: { id: contactId, createdBy: user.id },
    });
    if (res.count === 0) throw new Error("Contact not found");

    return { success: true };
  } catch (error) {
    return handleError(error, "Failed to delete contact.");
  }
};
