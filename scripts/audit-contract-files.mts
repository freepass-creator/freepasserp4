/**
 * **계약 완료 건 ↔ 데이터센터 「C1_계약서」 파일 정합성(읽기 전용).**
 *
 * ★사장님 2026-08-25 「계약완료된거는 계약서가 있을거니까 정합성 확인하고」.
 *
 * ★실측 2026-08-25 — 회사별 C1_계약서 8곳에 파일 5,948개.
 *   그중 **이름에 차번이 있는 것은 2,906개**뿐이다(나머지 3,042개는 KakaoTalk_*.jpg ·
 *   S36C-*.pdf(스캔) · *.zip · 「미정」처럼 번호가 아직 없던 계약).
 *   ⇒ **«파일이 없다»와 «이름으로 못 찾는다»는 다른 말이다.** 이 도구는 뒤엣것만 잴 수 있다.
 *     파일을 열어 보지 않고 이름만 본다 — 그게 이 도구의 한계이고, 그래서 숫자를 그렇게 읽어야 한다.
 *
 * ★차번은 파일명 **어디에 있든** 찾는다. 데이터센터 규칙은 「차량번호_날짜_계약서.pdf」 인데
 *   실제 이름은 「240816 김명호 스포티지 109하6942 골드타워.pdf」 꼴이 많다.
 *   규칙을 못 지킨 이름도 **차번만 들어 있으면 잇는다** — 이름을 고치는 건 다음 일이다.
 *
 *   npx tsx scripts/audit-contract-files.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB } from '../lib/domain/settlement-ledger';
const DRIVE='0ALp5cUm1kqTvUk9PVA';
const S=(v:unknown)=>String(v??'').trim();
const plate=(v:unknown)=>S(v).replace(/\s/g,'');
const sleep=(ms:number)=>new Promise(ok=>setTimeout(ok,ms));
const sa=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS||'tmp/firebase-auth/sa.json','utf8'));
const jwt=new JWT({email:sa.client_email,key:sa.private_key,subject:'pyh@teamjpk.com',scopes:['https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/spreadsheets']});
const call=async(u:string):Promise<any>=>{for(let n=0;;n++){const t=(await jwt.getAccessToken()).token;const r=await fetch(u,{headers:{Authorization:`Bearer ${t}`}});const x=await r.text();if(r.ok)return JSON.parse(x);if((r.status===429||r.status>=500)&&n<5){await sleep(20000*(n+1));continue;}throw new Error(`${r.status} ${x.slice(0,140)}`);}};

// ── 계약서 폴더 찾기
const folders=await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name contains 'C1_계약서' and trashed=false")}&fields=files(id,name,parents)&pageSize=50&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=drive&driveId=${DRIVE}`);
console.log(`■ C1_계약서 폴더 ${(folders.files||[]).length}개`);
const files:any[]=[];
for (const f of (folders.files||[])) {
  let parentName='';
  try { const up=await call(`https://www.googleapis.com/drive/v3/files/${f.parents?.[0]}?fields=name,parents&supportsAllDrives=true`);
        const up2=await call(`https://www.googleapis.com/drive/v3/files/${up.parents?.[0]}?fields=name&supportsAllDrives=true`);
        parentName=`${S(up2.name)}/${S(up.name)}`; } catch {}
  let page='', n=0;
  do {
    const r=await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${f.id}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=drive&driveId=${DRIVE}${page?`&pageToken=${page}`:''}`);
    for (const x of (r.files||[])) { files.push(x); n++; }
    page=r.nextPageToken||'';
  } while (page);
  console.log(`   ${parentName}/${S(f.name)} — 파일 ${n}`);
}
// ── 파일명에서 차번 뽑기
const PLATE=/(\d{2,3}[가-힣]\d{4})/;
const have=new Set<string>();
for (const f of files) { const m=PLATE.exec(S(f.name).replace(/\s/g,'')); if(m) have.add(m[1]); }
console.log(`   파일 ${files.length}개에서 알아낸 차번 ${have.size}개\n`);

// ── 원장 계약 완료
const want=new Map<string,string>();
for (const tab of [SETTLEMENT_CURRENT_TAB,SETTLEMENT_PAST_TAB]) {
  const v=await call(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${tab}'!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows=((v.values||[]) as any[][]).map(r=>(r||[]).map(S)); const h=rows[0]||[];
  const ip=h.indexOf('차량번호'), is=h.indexOf('상태');
  for (const r of rows.slice(1)) { const p=plate(r[ip]); const st=S(r[is]); if(!p) continue; if(/계약 완료|계약서 업로드/.test(st)) want.set(p,st); }
}
const missing=[...want].filter(([p])=>!have.has(p));
console.log(`■ 정합성 — 계약서가 있어야 할 차 ${want.size}대 (계약 완료·계약서 업로드)`);
console.log(`   파일 있음 ${want.size-missing.length} · **없음 ${missing.length}**`);
console.log(`   원장에 없는데 파일만 있는 차 ${[...have].filter(p=>!want.has(p)).length}`);
console.log('\n  ── 없는 차 앞 15');
for (const [p,st] of missing.slice(0,15)) console.log(`     ${p.padEnd(11)} ${st}`);
writeFileSync('tmp/contract-parity.json',JSON.stringify({want:[...want],have:[...have],missing},null,2));
