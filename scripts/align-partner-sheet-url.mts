/**
 * **`partner.sheet_url` 을 문패에 맞춘다.** 기본은 미리보기 · 쓰려면 `--apply`.
 *
 * ⚠ 2026-09-08 — 「읽는 주소」(문패)와 「사람이 보는 주소」(partner.sheet_url)가 **12곳에서 달랐고**,
 *   그 사본들이 전부 폐기된 옛 시트를 가리키고 있었다. 둘이 다르면 사고가 안 보인다 —
 *   화면은 죽은 시트를 열어 주고, 코드는 다른 데서 읽으니 «어느 쪽이 진짜인지» 아무도 못 짚는다.
 *   실제로 웰릭스는 그 틈에서 24일을 죽은 시트로 살았다.
 *
 * ★문패가 정본이다. 정제시트로 연동한 곳(MIRROR_SOURCES)은 문패가 «정제시트»를 가리키는 게 맞으므로
 *   그대로 맞춘다 — 사람이 열어야 할 곳도 정제시트다.
 *
 * ※ 이름이 비슷한 `fix-partner-sheet-url.mts` 는 **다른 도구**다 — 2026-08-13 이안카 한 건을 RTDB 에
 *   손으로 박던 일회성 스크립트이고, 지금은 안 쓰는 저장소를 본다. 이 쪽(문패 기준·Firestore)이 정본이다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/align-partner-sheet-url.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listSheetTabs, readSheetGrid } from '../lib/server/google-sheets';
import { HUB_CODE_SHEET_ID, isLegacySheetId } from '../lib/domain/legacy-sheets';
import { hubSourceMap, sheetIdOf } from '../lib/domain/supplier-source';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\n/g, '\n') }) });
const fs = getFirestore();

const grid = await readSheetGrid(HUB_CODE_SHEET_ID, (await listSheetTabs(HUB_CODE_SHEET_ID))[0]);
const hub = hubSourceMap([grid.header, ...grid.rows]);
const url = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

const plan: { ref: FirebaseFirestore.DocumentReference; code: string; name: string; from: string; to: string }[] = [];
for (const d of (await fs.collection('partner').get()).docs) {
  const p = d.data() as any;
  const code = S(p.partner_code).toUpperCase();
  const want = hub.get(code) || '';
  const have = sheetIdOf(p.sheet_url);
  if (!want || want === have) continue;
  /** ⚠ 살아 있는 사본을 «다른 살아 있는 주소»로 바꾸는 건 위험할 수 있다 — 죽은 것·빈 것만 고친다. */
  if (have && !isLegacySheetId(have)) { console.log(`  ~ ${code} ${S(p.name)} — 둘 다 살아 있어 건드리지 않는다 (문패 ${want.slice(0, 10)} · 사본 ${have.slice(0, 10)})`); continue; }
  plan.push({ ref: d.ref, code, name: S(p.name), from: have || '(빈칸)', to: want });
}

console.log(`\n■ partner.sheet_url → 문패 맞춤 ${plan.length}곳\n`);
for (const x of plan) console.log(`  ${x.code.padEnd(8)} ${x.name.slice(0, 12).padEnd(13)} ${x.from.slice(0, 12)} → ${x.to.slice(0, 12)}`);
if (!plan.length) { console.log('  고칠 것 없다.\n'); process.exit(0); }
if (!APPLY) { console.log(`\n미리보기 — 쓰려면 --apply\n`); process.exit(0); }
const batch = fs.batch();
for (const x of plan) batch.set(x.ref, { sheet_url: url(x.to), _sheet_url_fixed_at: Date.now() }, { merge: true });
await batch.commit();
console.log(`\n✓ ${plan.length}곳 반영 — 이제 읽는 주소와 보는 주소가 같다.\n`);
process.exit(0);
