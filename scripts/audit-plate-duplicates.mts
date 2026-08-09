/**
 * 차량번호 중복 조사 — 한 대의 차가 몇 개 레코드로 있나. 읽기 전용.
 *
 * 실측 발단(2026-08-09): 「182허6203」이 네 키로 있었다 —
 *   182허6203 · 182허6203_RP010 · EXT_088cdd6ffb3a · PD-260507-121
 * 키 규약이 여러 벌이라(차번 · 차번_공급사 · EXT_해시 · PD-순번) 같은 차가 갈라진다.
 * 갈라지면 계약·채팅·정산이 서로 다른 레코드를 가리키고, 재고 대수도 부풀어 보인다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const [prods, contracts] = await Promise.all(['v4/products', 'v4/contracts'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));

const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const plateOf = (p: Rec) => S(p.car_number || p.car_number_snapshot).replace(/\s/g, '');

/** 키가 어느 규약인가 — 어디서 만들어진 레코드인지 말해 준다. */
const kindOf = (key: string): string => {
  if (/^EXT_/.test(key)) return 'EXT_해시(v3 이관)';
  if (/^PD-\d/.test(key)) return 'PD-순번(수기 등록)';
  if (/^[가-힣]{0,2}\d{2,3}[가-힣]\d{4}_/.test(key)) return '차번_공급사(시트)';
  if (/_[가-힣]{0,2}\d{2,3}[가-힣]\d{4}$/.test(key)) return '공급사_차번(시트)';
  if (/^[가-힣]{0,2}\d{2,3}[가-힣]\d{4}$/.test(key)) return '차번만';
  return '기타';
};

/** 살아 있는 계약이 가리키는 상품코드 — 함부로 못 합치는 것들이다. */
const lockedCodes = new Set<string>();
for (const c of Object.values(contracts) as Rec[]) {
  if (!c || typeof c !== 'object') continue;
  const st = S(c.status);
  if (/취소|해지|종료|반납완료/.test(st)) continue;
  for (const k of ['product_code', 'product_key', 'productId']) if (S(c[k])) lockedCodes.add(S(c[k]));
}

type Row = { plate: string; keys: string[]; kinds: string[]; active: number; deleted: number; locked: number; providers: string[] };
const byPlate = new Map<string, Row>();
for (const [key, p0] of Object.entries(prods) as [string, Rec][]) {
  const p = p0 as Rec;
  if (!p || typeof p !== 'object') continue;
  const plate = plateOf(p);
  if (!plate || p.is_pending_plate) continue;
  const row = byPlate.get(plate) || { plate, keys: [], kinds: [], active: 0, deleted: 0, locked: 0, providers: [] };
  row.keys.push(key);
  const kind = kindOf(key);
  if (!row.kinds.includes(kind)) row.kinds.push(kind);
  if (dead(p)) row.deleted++; else row.active++;
  if (lockedCodes.has(key) || lockedCodes.has(S(p.product_code))) row.locked++;
  const pv = S(p.provider_company_code);
  if (pv && !row.providers.includes(pv)) row.providers.push(pv);
  byPlate.set(plate, row);
}

const dups = [...byPlate.values()].filter((r) => r.keys.length > 1);
const activeDups = dups.filter((r) => r.active > 1);

console.log('■ 차량번호 중복\n');
console.log(`  차량번호 ${byPlate.size}종 · 레코드 ${Object.values(prods).length}건`);
console.log(`  두 개 이상으로 갈린 차번        ${String(dups.length).padStart(4)}종`);
console.log(`  ★그중 «살아있는 것»이 둘 이상    ${String(activeDups.length).padStart(4)}종   ← 재고가 부풀어 보인다`);
console.log(`  살아있는 계약이 걸린 중복       ${String(dups.filter((r) => r.locked > 0).length).padStart(4)}종   ← 함부로 못 합친다`);
console.log(`  공급사가 서로 다른 중복        ${String(dups.filter((r) => r.providers.length > 1).length).padStart(4)}종   ← 같은 차를 두 곳이 올렸다\n`);

const kindTally = new Map<string, number>();
for (const r of dups) for (const k of r.kinds) kindTally.set(k, (kindTally.get(k) || 0) + 1);
console.log('── 중복에 섞인 키 규약');
for (const [k, n] of [...kindTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}종  ${k}`);

console.log('\n── 살아있는 것이 둘 이상인 차번 (상위 12)');
for (const r of activeDups.sort((a, b) => b.active - a.active).slice(0, 12)) {
  console.log(`  ${r.plate.padEnd(11)} 살아있음 ${r.active} · 삭제 ${r.deleted} · 계약 ${r.locked} · 공급사[${r.providers.join(',')}]`);
  console.log(`      ${r.keys.slice(0, 5).join(' | ')}`);
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(out, `﻿${[
    ['차량번호', '레코드수', '살아있음', '삭제', '계약걸림', '공급사', '키규약', '키목록'].join(','),
    ...dups.sort((a, b) => b.active - a.active || b.keys.length - a.keys.length).map((r) => [
      r.plate, String(r.keys.length), String(r.active), String(r.deleted), String(r.locked),
      r.providers.join(' / '), r.kinds.join(' / '), r.keys.join(' | '),
    ].map(esc).join(',')),
  ].join('\r\n')}`, 'utf8');
  console.log(`\nCSV: ${out} (${dups.length}행)`);
}
