import { PrismaClient } from "@prisma/client";

// Usage: npm run admin:promote --workspace @datapilot/api -- someone@example.com
// Super-admins can only be created from a shell with database access, never via the API.
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Pass the user's email address.");
  const prisma = new PrismaClient();
  const user = await prisma.user.update({ where: { email }, data: { platformRole: "SUPER_ADMIN" } });
  await prisma.auditEvent.create({
    data: { action: "admin.promoted_via_cli", subjectType: "user", subjectId: user.id, actorUserId: null },
  });
  console.log(`${email} is now a super-admin. They must sign in again to see the admin area.`);
  await prisma.$disconnect();
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
