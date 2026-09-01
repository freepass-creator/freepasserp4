/**
 * 차종마스터 열 차례: 이름 축 다음이 세부트림, 생산시작·종료는 그 뒤.
 * 기본 dry-run. 반영 `--apply`.
 *
 *   npx tsx scripts/reorder-encar-work-name-columns.mts
 *   npx tsx scripts/reorder-encar-work-name-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  ENCAR_MASTER_SHEET_ID,
  ENCAR_MASTER_TAB,
  ENCAR_NAME_COLUMNS,
  loadEncarWorkSheetGrids,
} from '../lib/domain/encar-master-sheet';
import { workBookFromTabs } from '../lib/domain/encar-work-sheet-match';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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

const want = [...ENCAR_NAME_COLUMNS];
const grids = await loadEncarWorkSheetGrids(api);
const now = (grids.names[0] || []).map(S);
const head = now.slice(0, want.length);
console.log(`지금  ${now.join(' | ')}`);
console.log(`목표  ${want.join(' | ')}`);

if (head.join('|') === want.join('|')) {
  const book = workBookFromTabs(grids);
  console.log(`이미 맞음 · 차종 ${book.names.length}행`);
  process.exit(0);
}

const trimAt = now.indexOf('세부트림');
const startAt = now.indexOf('생산시작');
if (trimAt < 0 || startAt < 0) throw new Error(`필수 열 없음: ${now.join('|')}`);

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}?fields=sheets.properties(sheetId,title)`);
const gid = ((meta.sheets || []) as any[]).find((s) => S(s.properties?.title) === ENCAR_MASTER_TAB)?.properties?.sheetId;
if (gid === undefined) throw new Error('차종마스터 탭 없음');

// 세부트림을 생산시작 자리로 옮기면 기간 두 칸이 뒤로 밀린다.
const dest = startAt;
console.log(`세부트림 열 ${trimAt} → ${dest} (생산시작 앞)`);
if (!APPLY) {
  console.log('※ dry-run. 반영은 --apply');
  process.exit(0);
}

await api(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: [{
      moveDimension: {
        source: { sheetId: gid, dimension: 'COLUMNS', startIndex: trimAt, endIndex: trimAt + 1 },
        destinationIndex: dest,
      },
    }],
  }),
});

const after = await loadEncarWorkSheetGrids(api);
const afterHead = (after.names[0] || []).map(S);
const book = workBookFromTabs(after);
const sample = book.names.find((r) => r.sub === '캐스퍼' && r.trim === '스마트') || book.names[0];
if (afterHead.slice(0, want.length).join('|') !== want.join('|')) {
  throw new Error(`이동 후 헤더가 다름: ${afterHead.join(' | ')}`);
}
if (/^\d{4}-\d{2}$/.test(sample.trim) || sample.trim === '현재' || sample.trim === '보류') {
  throw new Error(`트림이 기간으로 읽힘: ${sample.maker} ${sample.sub} 「${sample.trim}」`);
}
console.log(`반영  ${afterHead.join(' | ')}`);
console.log(`확인  ${book.names.length}행 · 예 ${sample.maker} ${sample.sub} / ${sample.trim} · ${sample.start}~${sample.end}`);
