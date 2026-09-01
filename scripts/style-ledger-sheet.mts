/**
 * **정산원장 시트 — 「청구」·「수금」 체크칸 + 영역별 머리 색.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01
 *   「우리 정산원장 … 거기를 청구박스 표시하게 해주고 … 청구랑 수금 박스 체크하게 해줘」
 *   「접수랑 업무랑 청구 정산 실적 환수 이런거 영역별로 헤더 색깔 달리해주면 좋을거 같음」
 *
 * ★★**왜 필요한가** — 지금 원장에는 「청구했나·받았나」를 적는 칸이 없다.
 *   2026-09-01 에 우리캐피탈이 10,403,278 을 «이미 수금»했는데 시트가 「미청구」라고 말해서
 *   청구서를 한 번 더 만들 뻔했다. 받은 것을 적을 자리가 없으면 이중청구는 언제든 다시 난다.
 *
 * ★★**두 번 돌려도 안전하다** — 이미 있는 칸은 «안 만든다». 색만 다시 칠한다.
 * ⚠ **칸을 «끝에» 붙인다.** 가운데 끼우면 열이 밀리는데, 읽는 코드가 이름으로 찾으므로
 *   자리는 상관없고 밀리는 위험만 있다(매뉴얼 §14 「자리로 읽지 마라」).
 * ⚠ 값은 안 건드린다. 머리글 한 칸과 서식만 쓴다.
 *
 *   npx tsx scripts/style-ledger-sheet.mts
 *   npx tsx scripts/style-ledger-sheet.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const TABS = ['접수', '취소', '분납실적', '완납실적'];
/** 머리글이 있는 줄(0-based). 1행은 탭 설명이다. */
const HEAD_ROW = 1;

/** 새로 붙일 체크칸. 이미 있으면 안 만든다. */
const NEW_BOXES = ['청구', '수금'];

/**
 * **이름 바꾸기** — 값·서식은 그대로 두고 머리글 글자만 고친다.
 * ★사장님 2026-09-01 「계약취소 아니고 그냥 취소만 넣어줘」.
 * ⚠ 읽는 코드는 «이름»으로 찾으므로 여기만 바꾸면 안 되고 `settlement-atoms`·`settlement-record`·
 *   `settlement-store`·`settlement-ledger-read` 를 같이 고쳤다(옛 이름도 계속 읽는다).
 */
const RENAME: Record<string, string> = { 계약취소: '취소' };

/**
 * **죽은 칸** — 값이 한 줄도 없다. 머리에 «안 씀» 이라고 적어 둔다.
 * ★실측 2026-09-01 — 「상태」 는 443줄 전부 빈칸이다. 원본의 「상태 표기」(계약 완료·계약진행중·환수)를
 *   받으려던 자리인데, 그 글자는 체크 넷(계약서·인도완료·취소·환수)으로 «풀어» 담기로 해서 쓸 일이 없어졌다.
 * ⚠ 지우지는 않는다 — 지우면 열이 밀리고, 「왜 없어졌나」를 다음 사람이 다시 묻는다.
 */
const DEAD = new Set(['상태']);

/**
 * **영역** — 머리글 이름으로 가른다(자리가 아니라).
 * ★사장님이 부른 이름 그대로 쓴다. 여기 없는 칸은 「참고」로 떨어진다.
 */
const AREA: { name: string; color: { red: number; green: number; blue: number }; cols: string[] }[] = [
  { name: '접수', color: { red: 0.83, green: 0.89, blue: 0.97 }, // 연한 파랑
    cols: ['접수일', '차량번호', '공급사', '모델명', '영업채널', '영업담당자', '영업자연락처', '영업자코드', '고객명', '고객연락처'] },
  { name: '업무', color: { red: 0.92, green: 0.92, blue: 0.92 }, // 회색
    cols: ['상품구분', '계약기간', '렌탈료', '보증금', '차량가액', '분납여부', '렌트구분', '계약형태', '연령', '계약대여료', '업셀링금액', '출고지역'] },
  { name: '실적', color: { red: 0.85, green: 0.94, blue: 0.85 }, // 연한 초록
    cols: ['계약서', '계약서작성담당', '인도완료', '인도일', '취소', '계약취소', '상태', '납입회차', '다음회차일'] },
  { name: '정산', color: { red: 1.00, green: 0.95, blue: 0.80 }, // 연한 노랑
    cols: ['공급사수수료율', '판매수수료', '공급사인센티브', '공급사부가세', '에이전시수수료율', '출고수수료', '에이전시인센티브', '계약서대행료', '에이전시부가세'] },
  { name: '청구', color: { red: 1.00, green: 0.88, blue: 0.75 }, // 연한 주황
    cols: ['청구년', '청구월', '청구금액', '지급액', '청구', '수금'] },
  { name: '환수', color: { red: 0.98, green: 0.82, blue: 0.82 }, // 연한 빨강
    cols: ['환수', '환수사유', '환수일', '환수금액'] },
];
/** 어디에도 안 붙는 칸 — 참고. 흐린 색으로 둔다. */
const REST = { red: 0.96, green: 0.96, blue: 0.94 };
const areaOf = (name: string) => AREA.find((a) => a.cols.includes(name));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[];
};
const sheetOf = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));

console.log(`\n■ 정산원장 — 「청구」·「수금」 체크칸 + 영역별 머리 색 ${APPLY ? '(반영)' : '(대조만)'}\n`);

/**
 * ★**순서가 있다** — 열을 «먼저» 늘리고, 머리글을 쓰고, 그 다음 서식·체크박스다.
 *   2026-09-01 에 머리글부터 쓰다가 `Range ('접수'!AY2:AZ2) exceeds grid limits` 로 튕겼다.
 *   칸이 없는데 값을 먼저 넣으려 한 것이다.
 */
const grow: Record<string, unknown>[] = [];
const requests: Record<string, unknown>[] = [];
const valueWrites: { range: string; values: string[][] }[] = [];

for (const tab of TABS) {
  const p = sheetOf.get(tab);
  if (!p) { console.log(`   ✕ 「${tab}」 탭이 없다 — 멈춘다`); process.exit(1); }
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${tab}'!A${HEAD_ROW + 1}:BZ${HEAD_ROW + 1}`)}`, { headers: { Authorization: `Bearer ${await tok()}` } });
  const head = ((((await r.json()) as { values?: unknown[][] }).values || [[]])[0] || []).map(S);
  if (!head.includes('차량번호')) { console.log(`   ✕ 「${tab}」 머리글을 못 찾았다 — 멈춘다`); process.exit(1); }

  // ① 이름 먼저 바꾼다 — 그래야 아래 「이미 있나」 판정이 새 이름으로 선다.
  const renamed: string[] = [];
  const cur = head.map((h) => {
    const to = RENAME[h];
    if (to && !head.includes(to)) { renamed.push(`${h}→${to}`); return to; }
    return h;
  });
  const add = NEW_BOXES.filter((n) => !cur.includes(n));
  const next = [...cur];
  for (const n of add) next.push(n);
  // 머리글 칸이 모자라면 열을 늘린다
  const needCols = next.length;
  if (needCols > p.gridProperties.columnCount) {
    grow.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: needCols - p.gridProperties.columnCount } });
  }
  const a1 = (j: number) => { let s = ''; let n = j; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; };
  // ★머리글 줄을 통째로 다시 쓴다 — 이름 바꾼 칸과 새 칸을 한 번에.
  if (renamed.length || add.length) {
    valueWrites.push({ range: `'${tab}'!A${HEAD_ROW + 1}:${a1(next.length - 1)}${HEAD_ROW + 1}`, values: [next] });
  }
  if (add.length) {
    // ★체크박스 — 데이터 줄에만 건다(머리글 아래부터 끝까지).
    for (const n of add) {
      const j = next.indexOf(n);
      requests.push({
        setDataValidation: {
          range: { sheetId: p.sheetId, startRowIndex: HEAD_ROW + 1, endRowIndex: p.gridProperties.rowCount, startColumnIndex: j, endColumnIndex: j + 1 },
          rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
        },
      });
    }
  }

  // ── 영역별 머리 색 ──
  const groups: string[] = [];
  next.forEach((name, j) => {
    const dead = DEAD.has(name);
    const a = dead ? null : areaOf(name);
    groups.push(dead ? '안씀' : a ? a.name : '참고');
    requests.push({
      repeatCell: {
        range: { sheetId: p.sheetId, startRowIndex: HEAD_ROW, endRowIndex: HEAD_ROW + 1, startColumnIndex: j, endColumnIndex: j + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: dead ? { red: 0.85, green: 0.85, blue: 0.85 } : a ? a.color : REST,
            // ★안 쓰는 칸은 «흐리게 + 취소선». 지우지 않고 「여기는 안 씁니다」를 눈으로 말한다.
            textFormat: { bold: !dead, fontSize: 10, italic: dead, strikethrough: dead, foregroundColor: dead ? { red: 0.45, green: 0.45, blue: 0.45 } : { red: 0, green: 0, blue: 0 } },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    });
  });
  // 머리글 줄 고정 — 스크롤해도 색이 따라온다
  requests.push({ updateSheetProperties: { properties: { sheetId: p.sheetId, gridProperties: { frozenRowCount: HEAD_ROW + 1 } }, fields: 'gridProperties.frozenRowCount' } });

  const tally = new Map<string, number>();
  for (const g of groups) tally.set(g, (tally.get(g) || 0) + 1);
  console.log(`   ${tab.padEnd(6)} ${next.length}칸  ${add.length ? `+ 새 체크칸 ${add.join('·')}` : '체크칸 이미 있음'}${renamed.length ? `  · 이름 ${renamed.join('·')}` : ''}`);
  console.log(`          영역 — ${[...tally].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
}

console.log(`\n   열 늘리기 ${grow.length}건 · 서식·체크박스 ${requests.length}건 · 머리글 쓰기 ${valueWrites.length}건`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 반영한다.\n'); process.exit(0); }

// ① 열부터 늘린다
if (grow.length) {
  const g = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: grow }),
  });
  console.log(`   열 늘리기 ${g.status} ${g.ok ? '✓' : (await g.text()).slice(0, 300)}`);
  if (!g.ok) process.exit(1);
}
// ② 머리글
if (valueWrites.length) {
  const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: valueWrites.map((v) => ({ range: v.range, values: v.values })) }),
  });
  console.log(`   머리글 ${w.status} ${w.ok ? '✓' : (await w.text()).slice(0, 200)}`);
  if (!w.ok) process.exit(1);
}
const b = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
  method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests }),
});
console.log(`   서식·체크박스 ${b.status} ${b.ok ? '✓' : (await b.text()).slice(0, 300)}`);
if (!b.ok) process.exit(1);
console.log(`\n   ✓ 끝. https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
process.exit(0);
