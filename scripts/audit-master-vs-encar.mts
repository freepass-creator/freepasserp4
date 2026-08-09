/**
 * 차종마스터 ↔ 엔카 **전면 정합성 검사** — 우리 재고와 무관하게 마스터 전체를 본다.
 *
 * 재고에 걸린 것만 보면 마스터의 나머지가 맞는지 영영 모른다.
 * 여기서는 마스터 1,809행 전부를 엔카 4,606 조합과 맞대 본다.
 *
 *   OUT=tmp/encar/consistency.csv npx tsx scripts/audit-master-vs-encar.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { realMasterTrims } from '../lib/domain/vehicle-master-options';
import { TRIM_ALIAS, TRIM_TYPO } from '../lib/domain/vehicle-trim-resolve';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();

/**
 * ★비교 전용 표기 접기.
 *
 * 「GT Line」과 「GT라인」은 **같은 트림**이다. 접지 않고 글자로 비교하면
 * 한쪽은 「결손」, 다른 쪽은 「우리만」으로 **양쪽에 중복 계상된다** —
 * 그러면 결손 수가 부풀고, 있지도 않은 트림을 마스터에 넣게 된다.
 * 이 표는 비교에만 쓴다. 마스터에 저장하는 표기는 건드리지 않는다.
 */
const CMP_ALIAS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TRIM_ALIAS).map(([en, ko]) => [en, ko])),
  line: '라인', black: '블랙', edition: '에디션', plus: '플러스', special: '스페셜',
  sport: '스포츠', dynamic: '다이내믹', comfort: '컴포트', elegance: '엘레강스',
  select: '셀렉트', selection: '셀렉션', best: '베스트', urban: '어반', active: '액티브',
  classic: '클래식', essential: '에센셜', techno: '테크노', intense: '인텐스',
};
const fold = (v: string): string => {
  let t = S(v).toLowerCase();
  for (const [en, ko] of Object.entries(CMP_ALIAS)) if (t.includes(en)) t = t.split(en).join(ko);
  for (const [typo, real] of Object.entries(TRIM_TYPO)) if (t.includes(typo)) t = t.split(typo).join(real);
  return t.replace(/[\s\-_()[\]{}/·.,]/g, '');
};

/** 엔카가 트림칸에 실어 보내는 «트림 아닌 것» — 우리 축으로는 인승·개조이력이다. */
const NOT_A_TRIM = /^\s*(\d+인승|구조변경|특장|택시|장애인|영업용|자가용|밴|무사고|리스|할부)/;
const stripSeats = (v: string) => S(v).replace(/^\s*\d+\s*인승\s*/, '').trim();

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: Rec[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const cat: Rec[] = JSON.parse(readFileSync('tmp/encar/catalog.json', 'utf8'));
const subMap = new Map<string, string>();
try {
  const lines = readFileSync('tmp/encar/sub-map.csv', 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) || [];
    const enc = S(cells[1]).replace(/^"|"$/g, '').replace(/""/g, '"');
    const ours = S(cells[2]).replace(/^"|"$/g, '').replace(/""/g, '"');
    if (enc && ours) subMap.set(enc, ours);
  }
} catch { /* 없으면 이름 그대로 맞춰본다 */ }

/** 마스터: 세대 → 트림 집합 */
const masterTrims = new Map<string, Set<string>>();
const masterMaker = new Map<string, string>();
for (const e of entries) {
  const sub = S(e.sub_model);
  if (!sub) continue;
  if (!masterTrims.has(sub)) masterTrims.set(sub, new Set());
  masterMaker.set(sub, S(e.maker));
  const set = masterTrims.get(sub)!;
  for (const t of realMasterTrims((e.trims || []) as never)) if (S(t)) set.add(S(t));
  for (const v of (e.variants || []) as Rec[]) {
    for (const t of realMasterTrims((v.trims || []) as never)) if (S(t)) set.add(S(t));
  }
}

/** 엔카: 세대 → 트림 집합(+매물수) */
const encarTrims = new Map<string, Map<string, number>>();
const encarUnmapped = new Map<string, number>();
let notTrimRows = 0;
for (const r of cat) {
  const encSub = S(r.sub_model);
  const ours = subMap.get(encSub) || (masterTrims.has(encSub) ? encSub : '');
  if (!ours) { encarUnmapped.set(encSub, (encarUnmapped.get(encSub) || 0) + (Number(r.n) || 0)); continue; }
  /**
   * ★트림은 `BadgeDetail` 뿐이다. `Badge` 를 트림 자리로 끌어올리면 안 된다.
   *
   * 엔카 4단은 제조사 → Model(세대) → **Badge(파워트레인)** → BadgeDetail(트림) 이다.
   * BadgeDetail 이 비거나 「(세부등급 없음)」이면 **그 차는 트림이 없다는 뜻**이다 —
   * 요즘 제네시스가 그렇다(사장님 확인). 그런데 Badge 로 폴백하면
   * 「2.5T 가솔린 AWD」·「가솔린 9인승 시그니처」가 트림으로 둔갑해
   * 결손이 1,933건으로 부풀고, 마스터에 파워트레인을 트림으로 심게 된다.
   */
  const trim = stripSeats(S(r.badge_detail));
  if (!trim || /없음/.test(trim)) continue;
  if (NOT_A_TRIM.test(trim)) { notTrimRows++; continue; }
  if (!encarTrims.has(ours)) encarTrims.set(ours, new Map());
  const m = encarTrims.get(ours)!;
  m.set(trim, (m.get(trim) || 0) + (Number(r.n) || 0));
}

type Row = { kind: string; maker: string; sub: string; trim: string; encarN: number; note: string };
const rows: Row[] = [];
let same = 0; let spell = 0; let missing = 0; let oursOnly = 0;

for (const [sub, mset] of masterTrims) {
  const maker = masterMaker.get(sub) || '';
  const eMap = encarTrims.get(sub);
  const mFold = new Map<string, string>();
  for (const t of mset) mFold.set(fold(t), t);

  if (!eMap) {
    rows.push({ kind: '엔카에 그 세대 없음', maker, sub, trim: '', encarN: 0,
      note: mset.size ? `마스터 트림 ${mset.size}개 — 중고시장에 안 도는 차(신차·법인·단종)일 수 있다` : '마스터도 트림 목록 없음' });
    continue;
  }
  const eFold = new Map<string, string>();
  for (const t of eMap.keys()) eFold.set(fold(t), t);

  for (const [f, ours] of mFold) {
    if (eFold.has(f)) {
      if (ours === eFold.get(f)) same++;
      else { spell++; rows.push({ kind: '표기차', maker, sub, trim: ours, encarN: eMap.get(eFold.get(f)!) || 0, note: `엔카「${eFold.get(f)}」 — 뜻은 같다. 마스터 표기 유지, 오탈자 사전에만 넣을 것` }); }
    } else { oursOnly++; rows.push({ kind: '우리만', maker, sub, trim: ours, encarN: 0, note: '엔카에 없음 — 지우지 말 것(신차·법인·특장)' }); }
  }
  for (const [f, enc] of eFold) {
    if (mFold.has(f)) continue;
    const n = eMap.get(enc) || 0;
    missing++;
    rows.push({ kind: '결손', maker, sub, trim: enc, encarN: n,
      note: n < 3 ? '엔카 매물 3대 미만 — 오등록일 수 있다. 넣지 말 것' : `마스터 이웃: ${[...mset].slice(0, 5).join(' · ') || '(트림 목록 자체가 없음)'}` });
  }
}

console.log('■ 차종마스터 ↔ 엔카 전면 정합성 (재고 무관)\n');
console.log(`  마스터 세대 ${masterTrims.size}종 · 엔카 조합 ${cat.length}건 · 세대 대응표 ${subMap.size}건\n`);
console.log(`  일치(글자까지 같음)        ${String(same).padStart(5)}`);
console.log(`  표기차(뜻 같고 글자 다름)   ${String(spell).padStart(5)}   ← 마스터 표기 유지 · 오탈자 사전행`);
console.log(`  결손(엔카O 마스터X)        ${String(missing).padStart(5)}   ← 보강 후보`);
console.log(`     그중 엔카 3대 이상       ${String(rows.filter((r) => r.kind === '결손' && r.encarN >= 3).length).padStart(5)}   ← 실제 대상`);
console.log(`  우리만(마스터O 엔카X)      ${String(oursOnly).padStart(5)}   ← 지우지 말 것`);
console.log(`  엔카에 그 세대 자체가 없음   ${String(rows.filter((r) => r.kind === '엔카에 그 세대 없음').length).padStart(5)}`);
console.log(`\n  엔카 세대인데 우리 세대로 못 이은 것 ${encarUnmapped.size}종`);
console.log(`  엔카 트림칸의 «트림 아닌 값»(인승·구조변경·특장) 걸러낸 조합 ${notTrimRows}건`);

console.log('\n── 결손 상위 20 (엔카 매물 많은 순)');
for (const r of rows.filter((x) => x.kind === '결손' && x.encarN >= 3).sort((a, b) => b.encarN - a.encarN).slice(0, 20)) {
  console.log(`  ${String(r.encarN).padStart(5)}대  ${r.sub.slice(0, 22).padEnd(24)} ${r.trim}`);
}
console.log('\n── 엔카에 없는 우리 세대 상위 10 (마스터가 더 넓은 부분)');
for (const r of rows.filter((x) => x.kind === '엔카에 그 세대 없음').slice(0, 10)) console.log(`  ${r.sub.slice(0, 30).padEnd(32)} ${r.note}`);

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [['구분', '제조사', '세대', '트림', '엔카매물수', '비고'].join(','),
    ...rows.sort((a, b) => b.encarN - a.encarN)
      .map((r) => [r.kind, r.maker, r.sub, r.trim, String(r.encarN), r.note].map(esc).join(','))].join('\r\n');
  writeFileSync(out, '﻿' + csv, 'utf8');
  console.log(`\nCSV: ${out} (${rows.length}행)`);
}
