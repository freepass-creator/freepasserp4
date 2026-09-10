/**
 * **파이어스토어 ↔ RTDB 대조** — 노드별로 «대수»를 나란히 놓고 본다. **읽기 전용**.
 *
 * ★왜(사장님 2026-09-05 「RTDB 안 쓴다니까?」 · 「이거 테스트 들어가 볼 수 있게끔 해줘야 될 것 같은데」).
 *   이관은 「다 복사했다」는 말만으로는 못 믿는다 — 숫자를 나란히 놓고 봐야 한다.
 *   실제로 「정책이 덜 옮겨졌나?」를 이 방식으로 재서 **정책은 81 = 81 로 같고, 끊긴 것은 상품 쪽
 *   policy_code 였다**는 것을 가려냈다(2026-09-05).
 *
 * ★★**「0건」을 한 칸으로 찍지 않는다 — 「원래 없던 것」과 「잃은 것」은 다른 말이다.**
 *   2026-09-10 에 「빈 컬렉션 10개」를 이관 사고로 의심했는데, 손으로 다시 재 보니 **RTDB 에서도
 *   원래 비어 있던 노드**였다 — 오경보였다. 그래서 판정을 넷으로 갈랐다:
 *     ∅ 양쪽 0        = 원본도 비었다 (정상 · 잃은 게 아니다)
 *     ⛔ 원본>0 · FS 0 = 통째로 못 옮겼다
 *     ⛔ 살아 있는 키가 FS 에 없다
 *     ✓  그 밖
 *   「자료에 구멍이 있으면 «없다»가 아니라 «모른다»」 — 못 읽은 노드는 «?» 로 찍고 판정하지 않는다.
 *
 * ★노드 명단의 정본은 `scripts/migrate-rtdb-to-firestore-full.mts` 의 `NODES` 다.
 *   그 파일을 import 하면 «이관이 돌아간다»(최상위 실행 스크립트) — 그래서 **소스를 읽어 명단만 뽑는다.**
 *   아래 `FALLBACK` 은 파싱이 깨졌을 때의 대비이자 갈림 경보용 사본이다.
 *
 *   npx tsx scripts/audit-firestore-parity.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const SA_PATH = S(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
const RTDB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore(app);
/** RTDB 는 shallow=true 로 «키만» 센다 — admin SDK 의 .get() 은 본문을 통째로 끌어와 audit_logs 5천 건이 무겁다. */
const dbJwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });

/** 이관과 «같은» 문서 id 규칙 (migrate-rtdb-to-firestore-full.mts docSafe). 이게 어긋나면 있는 것을 없다고 센다. */
const docSafe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');

type Spec = { col: string; v3?: boolean; entity?: boolean };

/**
 * 명단 사본 — 정본은 migrate 스크립트다. 여기 것과 갈리면 아래에서 경보를 찍는다.
 * 노드 → 컬렉션 대응: contracts→contract · settlements→settlement · policies→policy ·
 * partners→partner · customers→customer · users→user · 나머지는 이름 그대로.
 */
const FALLBACK: Record<string, Spec> = {
  contracts: { col: 'contract', v3: true, entity: true },
  settlements: { col: 'settlement', v3: true, entity: true },
  policies: { col: 'policy', v3: true, entity: true },
  partners: { col: 'partner', v3: true, entity: true },
  customers: { col: 'customer', v3: true, entity: true },
  users: { col: 'user', v3: true, entity: true },
  esign_sessions: { col: 'esign_sessions' },
  esign_private: { col: 'esign_private' },
  esign_events: { col: 'esign_events' },
  esign_verifications: { col: 'esign_verifications' },
  esign_issue_claims: { col: 'esign_issue_claims' },
  esign_manual_offers: { col: 'esign_manual_offers' },
  esign_create_requests: { col: 'esign_create_requests' },
  esign_contract_seals: { col: 'esign_contract_seals' },
  esign_issuance: { col: 'esign_issuance' },
  settlement_rows: { col: 'settlement_rows' },
  settlement_events: { col: 'settlement_events' },
  settlement_contacts: { col: 'settlement_contacts' },
  settlement_clawbacks: { col: 'settlement_clawbacks' },
  settlement_invoices: { col: 'settlement_invoices' },
  admin_settlements: { col: 'admin_settlements' },
  settlements_provider_private: { col: 'settlements_provider_private' },
  settlements_admin_private: { col: 'settlements_admin_private' },
  settlements_agent_private: { col: 'settlements_agent_private' },
  users_private: { col: 'users_private' },
  partners_private: { col: 'partners_private' },
  system_locks: { col: 'system_locks' },
  system_status: { col: 'system_status' },
  inventory_sync_runs: { col: 'inventory_sync_runs' },
  inventory_sync_control: { col: 'inventory_sync_control' },
  plate_registry: { col: 'plate_registry' },
  audit_logs: { col: 'audit_logs' },
  sheet_conflict_resolutions: { col: 'sheet_conflict_resolutions' },
  sheet_edits: { col: 'sheet_edits' },
  sheet_sync_runs: { col: 'sheet_sync_runs' },
  sheet_sync_backups: { col: 'sheet_sync_backups' },
  ops: { col: 'ops' },
  report: { col: 'report' },
};

/** migrate 스크립트 소스에서 NODES 블록만 뽑는다 — 실행하지 않고 «명단»만 가져오려고. */
function readNodesFromMigrate(): { nodes: Record<string, Spec>; from: string } {
  try {
    const src = readFileSync('scripts/migrate-rtdb-to-firestore-full.mts', 'utf8');
    const block = src.split('const NODES: Record<string, Spec> = {')[1]?.split(/^};/m)[0];
    if (!block) throw new Error('NODES 블록을 못 찾았다');
    const out: Record<string, Spec> = {};
    for (const line of block.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*col:\s*'([^']+)'(.*)$/);
      if (!m) continue;                                  // 주석·빈 줄은 건너뛴다
      out[m[1]] = { col: m[2], v3: /v3:\s*true/.test(m[3]), entity: /entity:\s*true/.test(m[3]) };
    }
    if (Object.keys(out).length < 20) throw new Error(`${Object.keys(out).length}개만 읽혔다 — 형식이 바뀐 듯`);
    return { nodes: out, from: 'migrate-rtdb-to-firestore-full.mts' };
  } catch (e) {
    console.warn(`⚠ 명단 정본을 못 읽었다(${(e as Error).message}) — 사본으로 돈다. 사본이 낡았을 수 있다.`);
    return { nodes: FALLBACK, from: '이 파일의 사본(FALLBACK)' };
  }
}

/** RTDB 노드의 키 목록. 못 읽으면 «모른다»로 null 을 준다 — 0 으로 삼키지 않는다. */
async function rtKeys(node: string): Promise<string[] | null> {
  try {
    const t = (await dbJwt.getAccessToken()).token;
    const r = await fetch(`${RTDB}/${node}.json?shallow=true&access_token=${t}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    if (j === null) return [];                            // 노드 자체가 없다 = 원래 비었다
    return typeof j === 'object' ? Object.keys(j) : ['_value'];
  } catch { return null; }
}
/** 그 키가 «지운 것»인가 — 지운 건 안 옮기는 게 맞다(이관이 빠뜨린 게 아니다). */
async function rtDeleted(node: string, key: string): Promise<boolean> {
  try {
    const t = (await dbJwt.getAccessToken()).token;
    const j: any = await (await fetch(`${RTDB}/${node}/${key}/_deleted.json?access_token=${t}`)).json();
    return j === true;
  } catch { return false; }
}
/** 파이어스토어 컬렉션의 문서 id 전부 — 모자란 갈래를 «어느 키»까지 짚어 준다. */
async function fsIds(col: string): Promise<Set<string>> {
  const snap = await fs.collection(col).select().get();   // select() = 필드 없이 id 만
  return new Set(snap.docs.map((d) => d.id));
}

const { nodes: NODES, from } = readNodesFromMigrate();
/** 명단이 갈렸나 — 갈렸으면 «어느 쪽이 맞는지» 사람이 봐야 한다. 여기서 조용히 덮지 않는다. */
const drift = [
  ...Object.keys(NODES).filter((k) => !FALLBACK[k]).map((k) => `+${k}`),
  ...Object.keys(FALLBACK).filter((k) => !NODES[k]).map((k) => `-${k}`),
  ...Object.keys(NODES).filter((k) => FALLBACK[k] && FALLBACK[k].col !== NODES[k].col).map((k) => `~${k}`),
];

console.log(`\n■ 파이어스토어 ↔ RTDB 대조 — 노드별 대수 (읽기 전용 · 명단 출처: ${from})`);
if (drift.length) console.log(`⚠ 명단이 사본과 갈렸다: ${drift.join(' · ')} — audit-firestore-parity.mts 의 FALLBACK 도 맞춰 두라.`);
console.log('');
console.log('노드'.padEnd(30) + '컬렉션'.padEnd(30) + 'RTDB'.padEnd(8) + '파이어스토어'.padEnd(14) + '판정');
console.log('─'.repeat(104));

let gap = 0, unknown = 0, emptyBoth = 0;
for (const [node, spec] of Object.entries(NODES)) {
  /** v3 플래그가 있는 6엔티티는 «라이브 v3 ∪ v4 오버레이» 가 원본이다 — 이관이 그렇게 합쳤다. */
  const parts = spec.v3 ? [node, `v4/${node}`] : [`v4/${node}`];
  const keys = new Set<string>();
  let unreadable = false;
  for (const p of parts) {
    const ks = await rtKeys(p);
    if (ks === null) { unreadable = true; continue; }
    for (const k of ks) keys.add(docSafe(k));
  }
  const ids = await fsIds(spec.col);
  const rt = keys.size, fsN = ids.size;

  let note: string;
  if (unreadable) {
    note = '? RTDB 를 못 읽었다 — 「없다」가 아니라 「모른다」';
    unknown++;
  } else if (rt === 0 && fsN === 0) {
    note = '∅ 원본도 0 — 원래 비어 있던 노드다 (잃은 것 아님)';
    emptyBoth++;
  } else if (rt > 0 && fsN === 0) {
    note = `⛔ 통째로 없다 — 원본 ${rt}건이 하나도 안 옮겨졌다`;
    gap++;
  } else {
    /*
     * ★수가 같아도 «키»가 다를 수 있다 — 그래서 항상 키를 맞대 본다.
     *   실측(2026-09-05): 계약 122 vs 121 로 하나 적었는데, 그 하나는 v3 에서 **지운 계약**이었다.
     *   지운 것을 안 옮긴 것은 이관이 맞게 한 것이다. 그래서 «살아 있는 것»만 세어 판정한다.
     */
    const missing = [...keys].filter((k) => !ids.has(k));
    let dels = 0;
    const alive: string[] = [];
    for (const k of missing) {
      let deleted = false;
      if (spec.entity && missing.length <= 200) {          // 지움표시는 엔티티에만 있다 · 너무 많으면 안 물어본다
        for (const p of parts) if (await rtDeleted(p, k)) { deleted = true; break; }
      }
      if (deleted) dels++; else alive.push(k);
    }
    if (alive.length) {
      note = `⛔ ${alive.length}건 없음 (${alive.slice(0, 3).join(' · ')}${alive.length > 3 ? ' …' : ''})`;
      gap++;
    } else {
      const extra = fsN - rt;
      note = dels ? `✓ (지운 것 ${dels}건은 안 옮긴 게 맞다)` : extra > 0 ? `✓ (FS 에만 ${extra}건 — 이관 뒤 새로 쓴 것)` : '✓';
    }
  }
  console.log(node.padEnd(30) + spec.col.padEnd(30) + String(rt).padEnd(8) + String(fsN).padEnd(14) + note);
}

/**
 * ★이관 «제외» 노드 — 여기 없다고 사고가 아니다. 셈에서 빼는 이유를 같이 적는다.
 *   products 는 거꾸로 **파이어스토어가 정본**이다(정제·gencode 교정이 얹혀 RTDB 보다 많다).
 *   RTDB 원본으로 덮으면 정제분이 사라진다 — 그래서 이관 대상이 아니다.
 */
console.log('\n— 이관 제외(정상) —');
for (const [node, why] of [
  ['v4/products → products', '거꾸로 파이어스토어가 정본(정제분). RTDB 로 덮으면 안 된다'],
  ['messages · rooms', '폐기된 채팅'],
  ['_client_errors · esign_test_sessions', '쓰레기·시험용'],
] as const) console.log(`  ${node.padEnd(38)} ${why}`);

console.log(`\n  RTDB 수는 «노드 합집합의 키 수»(v3 플래그면 v3∪v4), 파이어스토어는 문서 수다.`);
console.log(`  같은 것이 양쪽에 있으면 파이어스토어가 같거나 많다 — 이관 뒤 새로 쓴 것이 얹히기 때문.`);
console.log(`  양쪽 0 인 노드 ${emptyBoth}개는 «원래 비어 있던» 것이다 — 사고가 아니다.`);
if (unknown) console.log(`  ? 못 읽은 노드 ${unknown}개 — 판정하지 않았다. 자격증명·권한부터 보라.`);
if (gap) { console.log(`\n  ⛔ ${gap}개 갈래가 덜 옮겨졌다. 그 갈래를 읽는 화면은 아직 RTDB 를 봐야 한다.\n`); process.exit(1); }
console.log('\n  ✓ 모든 갈래가 파이어스토어에 있다 — 읽는 곳을 옮겨도 된다.\n');
process.exit(0);
