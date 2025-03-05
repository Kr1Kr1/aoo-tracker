/*
  Warnings:

  - You are about to drop the column `spd` on the `CharacterAttributes` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CharacterAttributes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "characterId" INTEGER NOT NULL,
    "cc" INTEGER NOT NULL,
    "ct" INTEGER NOT NULL,
    "f" INTEGER NOT NULL,
    "e" INTEGER NOT NULL,
    "agi" INTEGER NOT NULL,
    "pv" INTEGER NOT NULL,
    "pm" INTEGER NOT NULL,
    "fm" INTEGER NOT NULL,
    "m" INTEGER NOT NULL,
    "a" INTEGER NOT NULL,
    "mvt" INTEGER NOT NULL,
    "p" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "rm" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterAttributes_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CharacterAttributes" ("a", "agi", "cc", "characterId", "createdAt", "ct", "e", "f", "fm", "id", "m", "mvt", "p", "pm", "pv", "r", "rm", "updatedAt", "xp") SELECT "a", "agi", "cc", "characterId", "createdAt", "ct", "e", "f", "fm", "id", "m", "mvt", "p", "pm", "pv", "r", "rm", "updatedAt", "xp" FROM "CharacterAttributes";
DROP TABLE "CharacterAttributes";
ALTER TABLE "new_CharacterAttributes" RENAME TO "CharacterAttributes";
CREATE UNIQUE INDEX "CharacterAttributes_characterId_key" ON "CharacterAttributes"("characterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
