-- CreateTable
CREATE TABLE "Forums" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "factionId" INTEGER,
    CONSTRAINT "Forums_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Factions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Topics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "forumId" INTEGER NOT NULL,
    CONSTRAINT "Topics_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Topics_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "Forums" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "characterId" INTEGER NOT NULL,
    "topicId" INTEGER NOT NULL,
    CONSTRAINT "Messages_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Messages_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Forums_link_key" ON "Forums"("link");

-- CreateIndex
CREATE UNIQUE INDEX "Topics_link_key" ON "Topics"("link");
