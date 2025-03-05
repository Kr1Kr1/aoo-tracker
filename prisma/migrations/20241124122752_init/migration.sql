-- CreateTable
CREATE TABLE "Events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event" TEXT NOT NULL,
    "details" TEXT,
    "fromCol" TEXT NOT NULL,
    "withWhom" TEXT,
    "date" TEXT NOT NULL
);
