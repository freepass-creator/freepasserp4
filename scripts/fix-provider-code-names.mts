/**
 * 공급사코드 자리에 **회사 이름**이 들어간 매물 정정.
 *
 * `provider_company_code` 는 파트너 레코드의 키(RP004·PT-0023…)여야 한다.
 * 한글 상호가 들어가 있으면 어떤 조인도 성립하지 않는다 —
 * 시트 동기화도, 공급사 스코프(규칙)도, 정산 귀속도 그 매물을 못 찾는다.
 *
 * 이름 → 코드 매핑은 **파트너 레코드의 name 정확일치**로만 한다.
 * 부분일치·유사도로 맞추면 엉뚱한 공급사에 매물이 붙는다(= 남의 재고를 팔게 된다).
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
const dead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';
/** 정상 코드 = 영문/숫자/하이픈/언더스코어만. 한글이 섞이면 이름이다. */
const isCode = (v: string) => /^[A-Za-z0-9_-]+$/.test(v);
/** 상호 표기차 흡수 — 법인격 접두어만 떼고 공백 제거. 그 이상은 손대지 않는다. */
const norm = (v: string) => v.replace(/^\(?주\)?식?회?사?\)?/g, '').replace(/주식회사/g, '').replace(/\s/g, '').trim();

async function main() {
  const [pSnap, p4Snap, s3, s4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
  ]);
  const partners: Rec = { ...(pSnap.val() || {}), ...(p4Snap.val() || {}) };

  // 이름 → 코드. 같은 이름이 둘 이상이면 **자동 매핑하지 않는다**(어느 쪽인지 사람이 정해야 한다).
  //  `alias` 도 같이 본다 — 시트·현장에서 쓰는 통칭("엘씨렌트")이 등기 상호("주식회사 엘씨")와
  //  다른 경우가 흔하다. 그때마다 스크립트에 하드코딩하지 말고 파트너에 별칭을 등록해 두면
  //  다음에 같은 표기가 또 들어와도 자동으로 풀린다.
  const byName = new Map<string, string[]>();
  const put = (raw: string, code: string) => {
    const n = norm(raw);
    if (!n) return;
    const arr = byName.get(n); if (arr) { if (!arr.includes(code)) arr.push(code); } else byName.set(n, [code]);
  };
  for (const [code, p] of Object.entries(partners)) {
    if (!isObj(p) || dead(p)) continue;
    put(S(p.name) || S(p.partner_name), code);
    for (const a of S(p.alias).split(/[,/|]/)) put(a, code);
  }

  const patch: Rec = {};
  const rows: string[] = []; const unresolved: string[] = [];
  const seen: Record<string, number> = {};

  for (const [node, snap] of [['products', s3], ['v4/products', s4]] as const) {
    for (const [key, r] of Object.entries((snap.val() || {}) as Rec)) {
      if (!isObj(r) || dead(r)) continue;
      const cur = S(r.provider_company_code);
      if (!cur || isCode(cur)) continue;
      seen[cur] = (seen[cur] || 0) + 1;
      const hit = byName.get(norm(cur));
      if (!hit) { unresolved.push(`${node}/${key} · "${cur}" → 이름 일치 파트너 없음`); continue; }
      // 후보가 여럿이면 **공급사 쪽**을 고른다 — 지금 고치는 필드가 provider_company_code 다.
      //  같은 회사가 공급사(RP·시트연동)이자 영업 파트너(PT)로 둘 다 등록된 경우가 있고,
      //  매물의 공급사 자리에는 공급사 코드가 들어가야 한다.
      const providers = hit.filter((c) => {
        const p = partners[c];
        return /provider|공급/.test(S(p?.partner_type)) || !!S(p?.sheet_url) || /^RP/.test(c);
      });
      const pick = hit.length === 1 ? hit[0] : providers.length === 1 ? providers[0] : '';
      if (!pick) {
        unresolved.push(`${node}/${key} · "${cur}" → 후보 ${hit.length}곳(${hit.join(', ')}) · 공급사 후보 ${providers.length}곳 — 사람이 정해야 함`);
        continue;
      }
      patch[`${node}/${key}/provider_company_code`] = pick;
      rows.push(`${node}/${key} · "${cur}" → ${pick}${hit.length > 1 ? ` (후보 ${hit.join('/')} 중 공급사)` : ''}`);
    }
  }

  console.log('## 코드 자리에 이름이 든 값 분포');
  for (const [k, n] of Object.entries(seen).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  "${k}"`);
  console.log(`\n## 정정 가능 ${rows.length}건`);
  rows.slice(0, 12).forEach((x) => console.log('  ', x));
  if (rows.length > 12) console.log(`   … 외 ${rows.length - 12}건`);
  if (unresolved.length) {
    console.log(`\n## 자동 정정 불가 ${unresolved.length}건`);
    unresolved.slice(0, 10).forEach((x) => console.log('  ', x));
  }

  if (!APPLY) { console.log(`\n드라이런 — 쓰기 ${Object.keys(patch).length}경로 예정. 적용하려면 --apply`); process.exit(0); }
  if (!Object.keys(patch).length) { console.log('\n쓸 것 없음.'); process.exit(0); }

  mkdirSync('tmp/migration', { recursive: true });
  const log = `tmp/migration/provider-code-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  for (const p of Object.keys(patch)) {
    appendFileSync(log, JSON.stringify({ path: p, before: (await db.ref(p).get()).val() }) + '\n', 'utf8');
  }
  await db.ref('/').update(patch);
  console.log(`\n적용 ${Object.keys(patch).length}경로 · 롤백 로그 ${log}`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
