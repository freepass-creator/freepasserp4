/**
 * **색·표시낱말 SSOT 잠금** — 「AI 가 임기응변으로 덧칠하지 못하게」.
 *
 * ★★★사장님 2026-09-16 「ssot 규격 통일하고 이거 이제 잠그자. 이제 더이상 뭐 한다고 할때 ai가
 *   임기응변으로 거기 덧칠하는게 아니라 ssot를 갖다가 쓰는거로」
 *
 * 하루 동안 같은 색이 세 곳에 따로 박혀 있어서 회차마다 다른 색이 나왔다 —
 * 상품구분이 `GUBUN_INK`·`byValue('분류')`·`TYPE_TONE` 셋에 각각 박혀 헥스가 서로 달랐고
 * (중고구독 7E57C2 ↔ 6B3DB3), 픽업구독은 «존재하지 않는 칸»을 겨눈 죽은 코드에 박혀 있어
 * 고쳐도 시트에 안 나왔다. 그래서 정본을 하나로 모으고, 그 밖에서 색을 적으면 여기서 멈춘다.
 *
 * 정본은 셋이다:
 *   ① 상품구분·제조사·연료… 값별 글자색  = `lib/domain/category-colors.ts` MASTER_CATEGORY_COLORS
 *   ② 배차상태 값별 글자색                = `lib/domain/sales-sheet-format.ts` STATE_INK
 *   ③ 「미입력」·「해당없음」 낱말과 색      = `lib/domain/missing-value-display.ts`
 *
 * ★바꾸려면 **정본 파일을 고친다.** 소비처에 헥스를 새로 적어서 통과시키지 마라 — 그게 이 검사가
 *   막으려는 바로 그 일이다.
 *
 *   npm run check:color-ssot
 */
import { readFileSync, readdirSync } from 'node:fs';
import { MASTER_CATEGORY_COLORS } from '../lib/domain/category-colors';
import { GUBUN_INK, STATE_INK } from '../lib/domain/sales-sheet-format';
import { TYPE_TONE } from '../lib/domain/supplier-template-sheet';
import { MISSING_INK, MISSING_VALUE_LABEL, NOT_APPLICABLE_LABEL, MISSING_DISPLAY_LABELS } from '../lib/domain/missing-value-display';
import { PRODUCT_TYPES } from '../lib/intake/entities';

const fails: string[] = [];
const must = (ok: boolean, what: string, where: string) => { if (!ok) fails.push(`${what}\n      → ${where}`); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const J = (v: unknown) => JSON.stringify(v);

const CAT = 'lib/domain/category-colors.ts · MASTER_CATEGORY_COLORS';
const FMT = 'lib/domain/sales-sheet-format.ts';
const MVD = 'lib/domain/missing-value-display.ts';

/* ── ① 상품구분 — 7캐논을 다 덮는가 · 소비처가 정본에서 파생되는가 ───────────── */
const 분류 = MASTER_CATEGORY_COLORS['분류'] ?? {};
const 빠진캐논 = PRODUCT_TYPES.filter((t) => !분류[t]);
must(빠진캐논.length === 0,
  `상품구분 색표에 캐논 ${빠진캐논.length}개가 빠졌습니다: ${빠진캐논.join('·')} — 색이 없으면 시트에서 «검정»으로 떠 값이 없는 칸처럼 보입니다.`,
  `${CAT}['분류'] — 캐논은 lib/intake/entities.PRODUCT_TYPES`);
const 군더더기 = Object.keys(분류).filter((v) => !(PRODUCT_TYPES as readonly string[]).includes(v));
must(군더더기.length === 0, `상품구분 색표에 캐논 밖 값이 있습니다: ${군더더기.join('·')} — 옛 표기라면 지웁니다.`, `${CAT}['분류']`);

/** 소비처 둘은 «정본에서 파생»되어야 한다 — 값을 다시 적으면 여기서 어긋난다. */
const 정본쌍 = Object.entries(분류).map(([v, hex]) => [v, hex.replace(/^#/, '')]).sort();
must(J([...GUBUN_INK].map(([v, h]) => [v, h]).sort()) === J(정본쌍),
  'GUBUN_INK 가 정본(MASTER_CATEGORY_COLORS[「분류」])과 다릅니다 — 판매시트 색을 따로 적고 있습니다.',
  `${FMT} · GUBUN_INK — ${CAT}`);
must(J(Object.entries(TYPE_TONE).sort()) === J(Object.entries(분류).sort()),
  'TYPE_TONE(공급사시트) 이 정본과 다릅니다 — 공급사시트 색을 따로 적고 있습니다.',
  `lib/domain/supplier-template-sheet.ts · TYPE_TONE — ${CAT}`);

/* ── ② 배차상태 — 값 여섯을 덮고, 상품구분 색과 겹치지 않는가 ───────────────── */
const 상태색 = new Map(STATE_INK);
for (const v of ['즉시출고', '출고가능', '상품화중', '출고협의', '계약중', '출고불가']) {
  must(!!상태색.get(v), `배차상태 「${v}」 색이 없습니다.`, `${FMT} · STATE_INK`);
}
/**
 * 사장님 2026-08-18 「출고협의 주황 옆에 중고구독 주황 — 이렇게 색깔이 비슷하면 안 되지」.
 * 상품구분과 배차상태가 «같은 헥스»면 두 칸이 한 뜻처럼 읽힌다.
 */
const 겹침 = Object.entries(분류).filter(([, hex]) => [...상태색.values()].includes(hex.replace(/^#/, '').toUpperCase()));
must(겹침.length === 0, `상품구분과 배차상태가 같은 색을 씁니다: ${겹침.map(([v, h]) => `${v} ${h}`).join(' · ')}`, `${CAT} ↔ ${FMT} · STATE_INK`);

/* ── ③ 미입력 — 낱말과 색이 한 곳인가 · 배차상태 회색과 구별되는가 ─────────── */
must(MISSING_VALUE_LABEL === '미입력' && NOT_APPLICABLE_LABEL === '해당없음', '표시 낱말이 바뀌었습니다.', MVD);
must(J([...MISSING_DISPLAY_LABELS]) === J(['미입력', '해당없음']),
  `연한 회색으로 눕히는 낱말 목록이 바뀌었습니다: ${J([...MISSING_DISPLAY_LABELS])} — 「없음」은 업무 값이라 넣지 않습니다.`, MVD);
must(MISSING_INK === 'B7B7B7', `「미입력」 연한 회색이 바뀌었습니다: ${MISSING_INK}`, `${MVD} · MISSING_INK`);
must(!([...상태색.values()].includes(MISSING_INK)),
  `「미입력」 색이 배차상태 색과 같습니다(${MISSING_INK}) — 「값 없는 칸」과 「못 파는 차」가 같은 무게로 보입니다.`, `${MVD} ↔ ${FMT}`);

/* ── ④ 정본 밖 하드코딩 금지 — 소비처에 헥스를 새로 적었는가 ───────────────── */
/**
 * 정본에 있는 헥스가 «다른 파일»에 글자로 박혀 있으면 그건 돌려쓰기가 아니라 «복사»다.
 * 복사는 한쪽만 고쳐질 때 갈라지고, 그게 하루 내내 색이 되돌아간 이유였다.
 */
const 정본헥스 = [...Object.values(분류).map((h) => h.replace(/^#/, '')), MISSING_INK]
  .map((h) => h.toUpperCase());
const 봄 = ['lib/domain', 'lib/server', 'scripts', 'components/ui'];
const 봐준다 = new Set([
  'lib/domain/category-colors.ts',             // ① 정본
  'lib/domain/missing-value-display.ts',        // ③ 정본
  'scripts/check-color-ssot.mts',               // 이 검사(정본 값을 글로 적어 잠근다)
  'scripts/check-f86-locked.mts',               // F86 확정 규격 잠금(같은 성격)
  // 회사(채널) 탭 배경색 — 2026-09-15 옛 시트를 실측해 그대로 옮긴 값이라 상품구분과 무관하다.
  // '아이언'·'우리캐피탈' 탭이 우연히 신차렌트와 같은 FF00FF를 쓰는 것뿐, 같은 사실의 복제가 아니다.
  'lib/domain/channel-retro-skin.ts',
]);
const 파일들: string[] = [];
const 훑기 = (dir: string) => {
  for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) 훑기(p);
    else if (/\.(ts|tsx|mts)$/.test(e.name)) 파일들.push(p);
  }
};
for (const d of 봄) 훑기(d);
for (const f of 파일들) {
  if (봐준다.has(f)) continue;
  const src = read(f);
  for (const hex of 정본헥스) {
    const re = new RegExp(`['"\`]#?${hex}['"\`]`, 'i');
    must(!re.test(src), `정본 색 ${hex} 가 여기 글자로 박혀 있습니다 — 정본에서 가져다 쓰세요(복사하면 한쪽만 고쳐져 갈라집니다).`, f);
  }
}

if (fails.length) {
  console.error(`\n⛔ 색·표시낱말 SSOT 가 어긋났습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  console.error('  바꾸려면: 정본 파일(category-colors · sales-sheet-format STATE_INK · missing-value-display)을 고칩니다.');
  console.error('  ⚠ 소비처에 헥스를 새로 적어 통과시키는 것은 규격을 지운 것과 같습니다.\n');
  process.exit(1);
}
console.log(`✓ 색·표시낱말 SSOT 그대로 — 상품구분 ${Object.keys(분류).length}캐논(정본 1곳·소비처 2곳 파생) · 배차상태 ${상태색.size}값 · 미입력 낱말 ${MISSING_DISPLAY_LABELS.length}·색 ${MISSING_INK} · 정본 밖 하드코딩 0 (훑은 파일 ${파일들.length})`);
