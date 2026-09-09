/**
 * **발행기는 «차 줄»을 시트에서 읽지 않는다 — 원자에서 읽는다.** 어기면 exit 1.
 *
 * > 사장님 2026-09-09 「당겨오는 거는 **원자 쪽에서** 당겨오는 거고 …
 * >  네가 **시트까지 원자가 갖고 왔다고 가정하고 그 갖고 온 원자에서 다 주는** 거잖아」
 *
 * ⚠⚠ 실측 2026-09-09 — 이 규칙이 두 곳에서 깨져 있었다.
 * ```
 *   F86 채널시트   F01 의 네 탭을 values/'탭'!A1:CZ3000 으로 통째로 다시 읽어 줄을 만들었다
 *   F01 본시트     「차번링크」를 손오공 재고시트 「픽업재고」 탭에서 발행할 때마다 읽었다
 * ```
 *   발행기가 원천·상위시트를 읽으면 셋이 따라온다:
 *   ㉠ 그 시트가 잠깐 안 읽히는 회차엔 **칸이 통째로 빈다 — 그런데 로그는 성공으로 찍힌다**
 *   ㉡ 원자만 보는 곳(ERP·화이트라벨)은 그 값을 **영영 모른다** — 목적지마다 아는 것이 달라진다
 *   ㉢ 같은 규칙이 두 벌로 적혀 한쪽만 고치면 갈린다(실제로 공급사명·정렬이 갈렸다)
 *
 * ★**시트에서 읽어도 되는 것 둘**
 *   · **머리글 한 줄**(`A1:…1`) — 열 이름은 여전히 판매시트가 정한다(사장님 「이미 정답이 있는데」).
 *   · **문패**(공급사시트정리) — 공급사 «이름표»지 차 데이터가 아니다.
 *   그 밖에 «두 줄 이상»을 읽으면 그건 차 줄을 읽는 것이다.
 *
 *   npx tsx scripts/check-publishers-read-atoms.mts
 */
import { readFileSync } from 'node:fs';

/** 발행기 = 원자를 목적지로 내보내는 곳. 여기에 새 발행기를 더하면 이 명단에도 더한다. */
const 발행기 = [
  'scripts/make-sample-sheet-google.mts',      // 상품리스트 F01(본시트)
  'scripts/build-channel-supplier-sheet.mts',  // 채널 전용 상품시트 F86(하허호)
  'lib/domain/sales-atom-row.ts',              // 둘이 같이 쓰는 줄 만들기·문맥
];

/** 문패 = 공급사 이름표. 차 데이터가 아니라 허용한다. */
const 문패 = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';

/** 원천을 직접 읽는 표식 — 발행기에 있으면 안 된다. */
const 원천표식: [RegExp, string][] = [
  [/손오공차량\.json/, '손오공 API 덤프를 발행기가 직접 읽는다'],
  [/mirror-iron-source|ironrentcar-source/, '아이언 홈페이지를 발행기가 직접 읽는다'],
  [/reborncar/, '오플 홈페이지를 발행기가 직접 읽는다'],
  [/hubSourceMap|HUB_CODE_SHEET_ID/, '공급사 원천 주소를 발행기가 들고 있다(수집기 몫이다)'],
];

const 어긋남: string[] = [];
for (const f of 발행기) {
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { 어긋남.push(`${f} — 파일이 없다(명단을 고쳐라)`); continue; }
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    if (/^\s*\*/.test(line) || /^\s*\/\//.test(line)) return;   // 주석은 규칙이 아니다

    /**
     * `values/…!A1:CZ3000` 처럼 «두 줄 이상»을 읽는 자리를 잡는다.
     * 머리글만 읽는 `!A1:BZ1` 은 통과 — 끝 행이 1 이다.
     */
    for (const m of line.matchAll(/!A1:([A-Z]{1,2})(\d+)/g)) {
      if (Number(m[2]) <= 1) continue;
      if (line.includes(문패)) continue;
      어긋남.push(`${f}:${i + 1} — 시트에서 «${m[0]}»를 읽는다(차 줄은 원자에서 온다)\n      ${line.trim().slice(0, 120)}`);
    }
    for (const [re, why] of 원천표식) {
      if (re.test(line)) 어긋남.push(`${f}:${i + 1} — ${why}\n      ${line.trim().slice(0, 120)}`);
    }
  });

  /** 발행기 한 곳은 반드시 원자를 읽어야 한다 — 「아무것도 안 읽는 발행기」는 껍데기다. */
  if (f.startsWith('scripts/') && !/collection\('products'\)/.test(src)) {
    어긋남.push(`${f} — 원자(products)를 읽지 않는다. 무엇을 내보내는지 알 수 없다`);
  }
}

console.log(`\n■ 발행기는 원자에서 읽는가 — ${발행기.length}곳`);
if (!어긋남.length) {
  console.log('  ✓ 모두 원자에서 읽는다(시트에서는 머리글·문패만).\n');
  process.exit(0);
}
console.error(`  ⛔ 어긋남 ${어긋남.length}`);
for (const x of 어긋남) console.error(`    ${x}`);
console.error('\n  고치는 법 — 그 값을 «수집기»가 원자에 박게 하고, 발행기는 원자만 읽는다.');
console.error('  규칙 정본 = docs/원자-내려보내기-로직.md\n');
process.exit(1);
