/**
 * 정산 이력 임포터 — 프리패스 "계약현황" xlsx → v4 정산 레코드. (generate_analytics.py 컬럼매핑·정규화 이식)
 * ERP엔 필요한 원자만: 공급사·계약일·상태·차번·고객·기간·월대여료·영업자·영업채널 + R1(공급사청구)·R2(에이전시지급).
 * 나머지(마진추정·차량가액·분납·리드타임)는 버림. 재사용: 다음 파일도 같은 임포터로.
 */
import { type EntityRecord } from '@/lib/intake/entities';

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').trim();
const money = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  const raw = norm(v);
  const negative = /^-/.test(raw) || /^\(.*\)$/.test(raw);
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const amount = Number(digits);
  return negative ? -amount : amount;
};
function asDate(v: unknown): string | null {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v ?? '').trim().match(/(\d{4})[-.\/ ]+(\d{1,2})[-.\/ ]+(\d{1,2})/);
  if (m) { const [, y, mo, d] = m; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
  return null;
}
// 계약현황 상태 → 정산상태(SETTLEMENT_STATES)
function statusToSettlement(raw: unknown, settled: boolean): string {
  const s = String(raw || '');
  if (/완료|업로드/.test(s)) return '정산완료';
  if (/환불|취소|환수|불가/.test(s)) return settled ? '환수결정' : '정산보류';
  return '정산대기'; // 확인중·진행·대기·기타
}
function vendorCanon(v: unknown): string {
  let s = norm(v).replace(/[(\s]*LC[)\s]*$/, '');
  const map: Record<string, string> = { '경진렌트카': '경진카', '리더스렌트카': '리더스', '빌린카': '빌림', 'JPK모빌리티': 'JPK' };
  return map[s] || s || '(미상)';
}
const person = (v: unknown): string => { const s = norm(v); return (s === '' || ['-', '미정', '미상', '해당없음', '없음'].includes(s) || /^-?\d/.test(s)) ? '' : s; };

type SheetAoa = { name: string; aoa: unknown[][] };

/** 워크북 시트들(aoa) → 정산 이력 레코드. 헤더 자동탐지(업체명+접수일/계약일). */
export function parseSettlementHistory(sheets: SheetAoa[]): { records: EntityRecord[]; skipped: number } {
  const out: EntityRecord[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const { aoa } of sheets) {
    // 헤더행 탐지
    let hi = -1, hdr: unknown[] = [];
    for (let r = 0; r < Math.min(6, aoa.length); r++) {
      const c = (aoa[r] || []).map(norm);
      if (c.includes('업체명') && (c.includes('접수일') || c.includes('계약일'))) { hi = r; hdr = aoa[r]; break; }
    }
    if (hi < 0) continue;
    const cols: Record<string, number> = {};
    hdr.forEach((c, i) => { const n = norm(c); if (n) cols[n] = i; });
    const gi = (...names: string[]) => { for (const n of names) if (n in cols) return cols[n]; return -1; };
    const ci = {
      status: gi('상태표기', '상태표시', '상태'), vendor: gi('업체명'), cdate: gi('접수일', '계약일'),
      rtype: gi('렌트구분'), ptype: gi('상품구분'), carno: gi('차량번호'), model: gi('모델명'), customer: gi('고객명'),
      term: gi('계약기간'), fee: gi('렌탈료'), sales: gi('영업자'), agency: gi('에이전시'),
      recv: gi('공급사청구금액', '청구금액'), paid: gi('에이전시지급액', '지급액'),
    };
    for (let r = hi + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const g = (k: keyof typeof ci) => { const j = ci[k]; return j < 0 || j >= row.length ? null : row[j]; };
      const vendor = vendorCanon(g('vendor'));
      const cdate = asDate(g('cdate'));
      const carno = norm(g('carno')); const customer = norm(g('customer')); const fee = money(g('fee'));
      if (norm(g('vendor')) === '' || norm(g('vendor')) === '업체명') continue;
      if (!cdate && !carno && !customer && !fee) continue; // 빈 행
      const term = Number(String(g('term') ?? '').replace(/[^0-9]/g, '')) || 0;
      const recv = money(g('recv')); const paid = money(g('paid'));
      const settled = recv > 0 || paid > 0;
      const status = statusToSettlement(g('status'), settled);
      const claw = status === '환수결정' ? recv : 0;
      const key = `IMP_${cdate || 'x'}_${carno || 'x'}_${norm(customer) || 'x'}_${fee}`;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      out.push({
        settlement_code: key, contract_code: key, provider_company_code: vendor,
        agent_code: person(g('sales')), agent_channel_code: person(g('agency')),
        customer_name: customer, car_number: carno, sub_model_snapshot: norm(g('model')),
        rent_month_snapshot: term || '', rent_amount: fee,
        fee_amount: recv, agent_payout: paid, net_amount: recv - paid,
        clawback_amount: claw, settlement_status: status, contract_date: cdate || '',
        rtype: norm(g('rtype')), _imported: true,
      });
    }
  }
  return { records: out, skipped };
}
