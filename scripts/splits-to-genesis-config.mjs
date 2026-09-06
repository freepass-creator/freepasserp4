#!/usr/bin/env node
/**
 * 검증된 split JSON(가격행 완전배정 mapOk=true) → genesis-config.json 엔트리.
 *   (사장님 2026-09-06 「옵션이 있고 어디까지 조합되는지 + 최소~최대 두 끝」)
 * 손으로 정밀검증한 GV80/GV80쿠페 엔트리는 «보존»하고, 나머지 모델을 이 변환으로 붙인다.
 * 섹션 키워드 → 배타그룹(필수 선택) / 자유(선택 품목·Genuine Parts).
 * min=base(전 기본) · 배타상한=base+각 배타그룹 최대(상호양립 확실) · 자유합=선택품목 양수합(패키지 포함중복 주의).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const NEW = ['gv70', 'g70', 'g80', 'g90', 'gv60'];   // 붙일 모델(GV80/쿠페는 보존)
const LABEL = { gv70: 'GV70', g70: 'G70', g80: 'G80', g90: 'G90', gv60: 'GV60 (EV)' };

function sectionKind(sec) {
  if (!sec) return null;
  if (sec.includes('엔진')) return '엔진';
  if (sec.includes('구동')) return '구동';
  if (sec.includes('인승')) return '인승';
  if (sec.includes('외장') || sec.includes('컬러')) return '외장 컬러';
  if (sec.includes('내장') && sec.includes('스포츠')) return '내장 디자인(스포츠)';
  if (sec.includes('내장')) return '내장 디자인';
  if (sec.includes('스포츠 패키지')) return '스포츠 패키지';
  if (sec.includes('휠')) return '휠 & 타이어';
  if (sec.includes('Genuine')) return 'GP';
  if (sec.includes('선택 품목') || sec.includes('패키지 선택')) return '자유';
  return null;
}

const MANDATORY = new Set(['엔진', '구동', '인승', '외장 컬러', '내장 디자인', '내장 디자인(스포츠)', '휠 & 타이어', '스포츠 패키지']);

function buildEntry(m) {
  const d = JSON.parse(readFileSync(`tmp/${m}-split.json`, 'utf8'));
  // 섹션 forward-fill
  let cur = null;
  const rows = d.options.map((o) => {
    const k = sectionKind(o.section);
    if (k) cur = k;
    return { ...o, kind: cur };
  });
  // 배타그룹: kind별로 묶되 default(0)+유료. 스포츠계열은 엔진분기라 pick 규칙만 표시.
  const groups = {};
  const free = [];
  for (const r of rows) {
    if (r.kind === '자유' || r.kind === 'GP') {
      free.push({ name: r.name || '(이름조각)', price: r.addWon, kind: r.kind === 'GP' ? 'Genuine Parts' : undefined });
    } else if (r.kind && MANDATORY.has(r.kind)) {
      (groups[r.kind] ||= []).push({ label: r.name || '(기본)', addWon: r.addWon, isDefault: !!r.isDefault });
    }
  }
  const exclusiveGroups = Object.entries(groups).map(([group, choices]) => ({
    group, pick: 1, status: 'xcheck', choices,
  }));
  // 배타상한: 각 배타그룹의 최대 addWon 합 (상호양립 확실). 단 엔진분기 휠/스포츠는 상한이 겹칠 수 있어 그룹최대만.
  const exclusiveCeil = exclusiveGroups.reduce((s, g) => s + Math.max(0, ...g.choices.map((c) => c.addWon)), 0);
  const freePositive = free.filter((f) => f.price > 0).reduce((s, f) => s + f.price, 0);
  const base = d.basePrice;
  return {
    model: m,
    label: LABEL[m],
    priceSource: `mtops ${m.toUpperCase()}_price.html — 가격행 ${d.priceRow.length}개 완전배정(mapOk). baseOffset=${d.baseOffset}. 재료=tmp/${m}-split.json`,
    basePrice: base,
    basePriceTax35: d.basePriceTax35 || null,
    isEV: /gv60|electrified|ev/i.test(m) || d.baseOffset >= 4,
    exclusiveGroups,
    freeOptions: { status: 'xcheck', items: free },
    minMax: {
      min: base,
      minConfig: '전 기본(모든 배타그룹 기본선택·유료선택 없음)' + (d.baseOffset >= 4 ? ' · base=세제혜택 후' : ''),
      exclusiveCeiling: base + exclusiveCeil,
      exclusiveCeilingNote: '배타그룹 최대선택 합(엔진·구동·인승·외장·휠·내장 등 상호양립 확실). 엔진분기 휠/스포츠가 중복계상될 수 있어 «상한»으로만.',
      freePositiveSum: freePositive,
      maxCandidate: base + exclusiveCeil + freePositive,
      maxStatus: '배타 상한후보 — 자유합은 패키지 포함중복(파퓰러 등)·상호배제·종속 미검증. 단순합 아님을 명시. 정밀 max 는 GV80처럼 포함관계 반영 필요.',
    },
    priceRowCheck: { count: d.priceRow.length, allMapped: d.mapOk, note: '가격행 완전배정 = 코덱스 22개 일치(GV80쿠페)와 같은 급 교차검증.' },
  };
}

const cfg = JSON.parse(readFileSync('data/new-car/genesis-config.json', 'utf8'));
const keep = cfg.models.filter((x) => x.model === 'gv80-coupe' || x.model === 'gv80');
cfg.models = [...keep, ...NEW.map(buildEntry)];
cfg._meta.updatedAt = '2026-09-06';
cfg._meta.note = (cfg._meta.note || '') + ' | GV80/쿠페=정밀(패키지 포함관계 반영). 나머지 5모델=split 자동변환(가격행 완전배정 검증, 정밀 max 는 후속).';
writeFileSync('data/new-car/genesis-config.json', JSON.stringify(cfg, null, 1));
console.log('models:', cfg.models.map((x) => `${x.model}(base ${x.basePrice?.toLocaleString?.() || x.basePrice})`).join(', '));
for (const m of NEW) {
  const e = cfg.models.find((x) => x.model === m);
  console.log(`  ${m}: 배타그룹 ${e.exclusiveGroups.length}, 자유 ${e.freeOptions.items.length}, min ${e.minMax.min.toLocaleString()}, 상한 ${e.minMax.exclusiveCeiling.toLocaleString()}, max후보 ${e.minMax.maxCandidate.toLocaleString()}`);
}
