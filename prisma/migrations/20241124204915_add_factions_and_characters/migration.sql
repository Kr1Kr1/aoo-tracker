-- CreateTable
CREATE TABLE "Factions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Characters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "targetId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rank" TEXT,
    "popularity" TEXT,
    "role" TEXT,
    "portraitUrl" TEXT,
    "description" TEXT,
    "factionId" INTEGER,
    CONSTRAINT "Characters_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Factions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Factions_name_key" ON "Factions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Characters_targetId_key" ON "Characters"("targetId");
