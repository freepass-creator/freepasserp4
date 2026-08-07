/**
 * 링크 사진이 **실제로 풀리는가**(읽기 전용) — 화면에 뜨는 사진의 97%가 링크 해석분이라
 * 해석이 실패하면 영업자에겐 그냥 «사진 없는 차»다. 그 실패율을 잰다.
 *
 *   npm run dev 를 띄운 뒤
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/audit-photo-resolve.mts [--limit 60] [--base http://localhost:4004]
 *
 * 앱과 **같은 경로**로 잰다 — `/api/extract-photos`(화면이 부르는 그 API)를 그대로 호출한다.
 * 스크래핑 로직을 이 스크립트에 복붙하면 리포트와 화면이 다른 답을 내게 된다.
 * 쓰기는 없다. 외부 사이트를 두드리므로 동시 4개로 묶고, 표본을 줄이려면 --limit 을 쓴다.
 */
import { readFileSync } from 'node:fs';
import { scrapableSources } from '../lib/domain/product-photos';
import type { EntityRecord } from '../lib/intake/entities';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BASE = arg('--base', 'http://localhost:4004');
const LIMIT = Number(arg('--limit', '0')) || 0;
const CONC = 4;
const SELLABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '(알수없음)'; }
}

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const products = Object.values(((await db.ref('v4/products').get()).val() || {}) as Record<string, EntityRecord>);

  const targets: { code: string; provider: string; src: string }[] = [];
  for (const p of products) {
    if (p._deleted === true) continue;
    if (!SELLABLE.has(String(p.vehicle_status || '').replace(/\s+/g, ''))) continue;
    for (const src of scrapableSources(p)) {
      targets.push({ code: String(p.product_code || p._key), provider: String(p.provider_company_code || '(미지정)'), src });
    }
  }
  const list = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(`\n링크 사진 ${targets.length}건 중 ${list.length}건 확인 — ${BASE}/api/extract-photos\n`);

  type R = { ok: number; empty: number; fail: number; photos: number };
  const byHost = new Map<string, R>();
  const byProvider = new Map<string, R>();
  const bump = (m: Map<string, R>, k: string, f: keyof R, n = 1) => {
    const r = m.get(k) || { ok: 0, empty: 0, fail: 0, photos: 0 };
    r[f] += n;
    m.set(k, r);
  };
  const failures: string[] = [];

  let idx = 0;
  const worker = async () => {
    while (idx < list.length) {
      const t = list[idx++];
      const host = hostOf(t.src);
      try {
        const res = await fetch(`${BASE}/api/extract-photos?url=${encodeURIComponent(t.src)}&size=1280`, { signal: AbortSignal.timeout(30000) });
        const body = await res.json() as { ok?: boolean; urls?: string[] };
        const n = Array.isArray(body.urls) ? body.urls.length : 0;
        if (n > 0) {
          bump(byHost, host, 'ok'); bump(byProvider, t.provider, 'ok');
          bump(byHost, host, 'photos', n); bump(byProvider, t.provider, 'photos', n);
        } else {
          bump(byHost, host, 'empty'); bump(byProvider, t.provider, 'empty');
          if (failures.length < 12) failures.push(`빈 결과  ${t.provider} ${t.code}  ${t.src.slice(0, 70)}`);
        }
      } catch (e) {
        bump(byHost, host, 'fail'); bump(byProvider, t.provider, 'fail');
        if (failures.length < 12) failures.push(`오류    ${t.provider} ${t.code}  ${(e as Error).message}`);
      }
      if (idx % 25 === 0) console.log(`  … ${idx}/${list.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-');
  const show = (title: string, m: Map<string, R>) => {
    console.log(`\n${title}`);
    console.log('대상                 성공   빈결과   오류   성공률   받은 사진');
    console.log('─'.repeat(66));
    for (const [k, r] of [...m.entries()].sort((a, b) => (b[1].empty + b[1].fail) - (a[1].empty + a[1].fail))) {
      const tot = r.ok + r.empty + r.fail;
      console.log(`${k.slice(0, 20).padEnd(20)} ${String(r.ok).padStart(4)} ${String(r.empty).padStart(7)} ${String(r.fail).padStart(6)}   ${pct(r.ok, tot).padStart(5)}   ${String(r.photos).padStart(7)}`);
    }
  };
  show('출처(호스트)별', byHost);
  show('공급사별', byProvider);
  if (failures.length) {
    console.log('\n실패 표본');
    failures.forEach((f) => console.log(`  ${f}`));
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
