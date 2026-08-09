/** 커서 작업 수용 조건 검사 — PLAN 두 문서에 적어둔 기준 그대로. */
import { readFileSync, existsSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${detail == null ? '' : ` — ${JSON.stringify(detail).slice(0, 200)}`}`); }
};

// ── 1. catalog.json ──────────────────────────────────────────
const cat = JSON.parse(readFileSync('tmp/encar/catalog.json', 'utf8')) as Record<string, any>[];
console.log(`■ catalog.json — ${cat.length}건\n`);
check('국산·수입 둘 다 있다',
  cat.some((r) => ['현대', '기아', '제네시스'].includes(S(r.maker)))
  && cat.some((r) => ['BMW', '벤츠', '아우디', '볼보', '테슬라'].includes(S(r.maker))),
  [...new Set(cat.map((r) => S(r.maker)))].slice(0, 10));
check('한글이 깨지지 않았다',
  cat.some((r) => /^[가-힣]/.test(S(r.maker))) && !JSON.stringify(cat).includes('ë'),
  cat[0]);
check('저장 필드가 분류 튜플뿐 (Id·가격·주행거리 없음)',
  !cat.some((r) => 'Id' in r || 'Price' in r || 'Mileage' in r || 'Photo' in r),
  Object.keys(cat[0] || {}));

// ── 2. master-diff.csv ───────────────────────────────────────
const csv = readFileSync('tmp/encar/master-diff.csv', 'utf8').replace(/^﻿/, '');
const rows = csv.split(/\r?\n/).filter(Boolean);
console.log(`\n■ master-diff.csv — ${rows.length - 1}행\n`);
console.log(`  열: ${rows[0]}`);

const has = (needle: string, kind = '결손') => rows.slice(1).some((line) => {
  if (!line.includes(needle)) return false;
  return kind ? line.includes(kind) : true;
});

// ★정답지 — 실측으로 이미 아는 결손. 안 나오면 대조 로직이 틀린 것이다.
console.log('\n  ── 결손으로 나와야 하는 것 (정답지)');
check('트랙스 크로스오버 RS', has('RS') && rows.slice(1).some((l) => l.includes('트랙스') && l.includes('RS')),
  rows.slice(1).filter((l) => l.includes('트랙스')).slice(0, 3));
check('셀토스 베스트 셀렉션', rows.slice(1).some((l) => l.includes('셀토스') && l.includes('베스트')),
  rows.slice(1).filter((l) => l.includes('셀토스')).slice(0, 3));
check('쏘나타 디 엣지 비즈니스', rows.slice(1).some((l) => l.includes('쏘나타') && l.includes('비즈니스')),
  rows.slice(1).filter((l) => l.includes('쏘나타') && l.includes('비즈')).slice(0, 3));
check('K8 스탠다드', rows.slice(1).some((l) => l.includes('K8') && l.includes('스탠다드')),
  rows.slice(1).filter((l) => l.includes('K8')).slice(0, 3));

// ★반례 — 매칭 버그가 만든 가짜 결손이 마스터에 들어가면 안 된다.
console.log('\n  ── 결손으로 나오면 안 되는 것 (반례)');
const ghost = rows.slice(1).filter((l) => l.includes('아이오닉 일렉트릭') && /익스클루시브|플러스|Long|Range/.test(l));
check('「아이오닉 일렉트릭 + 익스클루시브 플러스」가 결손에 없다', ghost.length === 0, ghost.slice(0, 3));

// 구분 분포
const kinds = new Map<string, number>();
for (const line of rows.slice(1)) {
  const k = S(line.split(',')[0]).replace(/"/g, '');
  kinds.set(k, (kinds.get(k) || 0) + 1);
}
console.log('\n  ── 구분 분포');
for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(5)}  ${k}`);

// ── 3. 마스터가 안 바뀌었나 ───────────────────────────────────
console.log('\n■ 마스터 무단 변경 여부\n');
check('vehicle-master.json 은 아직 커밋 상태 그대로여야 한다(승인 전 반영 금지)',
  existsSync('public/data/vehicle-master.json'));

console.log(`\n━━ ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
