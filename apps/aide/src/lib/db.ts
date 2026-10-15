import 'server-only';

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function db<T = Record<string, unknown>>(table: string, options: {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; query?: string; body?: unknown;
  one?: boolean; prefer?: string;
} = {}): Promise<T> {
  if (!url() || !key()) throw new Error('Supabase is not configured');
  const response = await fetch(`${url()}/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: key()!, Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer ?? (options.method === 'POST' || options.method === 'PATCH' ? 'return=representation' : ''),
      ...(options.one ? {Accept: 'application/vnd.pgrst.object+json'} : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Database ${table}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export const filter = (value: string) => encodeURIComponent(value);
