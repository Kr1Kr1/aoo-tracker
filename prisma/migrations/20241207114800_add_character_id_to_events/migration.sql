/*
  Warnings:

  - Added the required column `characterId` to the `Events` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event" TEXT NOT NULL,
    "details" TEXT,
    "fromCol" TEXT NOT NULL,
    "withWhom" TEXT,
    "date" TEXT NOT NULL,
    "calculatedDate" DATETIME,
    "territory" TEXT NOT NULL DEFAULT 'Unknown Territory',
    "source" TEXT NOT NULL DEFAULT 'extension',
    "characterId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Events_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Insert all existing data into the new table, setting characterId to 146 (Glenefal)
INSERT INTO "new_Events" ("calculatedDate", "date", "details", "event", "fromCol", "id", "source", "territory", "withWhom", "characterId")
SELECT "calculatedDate", "date", "details", "event", "fromCol", "id", "source", "territory", "withWhom", 146
FROM "Events";

DROP TABLE "Events";
ALTER TABLE "new_Events" RENAME TO "Events";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
