/**
 * **ERP 거래 데이터를 이력 파일로 남긴다.** 읽기 전용 — 아무것도 지우지 않는다.
 *
 * ★사장님 2026-08-23 「실계약 다 없애 **이력에 남기든가** 하고」 · 「회원, 파트너사 빼고는 완전 리셋하자」
 *   리셋 «전에» 무엇이 있었는지 남겨 두는 자리다. 이 파일들이 되돌릴 유일한 근거다.
 *
 *   · 계약은 **사람이 읽는 CSV** 로 (누가·무슨 차·얼마·언제·어떤 상태)
 *   · 나머지는 **JSON 원본 그대로**
 *
 *   npx tsx scripts/archive-erp-transactions.mts          # 무엇이 담기는지 보기만
 *   npx tsx scripts/archive-erp-transactions.mts --write  # 파일로 저장
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { JWT } from 'google-auth-library';

const WRITE = process.argv.includes('--write');
const S = (v: unknown) => String(v ?? '').trim();
const stampArg = process.argv.find((a) => a.startsWith('--stamp='));
const STAMP = stampArg ? stampArg.slice('--stamp='.length) : new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT_DIR = join('D:', 'backup', 'freepasserp4-rtdb', `리셋이력-${STAMP}`);

/** 이력으로 남길 거래 노드 — 리셋 대상과 같은 목록이다. */
const NODES = [
  'v4/products', 'v4/products_private', 'products', 'product_code_aliases',
  'v4/contracts', 'contracts', 'contract_sign',
  'v4/rooms', 'rooms', 'v4/messages', 'messages',
  'v4/settlements', 'settlements', 'v4/admin_settlements',
  'v4/settlements_admin_private', 'v4/settlements_agent_private', 'v4/settlements_provider_private',
  'v4/esign_events', 'v4/esign_issue_claims', 'v4/esign_private', 'v4/esign_sessions', 'v4/esign_verifications',
  'v4/sheet_conflict_resolutions', 'v4/sheet_sync_backups', 'v4/sheet_sync_runs',
  'v4/customers', 'customers',
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const tok = (await jwt.getAccessToken()).token;
const get = async (p: string) => (await (await fetch(`${DB}/${p}.json?access_token=${tok}`)).json()) as Record<string, any> | null;

/** 사람이 읽을 계약 이력 — 한 줄에 «누가·무슨 차·얼마·언제·어떤 상태». */
function toCsv(rows: [string, any][]): string {
  const cols = ['계약코드', '상태', '고객명', '연락처', '차량번호', '차명', '공급사', '영업자', '월대여료', '보증금', '기간(개월)', '만든때', '고친때'];
  const pick = (c: any, keys: string[]) => { for (const k of keys) if (S(c[k])) return S(c[k]); return ''; };
  const when = (v: unknown) => { const n = Number(v); return n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString().slice(0, 19).replace('T', ' ') : S(v); };
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = [cols.join(',')];
  for (const [key, c] of rows) {
    out.push([
      key, pick(c, ['status', 'contract_status']),
      pick(c, ['customer_name', 'customer', 'customer_name_snapshot']), pick(c, ['customer_phone', 'phone']),
      pick(c, ['car_number', 'car_number_snapshot']), pick(c, ['vehicle_name_snapshot', 'vehicle_name', 'product_name']),
      pick(c, ['provider_company_code', 'provider']), pick(c, ['agent_name', 'agent_company_code', 'agent']),
      pick(c, ['monthly_rent_snapshot', 'monthly_rent', 'rent']), pick(c, ['deposit_amount_snapshot', 'deposit', 'deposit_amount']),
      pick(c, ['term_months', 'months', 'period']),
      when(pick(c, ['created_at', 'createdAt'])), when(pick(c, ['updated_at', 'updatedAt'])),
    ].map((v) => esc(S(v))).join(','));
  }
  return out.join('\n');
}

console.log('■ ERP 거래 데이터 이력 남기기 (읽기 전용)\n');
const data = new Map<string, Record<string, any>>();
for (const node of NODES) {
  const v = await get(node);
  const n = v && typeof v === 'object' ? Object.keys(v).length : 0;
  if (!n) continue;
  data.set(node, v as Record<string, any>);
  console.log(`  ${node.padEnd(38)} ${String(n).padStart(6)}건`);
}
const total = [...data.values()].reduce((a, v) => a + Object.keys(v).length, 0);
console.log(`  ${'합계'.padEnd(38)} ${String(total).padStart(6)}건`);

if (!WRITE) {
  console.log(`\n  (미리보기다 — 파일로 남기려면 --write)\n  저장 위치: ${OUT_DIR}`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const wrote: string[] = [];
const save = (name: string, body: string) => {
  writeFileSync(join(OUT_DIR, name), body, 'utf8');
  wrote.push(`${name} (${Math.round(body.length / 1024)}KB)`);
};
// CSV 는 엑셀이 한글을 안 깨뜨리게 BOM 을 붙인다.
if (data.has('v4/contracts')) save('계약이력-v4.csv', '﻿' + toCsv(Object.entries(data.get('v4/contracts')!)));
if (data.has('contracts')) save('계약이력-v3.csv', '﻿' + toCsv(Object.entries(data.get('contracts')!)));
for (const [node, v] of data) save(`${node.replace(/\//g, '_')}.json`, JSON.stringify(v, null, 2));

console.log(`\n  ✓ ${OUT_DIR}`);
wrote.forEach((w) => console.log(`     ${w}`));
console.log('\n  이 파일들이 되돌릴 유일한 근거다. 지우지 마라.');
