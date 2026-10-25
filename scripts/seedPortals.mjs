// Importer les passages (téléporteurs) du monde depuis la base du moteur local.
//
// La topologie ne change pas d'une instance à l'autre : on la lit une fois
// (docker exec sur MariaDB, cf. lib/localEngine.ts) et on la garde dans
// PlanPortal, pour les repères de la carte et l'arpentage. Relancer le script
// remplace tout. Usage : pnpm seed-portals
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const CONTAINER = process.env.LOCAL_ENGINE_DB_CONTAINER || "aoo-engine-mariadb-aoo4-1";
const DB_NAME = process.env.LOCAL_ENGINE_DB_NAME || "aoo4_saison2";
const DB_PASSWORD = process.env.LOCAL_ENGINE_DB_PASSWORD || "passwordRoot";

const prisma = new PrismaClient();

const sql =
  "SELECT c.plan, c.z, c.x, c.y, t.params FROM map_triggers t JOIN coords c ON c.id = t.coords_id WHERE t.name = 'tp'";
const out = execFileSync(
  "docker",
  ["exec", CONTAINER, "mariadb", "-uroot", `-p${DB_PASSWORD}`, DB_NAME, "-N", "-B", "-e", sql],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
);

const num = (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : null);
const rows = [];
let skipped = 0;
for (const line of out.split("\n")) {
  if (!line) continue;
  const [plan, z, x, y, params] = line.split("\t");
  const parts = (params || "").split(",").map((p) => p.trim());
  if (parts.length < 4) {
    skipped++;
    continue;
  }
  const toZ = num(parts[2]) ?? Number(z);
  const toPlan = parts[3] && parts[3] !== "plan" ? parts[3] : plan;
  // Un téléporteur interne au même niveau n'est pas un passage.
  if (toPlan === plan && toZ === Number(z)) {
    skipped++;
    continue;
  }
  rows.push({ plan, z: Number(z), x: Number(x), y: Number(y), toPlan, toZ, toX: num(parts[0]), toY: num(parts[1]) });
}

const unique = new Map(rows.map((r) => [`${r.plan}|${r.z}|${r.x}|${r.y}|${r.toPlan}|${r.toZ}`, r]));
await prisma.$transaction([
  prisma.planPortal.deleteMany(),
  prisma.planPortal.createMany({ data: Array.from(unique.values()) }),
]);
const plans = new Set(Array.from(unique.values()).map((r) => r.plan));
console.log(`${unique.size} passages importés sur ${plans.size} plans (${skipped} lignes ignorées : internes ou illisibles).`);
await prisma.$disconnect();
