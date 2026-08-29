/**
 * F03 차종마스터 — 커서 지식검토만 「커서 지식검토」에 쓴다. 이름·엔카칸·클로드는 안 건드린다.
 *
 *   npx tsx scripts/write-cursor-f03-review.mts
 *   npx tsx scripts/write-cursor-f03-review.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  ENCAR_MASTER_SHEET_ID,
  ENCAR_MASTER_TAB,
  ENCAR_NAME_COLUMNS,
  loadEncarWorkSheetGrids,
} from '../lib/domain/encar-master-sheet';
import { fold } from '../lib/domain/encar-work-sheet-match';
import { assertNotLiveVehicleMasterWrite } from '../lib/domain/legacy-sheets';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string, init?: RequestInit) => {
  const tok = (await jwt.getAccessToken()).token;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};
assertNotLiveVehicleMasterWrite(ENCAR_MASTER_SHEET_ID, 'cursor review');

const MAKER_LEAK = [
  '메르세데스벤츠', '메르세데스-벤츠', '메르세데스', '기아자동차', '현대자동차',
  'KG모빌리티', '르노코리아', '르노삼성', '한국지엠', '제네시스',
  '쉐보레', '쌍용', '기아', '현대', '벤츠', 'BMW', '아우디', '테슬라', '미니',
  '폭스바겐', '볼보', '캐딜락', '지프', '포르쉐', 'KGM', '르노', 'BYD', '폴스타',
].sort((a, b) => b.length - a.length);

const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};

function tokens(s: string): string[] {
  return S(s).split(/[\s/·]+/).filter(Boolean);
}

function makerLeakIn(name: string, rowMaker: string): string | '' {
  const hay = tokens(name);
  const rowF = fold(rowMaker);
  for (const tok of hay) {
    const f = fold(tok);
    if (!f) continue;
    const hit = MAKER_LEAK.find((m) => fold(m) === f);
    if (!hit) continue;
    if (fold(hit) === rowF) return hit;
    return hit;
  }
  return '';
}

function cursorOpinion(r: {
  origin: string; maker: string; model: string; sub: string; trim: string; start: string; end: string;
}): string {
  const name = `${r.model} ${r.sub} ${r.trim}`;
  if (!r.origin || !r.maker || !r.model || !r.sub) return '틀림 · 필수칸 빈칸';
  if (/[()（）]/.test(name)) return '틀림 · 괄호(엔카 표기는 괄호 없이)';
  if (/\bFL\b|페이스리프트|F\/L/i.test(name)) return '틀림 · FL 표기(엔카 안 나눈 FL은 안 씀)';
  if (r.maker === '기아' && /\d+\s*세대/.test(r.sub)) return '틀림 · 기아 N세대 잔존(예외①은 개발코드)';
  if (/티볼리/.test(r.sub) && /X100/i.test(name)) return '틀림 · 티볼리 X100(세 번째 예외 아님)';
  if (/GT\s+Line/i.test(r.trim) && !/GT-Line/i.test(r.trim)) return '틀림 · GT-Line 하이픈';
  const leak = makerLeakIn(r.sub, r.maker) || makerLeakIn(r.trim, r.maker);
  if (leak) return `틀림 · 제조사 누출 「${leak}」`;
  if (r.maker === '제네시스' && r.sub === 'G80 DH') return '맞음 · 예외② G80 DH';
  if (r.maker === '제네시스' && r.sub === 'G80 RG3') return '못정함 · 제네시스 개발코드는 예외 아님(지식)';
  if (r.maker === '제네시스' && r.sub === 'G80') return '맞음 · 합의안 1세대 G80';
  if (r.maker === '기아' && r.sub === 'K5 DL3') return '맞음 · 예외① K5 DL3';
  if (r.maker === '기아' && (r.sub === '더 뉴 카니발 YP' || r.sub === '올 뉴 카니발 YP')) {
    return '맞음 · 예외① 올뉴/더뉴 카니발=3세대 YP';
  }
  if ((r.sub === '포터 II' || r.sub === '봉고') && !r.trim) return '못정함 · 상용 트림 빈칸';
  if (!r.trim) return '못정함 · 세부트림 빈칸';
  if (r.start === '보류' || r.end === '보류') return '못정함 · 생산기간 보류';
  return '맞음(규칙)';
}

const grids = await loadEncarWorkSheetGrids(api);
const hdr = (grids.names[0] || []).map(S);
if (hdr.slice(0, 7).join('|') !== ENCAR_NAME_COLUMNS.join('|')) {
  throw new Error(`이름 7열이 다름: ${hdr.join(' | ')}`);
}
const whoAt = hdr.indexOf('커서 지식검토');
if (whoAt < 7) throw new Error(`커서 지식검토 칸 없음: ${hdr.join(' | ')}`);

const idx = (n: string) => hdr.indexOf(n);
const iOrigin = idx('원산지');
const iMaker = idx('제조사');
const iModel = idx('모델');
const iSub = idx('세부모델');
const iTrim = idx('세부트림');
const iStart = idx('생산시작');
const iEnd = idx('생산종료');

type Hit = { sheetRow: number; label: string; value: string };
const hits: Hit[] = [];
const tally = new Map<string, number>();
for (let r = 1; r < grids.names.length; r++) {
  const row = (grids.names[r] || []).map(S);
  if (!row[iMaker] && !row[iModel]) continue;
  const rec = {
    origin: row[iOrigin], maker: row[iMaker], model: row[iModel],
    sub: row[iSub], trim: row[iTrim], start: row[iStart], end: row[iEnd],
  };
  const value = cursorOpinion(rec);
  hits.push({ sheetRow: r + 1, label: `${rec.maker} ${rec.sub} / ${rec.trim || '(트림없음)'}`, value });
  const key = value.split(' · ')[0];
  tally.set(key, (tally.get(key) || 0) + 1);
}

const nonDefault = hits.filter((h) => h.value !== '맞음(규칙)');
console.log(`■ 커서 지식 ${APPLY ? '반영' : '미리보기'} · ${hits.length}행 · 칸 ${colA1(whoAt)}`);
console.log(`  머리 ${hdr.join(' | ')}`);
[...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
console.log(`  기본 아닌 ${nonDefault.length}`);
const byVal = new Map<string, Hit[]>();
for (const h of nonDefault) {
  const arr = byVal.get(h.value) || [];
  arr.push(h);
  byVal.set(h.value, arr);
}
for (const [v, arr] of [...byVal.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  · ${arr.length}× ${v}`);
  arr.slice(0, 6).forEach((h) => console.log(`      ${h.sheetRow}  ${h.label}`));
  if (arr.length > 6) console.log(`      … +${arr.length - 6}`);
}

if (!APPLY) {
  console.log('※ dry-run. 반영은 --apply. 이름·클로드 칸은 안 씀.');
  process.exit(0);
}

const SH = `https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}`;
const data = hits.map((h) => ({
  range: `'${ENCAR_MASTER_TAB}'!${colA1(whoAt)}${h.sheetRow}`,
  values: [[h.value]],
}));
for (let i = 0; i < data.length; i += 400) {
  await api(`${SH}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }),
  });
  console.log(`  씀 ${Math.min(i + 400, data.length)}/${data.length}`);
}

const meta = await api(`${SH}?fields=sheets.properties(sheetId,title,gridProperties)`);
const gid = ((meta.sheets || []) as any[]).find((s) => S(s.properties?.title) === ENCAR_MASTER_TAB)?.properties?.sheetId;
if (gid === undefined) throw new Error('차종마스터 탭 없음');
await api(`${SH}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: [
      {
        updateSheetProperties: {
          properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 0 } },
          fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
        },
      },
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId: gid,
              startRowIndex: 0,
              endRowIndex: grids.names.length,
              startColumnIndex: 0,
              endColumnIndex: hdr.length,
            },
          },
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: 'COLUMNS', startIndex: whoAt, endIndex: whoAt + 1 },
          properties: { pixelSize: 220 },
          fields: 'pixelSize',
        },
      },
    ],
  }),
});
console.log(`반영 ${hits.length}행 · 커서만 · 필터 A:${colA1(hdr.length - 1)}`);
