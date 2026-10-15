import 'server-only';
import { cookies } from 'next/headers';

export async function requireUser() {
  const cookie = (await cookies()).get('aide_session')?.value;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!cookie || !base || !anon) throw new Error('Unauthorized');
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: {apikey: anon, Authorization: `Bearer ${cookie}`}, cache: 'no-store'
  });
  if (!response.ok) throw new Error('Unauthorized');
  return response.json() as Promise<{id: string; email: string}>;
}

export async function guarded<T>(operation: () => Promise<T>) {
  try { await requireUser(); return await operation(); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    return Response.json({error: message}, {status: message === 'Unauthorized' ? 401 : 500}) as T;
  }
}
