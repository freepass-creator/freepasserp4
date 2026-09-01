const sa=JSON.parse((await import('node:fs')).readFileSync('tmp/firebase-auth/sa.json','utf8'));
const {JWT}=await import('google-auth-library');
const t=(await new JWT({email:sa.client_email,key:sa.private_key,scopes:['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email']}).getAccessToken()).token;
const prod=await import('../lib/domain/product');
const p=JSON.parse(await(await fetch(`https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app/v4/products.json?access_token=${t}`)).text())||{};
const S=(v:any)=>String(v??'').trim();
const rp012=(Object.values(p) as any[]).filter(x=>S(x.provider_company_code)==='RP012');
const byType:Record<string,number>={};
for(const x of rp012){const k=S(x.product_type)||'(빈)';byType[k]=(byType[k]||0)+1;}
console.log('손오공(RP012) 구분 분포:',JSON.stringify(byType));
const pk=rp012.filter(x=>S(x.product_type)==='픽업구독');
const listable=pk.filter(x=>prod.isListableProduct?.(x)).length;
const withprice=pk.filter(x=>x.price&&Object.keys(x.price).length).length;
const withphoto=pk.filter(x=>S(x.photo_link)).length;
console.log(`픽업구독 ERP ${pk.length}대 · 목록가능 ${listable} · 가격있음 ${withprice} · 사진있음 ${withphoto}`);
process.exit(0);
