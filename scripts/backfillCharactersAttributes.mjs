import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const raceAttributes = {
  "Nain": { cc: 11, ct: 8, f: 11, e: 6, agi: 6, p: 4, a: 2, mvt: 4, pv: 50, pm: 15, r: 5, rm: 4, fm: 10, m: 3, spd: 16 },
  "Geant": { cc: 9, ct: 10, f: 12, e: 4, agi: 7, p: 4, a: 2, mvt: 5, pv: 65, pm: 20, r: 5, rm: 5, fm: 6, m: 5, spd: 16 },
  "Olympien": { cc: 10, ct: 9, f: 10, e: 5, agi: 8, p: 4, a: 2, mvt: 5, pv: 60, pm: 30, r: 5, rm: 6, fm: 7, m: 5, spd: 16 },
  "HommeSauvage": { cc: 8, ct: 9, f: 7, e: 3, agi: 11, p: 5, a: 2, mvt: 6, pv: 45, pm: 40, r: 3, rm: 7, fm: 9, m: 5, spd: 16 },
  "Elfe": { cc: 9, ct: 10, f: 9, e: 4, agi: 9, p: 5, a: 2, mvt: 5, pv: 55, pm: 30, r: 4, rm: 6, fm: 8, m: 6, spd: 16 }
};

const factionToRace = {
  "Le Royaume des Cimes": "Geant",
  "Saruta & Frères": "Lutin",
  "Eryn Dolen": "Elfe",
  "La Forge Sacrée": "Nain",
  "Praetorium": "Olympien",
  "Le Tertre Sauvage": "HommeSauvage"
};

async function backfillCharacterAttributes() {
  try {
    console.log("Starting to backfill character attributes...");

    // Get all characters with their factions
    const characters = await prisma.characters.findMany({
      include: {
        faction: true,
        attributes: true
      }
    });

    console.log(`Found ${characters.length} characters to process`);

    for (const character of characters) {
      const race = character.faction ? factionToRace[character.faction.name] : null;
      if (!race) {
        console.log(`No race found for character ${character.name} (faction: ${character.faction?.name || 'none'})`);
        continue;
      }

      const attributes = raceAttributes[race];
      if (!attributes) {
        console.log(`No attributes found for race ${race}`);
        continue;
      }

      // Update or create character attributes
      if (character.attributes) {
        await prisma.characterAttributes.update({
          where: { characterId: character.id },
          data: {
            ...attributes,
            race
          }
        });
        console.log(`Updated attributes for character ${character.name} (${race})`);
      } else {
        await prisma.characterAttributes.create({
          data: {
            characterId: character.id,
            ...attributes,
            race
          }
        });
        console.log(`Created attributes for character ${character.name} (${race})`);
      }
    }

    console.log("Finished backfilling character attributes");
  } catch (error) {
    console.error("Error backfilling character attributes:", error);
  } finally {
    await prisma.$disconnect();
  }
}

backfillCharacterAttributes();