// Promote a user to role=admin. Run once after the schema migration to
// bootstrap the first admin (since the admin UI needs an admin to use).
//
// Usage:  node scripts/promoteAdmin.mjs <username>

import { PrismaClient } from '@prisma/client';

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/promoteAdmin.mjs <username>');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.update({
    where: { username },
    data: { role: 'admin' },
    select: { id: true, username: true, role: true },
  });
  console.log(`✓ Promoted: ${user.username} (id=${user.id}) → ${user.role}`);
} catch (err) {
  if (err.code === 'P2025') {
    console.error(`✗ User '${username}' not found.`);
    process.exit(1);
  }
  console.error('✗ Failed:', err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
