/**
 * **그 사람이 정산원장을 «정말» 고칠 수 있나** — 계정으로 직접 들어가 재 본다. 읽기만.
 *
 * ★사장님 2026-09-02 「우리 멤버들 수정을 못한다는데 왜그러지??」
 *
 * ★★**「공유했다」와 「고칠 수 있다」는 다른 말이다.** 파일은 공유돼 있어도 탭 보호에 막히면
 *   구글은 「이 셀은 보호되어 있습니다」만 띄우고 «권한이 없다»고는 말하지 않는다.
 *   그래서 쓰는 사람 눈에는 그냥 「수정이 안 된다」로 보인다.
 *   ⇒ 짐작하지 말고 «그 계정으로» 들어가 `requestingUserCanEdit` 을 읽는다.
 *
 *   npx tsx scripts/check-ledger-access.mts pty@teamjpk.com
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const LED='1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const S=(v:unknown)=>String(v??'').trim();
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
const who=process.argv[2]||'pty@teamjpk.com';
let t='';
try{ t=(await new JWT({email:sa.client_email,key:sa.private_key,subject:who,scopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive']}).getAccessToken()).token as string; }
catch(e:any){ console.log(`✕ ${who} — 계정으로 못 들어감: ${S(e?.message).slice(0,120)}`); process.exit(0); }
const f=await (await fetch(`https://www.googleapis.com/drive/v3/files/${LED}?fields=name,capabilities(canEdit,canModifyContent)&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${t}`}})).json() as any;
console.log(`■ ${who}`);
console.log(`   파일 열람 : ${S(f.name)||'✕ 못 봄'}`);
console.log(`   파일 편집 가능(canEdit) : ${f.capabilities?.canEdit}`);
const m=await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LED}?fields=sheets(properties(title),protectedRanges(requestingUserCanEdit,editors))`,{headers:{Authorization:`Bearer ${t}`}})).json() as any;
console.log('   탭 보호 — 이 사람이 고칠 수 있나');
for(const s of (m.sheets||[])) for(const pr of (s.protectedRanges||[]))
  console.log(`      ${S(s.properties.title).padEnd(12)} ${pr.requestingUserCanEdit===true?'○ 고칠 수 있다':'✕ 막힘'}`);
process.exit(0);
