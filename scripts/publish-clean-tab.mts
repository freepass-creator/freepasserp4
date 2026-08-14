/**
 * **「AI 정제」 탭**을 판매시트에 숨겨 둔다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「정제탭을 하나 만들던지… 숨겨서」)
 *   공급사마다 같은 색을 다른 말로 쓴다 — 화이트 107 · 흰색 86 · 크리미 화이트펄 42(실측).
 *   그 «무엇을 무엇으로» 를 코드에 박으면 고칠 때마다 배포해야 한다. 시트에 두면 바로 고친다.
 *
 * ★표는 **지금 시트에 실제로 있는 값**에서 뽑는다. 짐작으로 목록을 만들지 않는다.
 *   대표색 제안은 ERP 색 마스터(`lib/domain/color-master`)가 낸다 — 이미 별칭까지 정리돼 있다.
 *   ⚠ 제안이 틀렸으면 **시트에서 고치면 된다.** 다음 발행이 그대로 따른다.
 * ★새 값이 들어오면 이 스크립트를 다시 돌린다 — 이미 적어 둔 줄은 **손대지 않고** 새 줄만 더한다.
 *
 *   npx tsx scripts/publish-clean-tab.mts
 *   npx tsx scripts/publish-clean-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapColor } from '../lib/domain/color-master';
import { makerDisplay } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const TAB = arg('tab', 'AI 정제');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const api = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
/** ⚠ 재시도가 없으면 쿼터에 걸린 순간 죽는다. 이 스크립트는 죽으면 사전을 못 지킨다. */
const call = async (u: string, init?: RequestInit) => {
  for (let n = 0; ; n++) {
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};

// ── ① 판매시트에서 지금 쓰이는 색을 모은다 ────────────────────────────────────
const meta = await call(`${api}?fields=sheets.properties(sheetId,title,hidden,index)`) as
  { sheets: { properties: { sheetId: number; title: string; hidden?: boolean; index: number } }[] };
const listTab = meta.sheets.find((s) => !s.properties.hidden && s.properties.title.startsWith('상품리스트'))?.properties.title;
if (!listTab) throw new Error('상품리스트 탭을 못 찾음');
const v = await call(`${api}/values/${encodeURIComponent(`'${listTab.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
const rows = (v.values || []) as string[][];
const hdr = (rows[0] || []).map(S);
const seen = (col: string) => {
  const i = hdr.indexOf(col);
  const m = new Map<string, number>();
  if (i < 0) return m;
  for (const r of rows.slice(1)) { const s = S(r[i]); if (s) m.set(s, (m.get(s) || 0) + 1); }
  return m;
};
const ext = seen('외장');
const int = seen('내장');

// ── ② 이미 적어 둔 규칙은 지키고 새 값만 더한다 ───────────────────────────────
const old = new Map<string, string>();
try {
  const cur = await call(`${api}/values/${encodeURIComponent(`'${TAB}'!A1:D2000`)}`) as { values?: string[][] };
  for (const r of ((cur.values || []) as string[][])) {
    const kind = S(r[0]), from = S(r[1]), to = S(r[2]);
    if (kind.startsWith('@') && from) old.set(`${kind}|${from}`, to);
  }
  if (old.size) console.log(`  이미 적힌 규칙 ${old.size}개 — 그대로 지킨다`);
} catch { /* 처음이면 없다 */ }

type Row = [string, string, string, string];
const block = (kind: '@외장' | '@내장', m: Map<string, number>, k: 'ext' | 'int'): Row[] => {
  const out: Row[] = [];
  for (const [raw, n] of [...m].sort((a, b) => b[1] - a[1])) {
    const key = `${kind}|${raw}`;
    const kept = old.get(key);
    // 사람이 적어 둔 값이 있으면 그것을 쓰고, 없으면 색 마스터의 제안을 적는다.
    const to = kept !== undefined && kept !== '' ? kept : snapColor(raw, k);
    out.push([kind, raw, to, `${n}대${kept !== undefined ? '' : ' · 새로 들어온 값'}`]);
  }
  return out;
};

/**
 * ★차명 축 — **차종마스터에 없는 말만** 뽑는다(사장님 2026-08-14 —
 *   「익스크루스비 → 익스클루시브」·「벤츠 이클래스 → E-클래스」 이런 식으로).
 *   이미 마스터와 같은 말은 규칙이 필요 없다. 목록이 길면 고칠 사람이 지친다.
 * ★제안은 **가장 비슷한 마스터 말**을 낸다. 확신이 없으면 비워 둔다 —
 *   빈칸은 「공급사 말 그대로」라 안전하다. 지어낸 제안이 틀린 값보다 나쁘다.
 */
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];
const nk = (v: unknown) => S(v).replace(/[\s()\-·.]/g, '').toLowerCase();
const MASTER_MAKER = new Set(MASTER.map((e) => nk(makerDisplay(e.maker))));
const MASTER_MODEL = new Set(MASTER.map((e) => nk(e.model)));
const MASTER_SUB = new Set(MASTER.flatMap((e) => [nk(e.sub_model), nk(`${e.sub_model}${e.gen_code}`)]));
const MASTER_TRIM = new Set(MASTER.flatMap((e) => [...(e.trims || []), ...((e.variants || []).flatMap((v) => v.trims || []))]).map(nk));
const NAMES = {
  '@제조사': [...new Set(MASTER.map((e) => makerDisplay(e.maker)))],
  '@모델': [...new Set(MASTER.map((e) => S(e.model)))],
  '@세부모델': [...new Set(MASTER.map((e) => S(e.sub_model)))],
  '@세부트림': [...new Set(MASTER.flatMap((e) => [...(e.trims || []), ...((e.variants || []).flatMap((v) => v.trims || []))]).map(S))],
} as Record<string, string[]>;

/** 두 낱말이 얼마나 겹치나 — 글자 단위. 오타(익스크루스비)와 정답(익스클루시브)을 잇는다. */
function similar(a: string, b: string): number {
  const x = nk(a), y = nk(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const set = new Set([...x]);
  let hit = 0;
  for (const ch of new Set([...y])) if (set.has(ch)) hit++;
  const cover = hit / Math.max(set.size, new Set([...y]).size);
  const lenPenalty = Math.min(x.length, y.length) / Math.max(x.length, y.length);
  return cover * lenPenalty;
}
const suggest = (kind: string, raw: string) => {
  const pool = NAMES[kind] || [];
  let best = '', score = 0;
  for (const cand of pool) { const s = similar(raw, cand); if (s > score) { score = s; best = cand; } }
  // 어지간히 닮았을 때만 제안한다. 애매하면 사람이 채운다.
  return score >= 0.62 ? best : '';
};
const nameBlock = (kind: '@제조사' | '@모델' | '@세부모델' | '@세부트림', m: Map<string, number>, known: Set<string>): Row[] => {
  const out: Row[] = [];
  for (const [raw, n] of [...m].sort((a, b) => b[1] - a[1])) {
    const key = `${kind}|${raw}`;
    const kept = old.get(key);
    // 마스터와 이미 같은 말이면 규칙이 필요 없다 — 사람이 적어 둔 게 없으면 건너뛴다.
    if (kept === undefined && known.has(nk(raw))) continue;
    const to = kept !== undefined ? kept : suggest(kind, raw);
    out.push([kind, raw, to, `${n}대 · 마스터에 없는 말${to ? '' : ' · 제안 없음(비우면 원문 그대로)'}`]);
  }
  return out;
};

const ROWS: Row[] = [
  ['구분', '공급사가 쓴 말', '바꿀 값', '비고'],
  ['', '', '', ''],
  ['@설명', '이 탭이 무엇인가', '판매시트를 만들 때 «무엇을 무엇으로» 바꿀지 정하는 표다. 여기를 고치면 다음 발행이 그대로 따른다. 코드는 안 고쳐도 된다.', ''],
  ['@설명', '비우면', '「바꿀 값」을 비우면 공급사 말을 그대로 싣는다.', ''],
  ['@설명', '새 값', '공급사가 새 말을 쓰면 scripts/publish-clean-tab.mts 를 다시 돌린다. 이미 적어 둔 줄은 안 건드리고 새 줄만 붙는다.', ''],
  ['', '', '', ''],
  ...block('@외장', ext, 'ext'),
  ['', '', '', ''],
  ...block('@내장', int, 'int'),
  ['', '', '', ''],
  ...nameBlock('@제조사', seen('제조사'), MASTER_MAKER),
  ['', '', '', ''],
  ...nameBlock('@모델', seen('모델'), MASTER_MODEL),
  ['', '', '', ''],
  ...nameBlock('@세부모델', seen('세부모델'), MASTER_SUB),
  ['', '', '', ''],
  ...nameBlock('@세부트림', seen('세부트림'), MASTER_TRIM),
  ['', '', '', ''],
  /**
   * ★전용계좌는 **업체별로 하나**다(사장님 2026-08-14 — 「업체별로 확인된 거 메모탭에 남겨서」).
   *   차마다 적힐 값이 아니라 공급사에 붙는 값인데, 공급사 시트마다 적는 법이 달라 갈린다.
   *   여기 「바꿀 값」에 **확인된 계좌 한 줄**을 적어 두면 그 공급사 전체가 그걸로 나간다.
   * ⚠ 돈이 들어가는 자리다. 확인 안 된 계좌를 적지 마라 — 비워 두면 공급사 시트 값을 그대로 쓴다.
   */
  ...(() => {
    const m = seen('전용계좌');
    const sup = seen('공급사');
    const out: Row[] = [];
    // 공급사별로 지금 시트에 어떤 계좌가 몇 가지로 적혀 있나를 보여 준다.
    const bySup = new Map<string, Map<string, number>>();
    const iSup = hdr.indexOf('공급사'), iAcc = hdr.indexOf('전용계좌');
    if (iSup >= 0 && iAcc >= 0) {
      for (const r of rows.slice(1)) {
        const s = S(r[iSup]), a = S(r[iAcc]);
        if (!s) continue;
        const inner = bySup.get(s) || new Map<string, number>();
        inner.set(a || '(빈칸)', (inner.get(a || '(빈칸)') || 0) + 1);
        bySup.set(s, inner);
      }
    }
    for (const [name] of [...sup].sort((a, b) => b[1] - a[1])) {
      const key = `@전용계좌|${name}`;
      const kept = old.get(key);
      const inner = bySup.get(name) || new Map();
      const seenTxt = [...inner].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(' · ');
      out.push(['@전용계좌', name, kept ?? '', `지금 시트에 적힌 것 — ${seenTxt.slice(0, 120)}`]);
    }
    void m;
    return out;
  })(),
];

/**
 * ★**한 번 적어 둔 규칙은 시트에서 그 원문이 사라져도 지운다.** ← 이걸 안 했었다.
 *
 * ⚠ 여기가 이 스크립트의 가장 큰 함정이었다(2026-08-14 발견).
 *   표는 «지금 상품리스트에 서 있는 값»으로만 만든다. 그런데 규칙이 한 번 먹히면
 *   상품리스트에는 **바뀐 뒤 값만** 서므로 원문이 사라지고, 그 줄이 다음 실행에서
 *   표에서 통째로 없어졌다. 그러면 다음 발행에 원문이 되살아나고, 다시 제안이 뜬다 —
 *   사람이 검수해 확정한 표기가 조용히 유실되고 무한 왕복하는 구조였다.
 *
 * ★그래서 «지금 시트에 없는» 옛 규칙도 그대로 다시 싣는다. 값이 적힌 줄만 지킨다 —
 *   빈 줄까지 되살리면 표가 옛 제안으로 계속 불어난다.
 */
{
  const emitted = new Set(ROWS.filter((r) => S(r[0]).startsWith('@')).map((r) => `${S(r[0])}|${S(r[1])}`));
  const leftover: Row[] = [];
  for (const [key, to] of old) {
    if (!S(to)) continue;                       // 값이 안 적힌 옛 제안은 되살릴 것이 없다
    if (emitted.has(key)) continue;
    if (key.startsWith('@설명')) continue;
    const at = key.indexOf('|');
    leftover.push([key.slice(0, at), key.slice(at + 1), to, '지금 시트엔 없음 — 규칙은 지킨다']);
  }
  if (leftover.length) {
    leftover.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    ROWS.push(['', '', '', ''], ['@설명', '아래는', '전에 적어 둔 규칙인데 지금 상품리스트엔 그 원문이 안 보이는 것들이다. 규칙이 이미 먹혀서 그렇다 — 지우지 않는다.', '']);
    ROWS.push(...leftover);
    console.log(`  전에 적어 둔 규칙 ${leftover.length}개는 지금 시트에 원문이 없어도 그대로 지킨다`);
  }
}

console.log(`■ 「${TAB}」 ${APPLY ? '반영' : '미리보기(dry-run)'}`);
console.log(`  외장 ${ext.size}종 · 내장 ${int.size}종 · 모두 ${ROWS.length}줄\n`);
for (const r of ROWS.filter((x) => x[0] === '@외장').slice(0, 10)) console.log(`   ${r[1].padEnd(24)} → ${r[2].padEnd(8)} ${r[3]}`);
console.log('   …');
if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

let found = meta.sheets.find((s) => s.properties.title === TAB);
if (!found) {
  const made = await call(`${api}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  found = { properties: made.replies[0].addSheet.properties };
  console.log(`  탭 「${TAB}」 새로 만듦`);
}
const gid = found.properties.sheetId;
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});
await call(`${api}/values/${encodeURIComponent(TAB)}!A1:D2000:clear`, { method: 'POST', body: '{}' });
await call(`${api}/values/${encodeURIComponent(TAB)}!A1?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: ROWS }),
});
await call(`${api}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    { repeatCell: {
      range: { sheetId: gid },
      cell: { userEnteredFormat: {
        backgroundColor: rgb('FFFFFF'),
        textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, foregroundColor: rgb('000000') },
        horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
      } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    } },
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, bold: true } } },
      fields: 'userEnteredFormat.textFormat',
    } },
    // 「바꿀 값」 칸은 사람이 고치는 자리다 — 눈에 띄게 둔다.
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, bold: true, foregroundColor: rgb('1D4ED8') } } },
      fields: 'userEnteredFormat.textFormat',
    } },
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    ...[[0, 90], [1, 300], [2, 140], [3, 500]].map(([i, px]) => ({ updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px }, fields: 'pixelSize',
    } })),
    { updateSheetProperties: { properties: { sheetId: gid, index: meta.sheets.length, hidden: true }, fields: 'index,hidden' } },
  ] }),
});
console.log(`\n  반영 완료 — 숨긴 탭 「${TAB}」 · ${ROWS.length}줄`);
console.log(`  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
