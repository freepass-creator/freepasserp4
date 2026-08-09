/**
 * 계약서 칸(data-field)에 붙은 «실제 라벨»을 템플릿에서 뽑는다.
 * 원자 문서를 쓸 때 라벨을 지어내지 않기 위한 것.
 *
 *   npx tsx scripts/dump-contract-labels.mts
 */
import { readFileSync } from 'node:fs';

const DIR = 'C:/dev/freepasserp4/public/contract-template';
const FILES = ['rental-contract.html', 'contract-individual.html'];

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

type Hit = { field: string; label: string; sample: string; file: string };
const out: Hit[] = [];
const seen = new Set<string>();

for (const file of FILES) {
  const html = readFileSync(`${DIR}/${file}`, 'utf8');
  for (const m of html.matchAll(/data-field="([^"]+)"[^>]*>([^<]*)/g)) {
    const field = m[1];
    if (/^'|\+/.test(field)) continue;
    const key = `${file}:${field}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 앞쪽 400자에서 마지막 텍스트 덩어리를 라벨로 본다(대개 <td class="k">라벨</td> 형태).
    const before = html.slice(Math.max(0, m.index! - 400), m.index!);
    const chunks = strip(before).split(' ').filter(Boolean);
    const label = chunks.slice(-6).join(' ');
    out.push({ field, label, sample: strip(m[2]).slice(0, 30), file });
  }
}

const byField = new Map<string, Hit[]>();
for (const h of out) {
  if (!byField.has(h.field)) byField.set(h.field, []);
  byField.get(h.field)!.push(h);
}

console.log(`칸 ${byField.size}개\n`);
for (const [field, hits] of [...byField.entries()].sort()) {
  const h = hits[0];
  const files = hits.map((x) => x.file.split('-')[0]).join(',');
  console.log(`${field.padEnd(30)} | ${h.label.slice(-40).padEnd(42)} | 값예시: ${h.sample.padEnd(24)} | ${files}`);
}
