-- AlterTable: tag each revealed cell with the persona (AOM targetId) that saw
-- it, so PNJ cartography can be segregated from the main PJ's map vision.
ALTER TABLE "Coords" ADD COLUMN "seenById" INTEGER;

-- CreateIndex
CREATE INDEX "Coords_seenById_idx" ON "Coords"("seenById");
