import 'server-only';

const cache = new Map<string, {expires: number; value: PostcodeResult}>();
export type PostcodeResult = {valid: boolean; postcode: string; address_text?: string; state?: string; lga?: string};

export function normalizePostcode(input: string) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 11) return null; // EK(2) 01(2) A03(3) FK(2) 01(2): 11 symbols, 15 with separators.
  const chars = [...raw];
  const digitPositions = [2,3,5,6,9,10];
  const letters = new Set([0,1,4,7,8]);
  for (let i = 0; i < chars.length; i++) {
    if (digitPositions.includes(i)) chars[i] = ({O:'0',I:'1',L:'1',S:'5',B:'8'} as Record<string,string>)[chars[i]] ?? chars[i];
    else if (letters.has(i)) chars[i] = ({0:'O',1:'I',5:'S',8:'B'} as Record<string,string>)[chars[i]] ?? chars[i];
  }
  const compact = chars.join('');
  if (!/^[A-Z]{2}\d{2}[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(compact)) return null;
  return `${compact.slice(0,2)}-${compact.slice(2,4)}-${compact.slice(4,7)}-${compact.slice(7,9)}-${compact.slice(9)}`;
}

export async function lookupPostcode(input: string): Promise<PostcodeResult> {
  const postcode = normalizePostcode(input);
  if (!postcode) return {valid:false,postcode:input};
  const cached = cache.get(postcode);
  if (cached && cached.expires > Date.now()) return cached.value;
  const key = process.env.NIPOST_API_KEY;
  if (!key) throw new Error('Postcode lookup is not configured');
  const response = await fetch(`https://api.postcode.gov.ng/v1/lookup?code=${encodeURIComponent(postcode)}&level=1`, {
    headers: {'X-API-Key':key}, signal: AbortSignal.timeout(7000), cache:'no-store'
  });
  if (!response.ok) return {valid:false,postcode};
  const payload = await response.json();
  const item = payload.data;
  const result: PostcodeResult = item?.valid ? {
    valid:true, postcode, state:item.administrative_address?.state_name,
    lga:item.administrative_address?.lga_name,
    address_text:[item.recent_house_address?.recent,item.administrative_address?.lga_name,item.administrative_address?.state_name].filter(Boolean).join(', ')
  } : {valid:false,postcode};
  cache.set(postcode,{expires:Date.now()+3600000,value:result});
  return result;
}
