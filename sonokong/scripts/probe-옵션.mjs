/** 원천 view() 원본 응답에서 «모든 옵션류 필드»를 훑는다. 손오공 유료옵션이 다른 필드명인지 확인용. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { view } from '../lib/sonokong.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 덤프 = JSON.parse(fs.readFileSync(path.join(루트, 'lib', 'wonja', '손오공차량.json'), 'utf8'));
const K = (v) => String(v ?? '').replace(/\s/g, '');

const 대상 = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// 인자 없으면: 요청 차 + SON 하나 + TCAR 하나
const plates = 대상.length ? 대상 : ['264도8252'];
const sonSample = (덤프.차량 || []).find((c) => /SON/.test(c.버킷));
if (!대상.length && sonSample) plates.push(sonSample.차번);

for (const plate of plates) {
  const c = (덤프.차량 || []).find((x) => K(x.차번) === K(plate));
  if (!c) { console.log(`\n=== ${plate} — 현재 덤프에 없음(스테일)`); continue; }
  const d = await view(c.id).catch((e) => ({ __err: e.message }));
  if (d?.__err) { console.log(`\n=== ${plate} view 실패: ${d.__err}`); continue; }
  console.log(`\n=== ${plate}  버킷=${c.버킷}  id=${c.id}  ${c.차명}`);
  // 옵션류 키 전부
  const optKeys = Object.keys(d).filter((k) => /option|opt|사양|equip/i.test(k));
  console.log('  옵션류 키:', optKeys.length ? optKeys.join(', ') : '없음');
  for (const k of optKeys) {
    const v = d[k];
    if (Array.isArray(v)) {
      console.log(`   ${k}[${v.length}]:`, v.slice(0, 3).map((o) => (typeof o === 'object' ? JSON.stringify(o) : o)).join(' | ').slice(0, 200));
    } else {
      console.log(`   ${k}:`, JSON.stringify(v).slice(0, 200));
    }
  }
  // 정규화 결과(현재 우리가 뽑는 값)
  console.log('  → 정규화된 옵션:', JSON.stringify(c.옵션).slice(0, 120));
  console.log('  → 정규화된 유료옵션:', JSON.stringify(c.유료옵션));
}
