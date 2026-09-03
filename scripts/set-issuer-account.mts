/** 우리 법인 입금계좌를 v4 오버레이에 박는다. 기본 dry-run, 반영은 --apply */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
const APPLY=process.argv.includes('--apply');
const S=(v:unknown)=>String(v??'').trim();
const sa=JSON.parse(readFileSync('tmp/firebase-auth/sa.json','utf8'));
if(!getApps().length) initializeApp({credential:cert(sa),databaseURL:'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app'});
const db=getDatabase();
/** ★통장사본에서 «눈으로 읽어» 확인한 값이다(2026-09-03, 신한은행 기업자유예금). 지어내지 않았다. */
const acct={ bank_name:'신한', bank_account:'140-014-462206', bank_holder:'프리패스모빌리티 주식회사' };
const before=(await db.ref('v4/partners/OP001').get()).val()||{};
const v3=(await db.ref('partners/OP001').get()).val()||{};
console.log('지금 v3/OP001 :', JSON.stringify({name:S(v3.partner_name||v3.name),bank:S(v3.bank_name),acct:S(v3.bank_account)}));
console.log('지금 v4/OP001 :', JSON.stringify(before));
console.log('넣을 값       :', JSON.stringify(acct));
if(!APPLY){ console.log('\n※ dry-run — 안 썼다. --apply 로 반영한다.\n'); process.exit(0); }
await db.ref('v4/partners/OP001').update({ ...acct, updatedAt: Date.now(), by: 'settlement-account' });
const back=(await db.ref('v4/partners/OP001').get()).val()||{};
console.log('\n✓ 넣었다 —', JSON.stringify({bank:S(back.bank_name),acct:S(back.bank_account),holder:S(back.bank_holder)}));
process.exit(0);
