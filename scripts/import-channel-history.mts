/**
 * **채널이 보내 준 «지난 달 정산서»를 그 채널 시트에 우리 규격으로 얹는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-04 「카톡받은 파일에 하허호 7월 정산내역 넣었는데 이거 하허호시트에 7월로
 *   넣어달래 규격 맞춰서」 · 「이거 전체거라는데」 · 「26년도거 다 반영해줘」 · 「오플거도 받아놨어」
 *
 * ★★**어디서 오나 — «상대가 보내 준 종이»다. 우리 원자가 아니다.**
 * ```
 * 8월부터   원자(v4/settlement_rows) → publish-channel-settlement → 달 탭
 * 그 이전   상대가 준 xlsx           → 이 스크립트              → 달 탭
 * ```
 *   ⇒ **원자에는 «쓰지 않는다».** 8월은 이미 확정본이 나갔고, 지난 달을 원자에 밀어 넣으면
 *     원장·청구서가 통째로 흔들린다. 이건 «지난 기록을 한 곳에 모으는» 일이지 재정산이 아니다.
 *     그래서 탭 꼬리에 «어디서 온 값인지»를 적는다 — 안 적으면 다음 사람이 원자에서 나온 줄 안다.
 *
 * ★★**두 장을 한 탭에 담는다.** 하허호는 「26년 정산」과 「26년 오플정산」 두 장을 보낸다
 *   (오토플러스는 지급일이 익월 25일이라 저쪽에서 따로 뽑는다). 우리 규격은 «탭 하나»이고
 *   지급일은 줄마다 찍는다 — 사장님 2026-09-03 「탭 하나로 합쳐서 구분만 해주면됨」 ·
 *   「오토플러스는 맨 아래쪽에」. 그래서 오플 줄을 아래로 내린다.
 *
 * ★**빈 칸을 지어내지 않는다.** 상대 종이에는 접수일·보증금 «금액»·모델명이 없다.
 *   접수일·보증금은 비운다. 모델명만 차량번호로 우리 원자에서 빌려 온다(차 한 대의 모델은 안 변한다).
 *
 *   npx tsx scripts/import-channel-history.mts 하허호 --file=tmp/haheoho-07.xlsx --file=tmp/haheoho-opl-07.xlsx
 *   npx tsx scripts/import-channel-history.mts 하허호 --file=... --apply
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { CORP } from '../lib/domain/corporate-ci';
import { payDate, PAY_DAY_BY_SUPPLIER } from '../lib/domain/settlement-cycle';
import { CHANNEL_SETTLE_HEAD, CHANNEL_SETTLE_WIDTH, SETTLE_BASIS, settleTabOf, settleTabFormat } from '../lib/server/channel-sheet-tabs';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const APPLY = process.argv.includes('--apply');
const CH = S(process.argv.slice(2).find((a) => !a.startsWith('--')));
const FILES = process.argv.filter((a) => a.startsWith('--file=')).map((a) => a.slice('--file='.length));
if (!CH || !FILES.length) {
  console.log('\n  채널과 파일을 주세요 — npx tsx scripts/import-channel-history.mts 하허호 --file=a.xlsx --file=b.xlsx [--apply]\n');
  process.exit(1);
}

/**
 * ★★**8월부터는 «원자»가 주인이다.** 지난 기록 발행기가 그 달을 덮으면 이미 나간 정산서와
 *   시트가 갈린다. 파일에 그 달이 들어 있어도 여기서 멈춘다.
 */
const OWNED_FROM = '2026-08';

const dayKo = (d: Date | null) => (d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}` : '');
/** 엑셀 날짜(1899-12-30 부터 센 날 수) → 「YYYY-MM-DD」. 글로 적힌 날짜는 그대로 둔다. */
const xlDate = (v: unknown): string => {
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = S(v);
  const m = /^(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
};
/**
 * 차번은 «가운데 빈칸»이 섞여 온다 — 「133하 5131」과 「133하5131」은 같은 차다.
 * ⚠ 차번이 아닌 것은 «건드리지 않는다** — 「사무실비 지원금」 줄은 이 칸에 「5. 6, 7」(달)이
 *   적혀 온다. 빈칸을 지우면 「5.6,7」이 되어 무슨 말인지 알 수 없게 된다.
 */
const plateOf = (v: unknown) => {
  const s = S(v);
  const tight = s.replace(/\s+/g, '');
  return /^\d{2,3}[가-힣]\d{4}$/.test(tight) ? tight : s;
};

/**
 * **상대 종이의 칸 차례** — 두 파일(일반·오플)이 같다.
 * ```
 * 0 렌트사 · 1 인도일자 · 2 고객명 · 3 차량번호 · 4 구분 · 5 보증금 납입방식 · 6 기간
 * 7 영업자 · 8 대여료 · 9 차량가격 · 10 공급가액 · 11 부가세 · 12 합계금액 · 13 비고
 * ```
 * ⚠ 머리가 «두 줄»이다(위 줄에 「수수료」가 걸쳐 있고 아래 줄에 공급가액·부가세·합계금액).
 *   그래서 「렌트사」를 찾은 줄의 «두 줄 아래»부터가 표다.
 */
type Src = { sup: string; deliv: string; cust: string; plate: string; product: string; payKind: string;
  term: number; agent: string; rent: number; price: number; net: number; vat: number; total: number; why: string };

const monthOfTab = (t: string): string => {
  const m = /(\d{2})년\s*(\d{1,2})월/.exec(S(t));
  return m ? `20${m[1]}-${String(Number(m[2])).padStart(2, '0')}` : '';
};

/** 한 파일에서 달별로 줄을 긁는다. */
function readBook(path: string): Map<string, { rows: Src[]; paperTotal: number }> {
  const wb = XLSX.read(readFileSync(path));
  const out = new Map<string, { rows: Src[]; paperTotal: number }>();
  for (const tab of wb.SheetNames) {
    const month = monthOfTab(tab);
    if (!month) continue;
    const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tab], { header: 1, raw: true, defval: '' });
    const hi = g.findIndex((r) => S((r || [])[0]) === '렌트사');
    if (hi < 0) continue;
    const rows: Src[] = [];
    let paperTotal = 0;
    for (const r0 of g.slice(hi + 2)) {
      const r = (r0 || []) as unknown[];
      if (S(r[0]).replace(/\s/g, '') === '합계') { paperTotal = N(r[12]); break; }
      /** 값이 하나도 없는 줄은 건너뛴다 — 「사무실비 지원금」처럼 차번 없는 줄은 살린다. */
      if (!S(r[2]) && !S(r[3]) && !N(r[12])) continue;
      rows.push({
        sup: S(r[0]), deliv: xlDate(r[1]), cust: S(r[2]), plate: plateOf(r[3]), product: S(r[4]),
        payKind: S(r[5]), term: N(r[6]), agent: S(r[7]), rent: N(r[8]), price: N(r[9]),
        net: N(r[10]), vat: N(r[11]), total: N(r[12]), why: S(r[13]),
      });
    }
    out.set(month, { rows, paperTotal });
  }
  return out;
}

const books = FILES.map((f) => ({ file: f, byMonth: readBook(f) }));
const months = [...new Set(books.flatMap((b) => [...b.byMonth.keys()]))].sort();
const late = (sup: string) => Object.keys(PAY_DAY_BY_SUPPLIER).some((s) => S(sup).includes(s));

console.log(`\n■ ${CH} — 지난 기록 ${months.length}달 ${APPLY ? '(반영)' : '(대조만)'}`);
for (const b of books) console.log(`   원본  ${b.file}  (${[...b.byMonth.keys()].join(' · ')})`);

type Job = { month: string; rows: Src[]; net: number; vat: number; papers: { file: string; total: number; mine: number }[] };
const jobs: Job[] = [];
let blocked = 0;
for (const month of months) {
  if (month >= OWNED_FROM) { console.log(`   · ${month} 는 원자가 주인입니다 — 건너뜁니다`); blocked++; continue; }
  /** ★오플 줄을 아래로. 그 안의 차례는 «상대가 적은 그대로» 둔다(안정 정렬). */
  const gathered = books.flatMap((b) => (b.byMonth.get(month)?.rows) || []);
  const rows = [...gathered.filter((r) => !late(r.sup)), ...gathered.filter((r) => late(r.sup))];
  if (!rows.length) continue;
  /**
   * ★★**꼬리에 «파일 이름»을 적지 않는다.** 우리 쪽 임시 파일명(haheoho-07.xlsx)은 상대에게
   *   아무 뜻이 없다. 종이를 가르는 것은 이름이 아니라 «누구 몫이냐»다 — 일반분 / 오토플러스분.
   */
  const papers = books.map((b) => {
    const rs = b.byMonth.get(month)?.rows || [];
    const allLate = rs.length > 0 && rs.every((r) => late(r.sup));
    return { file: allLate ? '오토플러스분' : '일반분', total: b.byMonth.get(month)?.paperTotal || 0,
      mine: rs.reduce((a, r) => a + r.total, 0) };
  }).filter((p) => p.total || p.mine);
  jobs.push({ month, rows, net: rows.reduce((a, r) => a + r.net, 0), vat: rows.reduce((a, r) => a + r.vat, 0), papers });
}

/** ★★**우리가 센 것이 상대 종이와 같은가** — 다르면 옮기기 전에 멈춰야 한다. */
let mismatch = 0;
for (const j of jobs) {
  const bad = j.papers.filter((p) => Math.abs(p.total - p.mine) > 1);
  bad.forEach((p) => { mismatch++; console.log(`   ✕ ${j.month} ${p.file} — 종이 ${won(p.total)} ≠ 우리가 센 것 ${won(p.mine)}`); });
  console.log(`   ${bad.length ? '✕' : 'o'} ${j.month}  ${String(j.rows.length).padStart(2)}줄 · ${won(j.net + j.vat).padStart(12)}   ${j.papers.map((p) => `${p.file} ${won(p.total)}`).join(' + ')}`);
}
if (mismatch) { console.log(`\n  ✕ 멈춥니다 — 종이와 어긋난 곳 ${mismatch}군데. 원본을 먼저 봐 주세요.\n`); process.exit(1); }

/**
 * ★★**인도일이 «정산월보다 뒤»인 줄을 센다 — 고치지는 않는다.**
 *   실측 2026-09-04 하허호 원본 297줄 가운데 37줄이 그랬다(26년1월 정산에 인도일 2026-12-26 따위).
 *   한 해씩 앞선 꼴이라 상대 시트의 «연도 입력»이 어긋난 것으로 보이지만, 짐작으로 37개 날짜를
 *   옮기는 것은 없는 자료를 짓는 일이다. 돈에는 영향이 없다(인도일은 알림 칸이다).
 *   ⇒ **세어서 보이기만 한다.** 고칠지는 상대에게 물어 정한다.
 */
const ahead = jobs.flatMap((j) => j.rows.filter((r) => r.deliv && r.deliv.slice(0, 7) > j.month).map((r) => ({ month: j.month, r })));
if (ahead.length) {
  console.log(`\n   ⚠ 인도일이 정산월보다 «뒤»인 줄 ${ahead.length}개 — 원본 그대로 옮깁니다(돈에는 영향 없음).`);
  ahead.slice(0, 3).forEach(({ month, r }) => console.log(`      ${month}  ${r.plate.padEnd(10)} ${r.cust.padEnd(10)} 인도일 ${r.deliv}`));
}
if (blocked) console.log(`\n   ※ ${OWNED_FROM} 부터는 publish-channel-settlement 가 찍습니다.`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 붙입니다.\n'); process.exit(0); }

// ── 붙이기 ────────────────────────────────────────────────
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;

/** ★모델명만 우리 원자에서 빌린다 — 차 한 대의 모델은 안 변하니 차번으로 찾으면 된다. */
const modelOf = new Map<string, string>();
for (const r of Object.values((await getDatabase().ref('v4/settlement_rows').get()).val() || {}) as Record<string, unknown>[]) {
  const p = plateOf(r.plate); const m = S(r.model);
  if (p && m && !modelOf.has(p)) modelOf.set(p, m);
}

const q = `name contains '${CH} 프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const found = (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  { headers: { Authorization: `Bearer ${await tok()}` } })).json()) as { files?: { id: string; name: string }[] }).files || [])
  .filter((f) => !/구버전|폐기|백업/.test(S(f.name)));
if (found.length !== 1) { console.log(`\n  ✕ 시트를 «하나»로 못 맞췄습니다(${found.length}개)\n`); process.exit(1); }
const bookId = found[0].id;
console.log(`\n■ ${found[0].name}`);

const HEAD = CHANNEL_SETTLE_HEAD;
const WIDTH = CHANNEL_SETTLE_WIDTH;
const BASIS = SETTLE_BASIS;
const MONEY = ['렌탈료', '보증금', '차량 가격(신차)', '공급가액', '부가세', '합계'];
const LEFT = ['모델명', ...BASIS];
const iM = HEAD.indexOf('공급가액');
/**
 * ★★★**청구액은 채널 시트에 «절대» 안 들어간다** — 달 탭 발행기와 같은 빗장.
 *   지난 기록이라고 느슨해지면 그때 샌다.
 */
const FORBIDDEN = /청구|받을|이익|마진|claimWritten|supplierRate/;
const leak = HEAD.filter((h) => FORBIDDEN.test(h));
if (leak.length) { console.log(`\n  ✕ 멈춥니다 — 채널 시트에 못 넣는 칸: ${leak.join(' · ')}\n`); process.exit(1); }

const colName = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const pad = (n: number) => Array.from({ length: n }, () => '');
const rowOf = (m: Record<string, string | number | boolean>): (string | number | boolean)[] =>
  HEAD.map((h) => (m[h] === undefined ? '' : m[h]));

for (const j of jobs) {
  const TAB = settleTabOf(j.month);
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  const all = meta.sheets || [];
  let id = all.find((s) => s.properties.title === TAB)?.properties.sheetId;
  const rowsNeed = j.rows.length + 20;

  /** ★★상대가 적어 둔 「확인·메모」는 차량번호로 찾아 그대로 되돌려 놓는다. */
  const kept = new Map<string, [boolean, string]>();
  if (id === undefined) {
    const add = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: all.length, gridProperties: { rowCount: rowsNeed, columnCount: HEAD.length } } } }] }),
    })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
    id = add.replies?.[0]?.addSheet?.properties?.sheetId;
  } else {
    const got = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${TAB}'!A1:AZ400`)}`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { values?: unknown[][] };
    const g = got.values || [];
    const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    if (hi >= 0) {
      const h = (g[hi] || []).map(S);
      const [cp, cc, cm] = ['차량번호', '확인', '메모'].map((n) => h.indexOf(n));
      if (cp >= 0 && (cc >= 0 || cm >= 0)) {
        for (const r of g.slice(hi + 1)) {
          const p = plateOf((r || [])[cp]);
          const chk = cc >= 0 && /^(TRUE|true|1|Y|O|v|✓)$/.test(S((r || [])[cc]));
          const memo = cm >= 0 ? S((r || [])[cm]) : '';
          if (p && (chk || memo)) kept.set(p, [chk, memo]);
        }
      }
    }
    /** ★★병합은 값을 쓰기 «전»에 푼다 — 병합 안쪽 칸에 쓰면 시트가 조용히 버린다. */
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [
        { updateSheetProperties: { properties: { sheetId: id, gridProperties: { rowCount: rowsNeed, columnCount: HEAD.length, frozenRowCount: 0, frozenColumnCount: 0 } }, fields: 'gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } },
        { unmergeCells: { range: { sheetId: id } } },
      ] }),
    });
  }
  if (id === undefined) { console.log(`   x ${j.month} — 탭을 못 만들었습니다`); continue; }
  const note = (p: string): [boolean, string] => kept.get(p) || [false, ''];

  const tail = (a: string | number, b: string | number, c: string | number) =>
    [...pad(iM), a, b, c, ...pad(HEAD.length - iM - 3)];
  const body = j.rows.map((r, i) => rowOf({
    'No.': i + 1, 차량번호: r.plate, 인도일: r.deliv, 공급사: r.sup, 모델명: modelOf.get(r.plate) || '',
    '차량 가격(신차)': r.price || '', 임차인: r.cust, 영업사: r.agent, '상품 구분': r.product,
    '계약 기간': r.term || '', 렌탈료: r.rent || '', '납입 방식': r.payKind, [BASIS[0]]: r.why,
    공급가액: r.net, 부가세: r.vat, 합계: r.total, '지급 예정일': dayKo(payDate(j.month, r.sup)),
    확인: note(r.plate)[0], 메모: note(r.plate)[1],
  }));
  const backAt = j.rows.map((r, i) => (r.total < 0 ? i : -1)).filter((i) => i >= 0);
  const values: (string | number | boolean)[][] = [
    [`${j.month.slice(0, 4)}년 ${Number(j.month.slice(5))}월 정산서    ·    ${CH} 귀중 · ${CORP.name} 발행`, ...pad(HEAD.length - 1)],
    tail('공급가액', '부가세', '지급 금액'),
    tail(j.net, j.vat, j.net + j.vat),
    HEAD,
    ...body,
    ['', '합계', `${j.rows.length}건`, ...pad(iM - 3), j.net, j.vat, j.net + j.vat, ...pad(HEAD.length - iM - 3)],
    pad(HEAD.length),
    /**
     * ★★**어디서 온 값인지 적는다.** 이 탭은 원자가 아니라 «상대가 보내 준 종이»에서 왔다.
     *   안 적으면 다음 사람이 ERP 가 뽑은 줄 알고 원장과 맞대다가 헛물을 켠다.
     */
    [`지난 기록입니다 — ${CH} 제공 원본을 그대로 옮겼습니다 (${j.papers.map((p) => `${p.file} ${won(p.total)}`).join(' · ')}).`, ...pad(HEAD.length - 1)],
    ['원본에 접수일·보증금 금액이 없어 그 두 칸은 비워 두었습니다. 모델명은 차량번호로 채웠습니다.', ...pad(HEAD.length - 1)],
    [`${CORP.staff} · ${S(CORP.staffPhone) || CORP.phone} · ${CORP.email}`, ...pad(HEAD.length - 1)],
  ];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${TAB}'!A1:${colName(HEAD.length)}${values.length + 5}`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });

  /** ★서식은 달 탭 발행기와 «같은 함수»가 낸다 — 지난 기록이라고 다른 옷을 입히지 않는다. */
  const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: settleTabFormat({
      sheetId: id, head: HEAD, width: WIDTH, r0: 3, bodyLen: body.length, backAt,
      /** 지난 달은 «닫힌 달»이다 — 「빠진 건 적어 주세요」 빈 줄을 두지 않는다. */
      blanks: 0, footLen: 3, basisLen: BASIS.length, money: MONEY, left: LEFT,
    }) }),
  });
  console.log(`   ${fr.ok ? 'o' : '! 서식'} ${TAB}  ${String(j.rows.length).padStart(2)}줄 · ${won(j.net + j.vat).padStart(12)}${backAt.length ? `  (환수 ${backAt.length}줄)` : ''}`);
  if (!fr.ok) console.log(`      ${(await fr.text()).slice(0, 200)}`);
}

console.log(`\n   ✓ ${jobs.length}개 탭을 얹었습니다 — https://docs.google.com/spreadsheets/d/${bookId}`);
console.log('   ※ 탭 차례는 setup-channel-sheet 가 맞춥니다.\n');
process.exit(0);
