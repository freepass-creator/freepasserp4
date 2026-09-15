/**
 * **접수 갈래(`intakeKind`)를 지난 줄에 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-10 「접수할 때 **영업수수료 · 인센티브** 이런 식으로 표현해 주면 돼.
 *   **기본 영업수수료가 기본 세팅**이고」 — 접수 칸에 갈래를 두면서 원자에 밭이 하나 늘었다.
 *
 * ⚠ **돈 축은 한 글자도 안 건드린다.** 이 도구가 쓰는 것은 `intakeKind` 하나뿐이다.
 *   지난 줄은 전부 «영업수수료»다 — 인센티브·업무지원비로 접수한 적이 없기 때문이다.
 *   그래서 값 판단이 필요 없고, 규격을 채우는 일이라 사람이 고를 것이 없다.
 *
 * ★이미 값이 있는 줄은 «건드리지 않는다» — 덮지 않는다(정산시트 매뉴얼의 그 규칙 그대로).
 *
 *   npx tsx scripts/backfill-intake-kind.mts
 *   npx tsx scripts/backfill-intake-kind.mts --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const 기본 = '영업수수료';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const docs = (await db.collection('settlement_rows').get()).docs;
const 채울것 = docs.filter((d) => {
  const r = d.data() as Record<string, unknown>;
  return !('intakeKind' in r) || !S(r.intakeKind);
});

console.log(`\n■ 접수 갈래 채우기 — 원자 ${docs.length}줄 중 빈 줄 ${채울것.length}개`);
console.log(`   채울 값 = 「${기본}」 (지난 줄은 전부 영업수수료다)\n`);

if (!APPLY) { console.log('   ※ 미리보기입니다 — 반영하려면 --apply\n'); process.exit(0); }

/** ★한 묶음 500 이 파이어스토어 한도다. 넘기면 통째로 실패한다. */
let 쓴것 = 0;
for (let i = 0; i < 채울것.length; i += 450) {
  const b = db.batch();
  for (const d of 채울것.slice(i, i + 450)) b.update(d.ref, { intakeKind: 기본 });
  await b.commit();
  쓴것 += Math.min(450, 채울것.length - i);
  console.log(`   ${쓴것}/${채울것.length} …`);
}

/** ★되읽어 «정말 들어갔는지» 본다 — 썼다고 말하고 안 들어간 적이 있다. */
const 다시 = (await db.collection('settlement_rows').get()).docs
  .filter((d) => !S((d.data() as Record<string, unknown>).intakeKind)).length;
console.log(`\n   ${다시 === 0 ? '✓ 빈 줄 0 — 다 들어갔습니다' : `✕ 아직 ${다시}줄 비어 있습니다`}\n`);
