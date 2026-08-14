/**
 * **손오공 구독을 ERP 안 거치고 제공시트에서 바로 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 새로 만들었나(2026-08-14)
 *   `publish-jonghap-tab --sonogong` 은 ERP 를 거친다. 그래서 실측으로 이런 일이 났다 —
 *     제공시트 「구독재고」 45줄 · 반납형 요금 42대 · 인수형 요금 24대 · 인수형 보증금 24대
 *     ERP 경유 발행 결과      23대 · **보증금 0대**
 *   돈이 통째로 사라진 표를 영업자에게 주는 셈이었다. 상품리스트와 같은 규칙으로 돌린다 —
 *   **공급사가 쓴 글자를 그 자리에 옮길 뿐이다.**
 *
 * ★보증금은 두 칸이다 — 「보증금 반납형」·「보증금 인수형」.
 *   반납형 보증금은 제공시트에 「연수×대여료」라고 **글자로** 적혀 있다. 숫자로 계산해 넣지 마라 —
 *   기간마다 달라 한 숫자로 못 적는다(사장님 2026-08-13 확인).
 * ★인수형은 36개월부터만 판다 — 12·24개월은 45대 전부 비어 있다. 빈 열은 아예 두지 않는다.
 * ⚠ 제공시트 「구독재고」 A1 머리글이 「1열」로 깨져 있으면 차량번호가 안 잡힌다(2026-08-14 고침).
 *
 *   npx tsx scripts/publish-sonogong-tab.mts
 *   npx tsx scripts/publish-sonogong-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildSalesFormatRequests, columnWidths, rgb, LINK, FONT, SIZE, ITALIC } from '../lib/domain/sales-sheet-format';
import { productType } from '../lib/domain/sales-sheet-clean';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
/** 판매시트(영업자용). */
const SHEET = arg('sheet', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const TAB = arg('tab', '손오공구독');
/** 손오공 제공시트 — 우리가 만든 것. 공급사 소유 시트가 아니다. */
const SRC = arg('src', '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA');
const SRC_TAB = arg('srcTab', '구독재고');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit) => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) as Rec : {} as Rec;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((ok) => setTimeout(ok, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * 판매시트 열 차례 — 상품리스트와 같은 자리에 같은 칸이 서야 한다.
 * 돈 블록만 구독 규격(반납형 한 벌 + 인수형 한 벌)으로 갈아 끼운다.
 */
const RETURN_BLOCK = ['보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형'];
const ACQ_BLOCK = ['보증금 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형'];
const COLUMNS = [
  '배차상태', '구분', '차량번호',
  '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '외장', '내장', 'Km',
  ...RETURN_BLOCK, ...ACQ_BLOCK,
  '옵션', '최초등록', '소비자가격', '연료', '배기량', '공급사',
];

/** 판매시트 열 → 제공시트 열 이름 후보. 앞에서부터 먼저 맞는 것을 쓴다. */
const ALIAS: Record<string, string[]> = {
  배차상태: ['상태', '배차상태', '차량상태'],
  구분: ['분류', '구분', '상품구분'],
  차량번호: ['차량번호', '차번'],
  제조사: ['제조사', '메이커'],
  모델: ['차종', '차종분류', '모델'],
  세부모델: ['차명(트림)', '세부모델', '모델명'],
  파워트레인: ['파워트레인'],
  세부트림: ['세부트림', '트림'],
  외장: ['외부색상', '외장색', '외장'],
  내장: ['내부색상', '내장색', '내장'],
  Km: ['주행거리', 'Km'],
  '보증금 반납형': ['보증금 반납형'],
  '12개월 반납형': ['12개월 반납형'], '24개월 반납형': ['24개월 반납형'],
  '36개월 반납형': ['36개월 반납형'], '48개월 반납형': ['48개월 반납형'], '60개월 반납형': ['60개월 반납형'],
  '보증금 인수형': ['보증금 인수형'],
  '36개월 인수형': ['36개월 인수형'], '48개월 인수형': ['48개월 인수형'], '60개월 인수형': ['60개월 인수형'],
  옵션: ['옵션'],
  최초등록: ['최초등록일', '최초등록'],
  소비자가격: ['차량가격', '소비자가격'],
  연료: ['연료', '유종'],
  배기량: ['배기량'],
};

// ⚠ 파일이 배열이 아니라 { entries: [...] } 다. 그대로 넘기면 filter 가 없다며 죽는다.
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];

console.log(`■ 손오공구독 ${APPLY ? '반영' : '미리보기(dry-run)'} — 제공시트 직행(ERP 안 거침)\n`);

/** 숨긴 줄은 «파는 물건이 아니다». 값만 읽지 말고 줄 상태까지 본다. */
const g = await api(`${SH}/${SRC}?includeGridData=true&ranges=${encodeURIComponent(`'${SRC_TAB.replace(/'/g, "''")}'`)}&fields=${encodeURIComponent('sheets(data(rowMetadata(hiddenByUser,hiddenByFilter),rowData(values(formattedValue,hyperlink))))')}`);
const data = ((g.sheets || [])[0]?.data || [])[0] || {};
const rowMeta = (data.rowMetadata || []) as Rec[];
const grid = ((data.rowData || []) as Rec[]).map((r) => ((r.values || []) as Rec[]).map((v) => S(v.formattedValue)));
const linkRow = ((data.rowData || []) as Rec[]).map((r) => ((r.values || []) as Rec[]).map((v) => S(v.hyperlink)));

const hi = grid.findIndex((r) => r.some((c) => norm(c) === norm('차명(트림)')));
if (hi < 0) throw new Error('제공시트에서 머리행(「차명(트림)」)을 못 찾았다');
const hdr = grid[hi].map(S);
const pick = (name: string) => {
  for (const cand of ALIAS[name] || []) { const i = hdr.findIndex((h) => norm(h) === norm(cand)); if (i >= 0) return i; }
  return -1;
};
const idx = new Map(COLUMNS.map((c) => [c, pick(c)]));
const missing = COLUMNS.filter((c) => c !== '공급사' && (idx.get(c) ?? -1) < 0);
if (missing.length) console.log(`  ⚠ 제공시트에 없는 칸 ${missing.length}: ${missing.join(', ')} — 비운다(지어내지 않는다)\n`);

const pi = idx.get('차량번호') ?? -1;
if (pi < 0) throw new Error('차량번호 열을 못 찾았다 — 제공시트 A1 머리글이 「1열」로 깨져 있지 않은지 봐라');

const rows: string[][] = [];
const photoOf = new Map<string, string>();
let hidden = 0, blank = 0;
for (let k = hi + 1; k < grid.length; k++) {
  const m = rowMeta[k] || {};
  const r = grid[k];
  const plate = S(r[pi]);
  if (!plate) { blank++; continue; }
  if (m.hiddenByUser || m.hiddenByFilter) { hidden++; continue; }
  const cell = (c: string) => { const i = idx.get(c) ?? -1; return i >= 0 ? S(r[i]) : ''; };
  const photo = S(linkRow[k]?.[pi]);
  if (photo.startsWith('http')) photoOf.set(norm(plate), photo);
  // 차명만 마스터로 올린다. 돈·상태는 시트 글자 그대로.
  const rawName = [cell('모델'), cell('세부모델'), cell('세부트림')].filter(Boolean).join(' ').trim();
  const snap = rawName ? snapToMaster({
    maker: cell('제조사'), model: cell('모델'),
    sub_model: [cell('세부모델'), cell('세부트림')].filter(Boolean).join(' '),
    fuel_type: cell('연료'),
  } as EntityRecord, MASTER) : null;
  const ok = snap && (snap.confidence === 'high' || snap.confidence === 'medium');
  rows.push(COLUMNS.map((c) => {
    if (c === '공급사') return '손오공';
    if (c === '구분') return productType(cell(c)) || '중고구독';
    if (ok) {
      if (c === '제조사') return S(snap!.maker) || cell(c);
      if (c === '모델') return S(snap!.model) || cell(c);
      if (c === '세부모델') return S(snap!.sub_model) || cell(c);
      if (c === '파워트레인') return S(snap!.variant) || cell(c);
      if (c === '세부트림') return S(snap!.trim_name);
    }
    return cell(c);
  }));
}

const count = (c: string) => rows.filter((r) => S(r[COLUMNS.indexOf(c)])).length;
console.log(`  ${rows.length}대 실음 (숨긴 줄 ${hidden} · 차번 없는 줄 ${blank})`);
console.log(`  ★차량번호 ${count('차량번호')} · 보증금 반납형 ${count('보증금 반납형')} · 보증금 인수형 ${count('보증금 인수형')}`);
console.log(`  반납형 요금 36개월 ${count('36개월 반납형')} · 인수형 요금 36개월 ${count('36개월 인수형')}`);
console.log(`  사진링크 ${photoOf.size}대\n`);
if (!rows.length) throw new Error('한 대도 못 읽었다 — 발행하지 않는다');
if (!APPLY) { console.log('※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const meta = await api(`${SH}/${SHEET}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as Rec[]).find((s) => S(s.properties?.title).startsWith(TAB))?.properties?.sheetId as number | undefined;
if (gid == null) {
  const made = await api(`${SH}/${SHEET}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }) });
  gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
}
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '.');
const title = `${TAB} ${stamp} · ${rows.length}대`;
await api(`${SH}/${SHEET}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    { updateSheetProperties: { properties: { sheetId: gid, title }, fields: 'title' } },
    { updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } },
  ] }),
});
await api(`${SH}/${SHEET}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [[...COLUMNS], ...rows] }),
});
{
  const now = await api(`${SH}/${SHEET}?fields=sheets(properties(sheetId,gridProperties(columnCount)),bandedRanges(bandedRangeId),conditionalFormats)`);
  const me = ((now.sheets || []) as Rec[]).find((s) => Number(s.properties?.sheetId) === gid) || {};
  await api(`${SH}/${SHEET}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: buildSalesFormatRequests({
      gid: gid as number, columns: COLUMNS, headerAt: 0,
      columnCountNow: Number(me.properties?.gridProperties?.columnCount) || COLUMNS.length,
      bandedRangeIds: ((me.bandedRanges || []) as Rec[]).map((b) => Number(b.bandedRangeId)),
      conditionalFormatCount: ((me.conditionalFormats || []) as unknown[]).length,
      widths: columnWidths(COLUMNS, rows),
    }) }),
  });
}
// ⚠ 사진링크는 맨 마지막. 뒤에 repeatCell 이 오면 링크가 통째로 지워진다.
{
  const rgbLink = rgb(LINK);
  const p = COLUMNS.indexOf('차량번호');
  const linked = rows.map((r, k) => ({ row: k + 1, plate: S(r[p]), url: photoOf.get(norm(r[p])) || '' })).filter((x) => x.url.startsWith('http'));
  if (linked.length) {
    await api(`${SH}/${SHEET}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: linked.map((x) => ({
        updateCells: {
          range: { sheetId: gid, startRowIndex: x.row, endRowIndex: x.row + 1, startColumnIndex: p, endColumnIndex: p + 1 },
          rows: [{ values: [{
            userEnteredValue: { stringValue: x.plate },
            textFormatRuns: [{ startIndex: 0, format: { link: { uri: x.url }, foregroundColor: rgbLink, underline: true, italic: ITALIC, fontFamily: FONT, fontSize: SIZE } }],
          }] }],
          fields: 'userEnteredValue,textFormatRuns',
        },
      })) }),
    });
  }
  console.log(`  차량번호에 사진링크 ${linked.length}대`);
}
console.log(`\n  반영 완료 — 탭 「${title}」\n  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
