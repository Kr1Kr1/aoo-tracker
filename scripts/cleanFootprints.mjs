// One-shot cleanup: removes ephemeral footprint traces ("trace_pas_*")
// from the MapElements table. The scraper now filters them client-side,
// but earlier scrapes may have left some behind.
//
// Usage:  node scripts/cleanFootprints.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const result = await prisma.mapElements.deleteMany({
    where: { name: { startsWith: "trace_pas" } },
  });
  console.log(`✓ Removed ${result.count} footprint traces from MapElements.`);
} catch (err) {
  console.error("✗ Failed:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
