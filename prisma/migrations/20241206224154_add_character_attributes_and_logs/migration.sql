-- CreateTable
CREATE TABLE "CharacterAttributes" (
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
    "spd" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "rm" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterAttributes_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterAttributes_characterId_key" ON "CharacterAttributes"("characterId");

-- CreateIndex
CREATE INDEX "Characters_targetId_idx" ON "Characters"("targetId");
