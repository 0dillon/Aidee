const url = process.env.AIDE_PUBLIC_URL || 'http://localhost:3000';
const secret = process.env.TRIGGER_WORKER_SECRET;
if (!secret) throw new Error('TRIGGER_WORKER_SECRET is required');
while (true) {
  try {
    const result=await fetch(`${url.replace(/\/$/,'')}/api/worker/tick`,{method:'POST',headers:{Authorization:`Bearer ${secret}`}});
    if (!result.ok) console.error('Worker tick failed:',result.status,await result.text());
  } catch(error) {console.error('Worker tick failed:',error);}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
