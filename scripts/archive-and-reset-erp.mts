/**
 * **ERP 재고·계약을 «현재 기준»으로 리셋한다 — 계약은 이력으로 남기고 지운다.**
 *
 * ★사장님 2026-08-23 「현재 재고랑 계약이랑 다 리셋 다 없애고 재고 반영하는 거 현재 기준으로 해 보자」
 *   · 「**실계약 다 없애 이력에 남기든가 하고**」
 *
 * ⚠ **되돌릴 수 없는 작업이다.** 돌리기 전에 반드시:
 *     npx tsx scripts/deploy/rtdb-backup.mts export
 *   이 스크립트도 지우기 전에 계약을 CSV·JSON 으로 한 번 더 남긴다(이력).
 *
 * 하는 일 (차례대로)
 *   ① 계약(v4/contracts · contracts)을 **이력 파일**로 뽑는다 — CSV(사람이 읽는 것) + JSON(원본 그대로)
 *   ② 계약을 지운다
 *   ③ 재고(v4/products)를 지운다
 *   ④ 재유입은 **이 스크립트가 안 한다** — 끝난 뒤 판매시트 동기를 따로 돌린다(아래 안내).
 *
 * ⚠ `v4/rooms`(대화)·`v4/settlements`(정산)는 **안 지운다.** 사장님 지시에 없었고,
 *   지우면 되돌릴 수 없는 대화 기록까지 사라진다. 필요하면 따로 지시받고 지운다.
 *
 *   npx tsx scripts/archive-and-reset-erp.mts            # 무엇이 지워지는지 보기만
 *   npx tsx scripts/archive-and-reset-erp.mts --apply    # 이력 남기고 지우기
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const stampArg = process.argv.find((a) => a.startsWith('--stamp='));
// 날짜는 인자로 받는다 — 스크립트가 «오늘»을 스스로 정하면 재실행 결과가 달라진다.
const STAMP = stampArg ? stampArg.slice('--stamp='.length) : new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT_DIR = join('D:', 'backup', 'freepasserp4-rtdb', `계약이력-${STAMP}`);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const tok = (await jwt.getAccessToken()).token;
const get = async (path: string) => (await (await fetch(`${DB}/${path}.json?access_token=${tok}`)).json()) as Record<string, any> | null;
const del = async (path: string) => {
  const r = await fetch(`${DB}/${path}.json?access_token=${tok}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`${path} 삭제 실패 ${r.status} ${(await r.text()).slice(0, 160)}`);
};

const v4c = (await get('v4/contracts')) || {};
const v3c = (await get('contracts')) || {};
const prod = (await get('v4/products')) || {};

console.log('■ ERP 리셋 — 계약은 이력으로 남기고 지운다\n');
console.log(`  v4/contracts  ${Object.keys(v4c).length}건`);
console.log(`  contracts(v3) ${Object.keys(v3c).length}건`);
console.log(`  v4/products   ${Object.keys(prod).length}대`);
console.log(`\n  이력 저장 위치: ${OUT_DIR}`);
console.log('  ⚠ v4/rooms(대화)·v4/settlements(정산)는 건드리지 않는다.');

/** 사람이 읽을 이력 — 계약마다 «누가·무슨 차·얼마·언제·어떤 상태»를 한 줄로. */
function toCsv(rows: [string, any][]): string {
  const cols = ['계약코드', '상태', '고객명', '연락처', '차량번호', '차명', '공급사', '영업자', '월대여료', '보증금', '기간(개월)', '만든때', '고친때'];
  const pick = (c: any, keys: string[]) => { for (const k of keys) if (S(c[k])) return S(c[k]); return ''; };
  const when = (v: unknown) => { const n = Number(v); return n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString().slice(0, 19).replace('T', ' ') : S(v); };
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [cols.join(',')];
  for (const [key, c] of rows) {
    lines.push([
      key,
      pick(c, ['status', 'contract_status']),
      pick(c, ['customer_name', 'customer', 'customer_name_snapshot']),
      pick(c, ['customer_phone', 'phone']),
      pick(c, ['car_number', 'car_number_snapshot']),
      pick(c, ['vehicle_name_snapshot', 'vehicle_name', 'product_name']),
      pick(c, ['provider_company_code', 'provider']),
      pick(c, ['agent_name', 'agent_company_code', 'agent']),
      pick(c, ['monthly_rent_snapshot', 'monthly_rent', 'rent']),
      pick(c, ['deposit_amount_snapshot', 'deposit', 'deposit_amount']),
      pick(c, ['term_months', 'months', 'period']),
      when(pick(c, ['created_at', 'createdAt'])),
      when(pick(c, ['updated_at', 'updatedAt'])),
    ].map((v) => esc(S(v))).join(','));
  }
  return lines.join('\n');
}

if (!APPLY) {
  console.log('\n  (미리보기다 — 실제로 남기고 지우려면 --apply)');
  console.log('  ⚠ 먼저 전체 백업을 떠 두라: npx tsx scripts/deploy/rtdb-backup.mts export');
  process.exit(0);
}

// ── ① 이력 남기기 (지우기 전에)
mkdirSync(OUT_DIR, { recursive: true });
const wrote: string[] = [];
const save = (name: string, body: string) => { const f = join(OUT_DIR, name); writeFileSync(f, body, 'utf8'); wrote.push(`${name} (${Math.round(body.length / 1024)}KB)`); };
// CSV 는 엑셀이 한글을 깨뜨리지 않게 BOM 을 붙인다.
save('계약이력-v4.csv', '﻿' + toCsv(Object.entries(v4c)));
save('계약이력-v3.csv', '﻿' + toCsv(Object.entries(v3c)));
save('contracts-v4.json', JSON.stringify(v4c, null, 2));
save('contracts-v3.json', JSON.stringify(v3c, null, 2));
save('products-v4.json', JSON.stringify(prod, null, 2));
console.log('\n  ✓ 이력 남김');
wrote.forEach((w) => console.log(`     ${w}`));

// ── ② 계약 삭제
await del('v4/contracts');
await del('contracts');
console.log('  ✓ 계약 삭제 — v4/contracts · contracts');

// ── ③ 재고 삭제
await del('v4/products');
console.log('  ✓ 재고 삭제 — v4/products');

console.log('\n  다음: 판매시트를 현재 기준으로 다시 넣는다');
console.log('     npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/run-sheet-daily-sync-local.mts --apply');
