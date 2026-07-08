-- CreateTable
CREATE TABLE "MapPlants" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "href" TEXT,
    "coordsId" INTEGER NOT NULL,
    "scrapedAt" DATETIME NOT NULL,
    CONSTRAINT "MapPlants_coordsId_fkey" FOREIGN KEY ("coordsId") REFERENCES "Coords" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MapPlants_coordsId_idx" ON "MapPlants"("coordsId");

-- CreateIndex
CREATE UNIQUE INDEX "MapPlants_coordsId_name_key" ON "MapPlants"("coordsId", "name");
