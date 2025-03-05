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
    "territory" TEXT NOT NULL DEFAULT 'Unknown Territory'
);
INSERT INTO "new_Events" ("date", "details", "event", "fromCol", "id", "withWhom") SELECT "date", "details", "event", "fromCol", "id", "withWhom" FROM "Events";
DROP TABLE "Events";
ALTER TABLE "new_Events" RENAME TO "Events";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
