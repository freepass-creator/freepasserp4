/** view + viewAgent 전체 응답의 «모든 키»를 훑어 옵션류 필드를 전수조사한다.
 *  모바일 앱이 「선택옵션」을 어디서 받는지 찾기 위함(사장님 2026-09-10 「모바일 앱엔 티카 옵션이 분명히 있다」). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { view, viewAgent, API } from '../lib/sonokong.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 덤프 = JSON.parse(fs.readFileSync(path.join(루트, 'lib', 'wonja', '손오공차량.json'), 'utf8'));
const K = (v) => String(v ?? '').replace(/\s/g, '');
const plate = process.argv[2] || '264도8252';
const c = (덤프.차량 || []).find((x) => K(x.차번) === K(plate));
if (!c) { console.log('덤프에 없음'); process.exit(1); }

const walk = (obj, prefix = '') => {
  const hits = [];
  const rec = (o, p) => {
    if (o == null) return;
    if (Array.isArray(o)) { if (/option|opt|사양|equip|choice|추가|선택/i.test(p)) hits.push(`${p}[${o.length}] = ${JSON.stringify(o).slice(0, 160)}`); o.slice(0, 2).forEach((x, i) => rec(x, `${p}[${i}]`)); return; }
    if (typeof o === 'object') { for (const k of Object.keys(o)) rec(o[k], p ? `${p}.${k}` : k); return; }
    if (/option|opt|사양|equip|choice|추가|선택/i.test(p)) hits.push(`${p} = ${JSON.stringify(o).slice(0, 120)}`);
  };
  rec(obj, prefix);
  return hits;
};

console.log(`=== ${plate} id=${c.id} ${c.차명} ===`);
const d = await view(c.id).catch((e) => ({ __err: e.message }));
console.log('\n[view] 전체 키:', Object.keys(d).join(', '));
console.log('[view] 옵션류 hit:'); for (const h of walk(d)) console.log('   ', h);

const a = await viewAgent(c.id).catch((e) => ({ __err: e.message }));
console.log('\n[viewAgent] 전체 키:', a ? Object.keys(a).join(', ') : 'null');
if (a) { console.log('[viewAgent] 옵션류 hit:'); for (const h of walk(a)) console.log('   ', h); }

// 혹시 모를 다른 엔드포인트 탐색
console.log('\n[탐색] 다른 옵션 엔드포인트 시도:');
const { 토큰경로 } = await import('../lib/sonokong.mjs');
