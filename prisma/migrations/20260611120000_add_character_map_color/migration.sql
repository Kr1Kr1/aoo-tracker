-- AlterTable: race bgColor the engine paints around the player tile on the
-- in-game map (scraped from the race-hint rect). Used by the tracker map to
-- render the same color code around players.
ALTER TABLE "Characters" ADD COLUMN "mapColor" TEXT;
