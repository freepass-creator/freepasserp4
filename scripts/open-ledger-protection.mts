/**
 * **정산원장 탭 보호를 «회사 사람 전부»에게 연다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-02 「수정 권한을 직원들 다 부여해줘」
 *
 * ★★**막고 있던 것은 «공유 권한»이 아니라 «탭 보호»였다.**
 *   파일 공유는 이미 `teamjpk.com` 도메인 전체가 편집자였다. 그런데 탭 7개에 보호가 걸려 있고
 *   그 보호의 편집자 명단이 pyh·kjs 둘뿐이라, 태윤 매니저조차 청구·수금 체크를 못 눌렀다.
 *   ⇒ 보호는 «남기고»(외부 공유 대비) 편집자만 도메인 전체로 넓힌다.
 *
 * ⚠ **여기 적은 값은 다음 발행 때 덮인다.** 이 시트는 파이어베이스 원자에서 찍힌다.
 *   사람이 남겨야 하는 것(청구·수금 체크 · 환수 · 비고)은 원자에 반영해야 남는다.
 *
 *   npx tsx scripts/open-ledger-protection.mts
 *   npx tsx scripts/open-ledger-protection.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const LED='1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const APPLY=process.argv.includes('--apply');
const S=(v:unknown)=>String(v??'').trim();
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
const jwt=new JWT({email:sa.client_email,key:sa.private_key,subject:'pyh@teamjpk.com',scopes:['https://www.googleapis.com/auth/spreadsheets']});
const t=(await jwt.getAccessToken()).token;
const m=await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LED}?fields=sheets(properties(sheetId,title),protectedRanges)`,{headers:{Authorization:`Bearer ${t}`}})).json() as any;
const reqs:any[]=[];
for(const s of (m.sheets||[])) for(const pr of (s.protectedRanges||[])){
  console.log(`   ${S(s.properties.title).padEnd(12)} 지금 편집가능: ${(pr.editors?.users||[]).join(', ')||'(없음)'} → teamjpk.com 전원`);
  reqs.push({ updateProtectedRange: { protectedRange: { protectedRangeId: pr.protectedRangeId,
    editors: { users: pr.editors?.users||[], domainUsersCanEdit: true } }, fields: 'editors' } });
}
console.log(`\n보호 ${reqs.length}건`);
if(!APPLY){ console.log('※ dry-run — 아무것도 안 바꿨다. --apply 로 반영한다.\n'); process.exit(0); }
const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LED}:batchUpdate`,{method:'POST',
  headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({requests:reqs})});
console.log(r.ok?'   ✓ 반영했습니다':`   ✕ ${r.status} ${(await r.text()).slice(0,300)}`);
process.exit(0);
