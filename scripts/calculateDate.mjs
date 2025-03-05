import { PrismaClient } from "@prisma/client";
import { parseDate } from "../lib/dateUtils.js"; // Ensure the path to your utility is correct

const prisma = new PrismaClient();

async function updateCalculatedDates() {
  try {
    console.log("Starting the update for missing calculatedDate...");

    const events = await prisma.events.findMany({
      where: { calculatedDate: null },
    });

    if (events.length === 0) {
      console.log("No rows with missing calculatedDate found.");
      return;
    }

    console.log(`Found ${events.length} rows with missing calculatedDate.`);

    for (const event of events) {
      const parsedDate = parseDate(event.date);

      if (!parsedDate) {
        console.warn(`Could not parse date for event ID ${event.id}: ${event.date}`);
        continue;
      }

      const calculatedDate = new Date(parsedDate); // Convert ISO string to Date object

      await prisma.events.update({
        where: { id: event.id },
        data: { calculatedDate },
      });

      console.log(`Updated event ID ${event.id} with calculatedDate: ${calculatedDate}`);
    }

    console.log("Update completed successfully.");
  } catch (error) {
    console.error("Error updating calculatedDate:", error);
  } finally {
    await prisma.$disconnect();
  }
}

updateCalculatedDates();
