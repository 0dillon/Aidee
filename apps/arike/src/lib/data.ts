import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const base = () => process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function query<T>(table: string, options: {method?: string; query?: string; body?: unknown; prefer?: string} = {}): Promise<T> {
  if (!base() || !key()) throw new Error('Arike database is not configured');
  const response = await fetch(`${base()}/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, {
    method: options.method ?? 'GET',
    headers: {apikey:key()!, Authorization:`Bearer ${key()}`, 'Content-Type':'application/json', Prefer:options.prefer ?? 'return=representation'},
    body: options.body === undefined ? undefined : JSON.stringify(options.body), cache:'no-store'
  });
  if (!response.ok) throw new Error(`Arike ${table}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export type ProductImage = {url:string; alt:string; type:string};
export type Product = {
  id:string; slug:string; name:string; category:string; gender:string; collection:string;
  price:number; currency:'NGN'; description:string; short_description:string; material:string;
  composition:string; care:string; colour:string; colour_hex:string; images:ProductImage[];
  sizes:string[]; stock_by_size:Record<string,number>; delivery_days:number; preorder:boolean;
  featured:boolean; new_arrival:boolean; bestseller:boolean; fit:string; model_info:string;
  style_notes:string; created_at:string;
  price_naira:number; image_url:string|null; sizes_legacy:Record<string,number>;
};
export type Customer = {id:string; full_name:string; phone:string};

type ProductRow = Omit<Product,'price_naira'|'image_url'|'sizes_legacy'|'collection'|'sizes'> & {
  collection_id:string; price_naira?:number; image_url?:string|null; sizes?:Record<string,number>;
};

function normalizeProduct(row:ProductRow):Product {
  const stock = row.stock_by_size ?? row.sizes ?? {};
  const images = row.images?.length ? row.images : row.image_url ? [{url:row.image_url,alt:`${row.name} in ${row.colour}`,type:'primary'}] : [];
  const price = row.price ?? row.price_naira ?? 0;
  return {...row,collection:row.collection_id,price,currency:row.currency ?? 'NGN',images,
    sizes:Object.keys(stock),stock_by_size:stock,price_naira:price,image_url:images[0]?.url ?? null,sizes_legacy:stock};
}

export async function products(): Promise<Product[]> {
  const rows = await query<ProductRow[]>('arike_products',{query:'select=*&order=name.asc'});
  return rows.map(normalizeProduct);
}
export async function product(id: string): Promise<Product|null> {
  const rows = await query<ProductRow[]>('arike_products',{query:`id=eq.${encodeURIComponent(id)}&select=*`});
  return rows[0] ? normalizeProduct(rows[0]) : null;
}
export async function productBySlug(slug: string): Promise<Product|null> {
  const rows = await query<ProductRow[]>('arike_products',{query:`slug=eq.${encodeURIComponent(slug)}&select=*`});
  return rows[0] ? normalizeProduct(rows[0]) : null;
}
export async function findCustomer(id: string): Promise<Customer|null> {
  const rows = await query<Customer[]>('arike_customers',{query:`id=eq.${encodeURIComponent(id)}&select=*`});
  return rows[0] ?? null;
}

export function normalizePhone(input:string) {
  const digits = input.replace(/\D/g,'');
  const phone = digits.startsWith('234') ? `+${digits}` : digits.startsWith('0') ? `+234${digits.slice(1)}` : `+234${digits}`;
  if (!/^\+234(?:70|80|81|90|91)\d{8}$/.test(phone)) throw new Error('Enter a valid Nigerian mobile number');
  return phone;
}

export async function createAccount(full_name:string, phoneInput:string) {
  const phone = normalizePhone(phoneInput);
  if (full_name.trim().length < 3) throw new Error('Please provide your full name');
  const rows = await query<Customer[]>('arike_customers',{
    method:'POST',query:'on_conflict=phone',prefer:'resolution=merge-duplicates,return=representation',
    body:{full_name:full_name.trim(),phone,created_via:'voice'}
  });
  return {customer_id:rows[0].id,name:rows[0].full_name,phone:rows[0].phone};
}

export async function createOrder(input: {customer_id:string; items:{product_id:string;size:string;qty:number}[]; postcode?:string; address_text:string; payment_method:string; address_needs_review?:boolean}) {
  if (input.payment_method !== 'pay_on_delivery') throw new Error('Only pay on delivery is available');
  if (!input.address_text?.trim()) throw new Error('Please provide a delivery address');
  const customer = await findCustomer(input.customer_id);
  if (!customer) throw new Error('Customer account not found');
  if (!Array.isArray(input.items) || input.items.length < 1) throw new Error('Choose at least one item');
  let total = 0; let maxDays = 0;
  const items = [];
  for (const line of input.items) {
    const item = await product(line.product_id);
    if (!item || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 10 || (item.stock_by_size[line.size] ?? 0) < line.qty) throw new Error('Product, size, or quantity unavailable');
    total += item.price * line.qty;
    maxDays = Math.max(maxDays,item.delivery_days);
    items.push({product_id:item.id,name:item.name,size:line.size,qty:line.qty,price:item.price,currency:item.currency});
  }
  const delivery = new Date(Date.now()+(maxDays+2)*86400000).toISOString().slice(0,10);
  const orderId = `ARK-${randomUUID().slice(0,8).toUpperCase()}`;
  await query('arike_orders',{method:'POST',body:{id:orderId,customer_id:customer.id,items,postcode:input.postcode || null,
    address_text:input.address_text.trim(),address_needs_review:!!input.address_needs_review,
    payment_method:'pay_on_delivery',total_naira:total,estimated_delivery:delivery,created_via:'voice'}});
  const payload = {type:'order.placed',business_id:process.env.AIDE_BUSINESS_ID,occurred_at:new Date().toISOString(),
    customer:{external_id:customer.id,name:customer.full_name,phone:customer.phone},
    order:{id:orderId,items,total,estimated_delivery:delivery}};
  const destination = process.env.AIDE_EVENTS_URL;
  const secret = process.env.AIDE_SHARED_SECRET;
  if (destination && secret && payload.business_id) {
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256',secret).update(raw).digest('hex');
    try { await fetch(destination,{method:'POST',headers:{'Content-Type':'application/json','X-Aide-Signature':`sha256=${signature}`},body:raw,signal:AbortSignal.timeout(7000)}); }
    catch (error) { console.error('Aide event delivery failed',error); }
  }
  return {order_id:orderId,total,estimated_delivery:delivery};
}

export function verifyAideKey(supplied:string|null) {
  const expected = process.env.AIDE_SHARED_SECRET;
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
}
