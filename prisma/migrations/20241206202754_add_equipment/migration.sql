-- CreateTable
CREATE TABLE "Equipment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" INTEGER,
    "imageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "characterId" INTEGER NOT NULL,
    CONSTRAINT "Equipment_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
