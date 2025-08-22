-- CreateTable
CREATE TABLE "Maps" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Coords" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "z" INTEGER NOT NULL DEFAULT 0,
    "mapId" INTEGER NOT NULL,
    CONSTRAINT "Coords_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Maps" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MapTiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "coordsId" INTEGER NOT NULL,
    "foreground" INTEGER NOT NULL DEFAULT 0,
    "playerId" INTEGER,
    CONSTRAINT "MapTiles_coordsId_fkey" FOREIGN KEY ("coordsId") REFERENCES "Coords" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MapTiles_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Characters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MapElements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "coordsId" INTEGER NOT NULL,
    "endTime" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MapElements_coordsId_fkey" FOREIGN KEY ("coordsId") REFERENCES "Coords" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Maps_name_key" ON "Maps"("name");

-- CreateIndex
CREATE INDEX "Coords_mapId_idx" ON "Coords"("mapId");

-- CreateIndex
CREATE INDEX "MapTiles_coordsId_idx" ON "MapTiles"("coordsId");

-- CreateIndex
CREATE INDEX "MapTiles_playerId_idx" ON "MapTiles"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MapElements_name_key" ON "MapElements"("name");

-- CreateIndex
CREATE INDEX "MapElements_coordsId_idx" ON "MapElements"("coordsId");

-- CreateIndex
CREATE UNIQUE INDEX "MapElements_name_coordsId_key" ON "MapElements"("name", "coordsId");
