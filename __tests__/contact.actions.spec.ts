import {
  getContactList,
  getAllContacts,
  createContact,
  upsertContactByLinkedinUrl,
  updateContact,
  deleteContactById,
} from "@/actions/contact.actions";
import { linkedinProfileKey } from "@/lib/contacts";
import { getCurrentUser } from "@/utils/user.utils";
import prisma from "@/lib/db";

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    company: { count: vi.fn() },
    location: { count: vi.fn() },
    contactRole: { count: vi.fn() },
  },
}));

vi.mock("@/utils/user.utils", () => ({ getCurrentUser: vi.fn() }));

const db = prisma as any;
const user = { id: "user-1" };

describe("contact actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(user);
    db.contact.findMany.mockResolvedValue([]);
    db.contact.count.mockResolvedValue(0);
    db.company.count.mockResolvedValue(1);
    db.location.count.mockResolvedValue(1);
    db.contactRole.count.mockResolvedValue(1);
  });

  describe("getContactList", () => {
    it("scopes to the user", async () => {
      await getContactList();
      expect(db.contact.findMany.mock.calls[0][0].where).toEqual({
        createdBy: user.id,
      });
    });

    it("searches name, email and title", async () => {
      await getContactList(1, 10, "pat");
      expect(db.contact.findMany.mock.calls[0][0].where.OR).toEqual([
        { name: { contains: "pat" } },
        { email: { contains: "pat" } },
        { title: { contains: "pat" } },
      ]);
    });

    it("filters on the standing role or one held through any job link", async () => {
      await getContactList(1, 10, undefined, "role-1");
      expect(db.contact.findMany.mock.calls[0][0].where.AND).toEqual([
        {
          OR: [
            { roleId: "role-1" },
            { jobLinks: { some: { roleId: "role-1" } } },
          ],
        },
      ]);
    });

    it("pages with skip and take", async () => {
      await getContactList(3, 10);
      const args = db.contact.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
  });

  describe("getAllContacts", () => {
    it("returns picker rows whose value carries the email, so search finds it", async () => {
      db.contact.findMany.mockResolvedValue([
        { id: "c1", name: "Dave Patel", email: "dave@x.com", Company: { label: "Shopify" } },
      ]);

      const res = await getAllContacts();

      expect(res).toEqual([
        { id: "c1", label: "Dave Patel", value: "dave patel dave@x.com shopify" },
      ]);
    });
  });

  describe("createContact", () => {
    it("writes createdBy from the session, never from the payload", async () => {
      db.contact.create.mockResolvedValue({ id: "c1" });

      await createContact({ name: "Dave", createdBy: "attacker" } as any);

      const data = db.contact.create.mock.calls[0][0].data;
      expect(data.createdBy).toBe(user.id);
      expect(data.name).toBe("Dave");
    });

    it("stores empty optional text as null rather than an empty string", async () => {
      db.contact.create.mockResolvedValue({ id: "c1" });

      await createContact({ name: "Dave", email: "", title: "", company: "" } as any);

      const data = db.contact.create.mock.calls[0][0].data;
      expect(data.email).toBeNull();
      expect(data.title).toBeNull();
      expect(data.companyId).toBeNull();
    });
  });

  describe("upsertContactByLinkedinUrl", () => {
    const dave = {
      name: "Dave",
      title: "CTO at Acme",
      linkedinUrl: "https://www.linkedin.com/in/dave/",
    } as any;

    it("creates the person when no stored profile matches", async () => {
      db.contact.create.mockResolvedValue({ id: "c1" });

      const res = await upsertContactByLinkedinUrl(dave);

      expect(res.success).toBe(true);
      expect(res.created).toBe(true);
      expect(db.contact.create.mock.calls[0][0].data.createdBy).toBe(user.id);
    });

    // The whole point: the Mac re-imports the same post authors nightly, and
    // Contact has no unique constraint to stop a second copy.
    it("returns the existing person instead of a second copy", async () => {
      db.contact.findMany.mockResolvedValue([
        { id: "c1", linkedinUrl: "https://linkedin.com/in/DAVE", title: "CTO" },
      ]);

      const res = await upsertContactByLinkedinUrl(dave);

      expect(res.created).toBe(false);
      expect(res.data.id).toBe("c1");
      expect(db.contact.create).not.toHaveBeenCalled();
    });

    // A headline scraped off a post must not overwrite what the user typed.
    it("fills an empty field but never overwrites one that is set", async () => {
      db.contact.findMany.mockResolvedValue([
        {
          id: "c1",
          linkedinUrl: "https://www.linkedin.com/in/dave/",
          title: "Hand-written title",
          email: null,
        },
      ]);

      await upsertContactByLinkedinUrl({ ...dave, email: "dave@acme.com" });

      expect(db.contact.updateMany.mock.calls[0][0].data).toEqual({
        email: "dave@acme.com",
      });
    });

    it("refuses a payload with no profile URL rather than creating a person nothing can match", async () => {
      const res = await upsertContactByLinkedinUrl({ name: "Dave" } as any);
      expect(res.success).toBe(false);
      expect(db.contact.create).not.toHaveBeenCalled();
    });

    // createContact leans on the React form's resolver; this path has no form.
    it("validates the payload the form would have validated", async () => {
      const res = await upsertContactByLinkedinUrl({
        ...dave,
        email: "not-an-email",
      });
      expect(res.success).toBe(false);
      expect(db.contact.create).not.toHaveBeenCalled();
    });

    // The importer clamps headlines to 120 before sending, because this rejects
    // them. Both halves of that pair are asserted so they cannot drift apart in
    // silence: 85 of 310 real LinkedIn headlines are longer than the cap and the
    // longest is 220, and a rejection here loses the person the post was for.
    // The fixtures on both sides used to be hand-written short titles, which is
    // exactly why nothing caught it.
    it("rejects a headline longer than the title column allows", async () => {
      const res = await upsertContactByLinkedinUrl({
        ...dave,
        title: "x".repeat(220),
      });
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/title/i);
      expect(db.contact.create).not.toHaveBeenCalled();
    });

    it("accepts one clamped to the cap", async () => {
      db.contact.create.mockResolvedValue({ id: "c1" });
      const res = await upsertContactByLinkedinUrl({
        ...dave,
        title: "x".repeat(220).slice(0, 120),
      });
      expect(res.success).toBe(true);
    });
  });

  describe("linkedinProfileKey", () => {
    it("folds www, case and a trailing slash into one key", () => {
      expect(linkedinProfileKey("https://www.linkedin.com/in/Dave/")).toBe(
        linkedinProfileKey("https://linkedin.com/in/dave"),
      );
    });

    it("ignores a query string, which copying a profile often appends", () => {
      expect(
        linkedinProfileKey("https://www.linkedin.com/in/dave/?originalSubdomain=de"),
      ).toBe("linkedin.com/in/dave");
    });

    it("keeps two different people apart", () => {
      expect(linkedinProfileKey("https://www.linkedin.com/in/dave/")).not.toBe(
        linkedinProfileKey("https://www.linkedin.com/in/dave-2/"),
      );
    });

    it("has no key for a bare host or a non-URL", () => {
      expect(linkedinProfileKey("https://www.linkedin.com/")).toBe("");
      expect(linkedinProfileKey("dave")).toBe("");
      expect(linkedinProfileKey(null)).toBe("");
    });
  });

  describe("updateContact", () => {
    it("scopes the update to the owner and reports a miss", async () => {
      db.contact.updateMany.mockResolvedValue({ count: 0 });

      const res = await updateContact({ id: "c1", name: "Dave" } as any);

      expect(db.contact.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "c1", createdBy: user.id } }),
      );
      expect(res.success).toBe(false);
    });
  });

  describe("reference ownership", () => {
    const values = {
      name: "Dave",
      company: "co-1",
      workedAtCompany: "co-2",
      location: "loc-1",
      contactRole: "role-1",
    } as any;

    it("counts each referenced id against the caller", async () => {
      db.company.count.mockResolvedValue(2);
      db.contact.create.mockResolvedValue({ id: "c1" });

      const res = await createContact(values);

      expect(res.success).toBe(true);
      expect(db.company.count).toHaveBeenCalledWith({
        where: { id: { in: ["co-1", "co-2"] }, createdBy: user.id },
      });
      expect(db.location.count).toHaveBeenCalledWith({
        where: { id: "loc-1", createdBy: user.id },
      });
      expect(db.contactRole.count).toHaveBeenCalledWith({
        where: { id: "role-1", createdBy: user.id },
      });
    });

    it("counts a company used for both fields once", async () => {
      db.contact.create.mockResolvedValue({ id: "c1" });

      const res = await createContact({ ...values, workedAtCompany: "co-1" });

      expect(res.success).toBe(true);
      expect(db.company.count.mock.calls[0][0].where.id).toEqual({
        in: ["co-1"],
      });
    });

    it.each([
      ["company", "company", 1, "Company not found"],
      ["location", "location", 0, "Location not found"],
      ["role", "contactRole", 0, "Role not found"],
    ])(
      "create rejects another user's %s",
      async (_label, model, count, message) => {
        db.company.count.mockResolvedValue(2);
        db[model].count.mockResolvedValue(count);

        const res = await createContact(values);

        expect(res).toEqual({ success: false, message });
        expect(db.contact.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["company", "company", 1, "Company not found"],
      ["location", "location", 0, "Location not found"],
      ["role", "contactRole", 0, "Role not found"],
    ])(
      "update rejects another user's %s before writing",
      async (_label, model, count, message) => {
        db.company.count.mockResolvedValue(2);
        db[model].count.mockResolvedValue(count);

        const res = await updateContact({ ...values, id: "c1" });

        expect(res).toEqual({ success: false, message });
        expect(db.contact.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe("deleteContactById", () => {
    it("deletes only the caller's contact", async () => {
      db.contact.deleteMany.mockResolvedValue({ count: 1 });

      const res = await deleteContactById("c1");

      expect(db.contact.deleteMany).toHaveBeenCalledWith({
        where: { id: "c1", createdBy: user.id },
      });
      expect(res.success).toBe(true);
    });

    it("reports a delete that matched nothing rather than claiming success", async () => {
      db.contact.deleteMany.mockResolvedValue({ count: 0 });
      const res = await deleteContactById("someone-elses");
      expect(res.success).toBe(false);
    });
  });
});
