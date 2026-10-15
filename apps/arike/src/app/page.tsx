import Shop from './Shop';
import {products} from '@/lib/data';
export default async function Page(){const catalog=await products().catch(()=>[]);return <Shop products={catalog}/>;}
