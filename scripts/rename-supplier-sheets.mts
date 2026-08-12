/**
 * **우리 시트 이름을 「<공급사> 프리패스 재고」로 바꾼다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-12 — 「시트 이름을 손오공 프리패스 재고 이렇게 해줘 브라우저에서 안보이네」)
 *   브라우저 탭은 앞글자만 보여준다. 옛 이름 「프리패스 재고 · 손오공」은 열 장을 띄우면
 *   전부 「프리패스 재고…」로 보여 어느 업체 시트인지 구분이 안 된다. 업체 이름이 앞에 와야 한다.
 *
 * ★**주소(파일 ID)는 안 바뀐다.** 이미 나눠 준 링크·정리표의 링크가 그대로 산다.
 *   구글 시트의 이름은 표시용이고, 우리 코드도 이름이 아니라 ID로 연다.
 * ★이름 규칙은 `supplier-template-sheet` 의 `supplierSheetName` 하나다 — 여기서 지어내지 않는다.
 * ★이미 새 이름이면 손대지 않는다. 두 번 돌려도 안전하다.
 *
 *   npx tsx scripts/rename-supplier-sheets.mts
 *   npx tsx scripts/rename-supplier-sheets.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, supplierSheetName } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '${SHEET_NAME_MATCH}'`);
const files = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`)).files || []) as Rec[];
console.log(`■ 시트 이름 바꾸기 ${APPLY ? '(반영)' : '(dry-run)'} — 주소는 안 바뀐다\n`);

let n = 0; let same = 0;
for (const f of files) {
  const now = S(f.name);
  const label = supplierSheetLabel(now);
  if (!label) { console.log(`  △ 「${now}」 — 업체 이름을 못 뽑았다. 건너뛴다`); continue; }
  const next = supplierSheetName(label);
  if (now === next) { same++; continue; }
  console.log(`  「${now}」 → 「${next}」`);
  n++;
  if (!APPLY) continue;
  await api(`https://www.googleapis.com/drive/v3/files/${S(f.id)}?supportsAllDrives=true`, {
    method: 'PATCH', body: JSON.stringify({ name: next }),
  });
}
console.log(`\n  바꿀 시트 ${n}개 · 이미 맞는 시트 ${same}개`);
if (APPLY && n) console.log('\n  ※ 정리표의 이름 칸도 다시 찍을 것 — `npx tsx scripts/publish-supplier-hub.mts --apply`\n');
else if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
