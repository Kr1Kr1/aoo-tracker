-- CreateTable
CREATE TABLE "PlanPortal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plan" TEXT NOT NULL,
    "z" INTEGER NOT NULL DEFAULT 0,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "toPlan" TEXT NOT NULL,
    "toZ" INTEGER NOT NULL DEFAULT 0,
    "toX" INTEGER,
    "toY" INTEGER
);

-- CreateIndex
CREATE INDEX "PlanPortal_plan_z_idx" ON "PlanPortal"("plan", "z");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPortal_plan_z_x_y_toPlan_toZ_key" ON "PlanPortal"("plan", "z", "x", "y", "toPlan", "toZ");
