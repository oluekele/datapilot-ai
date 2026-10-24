import { Prisma, PrismaClient } from "@prisma/client";

/**
 * One-time catch-up for accounts verified before automatic free trials existed.
 *
 *   npm run trials:backfill               # preview only
 *   npm run trials:backfill -- --apply    # start the trials
 *
 * Applies the same rules as sign-up (EntitlementsService.startTrial): an
 * organisation qualifies only if it is active, its owner has verified their
 * email, neither the organisation nor the owner has ever had a trial, and it
 * has no subscription. The unique constraints on the trial tables still make a
 * second trial impossible, so running this twice is harmless.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const days = Number(process.env.TRIAL_DAYS ?? 14);
  if (!Number.isInteger(days) || days <= 0) {
    console.log("TRIAL_DAYS is 0 or invalid: automatic trials are disabled, nothing to do.");
    return;
  }
  const prisma = new PrismaClient();
  const candidates = await prisma.organization.findMany({
    where: {
      status: "ACTIVE",
      trialUse: null,
      subscription: null,
      memberships: {
        some: { role: "OWNER", user: { emailVerifiedAt: { not: null }, status: "ACTIVE", trialUse: null } },
      },
    },
    include: { memberships: { where: { role: "OWNER" }, include: { user: true } } },
    orderBy: { createdAt: "asc" },
  });

  // One trial per owner: if an owner has several qualifying organisations, the oldest gets it.
  const seenOwners = new Set<string>();
  const plan = candidates.filter((org) => {
    const owner = org.memberships[0].user;
    if (seenOwners.has(owner.id)) return false;
    seenOwners.add(owner.id);
    return true;
  });

  console.log(`${plan.length} organisation(s) qualify for a ${days}-day free trial:`);
  for (const org of plan) console.log(`  - ${org.name}  (owner ${org.memberships[0].user.email})`);
  if (!apply) {
    console.log("\nPreview only. Run with --apply to start these trials.");
    await prisma.$disconnect();
    return;
  }

  let started = 0;
  for (const org of plan) {
    const owner = org.memberships[0].user;
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + days * DAY_MS);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org.id}))`;
        await tx.organizationTrialUse.create({
          data: { organizationId: org.id, startedAt, expiresAt, reason: "Free trial for account created before automatic trials" },
        });
        await tx.userTrialUse.create({ data: { userId: owner.id, organizationId: org.id, startedAt, expiresAt } });
        await tx.auditEvent.create({
          data: {
            action: "trial.started",
            organizationId: org.id,
            subjectType: "organization",
            subjectId: org.id,
            metadata: { days, expiresAt: expiresAt.toISOString(), automatic: true, backfill: true },
          },
        });
      });
      started += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.log(`  skipped ${org.name}: a trial was recorded meanwhile`);
        continue;
      }
      throw error;
    }
  }
  console.log(`\nStarted ${started} trial(s), ending ${new Date(Date.now() + days * DAY_MS).toDateString()}.`);
  await prisma.$disconnect();
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
