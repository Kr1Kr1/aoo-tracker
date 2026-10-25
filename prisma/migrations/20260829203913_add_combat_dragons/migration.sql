-- CreateTable
CREATE TABLE "Monster" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "cc" INTEGER,
    "ct" INTEGER,
    "f" INTEGER,
    "e" INTEGER,
    "agi" INTEGER,
    "pv" INTEGER,
    "pm" INTEGER,
    "fm" INTEGER,
    "m" INTEGER,
    "a" INTEGER,
    "mvt" INTEGER,
    "p" INTEGER,
    "r" INTEGER,
    "rm" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CombatAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "characterId" INTEGER NOT NULL,
    "monsterId" INTEGER,
    "turnTime" DATETIME,
    "note" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CombatAssignment_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CombatAssignment_monsterId_fkey" FOREIGN KEY ("monsterId") REFERENCES "Monster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CombatAssignment_characterId_key" ON "CombatAssignment"("characterId");

-- CreateIndex
CREATE INDEX "CombatAssignment_monsterId_idx" ON "CombatAssignment"("monsterId");
