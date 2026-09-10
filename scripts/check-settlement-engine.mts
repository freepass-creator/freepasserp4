/**
 * **정산 엔진 경계 검사** — `npm run check:engine`
 *
 * ★★★사장님 2026-09-09 「정산 엔진 명확하게 만들어놔. **이거 별도로 구현되어야 하니까**」
 *
 * 「별도로 구현」이 되려면 엔진이 **아무것도 안 물고 있어야** 한다.
 * 저장소 한 줄, 세션 한 줄만 물어도 떼어낼 때 그 뒤에 딸린 것이 통째로 따라온다.
 * ⇒ 이 검사는 엔진 심장(`ENGINE_CORE`)이 금지 목록(`ENGINE_FORBIDDEN`)을 무는지만 본다.
 *
 * 넷을 잡는다.
 *   ① 심장 파일이 «없다»           — 명단과 실물이 갈렸다
 *   ② 심장이 금지된 것을 «문다»     — 떼어낼 수 없다
 *   ③ 문이 내보내는 이름이 «비었다» — 있지도 않은 것을 내보낸다(오타·삭제)
 *   ④ 심장이 심장 «밖»을 문다       — 명단에 없는 파일을 물면 그 파일도 심장이 된다
 */
import { readFileSync, existsSync } from 'node:fs';
import { ENGINE_CORE, ENGINE_FORBIDDEN } from '../lib/domain/settlement/engine';

const S = (v: unknown) => String(v ?? '').trim();
const DOOR = 'lib/domain/settlement/engine.ts';
const bad: string[] = [];
console.log('\n■ 정산 엔진 경계 — 떼어낼 수 있는가\n');

/** 한 파일이 무는 것들. `import x from 'y'` · `export … from 'y'` 둘 다 센다. */
const importsOf = (src: string) => [...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);

/* ── ①② 심장이 순수한가 ─────────────────────────────────────────── */
const seen = new Map<string, string[]>();
for (const f of ENGINE_CORE) {
  if (!existsSync(f)) { bad.push(`① 심장 파일이 없습니다 — ${f}`); continue; }
  const src = readFileSync(f, 'utf8');
  const imps = importsOf(src);
  seen.set(f, imps);
  const dirty = imps.filter((i) => ENGINE_FORBIDDEN.some((x) => i === x || i.startsWith(x)));
  console.log(`   ${dirty.length ? '✕' : '✓'} ${f.replace('lib/domain/', '')}${dirty.length ? `   ← ${dirty.join(' · ')}` : ''}`);
  for (const d of dirty) bad.push(`② ${f} 가 「${d}」 를 뭅니다 — 엔진은 저장·세션·시트·화면을 몰라야 합니다`);
}

/* ── ③ 문이 내보내는 이름이 실제로 있는가 ────────────────────────── */
const door = readFileSync(DOOR, 'utf8');
/** `export { a, b as c } from '../x'` 를 (원래이름, 파일)로 편다. */
for (const m of door.matchAll(/export\s+(type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/g)) {
  const from = m[3].replace(/^\.\.\//, 'lib/domain/') + '.ts';
  if (!existsSync(from)) { bad.push(`③ 문이 없는 파일에서 꺼냅니다 — ${m[3]}`); continue; }
  const src = readFileSync(from, 'utf8');
  for (const one of m[2].split(',').map(S).filter(Boolean)) {
    const name = S(one.split(/\s+as\s+/)[0]);
    const has = new RegExp(`export\\s+(?:declare\\s+)?(?:const|let|function|type|interface|enum|class)\\s+${name}\\b`).test(src)
      || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(src);
    if (!has) bad.push(`③ 「${name}」 이 ${m[3]} 에 없습니다 — 문이 빈 이름을 내보냅니다`);
  }
}

/* ── ④ 심장이 심장 밖 «우리 파일»을 무는가 ───────────────────────── */
for (const [f, imps] of seen) {
  for (const i of imps) {
    if (!i.startsWith('.') && !i.startsWith('@/')) continue;             // 바깥 꾸러미는 ②가 본다
    const p = i.startsWith('@/') ? `${i.slice(2)}.ts` : `lib/domain/${i.replace(/^\.\//, '').replace(/^\.\.\//, '')}.ts`;
    const norm = p.replace(/^lib\/domain\/lib\//, 'lib/');
    if ((ENGINE_CORE as readonly string[]).includes(norm)) continue;
    bad.push(`④ ${f} 가 심장 밖 「${i}」 을 뭅니다 — 심장에 넣든지, 안 물든지 하나여야 합니다`);
  }
}

if (bad.length) {
  console.log(`\n  ✕ ${bad.length}가지가 어긋납니다 — 지금은 «별도로 구현»할 수 없습니다.\n`);
  for (const x of bad) console.log(`     ${x}`);
  console.log('\n  경계는 lib/domain/settlement/engine.ts 머리에 적혀 있습니다.');
  console.log('  바꾸려면 사장님께 여쭙고 → 그 문서를 고치고 → 이 검사를 고칩니다.\n');
  process.exit(1);
}
console.log(`\n   ✓ 심장 ${ENGINE_CORE.length}장이 저장·세션·시트·화면을 물지 않습니다 — 통째로 떼어낼 수 있습니다.\n`);
