/**
 * 「연식으로 먼저 찾고, 텍스트로 검수」 — 순서를 바꿔서 재본다(읽기 전용).
 *
 * 사장님 지시(2026-08-09): 연식으로 1차 추출하고 그다음 원문 텍스트로 검수.
 *
 *   1차  모델 안에서 **연식이 생산구간에 드는 세대**만 남긴다.
 *   2차  남은 후보를 **원문 글**로 검수한다 — 세대코드 → 접두(더 뉴/디 올 뉴) → 트림 소속.
 *   3차  그래도 둘 이상이면 **비운다**. 틀린 세대를 붙이느니 공란이 낫다.
 *
 * 재는 것: 세대가 몇 대나 바로잡히고, 그 덕에 **트림이 몇 대나 살아나는가**.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { realMasterTrims } from '../lib/domain/vehicle-master-options';
import { resolveTrim } from '../lib/domain/vehicle-trim-resolve';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const NOW = Number(process.env.NOW) || 2026;
const flat = (v: string) => v.toLowerCase().replace(/[\s\-_()/·.]/g, '');

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

type Gen = { sub: string; model: string; codes: string[]; y0: number; y1: number; trims: string[] };
const gens = new Map<string, Gen>();
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  const y0 = Number(e.year_start) || 0;
  const y1 = /^\d{4}$/.test(S(e.year_end)) ? Number(e.year_end) : NOW;
  const g = gens.get(sub) || { sub, model: S(e.model), codes: [], y0, y1, trims: [] };
  if (y0 && (!g.y0 || y0 < g.y0)) g.y0 = y0;
  if (y1 > g.y1) g.y1 = y1;
  const code = S(e.gen_code).toUpperCase();
  if (code && !g.codes.includes(code)) g.codes.push(code);
  for (const t of realMasterTrims((e.trims || []) as never)) if (S(t) && !g.trims.includes(S(t))) g.trims.push(S(t));
  for (const v of (e.variants || []) as Rec[]) {
    for (const t of realMasterTrims((v.trims || []) as never)) if (S(t) && !g.trims.includes(S(t))) g.trims.push(S(t));
  }
  gens.set(sub, g);
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
const textOf = (p: Rec): string => {
  const raw = (p._raw_vehicle || {}) as Rec;
  return [raw.trim_name, raw.model, raw.sub_model, p.trim_extra, p.cert_car_name, p.vehicle_name]
    .map(S).filter(Boolean).join(' ');
};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
/** 접두 세대 표기 — 마스터와 원문 양쪽에서 같은 잣대로 읽는다. */
const prefixOf = (v: string): string => {
  const t = v.replace(/\s/g, '');
  if (/디올뉴|theallnew/i.test(t)) return '디올뉴';
  if (/올뉴|allnew/i.test(t)) return '올뉴';
  if (/더뉴|thenew/i.test(t)) return '더뉴';
  return '';
};

type Out = {
  plate: string; model: string; year: number;
  now: string; next: string; how: string;
  trimNow: string; trimNext: string;
};
const outs: Out[] = [];
let total = 0; let skipped = 0;
let byYearOne = 0; let byCode = 0; let byPrefix = 0; let byTrim = 0; let blanked = 0; let kept = 0;

for (const [key, p0] of Object.entries(prods) as [string, Rec][]) {
  const p = { ...p0, _key: key };
  if (!p || typeof p !== 'object' || dead(p)) continue;
  total++;
  const model = S(p.model);
  const year = yearOf(p);
  const now = S(p.sub_model);
  const text = textOf(p);
  if (!model || !byModel.has(model) || !year) { skipped++; continue; }

  // ── 1차: 연식이 생산구간에 드는 세대만
  const pool = byModel.get(model)!;
  let fit = pool.filter((g) => (!g.y0 || year >= g.y0) && (!g.y1 || year <= g.y1));
  let how = '';
  if (!fit.length) { skipped++; continue; }          // 그 연식의 세대가 마스터에 없음 — 손대지 않는다
  if (fit.length === 1) { how = '연식1차'; byYearOne++; }

  // ── 2차: 원문 텍스트로 검수
  if (fit.length > 1) {
    const blob = flat(text);
    const byCodeHit = fit.filter((g) => g.codes.some((c) => c.length >= 2 && blob.includes(flat(c))));
    if (byCodeHit.length === 1) { fit = byCodeHit; how = '연식+세대코드'; byCode++; }
    else {
      /**
       * ★접두는 **원문에 있을 때만** 근거다. 없는 것을 배제 근거로 쓰면 안 된다.
       * 공급사는 「더 뉴」를 자주 생략한다 — 없다고 「더 뉴 X」를 떨어뜨리면
       * 2025년식 아이오닉5가 구형 NE 로 역행하고, 「니로」가 택시·승차공유 전용
       * 「니로 플러스 DE」로 간다(실측 2026-08-09).
       */
      const want = prefixOf(text);
      const byPre = want ? fit.filter((g) => prefixOf(g.sub) === want) : [];
      if (byPre.length === 1) { fit = byPre; how = '연식+접두'; byPrefix++; }
      else {
        const src = byPre.length ? byPre : fit;
        // ★트림 소속으로 가른다 — 원문의 트림이 그 세대 목록에 있는가
        const byTrimHit = src.filter((g) => g.trims.length && resolveTrim(text, g.trims));
        if (byTrimHit.length === 1) { fit = byTrimHit; how = '연식+트림소속'; byTrim++; }
        else fit = [];
      }
    }
  }

  /**
   * ── 3차: 못 가리면 **지금 값을 유지한다** — 단 지금 값이 연식 구간 안일 때만.
   *
   * 처음엔 그냥 비웠는데 170대가 공란이 됐다. 과하다 —
   * 지금 붙은 세대가 연식 구간 안이면 «가릴 근거가 없다»는 것이지 «틀렸다»가 아니다.
   * 근거 없이 지우면 그 아래 트림까지 같이 날아간다.
   * **구간 밖일 때만** 비운다. 그건 확실히 틀린 것이기 때문이다.
   */
  if (!fit.length) {
    const cur = now ? gens.get(now) : null;
    const curFits = !!cur && (!cur.y0 || year >= cur.y0) && (!cur.y1 || year <= cur.y1);
    if (curFits) { kept++; continue; }
    blanked++;
    continue;
  }
  const next = fit[0].sub;
  const trimNow = S(p.trim_name);
  const hit = resolveTrim(text, gens.get(next)?.trims || []);
  const trimNext = hit?.trim || trimNow;
  if (next === now) { kept++; continue; }
  outs.push({ plate: S(p.car_number) || '(무번호)', model, year, now, next, how, trimNow, trimNext });
}

console.log('■ 연식 1차 → 텍스트 검수 (읽기 전용 시뮬레이션)\n');
console.log(`  매물 ${total}대 · 규칙 대상 아님(모델·연식 없음 등) ${skipped}대\n`);
console.log(`  세대가 지금과 같음                ${String(kept).padStart(4)}대`);
console.log(`  ★세대가 바뀜                     ${String(outs.length).padStart(4)}대`);
console.log(`  ★가릴 근거가 없어 비움             ${String(blanked).padStart(4)}대  ← 틀린 세대를 붙이느니 공란\n`);
console.log('  확정 경로');
console.log(`    연식만으로 하나        ${String(byYearOne).padStart(4)}대`);
console.log(`    연식 + 세대코드        ${String(byCode).padStart(4)}대`);
console.log(`    연식 + 접두(더 뉴 등)   ${String(byPrefix).padStart(4)}대`);
console.log(`    연식 + 트림 소속       ${String(byTrim).padStart(4)}대`);

const gained = outs.filter((o) => !o.trimNow && o.trimNext);
const lost = outs.filter((o) => o.trimNow && !o.trimNext);
const changed = outs.filter((o) => o.trimNow && o.trimNext && o.trimNow !== o.trimNext);
console.log(`\n  세대를 바로잡은 결과 트림은`);
console.log(`    새로 생김  ${String(gained.length).padStart(4)}대`);
console.log(`    바뀜      ${String(changed.length).padStart(4)}대`);
console.log(`    사라짐    ${String(lost.length).padStart(4)}대  ← 0 이어야 좋다`);

console.log('\n── 세대가 바뀌는 차 (상위 15)');
for (const o of outs.slice(0, 15)) {
  console.log(`  ${o.plate.padEnd(11)} ${o.model.slice(0, 10).padEnd(12)} ${o.year}년식  [${o.how}]`);
  console.log(`      「${o.now || '(공란)'}」 → 「${o.next}」   트림 「${o.trimNow || '-'}」 → 「${o.trimNext || '-'}」`);
}
if (lost.length) {
  console.log('\n★트림이 사라지는 차 — 반영 전 반드시 확인');
  for (const o of lost) console.log(`  ${o.plate}  「${o.now}」→「${o.next}」  트림 「${o.trimNow}」 사라짐`);
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [['차량번호', '모델', '연식', '지금세대', '바뀔세대', '확정근거', '지금트림', '바뀔트림'].join(','),
    ...outs.map((o) => [o.plate, o.model, String(o.year), o.now, o.next, o.how, o.trimNow, o.trimNext].map(esc).join(',')),
  ].join('\r\n');
  writeFileSync(out, `﻿${csv}`, 'utf8');
  console.log(`\nCSV: ${out}`);
}
