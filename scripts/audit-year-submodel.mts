/**
 * 「연식 + 모델명」만으로 세부모델(세대)이 1차 추출되는가 — 실매물로 잰다.
 *
 * 사장님 지적(2026-08-09): 세대는 연식 구간으로 갈리니 **모델명과 연식만 있으면**
 * 세대는 거의 확정된다. 「아반떼 + 2023」이면 CN7 말고 갈 데가 없다.
 *
 * 지금 코드는 연식을 «점수 가중치»로만 쓴다(vehicle-master-score: genLock 5점 / 연식 가점).
 * 그래서 이름이 조금 더 닮은 옛 세대에 밀린다 — 여기서 그 손해를 센다.
 *
 * ★제일 중요한 것: **연식이 붙은 세대의 생산구간 밖인 매물** = 확실히 틀린 것.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const NOW = Number(process.env.NOW) || 2026;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: Rec[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

/** 세대 → 생산구간 · 소속모델 */
type Gen = { sub: string; model: string; maker: string; y0: number; y1: number };
const gens = new Map<string, Gen>();
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  const y0 = Number(e.year_start) || 0;
  const y1 = /^\d{4}$/.test(S(e.year_end)) ? Number(e.year_end) : NOW;
  const prev = gens.get(sub);
  gens.set(sub, {
    sub, model: S(e.model), maker: S(e.maker),
    y0: prev ? Math.min(prev.y0 || y0, y0 || prev.y0) : y0,
    y1: prev ? Math.max(prev.y1, y1) : y1,
  });
}
const byModel = new Map<string, Gen[]>();
for (const g of gens.values()) {
  if (!g.model) continue;
  if (!byModel.has(g.model)) byModel.set(g.model, []);
  byModel.get(g.model)!.push(g);
}

const yearOf = (p: Rec): number => {
  const raw = (p._raw_vehicle || {}) as Rec;
  for (const v of [p.year, raw.year, p.first_registration_date, raw.first_registration_date]) {
    const m = /(20\d{2}|19\d{2})/.exec(S(v));
    if (m) return Number(m[1]);
  }
  return 0;
};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

type Row = { plate: string; model: string; year: number; now: string; span: string; cands: string[]; kind: string };
const rows: Row[] = [];
let total = 0; let noYear = 0; let noModel = 0;
let unique = 0; let multi = 0; let outOfSpan = 0; let agree = 0;

for (const [key, p0] of Object.entries(prods) as [string, Rec][]) {
  const p = { ...p0, _key: key };
  if (!p || typeof p !== 'object' || dead(p)) continue;
  total++;
  const model = S(p.model);
  const year = yearOf(p);
  if (!model || !byModel.has(model)) { noModel++; continue; }
  if (!year) { noYear++; continue; }

  const pool = byModel.get(model)!;
  // 1차 추출 = 그 모델 안에서 **연식이 생산구간에 드는** 세대
  const fit = pool.filter((g) => (!g.y0 || year >= g.y0) && (!g.y1 || year <= g.y1));
  const now = S(p.sub_model);
  const cur = gens.get(now);
  const plate = S(p.car_number) || '(무번호)';
  const span = cur ? `${cur.y0 || '?'}~${cur.y1 === NOW ? '현재' : cur.y1}` : '(마스터에 없는 세대)';

  // ★연식이 지금 붙은 세대의 구간 밖 = 확실히 틀림
  if (cur && year && cur.y0 && cur.y1 && (year < cur.y0 || year > cur.y1)) {
    outOfSpan++;
    rows.push({ plate, model, year, now, span, cands: fit.map((g) => g.sub), kind: '★연식이 세대 구간 밖' });
    continue;
  }
  if (fit.length === 1) {
    unique++;
    if (fit[0].sub === now) agree++;
    else rows.push({ plate, model, year, now, span, cands: [fit[0].sub], kind: '1차추출과 불일치' });
  } else if (fit.length > 1) {
    multi++;
  }
}

console.log('■ 「연식 + 모델명」 1차 추출 실측\n');
console.log(`  매물 ${total}대`);
console.log(`   모델이 마스터에 없음      ${String(noModel).padStart(4)}`);
console.log(`   연식을 못 읽음           ${String(noYear).padStart(4)}`);
console.log(`  ─────────────────────────────`);
console.log(`  ★연식만으로 세대 하나로 좁혀짐  ${String(unique).padStart(4)}대`);
console.log(`      그중 지금 값과 같음      ${String(agree).padStart(4)}대`);
console.log(`      그중 지금 값과 다름      ${String(unique - agree).padStart(4)}대  ← 고칠 것`);
console.log(`   연식으로도 후보 2개 이상    ${String(multi).padStart(4)}대`);
console.log(`  ★연식이 붙은 세대 구간 밖    ${String(outOfSpan).padStart(4)}대  ← 확실히 틀림\n`);

for (const kind of ['★연식이 세대 구간 밖', '1차추출과 불일치']) {
  const list = rows.filter((r) => r.kind === kind);
  if (!list.length) continue;
  console.log(`── ${kind} — ${list.length}대 (상위 12)`);
  for (const r of list.slice(0, 12)) {
    console.log(`  ${r.plate.padEnd(11)} ${r.model.slice(0, 10).padEnd(12)} ${String(r.year)}년식`);
    console.log(`      지금 「${r.now}」 (${r.span})   →  연식이 가리키는 것: ${r.cands.join(' · ') || '(그 연식에 맞는 세대가 마스터에 없음)'}`);
  }
  console.log('');
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [['구분', '차량번호', '모델', '연식', '지금세대', '지금세대구간', '연식이가리키는세대'].join(','),
    ...rows.map((r) => [r.kind, r.plate, r.model, String(r.year), r.now, r.span, r.cands.join(' / ')].map(esc).join(',')),
  ].join('\r\n');
  writeFileSync(out, `﻿${csv}`, 'utf8');
  console.log(`CSV: ${out} (${rows.length}행)`);
}
