/**
 * 정책 세 층이 성립하는지 본다.
 *   ① 계약 층 항목은 «근거 약관 조항»이 반드시 있어야 한다 — 못 적는 항목은 계약서에 실릴 값이 아니다
 *   ② 내부 전용 값이 손님에게 나가는 층에 섞이지 않았는가
 *   ③ 정책 엔티티에 그 키가 실제로 있는가 — 없으면 정책 화면에 칸부터 만들어야 한다
 *
 *   npx tsx scripts/check-policy-layers.mts
 */
import { readFileSync } from 'node:fs';
import {
  PRODUCT_LAYER, SALES_LAYER, CONTRACT_LAYER, ALL_POLICY_FIELDS,
} from '@/lib/domain/policy-tier';

const ents = readFileSync('lib/intake/entities.ts', 'utf8');
// policy 엔티티 블록만 정확히 잘라낸다 — 고정 길이로 자르면 뒤쪽 필드를 통째로 놓친다.
const start = ents.indexOf("policy_name");
const nextEntity = ents.indexOf('room: {', start);
const block = ents.slice(Math.max(0, start - 400), nextEntity > start ? nextEntity : ents.length);
const entityKeys = new Set([...block.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));

console.log(`상품 ${PRODUCT_LAYER.length} · 영업 ${SALES_LAYER.length} · 계약 ${CONTRACT_LAYER.length}  = ${ALL_POLICY_FIELDS.length}항목\n`);

const by: Record<string, number> = {};
for (const f of ALL_POLICY_FIELDS) by[f.exposure] = (by[f.exposure] || 0) + 1;
console.log(`노출  ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`내부전용  ${ALL_POLICY_FIELDS.filter((f) => f.exposure === 'internal').map((f) => f.label).join(' / ')}\n`);

let bad = 0;

// ① 계약 층은 근거 조항이 있어야 한다
const noArticle = CONTRACT_LAYER.filter((f) => !f.article);
if (noArticle.length) {
  console.error(`  [근거 없음] ${noArticle.map((f) => f.label).join(', ')}`);
  bad += noArticle.length;
}

// ② 내부 전용이 계약·견적 노출로 새지 않았는가
const leaked = ALL_POLICY_FIELDS.filter((f) => f.exposure === 'internal' && f.layer === 'contract');
if (leaked.length) {
  console.error(`  [누출 위험] 내부 전용인데 계약 층에 있음: ${leaked.map((f) => f.label).join(', ')}`);
  bad += leaked.length;
}

// ③ 엔티티에 키가 있는가
const missing = ALL_POLICY_FIELDS.filter((f) => !entityKeys.has(f.key));
console.log(`정책 엔티티에 칸이 없는 항목 ${missing.length}개 — 화면에 칸부터 만들어야 한다`);
for (const f of missing) {
  console.log(`   ${f.key.padEnd(30)} ${f.label.padEnd(22)} ${f.article || ''}`);
}

console.log(bad ? `\n어긋남 ${bad}건` : '\n층 구조 이상 없음');
process.exit(bad ? 1 : 0);
