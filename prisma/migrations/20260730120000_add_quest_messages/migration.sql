-- CreateTable: l'ancrage d'une quête sur des messages précis. Le fil dit où
-- l'histoire se joue, le message dit à quelle phrase elle s'est nouée : c'est
-- ce qui rend lisible une intrigue étalée sur des mois. Suppression en cascade
-- côté message : un message retiré de la base n'a plus de preuve à porter.
CREATE TABLE "QuestMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "QuestMessage_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QuestMessage_messageId_idx" ON "QuestMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestMessage_questId_messageId_key" ON "QuestMessage"("questId", "messageId");
