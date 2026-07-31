/**
 * 파트너 코드 실사용 집계 — 같은 회사가 코드를 두 벌 갖고 있을 때 **어느 쪽이 정본인지**를
 * 취향이 아니라 참조 수로 정하기 위한 것.
 *
 * 코드를 잘못 고르면 그 코드로 스코프를 받던 회원·매물·방·계약이 통째로 끊긴다.
 * 그래서 "어디서 몇 번 쓰이는지"를 노드·필드별로 센다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/partner-code-usage.mts
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';
const norm = (v: string) => v.replace(/\(?주\)?식?회?사?\)?/g, '').replace(/\s/g, '').trim();

/** 참조가 실릴 수 있는 자리 전부. 하나라도 빠뜨리면 "안 쓰이는 줄 알고" 지우게 된다. */
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

async function main() {
  const [p3, p4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners: Rec = { ...(p3.val() || {}), ...(p4.val() || {}) };

  // 같은 이름(법인격 제거) 또는 같은 사업자번호 = 같은 회사
  const groups = new Map<string, Set<string>>();
  const keyOf = (p: Rec) => {
    const b = S(p.business_number).replace(/\D/g, '');
    if (b && b !== '9999999999') return `biz:${b}`;
    return `name:${norm(S(p.name) || S(p.partner_name))}`;
  };
  for (const [code, p] of Object.entries(partners)) {
    if (!isObj(p)) continue;
    const k = keyOf(p);
    if (k === 'name:') continue;
    const s = groups.get(k); if (s) s.add(code); else groups.set(k, new Set([code]));
  }

  // 참조 집계
  const use = new Map<string, Record<string, number>>();
  const bump = (code: string, where: string) => {
    if (!code) return;
    const r = use.get(code) || {}; r[where] = (r[where] || 0) + 1; use.set(code, r);
  };
  for (const [node, fields] of REFS) {
    const snap = await db.ref(node).get();
    for (const v of Object.values((snap.val() || {}) as Rec)) {
      if (!isObj(v) || dead(v)) continue;
      for (const f of fields) bump(S(v[f]), `${node}.${f}`);
    }
  }
  const total = (code: string) => Object.values(use.get(code) || {}).reduce((a, b) => a + b, 0);

  console.log('## 같은 회사인데 코드가 둘 이상\n');
  const decisions: string[] = [];
  for (const [k, set] of [...groups].sort()) {
    if (set.size < 2) continue;
    const codes = [...set];
    const rows = codes.map((c) => {
      const p = partners[c];
      return {
        code: c,
        del: p._deleted === true || S(p.status) === 'deleted',
        sheet: !!S(p.sheet_url),
        biz: !!S(p.business_number),
        n: total(c),
        detail: use.get(c) || {},
      };
    }).sort((a, b) => b.n - a.n);
    const name = norm(S(partners[codes[0]].name) || S(partners[codes[0]].partner_name));
    console.log(`### ${name}  (${k})`);
    for (const r of rows) {
      const tags = [r.del ? '삭제됨' : '', r.sheet ? '시트연동' : '', r.biz ? '사업자번호' : ''].filter(Boolean).join('·');
      console.log(`  ${r.code.padEnd(10)} 참조 ${String(r.n).padStart(4)}  ${tags || '-'}`);
      for (const [w, n] of Object.entries(r.detail).sort((a, b) => b[1] - a[1])) console.log(`       ${String(n).padStart(4)}  ${w}`);
    }
    const live = rows.filter((r) => !r.del);
    const win = live[0];
    if (win) decisions.push(`${name}: ${win.code} 유지 ← ${live.slice(1).map((r) => `${r.code}(${r.n})`).join(', ') || '경쟁 없음'}`);
    console.log('');
  }

  console.log('## 참조 수 기준 정본 후보');
  decisions.forEach((d) => console.log('  ', d));
  console.log('\n## 코드 접두어별 총 참조');
  const byPrefix: Record<string, number> = {};
  for (const [code] of use) {
    const pre = code.startsWith('SP') ? 'SP' : code.startsWith('PT') ? 'PT' : code.startsWith('RP') ? 'RP' : '기타';
    byPrefix[pre] = (byPrefix[pre] || 0) + total(code);
  }
  for (const [k, n] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
