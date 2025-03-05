/*
  Warnings:

  - You are about to drop the column `description` on the `Characters` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Characters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "targetId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rank" TEXT,
    "popularity" TEXT,
    "role" TEXT,
    "portraitUrl" TEXT,
    "factionId" INTEGER,
    CONSTRAINT "Characters_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Factions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Characters" ("factionId", "id", "name", "popularity", "portraitUrl", "rank", "role", "targetId") SELECT "factionId", "id", "name", "popularity", "portraitUrl", "rank", "role", "targetId" FROM "Characters";
DROP TABLE "Characters";
ALTER TABLE "new_Characters" RENAME TO "Characters";
CREATE UNIQUE INDEX "Characters_targetId_key" ON "Characters"("targetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
