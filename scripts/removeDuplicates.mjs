import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function removeDuplicates() {
  try {
    console.log("Starting duplicate cleanup...");

    // Find all events
    const events = await prisma.events.findMany();

    // Group events by key fields to find duplicates
    const eventMap = new Map();

    events.forEach((event) => {
      const key = `${event.event}|${event.territory}|${event.calculatedDate}|${event.fromCol}`;
      if (!eventMap.has(key)) {
        eventMap.set(key, []);
      }
      eventMap.get(key).push(event);
    });

    // Identify duplicates
    const duplicates = [];
    eventMap.forEach((group) => {
      if (group.length > 1) {
        // Sort by ID to retain the earliest one
        group.sort((a, b) => a.id - b.id);
        duplicates.push(...group.slice(1)); // Keep only duplicates
      }
    });

    console.log(`Found ${duplicates.length} duplicates.`);

    // Delete duplicates
    for (const duplicate of duplicates) {
      await prisma.events.delete({
        where: { id: duplicate.id },
      });
      console.log(`Deleted duplicate ID: ${duplicate.id}`);
    }

    console.log("Duplicate cleanup completed!");
  } catch (error) {
    console.error("Error during duplicate cleanup:", error);
  } finally {
    await prisma.$disconnect();
  }
}

removeDuplicates();
