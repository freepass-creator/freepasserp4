// node scripts/measure-used-residual-encar.mjs — 결과 기록: docs/견적-원가-로직.md §3-4-1
// 중고 잔가 «비율»을 엔카 공개 매물로 잰다 — 같은 세대·같은 연료, «연식마다 따로» 조회해 중앙가.
//   우리 중고 잔가 = 시세 × curve(나이+약정) / curve(나이)   (residual-lookup.js usedResidual)
//   재는 것도 비율: 중앙가(나이 a+T) / 중앙가(나이 a).
//   ① 세대 전체 중앙가  ② 가장 흔한 트림 하나의 중앙가(트림 섞임 제거) — 둘 다 낸다.
import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const BASE = 'https://api.encar.com/search/car/list/general';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = 2026;
const OUT = new URL('../tmp/used-resid-results.json', import.meta.url);

const DELTA = JSON.parse(readFileSync(new URL('../lib/domain/estimate/data/residual-delta.json', import.meta.url), 'utf8'));
const norm = (v) => String(v ?? '').toLowerCase().replace(/[\s()·\-_.]/g, '');
const deltaFor = (maker, model) => {
  const hit = Object.values(DELTA).find((r) => norm(r.maker) === norm(maker) && norm(r.model) === norm(model));
  return hit ? { d: Number(hit.delta) || 0, seg: hit.seg } : { d: 0, seg: '표없음→표준' };
};
const STANDARD = { 1: 85, 2: 75, 3: 66, 4: 58, 5: 51, 6: 44, 7: 38, 8: 33 };
const rate = (d, age) => {
  const a = Math.round(age); if (a <= 0) return 1;
  const c = (y) => Math.max(5, Math.min(98, STANDARD[y] + d));
  if (a <= 8) return c(a) / 100;
  return Math.max(8, c(8) - (a - 8) * 5) / 100;
};
const ours = (d, a, T) => rate(d, a + T) / rate(d, a);

// [원산, 엔카제조사, 모델그룹, 세대 정규식, 연료, 첫해, 끝해]
const COHORTS = [
  ['국산', '현대', '그랜저', /IG/, '가솔린', 2017, 2022],
  ['국산', '현대', '쏘나타', /DN8/, '가솔린', 2020, 2024],
  ['국산', '현대', '아반떼', /CN7/, '가솔린', 2021, 2025],
  ['국산', '기아', 'K5', /3세대|DL3/, '가솔린', 2020, 2024],
  ['국산', '기아', '쏘렌토', /MQ4|4세대/, '디젤', 2021, 2024],
  ['수입', 'BMW', '5시리즈', /G30/, '가솔린', 2017, 2023],
  ['수입', 'BMW', '3시리즈', /G20/, '가솔린', 2019, 2025],
  ['수입', '벤츠', 'E-클래스', /W213/, '가솔린', 2017, 2023],
  ['수입', '벤츠', 'C-클래스', /W205/, '가솔린', 2015, 2021],
  ['수입', '벤츠', 'GLC-클래스', /X253/, '가솔린', 2017, 2022],
  ['수입', '아우디', 'A6', /C8/, '가솔린', 2020, 2025],
  ['수입', '볼보', 'XC60', /2세대/, '가솔린', 2018, 2025],
  ['수입', '폭스바겐', '티구안', /2세대/, '디젤', 2017, 2023],
  ['수입', '미니', '쿠퍼', /F56|3세대/, '가솔린', 2015, 2023],
  ['수입', '포드', '익스플로러', /6세대/, '가솔린', 2020, 2025],
];
// 우리 델타표 이름(엔카와 다른 것만)
const OUR_NAME = { 'GLC-클래스': 'GLC-클래스' };

async function yearRows(carType, maker, group, fuel, year, want = 400) {
  const q = `(And.Hidden.N._.SellType.일반._.Year.range(${year}00..${year}99)._.FuelType.${fuel}._.(C.CarType.${carType}._.(C.Manufacturer.${maker}._.ModelGroup.${group}.)))`;
  const out = []; let total = 0;
  for (let off = 0; off < want; off += 100) {
    const qs = new URLSearchParams({ count: 'true', q, sr: `|ModifiedDate|${off}|100` }).toString();
    let body;
    for (let n = 0; n < 4; n++) {
      try {
        const res = await fetch(`${BASE}?${qs}`, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.encar.com/' } });
        if (res.ok) { body = await res.json(); break; }
      } catch { /* retry */ }
      await sleep(1500 * (n + 1));
    }
    total = body?.Count ?? total;
    const rows = body?.SearchResults ?? [];
    for (const r of rows) {
      const price = Number(r.Price);
      if (!Number.isFinite(price) || price <= 0 || price === 10000 || price === 20000) continue;
      if (/^(\d)\1+$/.test(String(price))) continue;
      out.push({ price, km: Number(r.Mileage) || 0, model: String(r.Model ?? ''), badge: String(r.Badge ?? '') });
    }
    await sleep(600);
    if (!rows.length || off + 100 >= total) break;
  }
  return { rows: out, total };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const results = [];

for (const [origin, mk, grp, genRe, fuel, y0, y1] of COHORTS) {
  const carType = origin === '국산' ? 'Y' : 'N';
  const { d, seg } = deltaFor(mk, OUR_NAME[grp] ?? grp);
  const pts = []; const models = new Set(); const badgeCount = new Map(); const byYear = new Map();
  for (let y = y1; y >= y0; y--) {
    const { rows } = await yearRows(carType, mk, grp, fuel, y);
    const g = rows.filter((r) => genRe.test(r.model));
    for (const r of g) { models.add(r.model); badgeCount.set(r.badge, (badgeCount.get(r.badge) ?? 0) + 1); }
    byYear.set(y, g);
  }
  const topBadge = [...badgeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  for (const [y, g] of byYear) {
    if (g.length < 10) continue;
    const tb = g.filter((r) => r.badge === topBadge);
    pts.push({ y, age: NOW - y, n: g.length, med: med(g.map((r) => r.price)), km: med(g.map((r) => r.km)), nTop: tb.length, medTop: tb.length >= 6 ? med(tb.map((r) => r.price)) : null });
  }
  pts.sort((a, b) => a.age - b.age);
  console.log(`\n■ ${mk} ${grp} [${origin}] ${fuel} · 세대 ${[...models].join(' / ')} · 우리 델타 ${d} (${seg}) · 흔한 트림 「${topBadge}」`);
  console.log('    연식 나이  표본  중앙가   주행   | 흔한트림 표본 중앙가');
  for (const p of pts) console.log(`    ${p.y}  ${p.age}년  ${String(p.n).padStart(4)}  ${String(p.med).padStart(5)}만  ${String(Math.round(p.km / 1000)).padStart(3)}천km | ${String(p.nTop).padStart(3)}  ${p.medTop ?? '—'}${p.medTop ? '만' : ''}`);
  const at = new Map(pts.map((p) => [p.age, p]));
  for (const T of [3, 4]) {
    for (const p of pts) {
      const q2 = at.get(p.age + T);
      if (!q2) continue;
      const real = q2.med / p.med;
      const realTop = p.medTop && q2.medTop ? q2.medTop / p.medTop : null;
      const o = ours(d, p.age, T);
      results.push({ origin, mk, grp, fuel, a: p.age, T, real, realTop, ours: o, oursStd: ours(0, p.age, T), oursImp: ours(-8, p.age, T), d });
      console.log(`    ${p.age}년→${p.age + T}년(약정${T}년)  실측 ${(real * 100).toFixed(1)}%  흔한트림 ${realTop ? (realTop * 100).toFixed(1) + '%' : '—'}  우리 ${(o * 100).toFixed(1)}%`);
    }
  }
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}

const sum = {};
for (const r of results) {
  const k = `${r.origin} 약정${r.T}년`;
  sum[k] ??= { n: 0, real: 0, top: 0, nTop: 0, ours: 0, std: 0, imp: 0 };
  const s = sum[k]; s.n++; s.real += r.real; s.ours += r.ours; s.std += r.oursStd; s.imp += r.oursImp;
  if (r.realTop) { s.top += r.realTop; s.nTop++; }
}
console.log('\n=== 요약 (쌍 평균 · 지금 시세 대비 약정 끝 가치) ===');
for (const [k, s] of Object.entries(sum)) console.log(`${k}: 쌍 ${s.n} · 실측 ${(s.real / s.n * 100).toFixed(1)}% · 흔한트림 ${s.nTop ? (s.top / s.nTop * 100).toFixed(1) + '%' : '—'} · 우리 ${(s.ours / s.n * 100).toFixed(1)}% · (델타0 ${(s.std / s.n * 100).toFixed(1)}% / −8 ${(s.imp / s.n * 100).toFixed(1)}%)`);
