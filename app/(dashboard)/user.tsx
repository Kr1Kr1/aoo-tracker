import { Button } from '@/components/ui/button';
import Image from 'next/image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getCallerContextFromCookies } from '@/lib/authContext';

async function setActingAs(formData: FormData) {
  'use server';
  const raw = formData.get('targetId');
  const cookieStore = await cookies();
  if (raw === '' || raw == null) {
    cookieStore.delete('acting-as');
  } else {
    cookieStore.set('acting-as', String(raw), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  redirect('/');
}

async function signOut() {
  'use server';
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
  cookieStore.delete('acting-as');
  redirect('/login');
}

export async function User() {
  const ctx = await getCallerContextFromCookies();
  const characters = ctx
    ? await prisma.characters.findMany({
        where: { targetId: { in: ctx.characterTargetIds } },
        select: { targetId: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];

  const activeName =
    ctx?.actingAsTargetId != null
      ? characters.find((c) => c.targetId === ctx.actingAsTargetId)?.name ?? `#${ctx.actingAsTargetId}`
      : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="overflow-hidden rounded-full">
          <Image
            src="/placeholder-user.jpg"
            width={36}
            height={36}
            alt="Avatar"
            className="overflow-hidden rounded-full"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {ctx?.username ?? 'My Account'}
          {ctx?.role === 'admin' && (
            <span className="ml-2 text-xs text-muted-foreground">(admin)</span>
          )}
        </DropdownMenuLabel>

        {ctx && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Acting as: {activeName ?? 'all my characters'}
            </DropdownMenuLabel>

            {ctx.actingAsTargetId != null && (
              <DropdownMenuItem asChild>
                <form action={setActingAs}>
                  <input type="hidden" name="targetId" value="" />
                  <button type="submit" className="w-full text-left">
                    ← Show all my characters
                  </button>
                </form>
              </DropdownMenuItem>
            )}

            {characters.map((c) => (
              <DropdownMenuItem key={c.targetId} asChild>
                <form action={setActingAs}>
                  <input type="hidden" name="targetId" value={c.targetId} />
                  <button
                    type="submit"
                    className={`w-full text-left ${
                      ctx.actingAsTargetId === c.targetId ? 'font-semibold' : ''
                    }`}
                  >
                    {c.name} ({c.targetId})
                  </button>
                </form>
              </DropdownMenuItem>
            ))}

            {characters.length === 0 && (
              <DropdownMenuItem disabled>No linked characters</DropdownMenuItem>
            )}
          </>
        )}

        {ctx?.role === 'admin' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin/users">Admin: Users</Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        {ctx ? (
          <DropdownMenuItem asChild>
            <form action={signOut}>
              <button type="submit" className="w-full text-left">Sign Out</button>
            </form>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href="/login">Sign In</Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
