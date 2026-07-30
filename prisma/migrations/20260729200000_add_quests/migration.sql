-- CreateTable: intrigues sans résolution suivies par un personnage. Saisies à
-- la main ou issues d'une détection IA validée (`origin`). Le fil reste la
-- source ; la quête n'en est que la lecture narrative.
CREATE TABLE "Quest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "characterId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "stake" TEXT,
    "nextStep" TEXT,
    "status" TEXT NOT NULL DEFAULT 'lead',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: les fils (RP, missives, forum privé) qui portent l'intrigue.
CREATE TABLE "QuestTopic" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questId" INTEGER NOT NULL,
    "topicId" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "QuestTopic_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: qui d'autre est dans l'histoire, et à quel titre.
CREATE TABLE "QuestActor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questId" INTEGER NOT NULL,
    "characterId" INTEGER NOT NULL,
    "role" TEXT,
    CONSTRAINT "QuestActor_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestActor_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Characters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Quest_characterId_idx" ON "Quest"("characterId");

-- CreateIndex
CREATE INDEX "Quest_status_idx" ON "Quest"("status");

-- CreateIndex
CREATE INDEX "QuestTopic_topicId_idx" ON "QuestTopic"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestTopic_questId_topicId_key" ON "QuestTopic"("questId", "topicId");

-- CreateIndex
CREATE INDEX "QuestActor_characterId_idx" ON "QuestActor"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestActor_questId_characterId_key" ON "QuestActor"("questId", "characterId");
