/**
 * 세대 생산구간 **겹침** 실측 — 「연식+모델」 1차 추출이 못 가르는 자리가 어디인가.
 *
 * 세대는 연식으로 갈리는 게 원칙인데, 페이스리프트는 앞 세대와 구간이 물린다
 * (「아이오닉5 NE」 2021~현재 · 「더 뉴 아이오닉5 NE」 2024~현재).
 * 겹치는 해에 들어온 차는 연식만으론 못 고르고, 그때 이름·세대코드·트림 소속이 가른다.
 *
 * 여기서 재는 것
 *   ① 마스터 안에서 몇 세대가 서로 물리나
 *   ② 그 겹침이 **우리 재고 몇 대**에 실제로 걸리나  ← 이게 중요하다
 *   ③ 걸린 차를 무엇이 갈랐나(세대코드·문구·트림 소속) · 못 가른 건 몇 대인가
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const NOW = Number(process.env.NOW) || 2026;
const OPEN = 9999;

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

type Gen = { sub: string; model: string; maker: string; y0: number; y1: number; trims: number };
const gens = new Map<string, Gen>();
for (const e of entries as unknown as Rec[]) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  const y0 = Number(e.year_start) || 0;
  const y1 = /^\d{4}$/.test(S(e.year_end)) ? Number(e.year_end) : OPEN;
  const nTrim = (e.trims || []).length + (e.variants || []).reduce((a: number, v: Rec) => a + (v.trims || []).length, 0);
  const prev = gens.get(sub);
  gens.set(sub, {
    sub, model: S(e.model), maker: S(e.maker),
    y0: prev ? Math.min(prev.y0 || y0, y0 || prev.y0) : y0,
    y1: prev ? Math.max(prev.y1, y1) : y1,
    trims: (prev?.trims || 0) + nTrim,
  });
}
const byModel = new Map<string, Gen[]>();
for (const g of gens.values()) {
  if (!g.model) continue;
  if (!byModel.has(g.model)) byModel.set(g.model, []);
  byModel.get(g.model)!.push(g);
}

// ── ① 마스터 안의 겹침 ────────────────────────────────────
type Pair = { model: string; a: Gen; b: Gen; from: number; to: number };
const pairs: Pair[] = [];
for (const [model, list] of byModel) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      if (!a.y0 || !b.y0) continue;
      const from = Math.max(a.y0, b.y0);
      const to = Math.min(a.y1, b.y1);
      if (from <= to) pairs.push({ model, a, b, from, to });
    }
  }
}
const overlappedSubs = new Set(pairs.flatMap((p) => [p.a.sub, p.b.sub]));

console.log('■ 세대 생산구간 겹침\n');
console.log(`  마스터 세대 ${gens.size}종 · 모델 ${byModel.size}종`);
console.log(`  ★서로 물리는 세대 쌍   ${pairs.length}쌍`);
console.log(`   물린 세대            ${overlappedSubs.size}종 (${Math.round(overlappedSubs.size / gens.size * 100)}%)`);

// ── ② 우리 재고에 실제로 걸리나 ──────────────────────────
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const yearOf = (p: Rec): number => {
  const raw = (p._raw_vehicle || {}) as Rec;
  const digits = (v: unknown) => S(v).replace(/[^\d]/g, '');
  for (const [yv, cc] of [[p.year, p.engine_cc], [raw.year, raw.engine_cc]] as const) {
    if (digits(yv) && digits(yv) === digits(cc) && digits(yv).length === 4) continue;
    const m = /(20\d{2}|19\d{2})/.exec(S(yv));
    if (m) return Number(m[1]);
  }
  for (const v of [p.first_registration_date, raw.first_registration_date]) {
    const m = /(20\d{2}|19\d{2})/.exec(S(v));
    if (m) return Number(m[1]);
  }
  return 0;
};

type Row = { plate: string; model: string; year: number; picked: string; cands: string[]; decided: boolean };
const rows: Row[] = [];
let total = 0; let inOverlap = 0; let decided = 0; let stuck = 0;

for (const [key, p0] of Object.entries(prods) as [string, Rec][]) {
  const p = { ...p0, _key: key };
  if (!p || typeof p !== 'object' || dead(p)) continue;
  total++;
  const model = S(p.model);
  const year = yearOf(p);
  if (!model || !byModel.has(model) || !year) continue;
  // 그 연식에 살아 있는 세대가 둘 이상 = 겹침 구간에 걸린 차
  const fit = byModel.get(model)!.filter((g) => (!g.y0 || year >= g.y0) && year <= g.y1);
  if (fit.length < 2) continue;
  inOverlap++;
  const r = p._raw_vehicle ? snapToMaster(p as never, entries) as unknown as Rec | null : null;
  const picked = S(r?.sub_model) || S(p.sub_model);
  const ok = !!picked && fit.some((g) => g.sub === picked);
  if (ok) decided++; else stuck++;
  rows.push({
    plate: S(p.car_number) || '(무번호)', model, year, picked: picked || '(공란)',
    cands: fit.map((g) => g.sub), decided: ok,
  });
}

console.log(`\n■ 우리 재고에 걸린 겹침\n`);
console.log(`  매물 ${total}대 중 겹침 구간에 든 차   ${inOverlap}대`);
console.log(`    ★그중 하나로 갈린 것              ${decided}대`);
console.log(`     못 갈려 공란·구간 밖             ${stuck}대`);

console.log('\n── 못 갈린 차 (상위 12)');
for (const r of rows.filter((x) => !x.decided).slice(0, 12)) {
  console.log(`  ${r.plate.padEnd(11)} ${r.model.slice(0, 10).padEnd(12)} ${r.year}년식 → 「${r.picked}」`);
  console.log(`      후보: ${r.cands.join(' · ')}`);
}

console.log('\n── 마스터에서 가장 오래 물리는 쌍 (상위 10)');
for (const p of pairs.sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 10)) {
  const span = `${p.from}~${p.to === OPEN ? '현재' : p.to}`;
  console.log(`  ${span.padEnd(12)} ${p.a.sub.slice(0, 24).padEnd(26)} ↔ ${p.b.sub.slice(0, 24)}`);
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(out, `﻿${[
    ['구분', '차량번호', '모델', '연식', '고른세대', '겹친후보'].join(','),
    ...rows.map((r) => [r.decided ? '갈림' : '못갈림', r.plate, r.model, String(r.year), r.picked, r.cands.join(' / ')].map(esc).join(',')),
  ].join('\r\n')}`, 'utf8');
  console.log(`\nCSV: ${out} (${rows.length}행)`);
}
