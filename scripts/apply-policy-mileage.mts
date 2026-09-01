// 연주행 규칙 적용: 손오공(RP012)·웰릭스(RP013)=연 20,000km, 그 외=연 30,000km(프리패스 기본·표준표기).
// 사장님 2026-08-28 「렌트 기본 3만km · 손오공/웰릭스는 렌트·구독 다 2만km」. 드라이런 기본, --apply 로 반영.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const f of ['.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)) { const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if(!m)continue; const v=m[2].replace(/^["']|["']$/g,''); if(v&&!process.env[m[1]])process.env[m[1]]=v; } } catch {} }
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const db = firebaseAdminDatabase();
const EXC = new Set(['RP012', 'RP013']);      // 손오공·웰릭스 = 2만 예외
const V20 = '연 20,000km', V30 = '연 30,000km';
const kmOf = (s: string) => /3\s*만|30,?000/.test(s) ? 30 : /2\.5|25,?000/.test(s) ? 25 : /2\s*만|20,?000/.test(s) ? 20 : 0;

const updates: Record<string, string> = {};
const backup: Record<string, string> = {};
const rows: string[] = [];
for (const node of ['v4/policies', 'policies']) {
  const bag = (await db.ref(node).get()).val() || {};
  for (const [code, p] of Object.entries<any>(bag)) {
    const prov = S(p?.provider_company_code); if (!prov) continue;
    const want = EXC.has(prov) ? V20 : V30;
    const cur = S(p.annual_mileage);
    if (cur === want) continue;                 // 표기·값 다 같으면 스킵
    const changedValue = kmOf(cur) !== kmOf(want);
    updates[`${node}/${code}/annual_mileage`] = want;
    backup[`${node}/${code}/annual_mileage`] = cur;
    if (rows.length < 60) rows.push(`  ${prov.padEnd(7)} ${code.padEnd(16)} [${node.replace('/policies','')}] ${(cur||'(빈)').padEnd(14)} → ${want}${changedValue ? '  ★값변경' : '  (표기만)'}`);
  }
}
console.log(`${APPLY ? '★반영' : '드라이런(안 씀)'} · 손오공/웰릭스=2만 · 나머지=3만\n`);
rows.forEach((r) => console.log(r));
const valueChanges = Object.keys(updates).filter((k) => kmOf(backup[k]) !== kmOf(S(updates[k]))).length;
console.log(`\n대상 ${Object.keys(updates).length}칸 (값 실제변경 ${valueChanges} · 표기통일 ${Object.keys(updates).length - valueChanges})`);
if (!APPLY) { console.log('\n반영: --apply'); process.exit(0); }
mkdirSync('tmp/backup', { recursive: true });
writeFileSync('tmp/backup/policy-mileage-before.json', JSON.stringify(backup, null, 2), 'utf8');
await db.ref().update(updates);
console.log(`\n✅ ${Object.keys(updates).length}칸 반영 · 백업 tmp/backup/policy-mileage-before.json`);
process.exit(0);
