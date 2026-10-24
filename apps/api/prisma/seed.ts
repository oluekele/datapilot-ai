import { PrismaClient } from "@prisma/client";

// Default plans (prices in kobo). Adjust in the admin dashboard; set each
// plan's Paystack plan code there to enable recurring billing.
const plans = [
  {
    code: "starter",
    name: "Starter",
    description: "For individuals and small projects.",
    priceMinor: 15_000_00,
    limits: { maxDatasets: 20, maxJobsPerMonth: 200, maxFileMb: 10, maxMembers: 1 },
  },
  {
    code: "team",
    name: "Team",
    description: "Shared workspace for growing teams.",
    priceMinor: 45_000_00,
    limits: { maxDatasets: 100, maxJobsPerMonth: 1_000, maxFileMb: 25, maxMembers: 10 },
  },
  {
    code: "business",
    name: "Business",
    description: "Higher limits for data-heavy organisations.",
    priceMinor: 120_000_00,
    limits: { maxDatasets: 500, maxJobsPerMonth: 5_000, maxFileMb: 25, maxMembers: 50 },
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: { ...plan, currency: "NGN", interval: "monthly" },
      update: {},
    });
  }
  console.log(`Seeded ${plans.length} plans.`);
  await prisma.$disconnect();
}

void main();
