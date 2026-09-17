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

/* ── ②½ **비슷한 색도 안 된다** — 같은 헥스만 막으면 못 잡는다 ─────────────────
   사장님 2026-09-17 「어떤 시트에 가더라도 시트는 같아야 하고 … 비슷한 새깔 있으면 안 되고」.
   ⚠ 그때까지 이 검사는 «똑같은 헥스»만 봤다. 그래서 중고구독(6B3DB3)과 오공구독(5B21B6)처럼
     눈으로 구별이 안 되는 쌍이 그냥 통과했다. 사람 눈의 거리(ΔE)로 잰다.
   ★잰 축: 판매시트 한 줄에 «나란히 서는» 것 — 상품구분 · 배차상태 · 미입력.
     제조사·연료는 «다른 칸»이라 여기서 빼둔다(그쪽과의 근접은 category-colors 머리말에 적어 두었다).
   ★ΔE 기준 — 같은 축 안 28(값이 헷갈리면 안 되는 자리) · 축끼리 22(사장님 「출고협의 주황 옆 중고구독 주황」).
     CIE76 근사다. 정확한 CIEDE2000 까지 갈 일은 아니고, 이 거리면 9pt 글자에서 갈린다. */
const LAB = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace(/^#/, ''), 16);
  const g = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const r = g((n >> 16) & 255), gg = g((n >> 8) & 255), b = g(n & 255);
  const X = (r * 0.4124 + gg * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + gg * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + gg * 0.1192 + b * 0.9505) / 1.08883;
  const k = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * k(Y) - 16, 500 * (k(X) - k(Y)), 200 * (k(Y) - k(Z))];
};
const ΔE = (a: string, b: string) => {
  const p = LAB(a), q = LAB(b);
  return Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
};
const 한줄 = [
  ...Object.entries(분류).map(([v, h]) => ({ 축: '상품구분', 값: v, hex: h.replace(/^#/, '') })),
  ...STATE_INK.map(([v, h]) => ({ 축: '배차상태', 값: v, hex: h })),
  { 축: '표시', 값: '미입력', hex: MISSING_INK },
];
for (let i = 0; i < 한줄.length; i++) {
  for (let j = i + 1; j < 한줄.length; j++) {
    const a = 한줄[i], b = 한줄[j];
    if (a.hex.toUpperCase() === b.hex.toUpperCase() && a.축 === b.축) continue;   // 같은 축의 같은 뜻(즉시출고=출고가능 파랑)은 정상
    const d = ΔE(a.hex, b.hex);
    const 기준 = a.축 === b.축 ? 28 : 22;
    must(d >= 기준,
      `색이 너무 비슷합니다(ΔE ${Math.round(d)} < ${기준}): ${a.축}:${a.값}(${a.hex}) ↔ ${b.축}:${b.값}(${b.hex}) — 9pt 글자에서 구별이 안 됩니다.`,
      `${CAT} ↔ ${FMT} · STATE_INK ↔ ${MVD}`);
  }
}

/* ── ③ 미입력 — 낱말과 색이 한 곳인가 · 배차상태 회색과 구별되는가 ─────────── */
must(MISSING_VALUE_LABEL === '미입력' && NOT_APPLICABLE_LABEL === '해당없음', '표시 낱말이 바뀌었습니다.', MVD);
must(J([...MISSING_DISPLAY_LABELS]) === J(['미입력', '해당없음']),
  `연한 회색으로 눕히는 낱말 목록이 바뀌었습니다: ${J([...MISSING_DISPLAY_LABELS])} — 「없음」은 업무 값이라 넣지 않습니다.`, MVD);
must(MISSING_INK === 'D9D9D9', `「미입력」 연한 회색(D9D9D9)이 바뀌었습니다: ${MISSING_INK}`, `${MVD} · MISSING_INK`);
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
  /**
   * ★**탭 색은 «글자색»이 아니다** — 같은 헥스가 겹쳐도 다른 물건이다(2026-09-17).
   *   `RETRO_TAB_COLOR` 는 F86 회사 탭의 «탭 꼬리 색»으로, 옛 시트에서 잰 값이다
   *   (아이언·우리캐피탈 FF00FF). 글자색 정본에서 가져올 수 있는 값이 아니라 우연히 같은 것이다.
   */
  'lib/domain/channel-retro-skin.ts',
  /**
   * ★**옛 발행기라 손대지 않는다** — `publish-jonghap-tab.mts` 는 폐기 계열이다
   *   (`publish-handover-tab.mts` 가 「옛 손오공 발행기 … 쓰지 마라」로 못 박아 두었다).
   *   그 안 551행에 옛 상품구분 색표가 남아 있다:
   *     ['신차','FF00FF'] ['재렌트','34A853'] ['재구독','FF9900'] ['신차구독','FF9900']
   *   ★이 표가 사장님이 「거기에 이미 다 정의해놨었어」 하신 원래 색의 «흔적»이다 —
   *     신차=분홍(FF00FF)이 여기서도 확인된다. 다만 재구독·신차구독이 둘 다 주황(FF9900)이라
   *     배차상태 「출고협의」와 겹쳤고, 그게 사장님 2026-08-18 「출고협의 주황 옆에 중고구독 주황 —
   *     이렇게 색깔이 비슷하면 안 되지」로 갈라진 자리다(→ 보라·청록).
   *   ⇒ 지금 정본은 그 «갈라진 뒤» 값이 맞다. 옛 발행기를 고치면 쓰지도 않는 길에 손대는 것이라
   *     기록만 남기고 둔다. 되살릴 일이 생기면 그때 정본에서 가져오게 고친다.
   */
  'scripts/publish-jonghap-tab.mts',
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
