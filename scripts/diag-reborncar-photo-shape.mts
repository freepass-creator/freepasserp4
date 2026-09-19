const BASE = 'https://www.reborncar.co.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const S = (v: unknown) => String(v ?? '').trim();
const form = (o: Record<string, unknown>) => Object.entries(o).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');

async function bootstrap(pageUrl: string) {
  const res = await fetch(pageUrl, { headers: { 'User-Agent': UA } });
  const cookie = ((res.headers as any).getSetCookie?.() || []).map((c:string)=>c.split(';')[0]).join('; ');
  const html = await res.text();
  const token = (html.match(/RB_TOKEN\s*=\s*"([^"]+)"/) || [])[1] || '';
  const csrf = (html.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || '';
  if (!token || !csrf) throw new Error('bootstrap failed');
  return {cookie, token, csrf};
}
async function call(ctx:any, ep:string, obj:Record<string,unknown>, referer:string) {
  const r = await fetch(`${BASE}/api/v1/car/${ep}`, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Ajax-call':'true',Authorization:ctx.token,'X-CSRF-TOKEN':ctx.csrf,Cookie:ctx.cookie,'User-Agent':UA,Referer:referer},
    body:form(obj)
  });
  const t=await r.text();
  return JSON.parse(t);
}
const xml=await (await fetch(`${BASE}/sitemap-ext.xml`,{headers:{'User-Agent':UA}})).text();
const urls=[...new Set((xml.match(/<loc>([^<]+)<\/loc>/g)||[]).map(m=>m.replace(/<\/?loc>/g,'')))].filter(u=>/\/rent\/[A-Z]{2}\d+\/C\d{11}/.test(u));
let shown=0;
for(const url of urls){
  const productId=(url.match(/C\d{11}/)||[])[0];
  if(!productId) continue;
  try{
    const ctx=await bootstrap(url);
    const d=await call(ctx,'getRentCarDetail.rb',{productId},url);
    if(!d?.data) continue;
    const detail=d.data as Record<string,unknown>;
    const keys=Object.keys(detail).filter(k=>/image|img|photo|pic|file|thumb/i.test(k));
    const shape:Record<string,unknown>={};
    for(const k of keys){
      const v=detail[k];
      shape[k]=Array.isArray(v)?{type:'array',length:v.length,sample:v.slice(0,3)}:
        (v && typeof v==='object'?{type:'object',keys:Object.keys(v as object).slice(0,30)}:S(v).slice(0,300));
    }
    console.log(JSON.stringify({productId,url,carNumber:detail.carNumber,photoKeys:keys,shape},null,2));
    shown++;
    if(shown>=3) break;
  }catch(e){console.error('ERR',productId,String(e).slice(0,120));}
}
if(!shown) process.exit(2);


/* 상세 페이지/JS에서 갤러리 API 후보를 읽기 전용 탐색 */
{
  const firstUrl = urls[0];
  if (firstUrl) {
    const html = await (await fetch(firstUrl,{headers:{'User-Agent':UA}})).text();
    const scripts=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]);
    const abs=(u:string)=>{try{return new URL(u,BASE).toString()}catch{return ''}};
    const found=new Set<string>();
    const scan=(text:string)=>{
      for(const m of text.matchAll(/(?:\/api\/v1\/car\/)?[A-Za-z0-9_-]*(?:image|img|photo|pic|gallery|detail|car)[A-Za-z0-9_-]*\.rb/gi)) found.add(m[0]);
      for(const m of text.matchAll(/\/api\/v1\/car\/[A-Za-z0-9_-]+\.rb/gi)) found.add(m[0]);
    };
    scan(html);
    for(const src of scripts.slice(0,80)){
      const u=abs(src); if(!u) continue;
      try{ const t=await (await fetch(u,{headers:{'User-Agent':UA}})).text(); scan(t); }catch{}
    }
    console.log('GALLERY_ENDPOINT_CANDIDATES',JSON.stringify([...found].sort(),null,2));
  }
}
