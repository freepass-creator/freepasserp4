/**
 * **공급사별 건강진단** — 어느 집부터 챙겨야 하는지 한 장으로. 읽기 전용.
 *
 * ★사장님 2026-08-31 「이제 안정적으로 돌아가면 내가 공급사 하나하나 좀 챙기면 되니까
 *   공급사들부터 챙기면서 갑시다.」
 *
 * ⚠ **구글 시트를 읽지 않는다.** ERP(RTDB)만 본다 —
 *   자동동기가 매시간 시트를 읽으므로, 여기서 또 읽으면 할당량을 다퉈 회차가 밀린다
 *   (2026-08-30 실측: 회차 중에 감사기를 돌렸다가 429 로 죽고 회차도 느려졌다).
 *   시트 쪽까지 봐야 하면 `audit-sheet-erp-parity` · `audit-policy-code-drift` 를 «회차 사이»에 돌린다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-supplier-health.mts
 */
import nextEnv from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const [{ firebaseAdminDatabase }, { readProducts, readPartners }] = await Promise.all([
  import('../lib/server/firebase-admin'),
  import('../lib/server/sheet-daily-sync'),
]);

const S = (v: unknown) => String(v ?? '').trim();
const companyId = S(process.env.SHEET_SYNC_COMPANY_ID || 'freepass');
const db = firebaseAdminDatabase();
const [partners, products] = await Promise.all([
  readPartners(db, companyId),
  readProducts(db, companyId),
]);

/** 공급사 코드 → 이름. 없으면 코드 그대로. */
const nameOf = new Map<string, string>();
for (const p of partners as unknown as Record<string, unknown>[]) {
  const code = S(p.provider_company_code || p.company_code || p.partner_code);
  const name = S(p.company_name || p.name);
  if (code && name) nameOf.set(code, name);
}

type Health = {
  코드: string; 이름: string;
  전체: number; 출고가능: number; 출고불가: number; 계약중: number; 그밖상태: number;
  정책없음: number; 요금없음: number; 사진없음: number;
  이름빈칸: number; 원산지빈칸: number;
};
const rows = new Map<string, Health>();
const get = (code: string): Health => {
  if (!rows.has(code)) {
    rows.set(code, {
      코드: code, 이름: nameOf.get(code) || '(이름 없음)',
      전체: 0, 출고가능: 0, 출고불가: 0, 계약중: 0, 그밖상태: 0,
      정책없음: 0, 요금없음: 0, 사진없음: 0, 이름빈칸: 0, 원산지빈칸: 0,
    });
  }
  return rows.get(code) as Health;
};

/** 요금이 «있다»고 볼 수 있나 — price 안에 대여료 값이 하나라도 있으면 있다. */
const hasPrice = (p: Record<string, unknown>): boolean => {
  const price = p.price;
  if (!price || typeof price !== 'object' || Array.isArray(price)) return false;
  return Object.values(price as Record<string, unknown>).some((term) => {
    if (!term || typeof term !== 'object') return false;
    const rent = Number(S((term as Record<string, unknown>).rent).replace(/,/g, ''));
    return Number.isFinite(rent) && rent > 0;
  });
};

for (const p of products.active as unknown as Record<string, unknown>[]) {
  const h = get(S(p.provider_company_code) || '(공급사 없음)');
  h.전체 += 1;
  const status = S(p.vehicle_status);
  if (status === '출고가능') h.출고가능 += 1;
  else if (status === '출고불가') h.출고불가 += 1;
  else if (status === '계약중') h.계약중 += 1;
  else h.그밖상태 += 1;

  if (!S(p.policy_code)) h.정책없음 += 1;
  if (!hasPrice(p)) h.요금없음 += 1;
  if (!S(p.photo_link)) h.사진없음 += 1;
  if (!S(p.model) && !S(p.sub_model)) h.이름빈칸 += 1;
  if (!S(p.origin)) h.원산지빈칸 += 1;
}

const all = [...rows.values()].sort((a, b) => b.전체 - a.전체);
const pad = (v: unknown, n: number) => String(v).padStart(n);
const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v.padEnd(n));

console.log(`■ 공급사별 ERP 현황 — 활성 ${products.active.length}대 · 공급사 ${all.length}곳`);
console.log('   (구글 시트는 안 읽는다 — 자동동기와 할당량을 다투지 않기 위해)');
console.log('');
console.log(`   ${cut('공급사', 18)} ${pad('전체', 5)} ${pad('출고가능', 6)} ${pad('출고불가', 6)} ${pad('계약중', 5)} │ ${pad('정책없음', 6)} ${pad('요금없음', 6)} ${pad('사진없음', 6)} ${pad('원산지빈칸', 8)}`);
console.log(`   ${'─'.repeat(18)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(5)} ┼ ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(8)}`);
for (const h of all) {
  console.log(`   ${cut(`${h.코드} ${h.이름}`, 18)} ${pad(h.전체, 5)} ${pad(h.출고가능, 6)} ${pad(h.출고불가, 6)} ${pad(h.계약중, 5)} │ ${pad(h.정책없음, 6)} ${pad(h.요금없음, 6)} ${pad(h.사진없음, 6)} ${pad(h.원산지빈칸, 8)}`);
}

/** ★팔 수 있는 차인데 빠진 것 — 여기가 «돈이 새는 자리»다. */
console.log('');
console.log('■ ★출고가능인데 빠진 것 (이게 곧 못 파는 차다)');
const sellableGaps = all
  .map((h) => ({ h, gaps: [] as string[] }))
  .map((x) => x);
for (const h of all) {
  if (!h.출고가능) continue;
  const bits: string[] = [];
  if (h.요금없음) bits.push(`요금없음 ${h.요금없음}`);
  if (h.정책없음) bits.push(`정책없음 ${h.정책없음}`);
  if (h.사진없음) bits.push(`사진없음 ${h.사진없음}`);
  if (h.원산지빈칸) bits.push(`원산지빈칸 ${h.원산지빈칸}`);
  if (bits.length) console.log(`   ${cut(`${h.코드} ${h.이름}`, 18)} 출고가능 ${pad(h.출고가능, 4)}대 — ${bits.join(' · ')}`);
}
void sellableGaps;

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/supplier-health.json', JSON.stringify({ at: new Date().toISOString(), rows: all }, null, 1));
console.log('');
console.log('기록 tmp/supplier-health.json · 여기서 고치지 않는다 — 보여만 준다');
