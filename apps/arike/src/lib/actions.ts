import {createAccount,createOrder,product,products,query} from '@/lib/data';

export type ActionResult = {status:number;body:unknown};
const ok = (body:unknown):ActionResult => ({status:200,body});
const fail = (status:number,error:string):ActionResult => ({status,body:{error}});

export async function runAction(name:string, args:Record<string,any>):Promise<ActionResult> {
  try {
    switch (name) {
      case 'create_account': return ok(await createAccount(args.full_name,args.phone));
      case 'search_products': {
        const term = String(args.query || '').toLowerCase();
        const matches = (await products()).filter(p => (`${p.name} ${p.description} ${p.material}`).toLowerCase().includes(term)
          && (!args.size || (p.sizes[args.size] ?? 0) > 0) && (!args.max_price || p.price_naira <= Number(args.max_price))).slice(0,5);
        return ok({products:matches.map(p=>({id:p.id,name:p.name,price:p.price_naira,material:p.material,sizes_in_stock:Object.keys(p.sizes).filter(s=>p.sizes[s]>0)}))});
      }
      case 'get_product': {
        const found = await product(args.product_id);
        return found ? ok(found) : fail(404,'Product not found');
      }
      case 'get_delivery_estimate': {
        const found = await product(args.product_id);
        if (!found) return fail(404,'Product not found');
        const date = new Date(Date.now()+found.delivery_days*86400000).toISOString().slice(0,10);
        return ok({days:found.delivery_days,date_range:{from:date,to:date}});
      }
      case 'create_order': return ok(await createOrder(args as Parameters<typeof createOrder>[0]));
      case 'get_order': {
        const rows = await query<Record<string,unknown>[]>('arike_orders',{query:`id=eq.${encodeURIComponent(args.order_id)}&select=*`});
        return rows[0] ? ok(rows[0]) : fail(404,'Order not found');
      }
      default: return fail(404,'Unknown action');
    }
  } catch (error) { return fail(400,error instanceof Error ? error.message : 'Action failed'); }
}
