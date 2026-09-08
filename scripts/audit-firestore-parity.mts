/**
 * **파이어스토어 ↔ RTDB 대조** — 어디까지 옮겨졌고 무엇이 다른지 한 표로 본다. **읽기 전용**.
 *
 * ★왜(사장님 2026-09-05 「RTDB 안 쓴다니까?」 · 「이거 테스트 들어가 볼 수 있게끔 해줘야 될 것 같은데」).
 *   이관은 «다 복사했다」는 말만으로는 못 믿는다 — 숫자를 나란히 놓고 봐야 한다.
 *   실제로 「정책이 덜 옮겨졌나?」를 이 방식으로 재서 **정책은 81 = 81 로 같고, 끊긴 것은 상품 쪽
 *   policy_code 였다**는 것을 가려냈다(2026-09-05).
 *
 *   npx tsx scripts/audit-firestore-parity.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const sa = JSON.parse(readFileSync(String(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json'), 'utf8'));
const P = sa.project_id;
const fsJwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/datastore'] });
const dbJwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const RTDB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** RTDB 노드 → Firestore 컬렉션. `firestore-ref-shim` 의 표와 같아야 한다. */
const PAIRS: { label: string; nodes: string[]; col: string }[] = [
  { label: '재고',     nodes: ['v4/products'],            col: 'products' },
  { label: '정책',     nodes: ['policies', 'v4/policies'], col: 'policy' },
  { label: '공급사',   nodes: ['partners', 'v4/partners'], col: 'partner' },
  { label: '사용자',   nodes: ['users', 'v4/users'],       col: 'user' },
  { label: '손님',     nodes: ['customers', 'v4/customers'], col: 'customer' },
  { label: '계약',     nodes: ['contracts', 'v4/contracts'], col: 'contract' },
  { label: '정산',     nodes: ['settlements', 'v4/settlements'], col: 'settlement' },
];

const fsCount = async (col: string) => {
  const t = (await fsJwt.getAccessToken()).token;
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents:runAggregationQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: col }] }, aggregations: [{ alias: 'n', count: {} }] } }),
  });
  const j: any = await r.json();
  return Number(j?.[0]?.result?.aggregateFields?.n?.integerValue ?? -1);
};
const rtKeys = async (node: string) => {
  const t = (await dbJwt.getAccessToken()).token;
  const j: any = await (await fetch(`${RTDB}/${node}.json?shallow=true&access_token=${t}`)).json();
  return j && typeof j === 'object' ? Object.keys(j) : [];
};
/** 그 키가 «지운 것»인가 — 지운 건 안 옮기는 게 맞다(이관이 빠뜨린 게 아니다). */
const rtDeleted = async (node: string, key: string) => {
  const t = (await dbJwt.getAccessToken()).token;
  const j: any = await (await fetch(`${RTDB}/${node}/${key}/_deleted.json?access_token=${t}`)).json();
  return j === true;
};
/** 파이어스토어 컬렉션의 문서 id 전부 — 모자란 갈래를 «어느 키»까지 짚어 준다. */
const fsIds = async (col: string) => {
  const out = new Set<string>(); let tk = '';
  do {
    const t = (await fsJwt.getAccessToken()).token;
    const j: any = await (await fetch(`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents/${col}?pageSize=300${tk ? `&pageToken=${tk}` : ''}&mask.fieldPaths=_key`, { headers: { Authorization: `Bearer ${t}` } })).json();
    for (const d of (j.documents || [])) out.add(String(d.name).split('/').pop()!);
    tk = j.nextPageToken || '';
  } while (tk);
  return out;
};

console.log('■ 파이어스토어 ↔ RTDB — 어디까지 옮겨졌나 (읽기 전용)\n');
console.log('구분'.padEnd(10) + 'RTDB'.padEnd(10) + '파이어스토어'.padEnd(14) + '판정');
console.log('─'.repeat(52));
let gap = 0;
for (const pair of PAIRS) {
  const keys = new Set<string>();
  for (const n of pair.nodes) for (const k of await rtKeys(n)) keys.add(k);
  const fs = await fsCount(pair.col);
  let note = fs >= keys.size ? '✓' : '';
  if (!note) {
    /*
     * ★모자라 보이면 «무엇이» 빠졌는지까지 짚는다 — 숫자만 보고 놀랄 일이 아니다.
     *   실측(2026-09-05): 계약 122 vs 121 로 하나 적었는데, 그 하나는 v3 에서 **지운 계약**이었다.
     *   지운 것을 안 옮긴 것은 이관이 맞게 한 것이다. 그래서 «살아 있는 것»만 세어 판정한다.
     */
    const ids = await fsIds(pair.col);
    const missing = [...keys].filter((k) => !ids.has(k));
    const dels: string[] = [];
    for (const k of missing) {
      for (const n of pair.nodes) if (await rtDeleted(n, k)) { dels.push(k); break; }
    }
    const alive = missing.filter((k) => !dels.includes(k));
    note = alive.length
      ? `⛔ ${alive.length}건 없음 (${alive.slice(0, 2).join(' · ')}${alive.length > 2 ? ' …' : ''})`
      : `✓ (지운 것 ${dels.length}건은 안 옮긴 게 맞다)`;
    if (alive.length) gap++;
  }
  console.log(pair.label.padEnd(10) + String(keys.size).padEnd(10) + String(fs).padEnd(14) + note);
}
console.log(`\n  RTDB 키 수는 «노드 합집합»이고 파이어스토어는 문서 수다 — 같은 것이 양쪽에 있으면 파이어스토어가 같거나 많다.`);
if (gap) { console.log(`\n  ⛔ ${gap}개 갈래가 덜 옮겨졌다. 그 갈래를 읽는 화면은 아직 RTDB 를 봐야 한다.`); process.exit(1); }
console.log('\n  ✓ 모든 갈래가 파이어스토어에 있다 — 읽는 곳을 옮겨도 된다.');
