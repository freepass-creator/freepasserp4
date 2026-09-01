/**
 * 정산서 «장 넘김» 시험 — 줄 수를 1~70 까지 늘려 가며 다 만들어 본다.
 *
 * ★가운데 장(CAP_MID)은 실제 정산서로는 안 나온다. 지금 제일 긴 게 29줄이라
 *   세 장짜리가 없기 때문이다. 그러니 «만들어서» 시험한다 —
 *   안 그러면 언젠가 긴 정산서가 처음 나오는 날 인쇄가 깨진다.
 *
 *   npx tsx scripts/check-invoice-pages.mts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { invoiceDocHtml, invoicePageHtml } from '../lib/server/settlement-invoice-html';
import { EMPTY_PARTY, type Invoice } from '../lib/domain/settlement-invoice';

const OUT = 'tmp/정산서-장시험';
// ★먼저 비운다 — 안 비우면 지난번 «11줄 1장» 이 남아 이번 «11줄 2장» 과 섞여
//   멀쩡한데 넘쳤다고 나온다. 실제로 2026-08-27 에 그렇게 헛다리를 짚었다.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const line = (i: number) => ({
  plate: `${100 + (i % 800)}하${1000 + i}`,
  model: '아반떼N 1.6 터보 인스퍼레이션',
  customer: `고객${i}`,
  product: '장기렌트',
  term: 48,
  base: '대여료 790,000 × 48개월',
  rate: 0.0325,
  amount: 1232400,
  vat: 123240,
  total: 1355640,
  minus: false,
  reason: '',
});

const at = [1, 10, 11, 12, 14, 15, 25, 29, 30, 33, 40, 50, 60, 70];
console.log('\n■ 장 넘김 시험 — 줄 수 ' + at.join(' · ') + '\n');
for (const n of at) {
  const lines = Array.from({ length: n }, (_, i) => line(i + 1));
  const supply = lines.reduce((s, l) => s + l.amount, 0);
  const inv: Invoice = {
    axis: '공급사',
    kind: '청구서',
    month: '2026-08',
    party: '시험',
    issuer: EMPTY_PARTY,
    receiver: { ...EMPTY_PARTY, name: '시험 주식회사', bizNo: '000-00-00000', ceo: '홍길동' },
    lines,
    supply,
    vat: Math.round(supply * 0.1),
    total: supply + Math.round(supply * 0.1),
    clawback: 0,
    missing: [],
  };
  const html = invoicePageHtml(`${n}줄 시험`, invoiceDocHtml(inv, { issuedAt: Date.UTC(2026, 7, 27) }));
  const pages = (html.match(/class="doc"/g) || []).length;
  writeFileSync(`${OUT}/${String(n).padStart(2, '0')}줄 ${pages}장.html`, html, 'utf8');
  console.log('  ' + String(n).padStart(2) + '줄  →  ' + pages + '장');
}
console.log('\n다음  node scripts/check-invoice-overflow.mjs "' + OUT + '"\n');
