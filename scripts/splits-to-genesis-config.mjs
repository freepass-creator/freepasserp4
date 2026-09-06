#!/usr/bin/env node
/**
 * 검증된 split JSON(가격행 완전배정 mapOk=true) → genesis-config.json 엔트리.
 *   (사장님 2026-09-06 「옵션이 있고 어디까지 조합되는지 + 최소~최대 두 끝」)
 * 손으로 정밀검증한 GV80/GV80쿠페 엔트리는 «보존»하고, 나머지 모델을 이 변환으로 붙인다.
 * 섹션 키워드 → 배타그룹(필수 선택) / 자유(선택 품목·Genuine Parts).
 * min=base(전 기본) · 배타상한=base+각 배타그룹 최대(상호양립 확실) · 자유합=선택품목 양수합(패키지 포함중복 주의).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const NEW = ['gv70', 'g70', 'g80', 'gv60'];   // 자동생성. g90=손검증 특례(컬렉션 3중중첩·조건부가)·GV80/쿠페=손검증 → keep 로 보존
const LABEL = { gv70: 'GV70', g70: 'G70', g80: 'G80', g90: 'G90', gv60: 'GV60 (EV)' };
const PKGKEY = { gv70: 'GV70', g70: 'G70', g80: 'G80', g90: 'G90', gv60: 'GV60' };
const PKG = JSON.parse(readFileSync('data/new-car/genesis-pkg-includes.json', 'utf8'));  // 패키지→포함품
const norm = (s) => String(s || '').toLowerCase().replace(/[\s()·,&/\-Ⅰ-Ⅹⅰ-ⅹ]/g, '');

function sectionKind(sec) {
  if (!sec) return null;
  if (sec.includes('Genuine')) return 'GP';
  const mandatory = sec.includes('필수');   // 「필수 선택 사양/품목_…」 = 배타. 「선택 품목」(필수 없음) = 자유.
  if (mandatory) {
    if (sec.includes('엔진')) return '엔진';
    if (sec.includes('PE')) return 'PE 시스템(구동/성능)';   // ★코덱스: GV60 EV PE그룹 버려지던 것
    if (sec.includes('구동')) return '구동';
    if (sec.includes('인승')) return '인승';
    if (sec.includes('외장') || sec.includes('컬러')) return '외장 컬러';
    if (sec.includes('내장') && sec.includes('스포츠')) return '내장 디자인(스포츠)';
    if (sec.includes('내장')) return '내장 디자인';
    if (sec.includes('스포츠')) return '스포츠 패키지';
    if (sec.includes('휠')) return '휠 & 타이어';
    // 알 수 없는 «필수 선택» 섹션도 배타그룹으로 살린다(버리면 데이터 손실 — GV60 PE 사고)
    return sec.replace(/^필수 선택 (사양|품목)_/, '').trim() || '기타 필수';
  }
  if (sec.includes('선택 품목') || sec.includes('패키지 선택')) return '자유';
  return null;
}

// 중복 카테고리(일반/스포츠 내장·휠)는 상호배제 경로라 «최대 하나»만 상한에 센다(코덱스 이중계상 지적).
function ceilCategory(group) {
  if (group.includes('내장 디자인')) return '내장 디자인';
  if (group.includes('휠')) return '휠 & 타이어';
  return group;
}

const MANDATORY = new Set(['엔진', 'PE 시스템(구동/성능)', '구동', '인승', '외장 컬러', '내장 디자인', '내장 디자인(스포츠)', '휠 & 타이어', '스포츠 패키지']);

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
    } else if (r.kind) {
      // 자유/GP 가 아니면 전부 배타(필수 선택). 알 수 없는 섹션도 여기로 — 버리지 않는다(GV60 PE 사고).
      (groups[r.kind] ||= []).push({ label: r.name || '(기본)', addWon: r.addWon, isDefault: !!r.isDefault });
    }
  }
  const exclusiveGroups = Object.entries(groups).map(([group, choices]) => ({
    group, pick: 1, status: 'xcheck', choices,
  }));
  // 배타상한: 중복 카테고리(일반/스포츠 내장·휠)는 상호배제 경로라 «카테고리별 최대 하나»만 센다(코덱스 이중계상 지적).
  const catMax = {};
  for (const g of exclusiveGroups) {
    const cat = ceilCategory(g.group);
    const gmax = Math.max(0, ...g.choices.map((c) => c.addWon));
    catMax[cat] = Math.max(catMax[cat] || 0, gmax);
  }
  const exclusiveCeil = Object.values(catMax).reduce((s, v) => s + v, 0);
  const hasSportPath = exclusiveGroups.some((g) => /스포츠/.test(g.group));
  const freePos = free.filter((f) => f.price > 0);
  const freePositive = freePos.reduce((s, f) => s + f.price, 0);
  const base = d.basePrice;

  // ★정밀 max — 패키지는 «할인 번들»이라 max 는 개별을 다 사는 것(개별합≥번들가). 번들 라인은 뺀다.
  //   번들 = 그 포함품이 «다른 유료옵션 이름»을 2개 이상 담는 패키지(파퓰러 등). 컨비니언스처럼 하위기능만
  //   담는 «기능 패키지»는 개별 옵션으로 그대로 센다.
  const pkgIncludes = (PKG[PKGKEY[m]] || []);
  const pricedNames = freePos.map((f) => norm(f.name));
  const bundleNames = new Set();
  for (const p of pkgIncludes) {
    const incs = String(p.includes || '').split(/[,·]/).map(norm).filter(Boolean);
    const hits = incs.filter((inc) => pricedNames.some((pn) => pn && (pn.includes(inc) || inc.includes(pn)) && pn.length > 3)).length;
    if (hits >= 2) bundleNames.add(norm(p.name));   // 2개 이상 다른 유료옵션을 포함 = 할인 번들
  }
  // 사이드스텝 등 명백한 배타쌍은 최고 하나만
  const isSideStep = (n) => /사이드스텝|사이드 스텝/.test(n);
  let sideMax = 0;
  const preciseItems = [];
  for (const f of freePos) {
    if (bundleNames.has(norm(f.name))) continue;      // 번들 제외(개별로 대체)
    if (isSideStep(f.name)) { sideMax = Math.max(sideMax, f.price); continue; }
    preciseItems.push(f);
  }
  const freePrecise = preciseItems.reduce((s, f) => s + f.price, 0) + sideMax;
  const bundlesExcluded = [...bundleNames];
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
      minConfig: '전 기본(배타그룹 기본선택·유료선택 없음)' + (d.baseOffset >= 4 ? ' · base=세제혜택 후' : '')
        + (hasSportPath ? ' ⚠스포츠 패키지엔 「미선택 0원」 선택지가 원문에 없어 순수 기본구성 확정은 BTO 재확인' : ''),
      exclusiveCeiling: base + exclusiveCeil,
      exclusiveCeilingNote: '배타그룹 카테고리별 최대선택 합. 일반/스포츠 내장·휠은 상호배제 경로라 «카테고리당 하나»만 셌다(코덱스 이중계상 지적 반영).'
        + (hasSportPath ? ' 단 스포츠 내장·휠은 스포츠 패키지 선택이 전제라 실제 경로 유효성은 BTO 재확인 필요.' : ''),
      freePositiveSum: freePositive,
      maxCandidate: base + exclusiveCeil + freePositive,
      maxPrecise: base + exclusiveCeil + freePrecise,
      maxPreciseConfig: `base + 배타상한 ${exclusiveCeil.toLocaleString()} + 자유(번들 제외 개별합) ${freePrecise.toLocaleString()}`,
      bundlesExcluded: bundlesExcluded.length ? `${bundlesExcluded.length}개 번들 제외(개별로 대체): ${pkgIncludes.filter((p)=>bundleNames.has(norm(p.name))).map((p)=>p.name).join(', ')}` : '번들 없음',
      maxStatus: 'maxPrecise=풀옵션(할인번들 대신 개별 다 구매·개별합≥번들가). 남은 오차 = 개별 간 상호배제(파노라마↔투톤 등)·종속·연료분기 — BTO 재확인.'
        + (m === 'g90' ? ' ★G90은 컬렉션이 3중 중첩(파퓰러⊂프리미엄⊂프레스티지)이라 번들판별 휴리스틱에 오차 가능(뒷좌석컴포트 과다제외 소지) — 코덱스 교차검증 대상. 프레스티지 전용 「전동 뒷좌석 듀얼모니터」는 개별가 없어 미포함.' : '')
        + ' maxCandidate 는 번들 미제거 단순합(비교용).',
    },
    priceRowCheck: { count: d.priceRow.length, allMapped: d.mapOk, note: '가격행 완전배정 = 코덱스 22개 일치(GV80쿠페)와 같은 급 교차검증.' },
  };
}

const cfg = JSON.parse(readFileSync('data/new-car/genesis-config.json', 'utf8'));
const keep = cfg.models.filter((x) => x.model === 'gv80-coupe' || x.model === 'gv80' || x.model === 'g90');
cfg.models = [...keep, ...NEW.map(buildEntry)];
cfg._meta.updatedAt = '2026-09-06';
cfg._meta.note = 'min=기본구성 · maxCandidate=배타상한+자유 단순합(번들 미제거·비교용) · maxPrecise=풀옵션(할인번들 대신 개별 다 구매, 개별합≥번들가). GV80/쿠페=손검증 정밀. 나머지 5모델=split 자동변환(가격행 완전배정 mapOk + 패키지 포함관계로 정밀 max). G90=패키지 추출 실패로 maxPrecise 미반영(수작업 필요). 남은 오차=개별 간 상호배제·종속·연료분기(BTO 재확인).';
writeFileSync('data/new-car/genesis-config.json', JSON.stringify(cfg, null, 1));
console.log('models:', cfg.models.map((x) => `${x.model}(base ${x.basePrice?.toLocaleString?.() || x.basePrice})`).join(', '));
for (const m of NEW) {
  const e = cfg.models.find((x) => x.model === m);
  console.log(`  ${m}: 배타그룹 ${e.exclusiveGroups.length}, 자유 ${e.freeOptions.items.length}, min ${e.minMax.min.toLocaleString()}, 상한 ${e.minMax.exclusiveCeiling.toLocaleString()}, max후보 ${e.minMax.maxCandidate.toLocaleString()}`);
}
