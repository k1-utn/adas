import { PrismaClient } from '@prisma/client';
import { STARTER_RULES } from '@adas/ai';

/**
 * Seed. Loads the deterministic calibration ruleset into the database and creates a couple
 * of sample OEM procedures + references so the pipeline has something to cite. Run with:
 *   npm run db:seed
 *
 * The ruleset is the product's source of truth; seeding it (rather than hardcoding in app
 * code) is what lets rules be versioned and audited like any other data.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Sample OEM procedures (in production these are ingested from OEM documentation).
  const glassProc = await prisma.oemProcedure.upsert({
    where: { id: 'seed_oem_glass' },
    update: {},
    create: {
      id: 'seed_oem_glass',
      make: 'Generic',
      title: 'Forward Camera Aiming After Windshield Replacement',
      sourceDoc: 'oem/glass-camera-aiming.pdf',
      ingestedAt: new Date(),
    },
  });

  const radarProc = await prisma.oemProcedure.upsert({
    where: { id: 'seed_oem_radar' },
    update: {},
    create: {
      id: 'seed_oem_radar',
      make: 'Generic',
      title: 'Front Radar Calibration After Fascia Service',
      sourceDoc: 'oem/front-radar-calibration.pdf',
      ingestedAt: new Date(),
    },
  });

  const procByKind: Record<string, string> = {
    CAMERA_AIMING: glassProc.id,
    RADAR_CALIBRATION: radarProc.id,
  };

  for (const rule of STARTER_RULES) {
    await prisma.calibrationRule.upsert({
      where: { id: rule.id },
      update: {
        kind: rule.kind,
        appliesWhen: rule.predicate as object,
        rationale: rule.rationale,
        version: rule.version,
        isActive: true,
      },
      create: {
        id: rule.id,
        kind: rule.kind,
        appliesWhen: rule.predicate as object,
        makeScope: rule.predicate.makeIn?.[0] ?? null,
        yearFrom: rule.predicate.yearFrom ?? null,
        yearTo: rule.predicate.yearTo ?? null,
        rationale: rule.rationale,
        version: rule.version,
        isActive: true,
      },
    });

    // Link an OEM reference where we have a matching sample procedure.
    const procId = procByKind[rule.kind];
    if (procId) {
      await prisma.oemReference.upsert({
        where: { id: `seedref_${rule.id}` },
        update: {},
        create: {
          id: `seedref_${rule.id}`,
          procedureId: procId,
          ruleId: rule.id,
          citation: `${rule.kind} — see OEM procedure`,
        },
      });
    }
  }

  // A demo organization + shop + owner so the app is usable immediately after seeding.
  const org = await prisma.organization.upsert({
    where: { id: 'seed_org' },
    update: {},
    create: { id: 'seed_org', name: 'Demo Collision Group', subscriptionTier: 'PROFESSIONAL', currency: 'USD' },
  });
  await prisma.shop.upsert({
    where: { id: 'seed_shop' },
    update: {},
    create: { id: 'seed_shop', organizationId: org.id, name: 'Demo Shop — Downtown', country: 'US' },
  });
  await prisma.user.upsert({
    where: { id: 'seed_user' },
    update: {},
    create: {
      id: 'seed_user',
      organizationId: org.id,
      shopId: 'seed_shop',
      authProviderId: 'dev_owner',
      email: 'owner@demo.test',
      name: 'Demo Owner',
      role: 'OWNER',
    },
  });

  console.log(`Seeded ${STARTER_RULES.length} calibration rules, 2 OEM procedures, demo org/shop/user.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
