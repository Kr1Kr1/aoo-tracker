import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getCallerContextFromCookies } from '@/lib/authContext';
import bcrypt from 'bcrypt';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

async function createUser(formData: FormData) {
  'use server';
  const ctx = await getCallerContextFromCookies();
  if (!ctx || ctx.role !== 'admin') redirect('/login');

  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');
  const role = formData.get('role') === 'admin' ? 'admin' : 'user';
  if (!username || !password) return;

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return;

  await prisma.user.create({
    data: { username, password: await bcrypt.hash(password, 10), role },
  });
  revalidatePath('/admin/users');
}

async function deleteUser(formData: FormData) {
  'use server';
  const ctx = await getCallerContextFromCookies();
  if (!ctx || ctx.role !== 'admin') redirect('/login');

  const userId = parseInt(String(formData.get('userId') || ''), 10);
  if (Number.isNaN(userId)) return;
  if (userId === ctx.userId) return; // never delete self

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath('/admin/users');
}

async function setUserRole(formData: FormData) {
  'use server';
  const ctx = await getCallerContextFromCookies();
  if (!ctx || ctx.role !== 'admin') redirect('/login');

  const userId = parseInt(String(formData.get('userId') || ''), 10);
  const role = formData.get('role') === 'admin' ? 'admin' : 'user';
  if (Number.isNaN(userId)) return;

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath('/admin/users');
}

async function setLinkedCharacters(formData: FormData) {
  'use server';
  const ctx = await getCallerContextFromCookies();
  if (!ctx || ctx.role !== 'admin') redirect('/login');

  const userId = parseInt(String(formData.get('userId') || ''), 10);
  if (Number.isNaN(userId)) return;

  const targetIds = formData
    .getAll('characterTargetId')
    .map((v) => parseInt(String(v), 10))
    .filter((n) => !Number.isNaN(n));

  await prisma.user.update({
    where: { id: userId },
    data: { characters: { set: targetIds.map((targetId) => ({ targetId })) } },
  });
  revalidatePath('/admin/users');
}

async function resetPassword(formData: FormData) {
  'use server';
  const ctx = await getCallerContextFromCookies();
  if (!ctx || ctx.role !== 'admin') redirect('/login');

  const userId = parseInt(String(formData.get('userId') || ''), 10);
  const password = String(formData.get('password') || '');
  if (Number.isNaN(userId) || !password) return;

  await prisma.user.update({
    where: { id: userId },
    data: { password: await bcrypt.hash(password, 10) },
  });
  revalidatePath('/admin/users');
}

export default async function AdminUsersPage() {
  const ctx = await getCallerContextFromCookies();
  if (!ctx) redirect('/login');
  if (ctx.role !== 'admin') redirect('/');

  const [users, allCharacters] = await Promise.all([
    prisma.user.findMany({
      orderBy: { username: 'asc' },
      include: {
        characters: { select: { targetId: true, name: true } },
      },
    }),
    prisma.characters.findMany({
      select: { targetId: true, name: true },
      orderBy: [{ targetId: 'asc' }],
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Admin · Users</h1>

      <Card>
        <CardHeader>
          <CardTitle>Create user</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createUser} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input name="username" placeholder="Username" required />
            <Input name="password" type="password" placeholder="Password" required />
            <select name="role" className="border rounded px-2 py-1">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      {users.map((u) => (
        <Card key={u.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                {u.username}{' '}
                <span className="text-sm text-muted-foreground">
                  ({u.role}, {u.characters.length} characters)
                </span>
              </span>
              {u.id !== ctx.userId && (
                <form action={deleteUser}>
                  <input type="hidden" name="userId" value={u.id} />
                  <Button type="submit" variant="destructive" size="sm">
                    Delete
                  </Button>
                </form>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={setUserRole} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={u.id} />
              <label className="text-sm">Role:</label>
              <select
                name="role"
                defaultValue={u.role}
                className="border rounded px-2 py-1"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <Button type="submit" size="sm" variant="outline">
                Update role
              </Button>
            </form>

            <form action={resetPassword} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={u.id} />
              <Input
                name="password"
                type="password"
                placeholder="New password"
                className="max-w-xs"
              />
              <Button type="submit" size="sm" variant="outline">
                Reset password
              </Button>
            </form>

            <form action={setLinkedCharacters} className="space-y-2">
              <input type="hidden" name="userId" value={u.id} />
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Linked characters ({u.characters.length})
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 max-h-64 overflow-y-auto border rounded p-2">
                  {allCharacters.map((c) => {
                    const linked = u.characters.some(
                      (uc) => uc.targetId === c.targetId
                    );
                    return (
                      <label key={c.targetId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="characterTargetId"
                          value={c.targetId}
                          defaultChecked={linked}
                        />
                        <span>
                          {c.name}{' '}
                          <span className="text-xs text-muted-foreground">
                            ({c.targetId})
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </details>
              <Button type="submit" size="sm">
                Save linked characters
              </Button>
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
