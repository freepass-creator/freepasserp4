/**
 * **정산원장 탭 순서와 「이 시트는」 안내를 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★일하는 순서대로 놓는다 — 접수 → 취소 → 분납실적 → 완납실적 → 청구 → 참고표.
 *   맨 앞이 팀장이 매일 여는 탭이고, 뒤로 갈수록 쌓아 두는 것이다.
 *
 *   npx tsx scripts/order-ledger-tabs.mts
 *   npx tsx scripts/order-ledger-tabs.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const ORDER = ['이 시트는', '접수', '취소', '분납실적', '완납실적', '청구', '청구요약', '월별 요약', '수수료표'];
const GUIDE_TAB = '이 시트는';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

/** 「이 시트는」 안내. 왼쪽이 제목, 오른쪽이 설명 — 두 칸짜리다. */
const GUIDE: string[][] = [
  ['프리패스 정산원장', '계약이 들어와서 돈이 오갈 때까지를 한 문서에서 관리한다.'],
  ['★먼저 읽을 것', '「AI 운영 매뉴얼」 탭 — 사람이 하는 일, 기계가 도는 순서, 절대 규칙, 겪은 함정이 다 있다.'],
  ['', '정본은 리포 lib/domain/settlement-manual.ts · docs/정산원장-매뉴얼.md 로도 남는다.'],
  ['', ''],
  ['한 줄은 한 탭에만', '같은 계약이 두 탭에 동시에 있으면 대수가 두 번 세어진다.'],
  ['한 계약 = 차량번호 + 접수일', '같은 차가 다시 나갈 수 있다. 차번만으로는 계약을 못 가른다.'],
  ['', ''],
  ['① 접수', '미처리 이월건 + 당월 접수건. 계약금이 들어오면 빈 줄에 이어 적는다. **여기가 유일한 입구다.**'],
  ['', '「구분」이 «인도 전»인 줄은 아직 청구가 못 나간 것이라 위에 모여 있다. 오래 묵을수록 위에 온다.'],
  ['', '**인도완료를 체크하면 그 줄은 바로 나간다** — 분납이면 「분납실적」, 일시납이면 「완납실적」으로.'],
  ['', '그래서 접수 탭에는 «아직 차가 안 나간 것»만 남는다. 이번 달 실적은 「월별 요약」에서 본다.'],
  ['', ''],
  ['★팀장이 매일 하는 일', '① 계약금이 들어오면 접수 탭 빈 줄의 «연노랑 칸» 13개를 적는다.'],
  ['', '   차량번호 · 고객명 · 고객연락처 · 영업채널 · 영업담당자 · 상품구분 ·'],
  ['', '   계약기간 · 보증금 · 렌탈료 · 분납여부 — 여기까지가 계약금 받을 때 아는 것이다.'],
  ['', '② 계약서를 다 쓰면 「계약서」에 체크한다.'],
  ['', '③ 차가 나가면 「인도완료」에 체크한다. 그날이 인도일이 되고 청구월이 박힌다.'],
  ['', '   실제 인도일이 다르면 「인도일」 칸만 고친다 — 적힌 값이 이긴다.'],
  ['', '   인도완료를 켜면 계약서는 저절로 켜진다. 차가 나갔으면 계약서는 당연히 됐으니까.'],
  ['', '④ 나중에 환수·취소·연장이 생기면 「상태」에 적는다. 비어 있으면 계약중이다.'],
  ['★색이 곧 상태', '붉음 = 계약취소 · 주황 = 환수 · 옅은 초록 = 인도완료(이번 달). 겹치면 센 것이 이긴다.'],
  ['★체크 셋으로 읽는다', '계약서 ☐ 인도 ☐ = 계약금만 들어온 단계 · 계약서 ☑ 인도 ☐ = 계약서는 됐는데 차가 안 나감'],
  ['', '인도 ☑ = 청구가 나간다. 그 줄은 접수를 떠난다.   계약취소 ☑ = 줄이 붉어지고 「취소」 탭으로 간다.'],
  ['★청구서의 원천', '**분납실적 + 완납실적**이다. 접수 탭은 아직 청구가 못 나가는 것들이라 안 본다.'],
  ['★상태는 셋뿐', '환수 · 계약 불가(취소) · 연장. «예정대로 안 간 일»만 적는 칸이다.'],
  ['', '「계약 완료」는 없앴다(369줄을 비웠다) — 그 뜻은 「계약서」 체크가 담는다.'],
  ['', '차가 나갔는지는 인도완료 체크가, 청구가 나갔는지는 청구월이 말한다. 상태가 또 말할 필요가 없다.'],
  ['', '그 밖에는 아무것도 안 한다. 회색 칸은 기계가 채우고, 잠겨 있어 건드릴 수 없다.'],
  ['★상품구분이 돈을 정한다', '선출고·견적출고는 «차량가액» 기준, 나머지는 «대여료 × 기간» 기준으로 수수료가 나온다.'],
  ['', '여기가 틀리면 청구액이 틀린다. 장기렌트 · 선출고 · 견적출고 · 구독 · 오플구독 다섯 중 하나.'],
  ['★줄을 지우지 않는다', '취소돼도 지우지 말고 「상태」에 「계약 불가(취소)」라고 적는다. 기계가 취소 탭으로 옮긴다.'],
  ['② 취소', '계약금이 들어왔다가 취소된 것. 접수에 두면 일하는 표가 흐려져서 따로 뺐다.'],
  ['③ 분납실적', '인도됐고 보증금 분납이 아직 안 끝난 것. 만료가 가까운 순으로 놓인다.'],
  ['', '만료 = 인도일 + 회차개월. 그날이 지나고 환수가 없으면 이행된 것이라 저절로 완납실적으로 간다.'],
  ['★분납이 부러지면', '「다음회차일」이 다음에 돈이 들어올 날이다. 그 날이 지났는데 소식이 없으면 —'],
  ['', '**「환수」에 체크하고 환수사유·환수일·환수금액을 적는다.** 분납이 부러진 것도 환수로 적는다.'],
  ['', '켜면 줄이 주황이 되고, 청구에서 그만큼 빠지며, 더 굴러갈 회차가 없어 **완납실적으로 옮겨진다.**'],
  ['', '환수사유 — 분납 미납 · 대여료 미납 · 중도해지 · 계약위반 · 사고 · 고객요청 · 기타. 목록에 없으면 그냥 적는다.'],
  ['', '⚠ 회차별 입금 자료가 우리에게 없다. 기계는 «언제 확인할지»만 알려 주고, 들어왔는지는 사람이 안다.'],
  ['④ 완납실적', '끝난 것. 일시납이거나 분납 만료가 지났다. 환수도 여기 남는다. 쌓기만 한다.'],
  ['⑤ 청구', '청구월로 쌓는 장부. 분납실적 + 완납실적에서 만든다. 2026-08부터 담는다 — 그 전은 이미 청구가 끝났다.'],
  ['', '⚠ 환수는 여기서 안 적는다 — **분납실적·완납실적**에서 「환수」에 체크하고 환수일·환수금액을 적으면 따라온다.'],
  ['⑥ 청구요약', '그 달에 어느 공급사에 얼마 청구하고, 어느 영업자에게 얼마 주고, 수익이 얼마인지.'],
  ['', '월과 구분으로 거른다 — 공급사 한 곳만 걸면 그게 그 달 그 공급사에 끊을 계산서다.'],
  ['', '**공급사청구 − 영업자지급 = 수익.** 환수는 청구에서 이미 뺐다.'],
  ['', '환수는 마이너스 한 줄로 같이 쌓인다. 청구와 환수는 같은 차가 공존할 수 있다.'],
  ['', '접수 탭에 있는 «인도 완료» 줄도 여기 들어온다 — 청구는 인도되는 즉시 나간다.'],
  ['', ''],
  ['탭 색깔', '파랑=매일 여는 곳 · 회색=끝나 버린 것 · 주황=지켜볼 것 · 초록=끝난 것 · 남색=돈.'],
  ['머리글은 2행', '1행은 그 탭이 무엇인지 적은 설명이다. 기계는 「차량번호」가 있는 줄을 머리글로 찾는다.'],
  ['', ''],
  ['청구월이 관문이다', '인도되면 청구월이 박힌다. 인도 전에는 비어 있다.'],
  ['청구는 안 고친다', '한 번 나간 청구는 줄을 고치지 않는다. 되돌릴 일이 생기면 마이너스 한 줄을 더한다.'],
  ['환수 ≠ 취소', '취소는 인도 못 하고 끝난 것, 환수는 계약이 끝난 뒤 조건이 터진 것이다.'],
  ['', ''],
  ['돈이 어떻게 잡히나', '판매수수료 = 렌탈료 × 계약기간 × 공급사요율 → 공급사에 청구한다.'],
  ['', '출고수수료 = 렌탈료 × 계약기간 × 에이전시요율 → 영업자에게 지급한다.'],
  ['', '우리 몫 = 판매수수료 − 출고수수료. 부가세는 통과금이라 뺀다.'],
  ['', '세금계산서를 실제로 끊은 줄은 그 금액을 그대로 쓴다.'],
  ['', ''],
  ['주황 칸', '사람이 채워야 하는 칸이다. 청구 탭의 환수 줄은 환수월이 비어 있다 — 적어야 그 달 합계에 들어간다.'],
  ['줄을 지우지 말 것', '상태만 바꾼다. 지우면 무엇이 있었는지 되찾을 수 없다.'],
  ['', ''],
  ['누가 고치나', '탭 구조는 기계가 만든다 — scripts/build-settlement-tabs.mts · build-settlement-billing.mts.'],
  ['', '수정이력은 리포 docs/수정이력-정산원장.md 에 쌓인다.'],
  ['_옛실적 보관', '옛 도구가 만든 표라 숨겨 뒀다. 지금 규격과 안 맞으니 쓰지 말 것.'],
];

/** 참고표 탭은 옅은 회색 — 일하는 탭과 눈으로 갈라 놓는다. */
const SIDE_COLOR: Record<string, { red: number; green: number; blue: number }> = {
  '이 시트는': { red: 0.45, green: 0.5, blue: 0.55 },
  'AI 운영 매뉴얼': { red: 0.45, green: 0.35, blue: 0.6 },
  청구요약: { red: 0.2, green: 0.5, blue: 0.45 },
  수수료표: { red: 0.62, green: 0.68, blue: 0.72 },
  '월별 요약': { red: 0.62, green: 0.68, blue: 0.72 },
};


const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title,index,hidden)`);
const props: any[] = (meta.sheets || []).map((s: any) => s.properties);
const now = props.filter((p) => !p.hidden).sort((a, b) => a.index - b.index).map((p) => S(p.title));
const want = [...ORDER.filter((t) => now.includes(t)), ...now.filter((t) => !ORDER.includes(t))];

console.log(`\n■ 정산원장 탭 순서 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`   지금  ${now.join(' · ')}`);
console.log(`   바꿈  ${want.join(' · ')}`);
const missing = ORDER.filter((t) => !now.includes(t));
if (missing.length) console.log(`   ⚠ 아직 없는 탭 — ${missing.join(' · ')}`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

// ★한 장씩 옮긴다. 한꺼번에 보내면 index 가 서로 밀려서 엉킨다.
for (let i = 0; i < want.length; i++) {
  const p = props.find((x) => S(x.title) === want[i]);
  if (!p) continue;
  await api(`${SH}/${LEDGER}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: p.sheetId, index: i }, fields: 'index' } }] }),
  });
}
console.log('   ✓ 순서 맞췄다');

const gid = props.find((p) => S(p.title) === GUIDE_TAB)?.sheetId;
if (gid === undefined) { console.log(`   ⚠ 「${GUIDE_TAB}」 탭이 없다 — 안내는 못 썼다.`); process.exit(0); }
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(GUIDE_TAB)}!A1:D200`)}:clear`, { method: 'POST', body: '{}' });
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(GUIDE_TAB)}!A1:B${GUIDE.length}`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: GUIDE }),
});
const FONT = 'Noto Sans KR';
await api(`${SH}/${LEDGER}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: [
      { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 }, verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)' } },
      { repeatCell: { range: { sheetId: gid, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 720 }, fields: 'pixelSize' } },
      { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    ],
  }),
});
console.log(`   ✓ 「${GUIDE_TAB}」 ${GUIDE.length}줄`);

const paint = props.filter((p) => SIDE_COLOR[S(p.title)])
  .map((p) => ({ updateSheetProperties: { properties: { sheetId: p.sheetId, tabColor: SIDE_COLOR[S(p.title)] }, fields: 'tabColor' } }));
if (paint.length) { await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: paint }) }); console.log(`   ✓ 참고표 탭 색깔 ${paint.length}개`); }
console.log(`\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
