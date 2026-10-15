const hits = new Map<string, number[]>();

export function guard(request:Request, limit=60, windowMs=60_000):Response|null {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) return Response.json({error:'Forbidden'},{status:403});
  const ip = request.headers.get('x-forwarded-for') || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(time => now - time < windowMs);
  if (recent.length >= limit) return Response.json({error:'Too many requests. Please wait a moment.'},{status:429});
  hits.set(ip,[...recent,now]);
  return null;
}
