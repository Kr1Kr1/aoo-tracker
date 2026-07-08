-- CreateTable
CREATE TABLE "MapSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "capturedAt" DATETIME NOT NULL,
    "svgWidth" INTEGER NOT NULL DEFAULT 800,
    "svgHeight" INTEGER NOT NULL DEFAULT 532,
    "playerId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MapSnapshotLayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "snapshotId" INTEGER NOT NULL,
    "layerKey" TEXT NOT NULL,
    "sourceHref" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "zOrder" INTEGER NOT NULL,
    CONSTRAINT "MapSnapshotLayer_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MapSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MapSnapshot_capturedAt_key" ON "MapSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "MapSnapshot_capturedAt_idx" ON "MapSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "MapSnapshotLayer_snapshotId_idx" ON "MapSnapshotLayer"("snapshotId");

-- CreateIndex
CREATE INDEX "MapSnapshotLayer_contentHash_idx" ON "MapSnapshotLayer"("contentHash");
