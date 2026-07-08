-- AlterTable: per-z scraped SVG backdrop (e.g. img/tiles/sky.webp for the
-- Remparts) so the map renderer paints the right background per z-level.
ALTER TABLE "PlanZLevel" ADD COLUMN "bg" TEXT;
