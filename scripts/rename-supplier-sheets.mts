/**
 * **공급사 시트 이름을 규격으로 맞춘다** — 「MMDD 공급사 프리패스 재고 [제공|정제]」. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-12 — 「시트 이름을 손오공 프리패스 재고 이렇게 해줘 브라우저에서 안 보이네」(업체 이름이 앞에)
 * ★사장님 2026-08-18 — 「정제시트는 따로 표기 좀 해주자 — 우리가 제공한 시트랑 정제된 시트 표기 좀 해주고,
 *   언제 배포한 시트인지 앞에 날짜 좀 박자 0818 이렇게 — 공급사 시트 말야」
 *   · [제공] = 우리가 만들어 주고 공급사가 직접 적는 시트(그 시트가 원본이자 정제시트). 날짜 = 시트를 만든 날(드라이브 createdTime, KST).
 *   · [정제] = 자체시트·홈페이지를 우리가 옮겨 담는 시트(`mirror-sources`). 날짜 = 정제시트로 전환한 날(`--mirror-date`, 기본 오늘).
 *   이미 규격 이름이면 건드리지 않는다. 날짜를 손으로 바꾼 뒤 다시 돌려도 날짜는 안 덮는다(`--force-date` 로만).
 * ★이름만 바꾼다 — 파일 ID·문패·권한은 그대로. 우리 도구는 전부 ID 또는 「프리패스 재고」 부분일치로 찾고 라벨은 `supplierSheetLabel` 로 뽑으므로 안 깨진다.
 * ★이름 규칙은 `supplier-template-sheet.supplierSheetName` 하나다 — 여기서 지어내지 않는다.
 * ⚠ 되돌릴 이름은 화면과 tmp/rename-supplier-sheets-log.txt 에 남긴다.
 *
 *   npx tsx scripts/rename-supplier-sheets.mts
 *   npx tsx scripts/rename-supplier-sheets.mts --apply
 *   npx tsx scripts/rename-supplier-sheets.mts --apply --mirror-date=0818
 * ★사장님 2026-08-19 — 「현재 쓰고 있는 시트를 알아볼 수 있게 표기해줘 … 연동중 이런식으로」 → 문패가 읽는 21곳 전부 끝에 「[연동중]」.
 *   (`--no-status` 로 끄면 표식 없이). 옛 우리 시트의 「[구버전·폐기]」 표기는 retire-legacy-sheets.mts.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetName, supplierSheetNameParts, type SupplierSheetKind } from '../lib/domain/supplier-template-sheet';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const FORCE_DATE = process.argv.includes('--force-date');
const NO_STATUS = process.argv.includes('--no-status');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const kst = (iso: string) => { const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
const MIRROR_DATE = arg('mirror-date', kst(new Date().toISOString()));
const mirrored = new Set(MIRROR_SOURCES.map((m) => m.to));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {};
};
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const files = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: S(f.name), created: S(f.createdTime) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
console.log(`■ 공급사 시트 이름 규격화 ${APPLY ? '반영' : '미리보기'} — ${files.length}곳 · 정제 날짜 ${MIRROR_DATE}\n`);
let changed = 0;
for (const f of files) {
  const parts = supplierSheetNameParts(f.name);
  if (!parts.label) { console.log(`  △ 「${f.name}」 — 업체 이름을 못 뽑았다. 건너뛴다`); continue; }
  const kind: SupplierSheetKind = mirrored.has(f.id) ? '정제' : '제공';
  const date = parts.date && !FORCE_DATE ? parts.date : (kind === '정제' ? MIRROR_DATE : kst(f.created));
  const next = supplierSheetName(parts.label, { kind, date, status: NO_STATUS ? '' : '연동중' });
  if (next === f.name) { console.log(`  · ${f.name}  (그대로)`); continue; }
  console.log(`  ${APPLY ? '✓' : '→'} ${f.name}  →  ${next}`);
  changed++;
  if (!APPLY) continue;
  await call(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
  appendFileSync('tmp/rename-supplier-sheets-log.txt', `${new Date().toISOString()}\t${f.id}\t${f.name}\t→\t${next}\n`);
}
console.log(`\n  ${APPLY ? '바꿈' : '바꿀 것'} ${changed} / ${files.length}${APPLY ? ' · 되돌릴 이름은 tmp/rename-supplier-sheets-log.txt · 정리표 다시: publish-supplier-hub --apply' : ' (반영은 --apply)'}`);
