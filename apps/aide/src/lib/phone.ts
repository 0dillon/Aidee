export function normalizePhone(raw:string):string {
  const digits=String(raw).replace(/[^\d+]/g,'');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}
