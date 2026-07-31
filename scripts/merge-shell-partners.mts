/**
 * 껍데기 파트너 정리 — 같은 회사(사업자번호 동일)에 코드가 둘 이상인데
 * **한쪽만 실제로 쓰이는 경우**, 안 쓰이는 쪽을 소프트 삭제하고 어디로 합쳐졌는지 남긴다.
 *
 * 참조를 옮기지 않는다. 옮길 게 없기 때문이다 —
 * 실측(2026-07-31) 결과 11쌍 중 9쌍이 한쪽 참조 0이었다. 이긴 쪽은 이미 쓰이고 있고
 * 진 쪽은 아무도 안 가리킨다. 그래서 이 작업은 **재작성 0건**이고 스코프가 끊길 여지가 없다.
 *
 * 손대지 않는 것:
 *   · 양쪽 다 참조 0인 쌍 — 아무도 안 쓰니 급하지 않고, 지금 고르면 잘못 고를 수 있다.
 *     그 회사가 실제로 거래를 시작할 때 쓰는 쪽으로 자연히 정해진다.
 *   · **역할이 다른 쌍** — 같은 회사가 공급사(RP)이자 영업 파트너(PT)인 경우는 중복이 아니다.
 *     합치면 자기 매물을 자기가 파는 구조가 코드 하나로 뭉개진다.
 *   · 하드 삭제 — 나중에 "이 코드 뭐였지" 를 추적할 수 있어야 한다.
 *
 * 기본 드라이런. 쓰려면 --apply.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const isDead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

/** 참조가 실릴 수 있는 자리 전부. 하나라도 빠뜨리면 "안 쓰인다"고 오판한다. */
const REFS: [string, string[]][] = [
  ['users', ['company_code', 'agent_channel_code', 'matched_partner_code']],
  ['products', ['provider_company_code', 'partner_code']],
  ['v4/products', ['provider_company_code', 'partner_code']],
  ['rooms', ['provider_company_code', 'agent_channel_code']],
  ['v4/rooms', ['provider_company_code', 'agent_channel_code']],
  ['contracts', ['provider_company_code', 'agent_channel_code']],
  ['v4/contracts', ['provider_company_code', 'agent_channel_code']],
  ['settlements', ['provider_company_code', 'partner_code', 'agent_channel_code']],
  ['v4/settlements', ['provider_company_code', 'partner_code', 'agent_channel_code']],
  ['policies', ['provider_company_code']],
  ['v4/policies', ['provider_company_code']],
];

/** 역할 — 공급사(provider)와 영업채널을 가른다. 역할이 다르면 같은 회사여도 합치지 않는다. */
function roleOf(code: string, p: Rec): 'provider' | 'sales' | 'unknown' {
  const t = S(p.partner_type);
  if (/provider|공급/.test(t)) return 'provider';
  if (/영업|sales/.test(t)) return 'sales';
  if (S(p.sheet_url)) return 'provider';          // 시트 연동 = 매물 원천 = 공급사
  if (/^RP/.test(code)) return 'provider';
  if (/^SP/.test(code)) return 'sales';
  return 'unknown';
}

async function main() {
  const [p3, p4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const nodeOf = new Map<string, string>();
  for (const k of Object.keys((p3.val() || {}) as Rec)) nodeOf.set(k, 'partners');
  for (const k of Object.keys((p4.val() || {}) as Rec)) if (!nodeOf.has(k)) nodeOf.set(k, 'v4/partners');
  const partners: Rec = { ...(p3.val() || {}), ...(p4.val() || {}) };

  // 참조 집계
  const use = new Map<string, number>();
  for (const [node, fields] of REFS) {
    const snap = await db.ref(node).get();
    for (const v of Object.values((snap.val() || {}) as Rec)) {
      if (!isObj(v) || isDead(v)) continue;
      for (const f of fields) {
        const c = S(v[f]); if (c) use.set(c, (use.get(c) || 0) + 1);
      }
    }
  }
  const n = (c: string) => use.get(c) || 0;

  // 사업자번호로 묶는다 — 이름은 표기차가 있어도 사업자번호는 같은 회사의 확실한 열쇠다.
  const groups = new Map<string, string[]>();
  for (const [code, p] of Object.entries(partners)) {
    if (!isObj(p)) continue;
    const b = S(p.business_number).replace(/\D/g, '');
    if (!b || b === '9999999999') continue;
    const arr = groups.get(b); if (arr) arr.push(code); else groups.set(b, [code]);
  }

  const patch: Rec = {};
  const merged: string[] = []; const held: string[] = [];

  for (const [biz, codes] of groups) {
    if (codes.length < 2) continue;
    const live = codes.filter((c) => !isDead(partners[c]));
    if (live.length < 2) continue;

    // 역할별로 나눈다 — 역할이 다르면 같은 회사여도 별개 레코드가 맞다.
    for (const role of ['provider', 'sales', 'unknown'] as const) {
      const same = live.filter((c) => roleOf(c, partners[c]) === role);
      if (same.length < 2) continue;
      const sorted = same.slice().sort((a, b) => n(b) - n(a));
      const win = sorted[0]; const lose = sorted.slice(1);
      const name = S(partners[win].name) || S(partners[win].partner_name) || win;

      if (n(win) === 0) {
        held.push(`${name} (${biz}) — ${same.join(', ')} 전부 참조 0 → 손대지 않음`);
        continue;
      }
      for (const l of lose) {
        if (n(l) > 0) { held.push(`${name} — ${l} 참조 ${n(l)}건 있음 → 자동 정리 불가(참조 이전 필요)`); continue; }
        const node = nodeOf.get(l) || 'partners';
        patch[`${node}/${l}/_deleted`] = true;
        patch[`${node}/${l}/status`] = 'deleted';
        patch[`${node}/${l}/merged_into`] = win;
        patch[`${node}/${l}/merged_at`] = Date.now();
        patch[`${node}/${l}/merged_reason`] = `사업자번호 ${biz} 동일·참조 0 — ${win}(참조 ${n(win)})로 통합`;
        merged.push(`${name}: ${l}(참조 0) → ${win}(참조 ${n(win)}) · ${role}`);
      }
    }
  }

  console.log(`## 통합 대상 ${merged.length}건`);
  merged.forEach((m) => console.log('  ', m));
  console.log(`\n## 손대지 않음 ${held.length}건`);
  held.forEach((h) => console.log('  ', h));

  if (!APPLY) { console.log(`\n드라이런 — 쓰기 ${Object.keys(patch).length}경로 예정. 적용하려면 --apply`); process.exit(0); }
  if (!Object.keys(patch).length) { console.log('\n쓸 것 없음.'); process.exit(0); }

  mkdirSync('tmp/migration', { recursive: true });
  const log = `tmp/migration/merge-partners-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  for (const code of new Set(Object.keys(patch).map((p) => p.split('/').slice(0, -1).join('/')))) {
    appendFileSync(log, JSON.stringify({ path: code, before: (await db.ref(code).get()).val() }) + '\n', 'utf8');
  }
  await db.ref('/').update(patch);
  console.log(`\n적용 ${Object.keys(patch).length}경로 · 롤백 로그 ${log}`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
