// 라벨·법적값 표기 정규화: 연령→「만 N세 이상/이하」, 시동제어·회수·반환일→「N일」.
// 값(숫자)은 보존하고 «표기»만 규격으로. 계산값(돈·율·회차·보관/통지일)은 숫자라 안 건드림.
// 소비자는 ageNumber()/policyNumber()로 숫자만 뽑아 써서 안전. 드라이런 기본, --apply.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const f of ['.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)) { const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if(!m)continue; const v=m[2].replace(/^["']|["']$/g,''); if(v&&!process.env[m[1]])process.env[m[1]]=v; } } catch {} }
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const db = firebaseAdminDatabase();
// 필드 → 값에서 숫자 뽑아 규격 표기로. 숫자 없으면(협의·제한없음 등) 건드리지 않음(null 반환).
const RULES: Record<string, (raw: string) => string | null> = {
  basic_driver_age: (r) => { const m = r.match(/(\d{2})/); return m ? `만 ${m[1]}세 이상` : null; },
  driver_age_upper_limit: (r) => { const m = r.match(/(\d{2})/); return m ? `만 ${m[1]}세 이하` : null; },
  engine_control_overdue_days: (r) => { const m = r.match(/(\d+)/); return m ? `${m[1]}일` : null; },
  auto_terminate_overdue_days: (r) => { const m = r.match(/(\d+)/); return m ? `${m[1]}일` : null; },
  deposit_return_days: (r) => { const m = r.match(/(\d+)/); return m ? `${m[1]}일` : null; },
};
const updates: Record<string, string> = {}; const backup: Record<string, string> = {}; const rows: string[] = [];
for (const node of ['v4/policies', 'policies']) {
  const bag = (await db.ref(node).get()).val() || {};
  for (const [code, p] of Object.entries<any>(bag)) {
    for (const [key, rule] of Object.entries(RULES)) {
      const raw = S(p[key]); if (!raw) continue;
      const want = rule(raw); if (want == null || want === raw) continue;   // 못 뽑거나 이미 규격이면 스킵
      updates[`${node}/${code}/${key}`] = want; backup[`${node}/${code}/${key}`] = raw;
      if (rows.length < 50) rows.push(`  ${S(p.provider_company_code).padEnd(7)} ${code.padEnd(15)} ${key.padEnd(28)} 「${raw}」 → 「${want}」`);
    }
  }
}
console.log(`${APPLY ? '★반영' : '드라이런(안 씀)'} · 연령·일수 표기 규격화\n`);
rows.forEach((r) => console.log(r));
console.log(`\n대상 ${Object.keys(updates).length}칸`);
if (!APPLY) { console.log('\n반영: --apply'); process.exit(0); }
mkdirSync('tmp/backup', { recursive: true });
writeFileSync('tmp/backup/policy-notation-before.json', JSON.stringify(backup, null, 2), 'utf8');
await db.ref().update(updates);
console.log(`\n✅ ${Object.keys(updates).length}칸 반영 · 백업 tmp/backup/policy-notation-before.json`);
process.exit(0);
