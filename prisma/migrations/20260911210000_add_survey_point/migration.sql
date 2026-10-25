-- CreateTable
CREATE TABLE "SurveyPoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plan" TEXT NOT NULL,
    "z" INTEGER NOT NULL DEFAULT 0,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "radius" INTEGER NOT NULL,
    "ownerId" INTEGER,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SurveyPoint_plan_z_idx" ON "SurveyPoint"("plan", "z");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyPoint_plan_z_x_y_radius_key" ON "SurveyPoint"("plan", "z", "x", "y", "radius");
