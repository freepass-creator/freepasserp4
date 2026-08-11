/**
 * **공급사시트 정리표**를 다시 찍는다 — 사장님이 이걸 보고 업체에 시트를 나눠 준다.
 * 기본 dry-run, 실제 쓰기는 `--apply`.
 *
 * ★정리표가 둘이라 헷갈리면 안 된다.
 *   「공급사시트정리」(코드가 읽는 것) — 여기 적힌 주소를 ERP 가 **재고 정본**으로 읽는다.
 *     이 스크립트는 **손대지 않는다.** 아직 비어 있는 새 시트를 여기 적으면
 *     그 공급사 재고가 통째로 사라진다.
 *   「프리패스 공급사시트 정리」(사람이 보는 것) — 이 스크립트가 찍는다.
 *
 * 한 줄에 한 공급사, 무엇을 나눠 주고 지금 어디를 읽고 있는지 한눈에 보인다.
 *
 *   npx tsx scripts/publish-supplier-hub.mts
 *   npx tsx scripts/publish-supplier-hub.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED } from '../lib/domain/supplier-sheet-read';
import { buildRowHeights } from '../lib/domain/supplier-template-sheet';
import { isListableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const HUB = '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w';    // 「프리패스 공급사시트 정리」
const SALES = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';  // 「프리패스 상품리스트」(영업자용)
/** 탭 이름은 **메타에서 읽는다** — 파일 이름과 다르다(파일 「프리패스 공급사시트 정리」 / 탭 「공급사연동」). */
const TAB_HINT = '공급사연동';
/** A1 표기 — 탭 이름에 공백이 있으면 따옴표로 감싸야 «범위를 못 읽는다»가 안 난다. */
const A1 = (tab: string, ref = '') => `'${tab.replace(/'/g, "''")}'${ref ? `!${ref}` : ''}`;
const link = (id: string, gid = 0) => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${gid}`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

/** 공급사별 ERP 재고 — 살아있는 것과 목록에 서는 것. */
const stock = new Map<string, { alive: number; listed: number }>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  if (!code) continue;
  const cur = stock.get(code) || { alive: 0, listed: 0 };
  cur.alive++;
  if (isListableProduct({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord)) cur.listed++;
  stock.set(code, cur);
}

// ── 우리가 만든 입력시트 찾기 ───────────────────────────────────────────────
const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`);

const nameToCode = new Map<string, string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  for (const n of [p.partner_name, p.name, p.company_name].map(S).filter(Boolean)) nameToCode.set(n.replace(/\s|\(주\)|주식회사|㈜/g, ''), code);
}
const codeOf = (label: string): string => {
  const l = label.replace(/\s/g, '');
  if (nameToCode.has(l)) return nameToCode.get(l)!;
  for (const [n, c] of nameToCode) if (n.includes(l) || l.includes(n)) return c;
  return '';
};

/** 코드 → 우리 입력시트(재고 gid·정책 gid·이미 채운 행). */
type Ours = { id: string; name: string; stockGid: number; policyGid: number; rows: number; policies: number };
const ours = new Map<string, Ours>();
for (const f of ((found.files || []) as Rec[])) {
  const code = codeOf(S(f.name).replace('프리패스 재고 · ', ''));
  if (!code) continue;
  const g = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?includeGridData=true&fields=sheets(properties(sheetId,title),data(rowData(values(formattedValue))))`);
  let stockGid = 0; let policyGid = 0; let rows = 0; let policies = 0;
  for (const sh of ((g.sheets || []) as Rec[])) {
    const title = S(sh.properties?.title);
    const gid = Number(sh.properties?.sheetId ?? 0);
    const rd = (sh.data?.[0]?.rowData || []) as Rec[];
    if (title === '재고') {
      stockGid = gid;
      rows = rd.slice(1).filter((r) => ((r?.values || []) as Rec[]).some((c) => S(c?.formattedValue))).length;
    } else if (title === '정책') {
      policyGid = gid;
      // 1행이 정책코드 줄 — 라벨 칸을 빼고 값이 있는 칸이 정책 수다.
      policies = ((rd[0]?.values || []) as Rec[]).slice(1).filter((c) => S(c?.formattedValue)).length;
    }
  }
  ours.set(code, { id: S(f.id), name: S(f.name), stockGid, policyGid, rows, policies });
}

/**
 * 우리가 떠 둔 사본 — 자기 시트로 주는 공급사는 그쪽이 언제든 파일을 갈아탄다.
 * 「<공급사>(코드) 원본 YYYY-MM-DD」 중 **가장 최근 하나**를 줄에 붙인다.
 */
const copyQ = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '원본'");
const copyRes = await api(`https://www.googleapis.com/drive/v3/files?q=${copyQ}&pageSize=200&fields=files(id,name)&orderBy=name`);
const copyByCode = new Map<string, { id: string; name: string }>();
for (const f of ((copyRes.files || []) as Rec[])) {
  const code = (S(f.name).match(/\(([\w-]+)\)/) || [])[1];
  if (!code) continue;
  const cur = copyByCode.get(code);
  // 이름에 날짜가 들어 있다 — 사전순으로 큰 쪽이 최근이다.
  if (!cur || S(f.name) > cur.name) copyByCode.set(code, { id: S(f.id), name: S(f.name) });
}

// ── 표 만들기 ───────────────────────────────────────────────────────────────
// 링크 두 칸은 줄 종류에 따라 가리키는 곳이 다르다 — 공급사줄은 재고·정책, 영업자줄은 신·구 상품리스트.
const HEADERS = ['구분', '코드', '연동방식', 'ERP 재고', '목록에 선 것',
  '시트 ① (재고 / 상품리스트)', '시트 ② (정책 / 상품리스트 구버전)', '정책 수', '입력된 행',
  'ERP 가 지금 읽는 곳', '우리가 뜬 사본', '해야 할 일'];

const rows: (string | number)[][] = [];
const seen = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  if (!code || seen.has(code)) continue;
  const name = S(p.partner_name || p.name || p.company_name) || code;
  const mine = ours.get(code);
  const liveUrl = S(p.sheet_url);
  // 시트도 없고 우리가 만든 것도 없는 곳은 공급사가 아니다(영업채널 등).
  if (!mine && !liveUrl && !NOT_SHEET_BACKED.has(code)) continue;
  seen.add(code);

  const st = stock.get(code) || { alive: 0, listed: 0 };
  const how = NOT_SHEET_BACKED.has(code) ? '홈페이지 자동수집'
    : mine && liveUrl && !liveUrl.includes(mine.id) ? '공급사 자기 시트(우리 시트는 배포 대기)'
      : mine ? '우리 제공 시트'
        : '공급사 자기 시트';
  const todo = NOT_SHEET_BACKED.has(code) ? '없음 — 홈페이지가 정본'
    : !mine ? '공급사가 자기 시트로 준다 — 우리 양식은 안 만듦'
      : mine.rows === 0 ? '① 시트 전달 → ② 공급사가 입력 → ③ 다 채우면 ERP 연결을 이 시트로 바꾼다'
        : liveUrl.includes(mine.id) ? '연결 완료'
          : `입력 ${mine.rows}행 — 확인 후 ERP 연결을 이 시트로 바꾼다`;

  rows.push([
    name, code, how, st.alive, st.listed,
    mine ? link(mine.id, mine.stockGid) : '',
    mine ? link(mine.id, mine.policyGid) : '',
    mine ? mine.policies : '',
    mine ? mine.rows : '',
    liveUrl || (NOT_SHEET_BACKED.has(code) ? 'ironrentcar.com' : ''),
    copyByCode.has(code) ? link(copyByCode.get(code)!.id) : '',
    todo,
  ]);
}
rows.sort((a, b) => Number(b[3]) - Number(a[3]));

/**
 * 맨 윗줄은 **영업자용 시트**다 — 공급사가 아니라 우리가 찍어 내보내는 쪽이다.
 * 방향이 반대라 같은 표에 섞이면 헷갈리므로 「구분」과 「연동방식」으로 갈라 둔다.
 */
const salesMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}?fields=properties(title),sheets(properties(sheetId,title))`);
const salesTabs = ((salesMeta.sheets || []) as Rec[]).map((sh) => ({ gid: Number(sh.properties?.sheetId ?? 0), title: S(sh.properties?.title) }));
// 탭 이름에 날짜·시각이 들어 있다 — 이름을 내림차순으로 세우면 맨 앞이 제일 최근이다.
const newest = (prefix: string) => salesTabs.filter((t) => t.title.startsWith(prefix)).sort((a, b) => b.title.localeCompare(a.title))[0];
// 「상품리스트(구버전)」도 같은 글자로 시작한다 — 신버전을 고를 때는 구버전을 뺀다.
const listTab = salesTabs.filter((t) => t.title.startsWith('상품리스트') && !t.title.startsWith('상품리스트(구버전)')).sort((a, b) => b.title.localeCompare(a.title))[0];
const jonghapTab = newest('상품리스트(구버전)') || newest('종합표');
const totalAlive = [...stock.values()].reduce((n, s2) => n + s2.alive, 0);
const totalListed = [...stock.values()].reduce((n, s2) => n + s2.listed, 0);
rows.unshift([
  '★ 영업자용 상품리스트', '-', 'ERP → 영업자 (우리가 찍는다)', totalAlive, totalListed,
  listTab ? link(SALES, listTab.gid) : '',
  jonghapTab ? link(SALES, jonghapTab.gid) : '',
  '', '',
  'ERP (v4/products)',
  '',
  `공급사 시트가 바뀌면 다시 찍는다 — 지금 탭 「${S(listTab?.title)}」 · 「${S(jonghapTab?.title)}」`,
]);

console.log(`■ 공급사시트 정리표 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  ${'공급사'.padEnd(16)}${'코드'.padEnd(10)}${'재고'.padStart(6)}${'목록'.padStart(6)}${'정책'.padStart(6)}${'입력'.padStart(6)}   연동방식`);
for (const r of rows) {
  console.log(`  ${S(r[0]).slice(0, 15).padEnd(16)}${S(r[1]).padEnd(10)}${String(r[3]).padStart(6)}${String(r[4]).padStart(6)}${String(r[7] || '-').padStart(6)}${String(r[8] || '-').padStart(6)}   ${S(r[2])}`);
}
console.log(`\n  ${rows.length}곳 · 나눠 줄 시트 ${rows.filter((r) => S(r[5])).length}개`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}?fields=sheets(properties(sheetId,title))`);
const sheet = ((meta.sheets || []) as Rec[]).find((s) => S(s.properties?.title) === TAB_HINT) || ((meta.sheets || []) as Rec[])[0];
const gid = Number(sheet?.properties?.sheetId ?? 0);
const TAB = S(sheet?.properties?.title);

await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values/${encodeURIComponent(A1(TAB))}:clear`, { method: 'POST', body: '{}' });
await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values/${encodeURIComponent(A1(TAB, 'A1'))}?valueInputOption=USER_ENTERED`, {
  method: 'PUT', body: JSON.stringify({ values: [HEADERS, ...rows] }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: [
      { repeatCell: {
        range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: { userEnteredFormat: {
          backgroundColorStyle: { rgbColor: { red: 0.13, green: 0.20, blue: 0.33 } },
          textFormat: { bold: true, fontSize: 10, fontFamily: 'Roboto', foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
          verticalAlignment: 'MIDDLE',
        } },
        fields: 'userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment)',
      } },
      { repeatCell: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: { userEnteredFormat: { textFormat: { fontSize: 10, fontFamily: 'Roboto' }, verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      } },
      { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
      { autoResizeDimensions: { dimensions: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: HEADERS.length } } },
      // ★행 높이 — 기본 21px 은 붙어 보여 답답하다. 공급사 시트와 같은 규격으로 둔다.
      ...buildRowHeights(gid, rows.length + 1),
      // 글자가 칸을 넘치면 다음 줄로 흐르지 않고 잘리게 둔다 — 줄 높이가 들쭉날쭉해지면
      // 표가 아니라 문단처럼 보인다. 링크는 어차피 눌러서 여는 것이지 읽는 게 아니다.
      { repeatCell: {
        range: { sheetId: gid, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat.wrapStrategy',
      } },
    ],
  }),
});
console.log(`\n  반영 완료 — ${link(HUB, gid)}\n`);
