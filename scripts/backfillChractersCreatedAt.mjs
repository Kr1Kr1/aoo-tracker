import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function backfillCreatedAt() {
  try {
    const currentTimestamp = new Date();

    // Update all characters with a default createdAt timestamp
    const updatedRecords = await prisma.characters.updateMany({
      data: {
        createdAt: currentTimestamp,
      },
    });

    console.log(
      `Backfilled createdAt for ${updatedRecords.count} character records.`
    );
  } catch (error) {
    console.error("Error backfilling createdAt field:", error);
  } finally {
    await prisma.$disconnect();
  }
}

backfillCreatedAt();
