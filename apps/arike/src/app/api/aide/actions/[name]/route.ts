import { NextRequest, NextResponse } from 'next/server';
import {createAccount,createOrder,product,products,query,verifyAideKey} from '@/lib/data';

export async function POST(request:NextRequest, context:{params:Promise<{name:string}>}) {
  if (!verifyAideKey(request.headers.get('X-Aide-Key'))) return NextResponse.json({error:'Unauthorized'},{status:401});
  try {
    const {name} = await context.params;
    const args = await request.json();
    switch (name) {
      case 'create_account': return NextResponse.json(await createAccount(args.full_name,args.phone));
      case 'search_products': {
        const term = String(args.query || '').toLowerCase();
        const matches = (await products()).filter(p => (`${p.name} ${p.description} ${p.material}`).toLowerCase().includes(term)
          && (!args.size || (p.sizes[args.size] ?? 0) > 0) && (!args.max_price || p.price_naira <= Number(args.max_price))).slice(0,5);
        return NextResponse.json({products:matches.map(p=>({id:p.id,name:p.name,price:p.price_naira,material:p.material,sizes_in_stock:Object.keys(p.sizes).filter(s=>p.sizes[s]>0)}))});
      }
      case 'get_product': {
        const found = await product(args.product_id);
        return found ? NextResponse.json(found) : NextResponse.json({error:'Product not found'},{status:404});
      }
      case 'get_delivery_estimate': {
        const found = await product(args.product_id);
        if (!found) return NextResponse.json({error:'Product not found'},{status:404});
        const date = new Date(Date.now()+found.delivery_days*86400000).toISOString().slice(0,10);
        return NextResponse.json({days:found.delivery_days,date_range:{from:date,to:date}});
      }
      case 'create_order': return NextResponse.json(await createOrder(args));
      case 'get_order': {
        const rows = await query<Record<string,unknown>[]>('arike_orders',{query:`id=eq.${encodeURIComponent(args.order_id)}&select=*`});
        return rows[0] ? NextResponse.json(rows[0]) : NextResponse.json({error:'Order not found'},{status:404});
      }
      default: return NextResponse.json({error:'Unknown action'},{status:404});
    }
  } catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Action failed'},{status:400}); }
}
