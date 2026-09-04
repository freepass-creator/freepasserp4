/**
 * **정산 시트에서 «확정된 것»이 사라지지 않게 지킨다.**
 *
 * ★★★사장님 2026-09-04 「잘 되돌렸고 그 뭐 이어서 **보안이나 매뉴얼 이런 것 좀 제대로 만들어주고**」
 *
 * ★**왜 필요한가 — 하루에 두 번 사라졌다.**
 * ```
 * ① 상대가 고친 칸을 우리가 덮었다   하허호 최사랑 팀장 「새로 고침 되면서 다시 원상태로 돌아가네용」
 * ② 우리 커밋이 이력에서 사라졌다     f72e0c0c(확인·정정·정정금액 넉 칸)가 통째로 떨어져 나갔고,
 *                                작업본의 SETTLE_NOTE 도 옛 두 칸으로 되돌아가 있었다
 * ```
 *   문서만으로는 안 지켜진다. 다음 세션은 문서를 안 읽고 코드부터 고치고,
 *   다른 도구는 이력을 다시 쓴다. **기계가 잡아야 한다.**
 *
 * ★바꾸려면 차례를 지킨다 — **사장님께 여쭙고 → `docs/정산시트-매뉴얼.md` 를 고치고 → 이 검사를 고친다.**
 *   ⚠ 이 검사를 «먼저» 고쳐서 통과시키는 것은 규격을 지운 것과 같다.
 *
 *   npm run check:settlement
 */
import { readFileSync } from 'node:fs';
import { CHANNEL_SETTLE_HEAD, CHANNEL_SETTLE_WIDTH, SETTLE_NOTE } from '../lib/server/channel-sheet-tabs';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fails: string[] = [];
const must = (ok: boolean, what: string, where: string) => { if (!ok) fails.push(`${what}\n      → ${where}`); };

const tabs = read('lib/server/channel-sheet-tabs.ts');
const chan = read('scripts/publish-channel-settlement.mts');
const sup = read('scripts/publish-supplier-settlement.mts');
const hist = read('scripts/import-channel-history.mts');
const edits = read('lib/server/sheet-edits.ts');
const outward = read('lib/domain/outward-text.ts');
const manual = 'docs/정산시트-매뉴얼.md';

/* ── ① 칸 규격 — 상대가 적는 넉 칸 ──────────────────────────────
   사장님 2026-09-04 「수수료 박스에 확인 정정 정정금액 이렇게 하자」 · 「메모(정정사유) 이렇게」   */
must(/SETTLE_NOTE = \['확인', '정정', '정정금액', '메모\(정정사유\)'\]/.test(tabs),
  '상대가 적는 넉 칸(확인·정정·정정금액·메모(정정사유))이 바뀌었습니다. 2026-09-04 에 한 번 두 칸으로 되돌아간 적이 있습니다.',
  `lib/server/channel-sheet-tabs.ts · SETTLE_NOTE — ${manual} §칸 규격`);

/* 하허호가 시트 메모로 요청한 넉 칸(2026-09-04) — 「헤더에 보증금 납입방식, 영업사 명, 신차인 경우 차량 가격도」 */
for (const col of ['차량 가격(신차)', '영업사', '보증금', '납입 방식']) {
  must(tabs.includes(`'${col}'`),
    `달 탭 머리글에서 「${col}」 칸이 빠졌습니다. 하허호가 시트 메모로 요청해 붙인 칸입니다.`,
    `lib/server/channel-sheet-tabs.ts · CHANNEL_SETTLE_HEAD — ${manual} §칸 규격`);
}

/**
 * 칸 수와 너비 수가 어긋나면 마지막 칸들이 기본 너비로 서고 표가 통째로 어그러진다.
 * ⚠ **정규식으로 세지 않는다** — `...SETTLE_NOTE` 처럼 펼쳐지는 것이 섞여 있어 글자로는 못 센다.
 *   실제로 «불러와서» 센다.
 */
must(CHANNEL_SETTLE_HEAD.length === CHANNEL_SETTLE_WIDTH.length,
  `머리글 ${CHANNEL_SETTLE_HEAD.length}칸인데 너비는 ${CHANNEL_SETTLE_WIDTH.length}개입니다. 칸을 더할 때 너비도 «같이» 더해야 합니다.`,
  `lib/server/channel-sheet-tabs.ts · CHANNEL_SETTLE_HEAD / CHANNEL_SETTLE_WIDTH — ${manual} §칸 규격`);
/** 돈 칸은 «수수료 박스»가 끝나는 자리에 서고, 상대가 적는 넉 칸은 그 뒤다. */
must(CHANNEL_SETTLE_HEAD.slice(-SETTLE_NOTE.length).join('|') === SETTLE_NOTE.join('|'),
  '상대가 적는 넉 칸이 표 «맨 뒤»에 있지 않습니다. 사장님 2026-09-04 「뒤에 정정금액 칸을 만들어」.',
  `lib/server/channel-sheet-tabs.ts · CHANNEL_SETTLE_HEAD — ${manual} §칸 규격`);

/* ── ② 서식은 한 곳에서만 ────────────────────────────────────
   발행기가 둘(달 탭·지난 기록)이라, 서식을 각자 적으면 같은 시트 안에서 탭마다 생김새가 갈린다. */
must(/export function settleTabFormat/.test(tabs),
  '탭 서식 정본(settleTabFormat)이 사라졌습니다.',
  `lib/server/channel-sheet-tabs.ts — ${manual} §서식은 한 곳`);
for (const [name, src] of [['publish-channel-settlement', chan], ['import-channel-history', hist]] as const) {
  must(/settleTabFormat\(/.test(src),
    `${name} 가 서식을 «따로» 짓고 있습니다. settleTabFormat 을 써야 탭마다 생김새가 안 갈립니다.`,
    `scripts/${name}.mts — ${manual} §서식은 한 곳`);
}
/* 글꼴은 맨 나중에 깔린다 — 먼저 깔면 뒤에 오는 textFormat 이 글꼴까지 통째로 덮는다. */
{
  const body = /export function settleTabFormat[\s\S]*$/.exec(tabs)?.[0] || '';
  const font = body.indexOf("fontFamily: 'Roboto'");
  const bar = body.indexOf('bar(1, true)');
  must(font > bar && bar > 0,
    '글꼴(Roboto)을 남색 머리줄보다 «먼저» 깔고 있습니다. 그러면 머리글 글꼴이 기본으로 돌아갑니다.',
    `lib/server/channel-sheet-tabs.ts · settleTabFormat — ${manual} §서식 차례`);
}

/* ── ③ 보안 빗장 — 두 시트는 서로의 축을 못 본다 ──────────────────
   사장님 2026-09-03 「절대 영업자 지급 수수료가 얼만지 공급사시트에는 반영되면 안돼」            */
must(/const FORBIDDEN = \/청구\|받을\|이익\|마진\|claimWritten\|supplierRate\//.test(chan),
  '영업채널 시트의 «청구액 빗장»이 사라졌습니다. 채널이 우리 청구액을 보면 우리 몫이 그대로 드러납니다.',
  `scripts/publish-channel-settlement.mts · FORBIDDEN — ${manual} §보안 빗장`);
/**
 * 공급사 시트도 «같은 넉 칸»을 쓴다 — 한쪽만 고치면 다른 쪽을 볼 때마다 「또 바뀌었다」가 된다
 * (CLAUDE.md 「규칙을 정하면 양쪽에 한 번에 적용한다」).
 */
must(/const NOTE = SETTLE_NOTE;/.test(sup),
  '공급사 시트가 채널과 «다른» 상대 칸을 쓰고 있습니다. 넉 칸은 양쪽이 같아야 합니다.',
  `scripts/publish-supplier-settlement.mts · NOTE — ${manual} §칸 규격`);
/** 예정분도 양쪽에 — 사장님 2026-09-04 「영업자랑 공급사에 9 10 11월꺼 정산할거 미리 반영해두자고」. */
must(/const FORECAST = MONTH > CLOSED/.test(sup),
  '공급사 시트에 «예정분» 규칙이 없습니다. 영업자랑 공급사 양쪽에 미리 반영하기로 했습니다.',
  `scripts/publish-supplier-settlement.mts · FORECAST — ${manual} §달 규칙`);
must(!/settlementMonthOf\(asRow\(/.test(sup),
  '공급사 발행기가 settlementMonthOf 에 asRow(r) 를 넘깁니다. 예정 줄이 하나도 안 잡힙니다.',
  `scripts/publish-supplier-settlement.mts — ${manual} §달 규칙`);
must(/const FORBIDDEN = \/지급\|영업/.test(sup),
  '공급사 시트의 «지급액 빗장»이 사라졌습니다. 공급사가 영업 지급 수수료를 보면 안 됩니다.',
  `scripts/publish-supplier-settlement.mts · FORBIDDEN — ${manual} §보안 빗장`);
/** 빗장은 «걸리면 멈춰야» 빗장이다 — 세기만 하고 지나가면 없는 것과 같다. */
for (const [name, src] of [['publish-channel-settlement', chan], ['publish-supplier-settlement', sup]] as const) {
  must(/leak\.length[\s\S]{0,200}process\.exit\(1\)/.test(src),
    `${name} 의 빗장이 걸려도 «멈추지» 않습니다.`,
    `scripts/${name}.mts — ${manual} §보안 빗장`);
}
/** 채널 발행기는 청구 축을 «읽지도» 않는다. 빗장은 머리글만 보므로, 값 쪽도 같이 지킨다. */
must(!/N\(r\.claimWritten\)|r\.claimWritten\b(?!.*FORBIDDEN)/.test(chan.replace(/const FORBIDDEN[^\n]*\n/, '')),
  '영업채널 발행기가 claimWritten(청구액)을 읽고 있습니다. 이 파일이 세는 축은 «지급» 하나뿐입니다.',
  `scripts/publish-channel-settlement.mts — ${manual} §보안 빗장`);

/* 밖에 나가는 글에서 «우리끼리 하는 말»과 남의 상호를 걷는다. */
must(/INSIDE = \/사장님\|매니저/.test(outward),
  '내부 말 거르개(outward-text)가 헐거워졌습니다.',
  `lib/domain/outward-text.ts — ${manual} §보안 빗장`);
for (const [name, src] of [['publish-channel-settlement', chan], ['publish-supplier-settlement', sup]] as const) {
  must(/outwardText\(/.test(src),
    `${name} 가 환수 사유를 «그대로» 내보내고 있습니다. 사람 이름·남의 상호가 샙니다.`,
    `scripts/${name}.mts — ${manual} §보안 빗장`);
}
/* 시트는 «링크 공개»로 열지 않는다 — 계정 승인 방식(사장님 2026-09-03 「계정승인해야 보이게 하지」). */
for (const [name, src] of [['publish-channel-settlement', chan], ['import-channel-history', hist]] as const) {
  must(!/type: 'anyone'/.test(src),
    `${name} 가 시트를 «링크 공개»로 열고 있습니다. 공유는 계정 승인 방식입니다.`,
    `scripts/${name}.mts — ${manual} §보안 빗장`);
}

/* ── ④ 덮지 않는다 — 상대가 고친 칸은 받아 놓고 사람이 정한다 ──────
   사장님 2026-09-04 「덮지말고 그거를 우리가 보고 우리 원장을 변경할지 검토해야하는거야」        */
must(/export function diffSheetRows/.test(edits) && /export function applyPending/.test(edits),
  '시트에서 고친 칸을 받아 오는 장치(sheet-edits)가 사라졌습니다.',
  `lib/server/sheet-edits.ts — ${manual} §덮지 않는다`);
must(/applyPending\(\{[\s\S]{0,200}rows: body/.test(chan),
  '발행기가 «받아 둔 고침»을 얹지 않고 찍습니다. 그대로 두면 상대가 한 일이 매달 사라집니다.',
  `scripts/publish-channel-settlement.mts — ${manual} §덮지 않는다`);
/** 얹는 일은 «머리글이 달라도» 한다 — if 안에 넣으면 칸을 늘린 판에서 한 달치가 통째로 빠진다. */
{
  const i = chan.indexOf('applyPending({');
  const guard = chan.lastIndexOf("liveHead.join('|') === HEAD.join('|')", i);
  const close = chan.lastIndexOf('시트 머리글이 우리 것과 달라', i);
  must(guard < 0 || close > guard,
    '「받아 둔 고침 얹기」가 머리글 비교 안에 들어가 있습니다. 칸을 늘린 판에서 한 달치가 통째로 빠집니다.',
    `scripts/publish-channel-settlement.mts — ${manual} §덮지 않는다`);
}
/** 합계 아래 「누락」 줄도 읽어 온다 — 자리만 내어 주고 안 읽으면 자리를 낸 값을 못 한다. */
must(/column: '누락'/.test(chan),
  '합계 아래 「누락」 줄을 읽어 오지 않습니다. 2026-08 에 하허호가 일곱 줄을 적었는데 아무도 못 봤습니다.',
  `scripts/publish-channel-settlement.mts — ${manual} §덮지 않는다`);

/* ── ⑤ 달 규칙 — 마감된 달은 손대지 않는다 ─────────────────────── */
must(/const FORECAST = MONTH > CLOSED/.test(chan),
  '예정분 규칙이 «마감된 달»에도 걸립니다. 8월에 씌우면 34줄이 50줄로 불어 나간 청구서와 갈라집니다.',
  `scripts/publish-channel-settlement.mts · FORECAST — ${manual} §달 규칙`);
must(/const OWNED_FROM = '2026-08'/.test(hist),
  '지난 기록 발행기가 «원자가 주인인 달»을 덮을 수 있습니다.',
  `scripts/import-channel-history.mts · OWNED_FROM — ${manual} §달 규칙`);
/**
 * ★★★**지난 기록은 원자에 «쓰지» 않는다** — 사장님 2026-09-04
 *   「안 갖고와도 돼. **우리가 앞으로 만들어 가는 게 원자임.**」
 *   원자는 우리 파이프라인이 만든 것만 담는다. 지난 것을 끌어와 채우면 이미 나간 청구서의
 *   근거가 흔들린다. 이 발행기는 «읽기»만 한다(모델명을 차번으로 빌려 온다).
 */
must(!/settlement_rows[\s\S]{0,80}\.(update|set|push)\(/.test(hist) && !/\.(update|set|push)\([\s\S]{0,40}settlement_rows/.test(hist),
  '지난 기록 발행기가 원자(settlement_rows)에 «쓰고» 있습니다. 원자는 앞으로 만들어 가는 것만 담습니다.',
  `scripts/import-channel-history.mts — ${manual} §원자는 어디까지인가`);
/** settlementMonthOf 에 Date 를 넘기면 조용히 빈 값이 나온다 — 예정 줄이 하나도 안 잡힌다. */
must(!/settlementMonthOf\(asRow\(/.test(chan),
  'settlementMonthOf 에 asRow(r)(Date로 바뀐 줄)를 넘기고 있습니다. 조용히 빈 값이 나와 예정 줄이 하나도 안 잡힙니다.',
  `scripts/publish-channel-settlement.mts — ${manual} §달 규칙`);

/* ── ⑥ 시트를 함부로 새로 만들지 않는다 ───────────────────────── */
must(/hasBook\(/.test(chan),
  '할 말이 0원뿐인 채널에도 시트를 새로 만듭니다. 2026-09-04 에 유니오토모빌 시트가 그렇게 생겼습니다.',
  `scripts/publish-channel-settlement.mts · hasBook — ${manual} §시트를 새로 만들 때`);
must(/CHANNEL_F_CODE/.test(tabs) && /F8\?/.test(tabs) === false || /CHANNEL_F_CODE/.test(tabs),
  'F코드 표(CHANNEL_F_CODE)가 사라졌습니다. 코드가 없으면 지도(SHEET_MAP)에 못 올립니다.',
  `lib/server/channel-sheet-tabs.ts — ${manual} §F코드`);

/* ── 결과 ────────────────────────────────────────────────── */
if (fails.length) {
  console.log(`\n  ✕ 정산 시트 규격이 ${fails.length}군데 어긋났습니다\n`);
  fails.forEach((f, i) => console.log(`   ${i + 1}. ${f}\n`));
  console.log(`  바꾸시려면 — 사장님께 여쭙고 → ${manual} 을 고치고 → 이 검사를 고칩니다.`);
  console.log('  ⚠ 이 검사를 «먼저» 고쳐 통과시키는 것은 규격을 지운 것과 같습니다.\n');
  process.exit(1);
}
console.log('\n  ✓ 정산 시트 규격이 그대로입니다 — 칸·서식·빗장·덮지 않기·달 규칙\n');
