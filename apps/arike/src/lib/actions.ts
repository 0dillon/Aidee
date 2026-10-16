import {createAccount,createOrder,product,products,query} from '@/lib/data';

export type ActionResult = {status:number;body:unknown};
const ok = (body:unknown):ActionResult => ({status:200,body});
const fail = (status:number,error:string):ActionResult => ({status,body:{error}});

function addWorkingDays(start:Date, days:number) {
  const date = new Date(start);
  while (days > 0) {
    date.setDate(date.getDate()+1);
    if (date.getDay() !== 0 && date.getDay() !== 6) days--;
  }
  return date.toISOString().slice(0,10);
}

export async function runAction(name:string, args:Record<string,any>):Promise<ActionResult> {
  try {
    name = name.replaceAll('-','_');
    switch (name) {
      case 'create_account': return ok(await createAccount(args.full_name,args.phone));
      case 'search_products': {
        const term = String(args.query || '').toLowerCase();
        const matches = (await products()).filter(p => (`${p.name} ${p.category} ${p.gender} ${p.description} ${p.material} ${p.composition} ${p.colour} ${p.collection}`).toLowerCase().includes(term)
          && (!args.size || (p.stock_by_size[String(args.size).toUpperCase()] ?? 0) > 0)
          && (args.max_price === undefined || p.price <= Number(args.max_price))).slice(0,5);
        return ok(matches.map(p=>({id:p.id,name:p.name,price:p.price,currency:p.currency,material:p.composition || p.material,
          colour:p.colour,sizes_in_stock:Object.keys(p.stock_by_size).filter(size=>p.stock_by_size[size]>0),delivery_days:p.delivery_days})));
      }
      case 'get_product': {
        const found = await product(args.product_id);
        return found ? ok({id:found.id,name:found.name,price:found.price,currency:found.currency,description:found.description,
          material:found.material,composition:found.composition,care:found.care,colour:found.colour,sizes:found.sizes,
          stock_by_size:found.stock_by_size,delivery_days:found.delivery_days,preorder:found.preorder,fit:found.fit}) : fail(404,'Product not found');
      }
      case 'get_delivery_estimate': {
        const found = await product(args.product_id);
        if (!found) return fail(404,'Product not found');
        const earliest = addWorkingDays(new Date(),found.delivery_days+1);
        const latest = addWorkingDays(new Date(),found.delivery_days+2);
        return ok({days:found.delivery_days,earliest_date:earliest,latest_date:latest,
          message:`${found.delivery_days} working days preparation, then 1-2 delivery days in Lagos. Outside Lagos may take an additional 2-4 working days.`});
      }
      case 'create_order': return ok(await createOrder(args as Parameters<typeof createOrder>[0]));
      case 'get_order': {
        const rows = await query<Record<string,unknown>[]>('arike_orders',{query:`id=eq.${encodeURIComponent(args.order_id)}&select=*`});
        const order = rows[0];
        return order ? ok({order_id:order.id,status:order.status,items:order.items,total:order.total_naira,currency:'NGN',
          estimated_delivery:{earliest:order.estimated_delivery,latest:order.estimated_delivery}}) : fail(404,'Order not found');
      }
      default: return fail(404,'Unknown action');
    }
  } catch (error) { return fail(400,error instanceof Error ? error.message : 'Action failed'); }
}
