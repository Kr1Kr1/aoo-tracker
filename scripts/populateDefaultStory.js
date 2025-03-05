import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fillEmptyStories() {
  try {
    console.log("Starting to update empty or null stories...");

    // Find all CharacterHistory entries with empty or null stories
    const histories = await prisma.characterHistory.findMany({
      where: {story: "" }
    });

    console.log(`Found ${histories.length} entries with empty or null stories.`);

    // Update each entry with the default story
    for (const history of histories) {
      await prisma.characterHistory.update({
        where: { id: history.id },
        data: {
          story: "Histoire: Je préfère garder cela pour moi.",
        },
      });
      console.log(`Updated CharacterHistory ID ${history.id}`);
    }

    console.log("All empty stories have been updated.");
  } catch (error) {
    console.error("Error updating stories:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fillEmptyStories();
