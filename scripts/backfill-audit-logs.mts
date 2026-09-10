/**
 * **RTDB 에만 남은 감사이력을 파이어스토어로 메운다.** 기본 미리보기 · 반영은 `--apply`.
 *
 * ★왜 구멍이 났나 — «이관 스냅샷 이후에 들어온 것»이다.
 *   `migrate-rtdb-to-firestore-full.mts` 는 «그 순간의» v4/audit_logs 를 한 번 떠서 옮겼다.
 *   그 뒤 전환 창(cutover window) 동안 앱이 아직 RTDB 로 이력을 쌓았고, 그만큼이 파이어스토어에 없다.
 *   실측 2026-09-10 — RTDB 5,827 · 파이어스토어 5,384 → **RTDB 에만 443건**
 *   (그 443건의 시각대 = 아래 실행이 찍는 「전환 창」. 앞선 손대조에서는 5,809/5,384/425 였다 —
 *    이력은 append-only 라 세는 사이에도 늘어난다. **줄지 않고 늘기만 하는 것이 정상이다.**)
 *
 * ★★**덮지 않는다.** RTDB 키 = 문서 id 로 두고 `create()` 로만 쓴다 — 이미 있으면 그대로 둔다.
 *   감사이력은 append-only 라 「메우기」는 되지만 「고쳐 쓰기」는 사고다.
 * ★**지어내지 않는다** — RTDB 에서 다시 읽어 온 본문만 넣는다. 읽는 사이 사라진 키는
 *   「없다」가 아니라 「모른다」로 세어 따로 찍고 넘어간다.
 * ⚠ 문서 모양은 이관과 «같은» 규칙이다: v4/audit_logs/{key} 서브트리를 통째로 문서 데이터로
 *   (객체가 아니면 `{_value: …}`). 여기서 필드를 더 얹으면 이관분과 모양이 갈린다.
 *
 *   npx tsx scripts/backfill-audit-logs.mts            # 미리보기
 *   npx tsx scripts/backfill-audit-logs.mts --apply    # 반영
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const RTDB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const NODE = 'v4/audit_logs';
const COL = 'audit_logs';

const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore(app);
const dbJwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = async () => (await dbJwt.getAccessToken()).token;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
/** 이관과 «같은» 문서 id 규칙(migrate docSafe). 어긋나면 있는 것을 또 넣는다. */
const docSafe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');
/** 키 `AL-<epoch ms>-…` 에서 시각을 뽑는다 — 못 뽑으면 0(모른다). */
const keyMs = (k: string) => Number(k.match(/^[A-Za-z]+-(\d{13})/)?.[1] ?? 0);
const ts = (ms: number) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '모름');

/** 한 번에 도는 수를 묶어 준다 — 443건을 한꺼번에 던지면 RTDB 쪽이 막는다. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const at = i++; if (at >= items.length) return; out[at] = await fn(items[at]); }
  }));
  return out;
}

// ① 양쪽 명단
const shallow: any = await (await fetch(`${RTDB}/${NODE}.json?shallow=true&access_token=${await token()}`)).json();
if (shallow !== null && !isObj(shallow)) { console.error(`⛔ ${NODE} 를 못 읽었다 — 「없다」가 아니라 「모른다」다. 자격증명·권한부터 보라.`); process.exit(1); }
const rtKeys = shallow ? Object.keys(shallow) : [];
const fsIds = new Set((await fs.collection(COL).select().get()).docs.map((d) => d.id));
const missing = rtKeys.filter((k) => !fsIds.has(docSafe(k)));

console.log(`\n■ 감사이력 메우기 — RTDB ${NODE} → 파이어스토어 ${COL}`);
console.log(`  RTDB ${rtKeys.length}건 · 파이어스토어 ${fsIds.size}건 · **RTDB 에만 ${missing.length}건**`);
if (missing.length) {
  const t = missing.map(keyMs).filter(Boolean).sort((a, b) => a - b);
  if (t.length) console.log(`  전환 창(RTDB 에만 있는 것의 시각대) — ${ts(t[0])} ~ ${ts(t[t.length - 1])}  (${t[0]} ~ ${t[t.length - 1]})`);
  for (const k of missing.slice(0, 5)) console.log(`     ${k}`);
  if (missing.length > 5) console.log(`     … 그 밖 ${missing.length - 5}건`);
}
if (!missing.length) { console.log(`\n  ✓ 메울 것 없다 — 양쪽이 같다.\n`); process.exit(0); }

/**
 * ★**한 번에 너무 많이 쓰려 하면 멈춘다** — 사람이 보게.
 *   실측 구멍은 «전환 창» 몇 백 건이다. 그보다 훨씬 크면 구멍이 아니라 **딴 사고**다
 *   (파이어스토어 컬렉션을 잘못 지웠다든가, 명단을 잘못 읽었다든가).
 *   그때 5천 건을 되부어 놓으면 무엇이 원래 있던 것인지 뒤에 못 가린다.
 */
const LIMIT = Math.max(1000, Math.ceil(rtKeys.length * 0.2));
if (missing.length > LIMIT) {
  console.error(`\n⛔ ${missing.length}건을 한 번에 메우려 한다 — 한도 ${LIMIT}건(전체의 20% 또는 1000건)을 넘는다.`);
  console.error(`   전환 창 구멍이 이만큼 클 리 없다. 파이어스토어 ${COL} 쪽부터 보라. 그래도 맞다면 한도를 손으로 올려라.\n`);
  process.exit(1);
}
if (!APPLY) { console.log(`\n미리보기 — 쓰려면 --apply\n`); process.exit(0); }

// ② 본문을 RTDB 에서 다시 읽어 온다 (shallow 는 키만 준다)
const fetched = await pool(missing, 8, async (k) => {
  try {
    const v = await (await fetch(`${RTDB}/${NODE}/${encodeURIComponent(k)}.json?access_token=${await token()}`)).json();
    return { k, v, ok: true as const };
  } catch (e) { return { k, v: null, ok: false as const, err: (e as Error).message }; }
});
const 못읽음 = fetched.filter((x) => !x.ok || x.v === null || x.v === undefined);
const 쓸것 = fetched.filter((x) => x.ok && x.v !== null && x.v !== undefined);

// ③ create() 로만 — 이미 있으면 손대지 않는다 (ALREADY_EXISTS = gRPC 6)
let 넣음 = 0, 이미있음 = 0;
const 실패: string[] = [];
await pool(쓸것, 20, async ({ k, v }) => {
  const doc = isObj(v) ? v : { _value: v };
  try { await fs.collection(COL).doc(docSafe(k)).create(doc); 넣음++; }
  catch (e: any) { if (Number(e?.code) === 6) 이미있음++; else 실패.push(`${k}: ${S(e?.message).slice(0, 80)}`); }
});

// ④ 메운 뒤 다시 센다 — 「했다」가 아니라 「몇이 됐다」로 말한다
const rtAfter = Object.keys((await (await fetch(`${RTDB}/${NODE}.json?shallow=true&access_token=${await token()}`)).json()) || {}).length;
const fsAfter = (await fs.collection(COL).count().get()).data().count;
console.log(`\n✓ 메웠다 — 새로 넣음 ${넣음}건 · 이미 있어 건너뜀 ${이미있음}건${못읽음.length ? ` · 못 읽어 넘김 ${못읽음.length}건(「없다」가 아니라 「모른다」)` : ''}${실패.length ? ` · 실패 ${실패.length}건` : ''}`);
for (const f of 실패.slice(0, 5)) console.log(`   ⛔ ${f}`);
for (const m of 못읽음.slice(0, 5)) console.log(`   ? ${m.k}`);
console.log(`  다시 셈 — RTDB ${rtAfter}건 · 파이어스토어 ${fsAfter}건 ${fsAfter >= rtAfter ? '✓ 맞다' : `⛔ 아직 ${rtAfter - fsAfter}건 모자란다`}`);
console.log(`  ⚠ RTDB 는 도는 사이에도 늘어난다 — 뒤 수가 앞 수보다 큰 것은 정상이다.\n`);
process.exit(실패.length ? 1 : 0);
