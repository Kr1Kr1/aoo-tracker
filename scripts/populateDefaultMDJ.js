import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function populateDefaultMDJ() {
  try {
    // Fetch all characters without MDJ entries
    const charactersWithoutMDJ = await prisma.characters.findMany({
      where: {
        mdjHistory: { none: {} }, // Characters with no MDJ entries
      },
    });

    console.log(`Found ${charactersWithoutMDJ.length} characters without MDJ.`);

    // Insert default MDJ entries
    for (const character of charactersWithoutMDJ) {
      await prisma.mDJHistory.create({
        data: {
          characterId: character.id,
          mdj: "Ce personnage est trop éloigné pour l'entendre parler.",
        },
      });
      console.log(`Inserted default MDJ for character ${character.name} (ID: ${character.id}).`);
    }

    console.log("Default MDJ entries populated successfully.");
  } catch (error) {
    console.error("Error populating default MDJ entries:", error);
  } finally {
    await prisma.$disconnect();
  }
}

populateDefaultMDJ();
