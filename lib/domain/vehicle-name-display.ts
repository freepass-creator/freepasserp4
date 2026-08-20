/**
 * **차명 한 칸** — 공급사가 적어 준 차명(세부모델+트림) 그대로. 없으면 우리 정제값으로 만든다.
 *   사장님 2026-08-20 「상품찾기 구성 — 모델·차명 넣기로 했잖아 · 간단에는 차명을 보여줘야 하고」.
 *   ERP 는 `supplier_vehicle_name`(상품마스터 원문보존의 「차명(세부모델+트림)」)을 싣는다 — product-master-import.
 */
import type { EntityRecord } from '@/lib/intake/entities';
const S = (v: unknown) => String(v ?? '').trim();
export function supplierVehicleName(p: EntityRecord | Record<string, unknown>): string {
  const rec = p as Record<string, unknown>;
  const direct = S(rec.supplier_vehicle_name) || S(rec.trim_extra);
  if (direct) return direct;
  const parts = [S(rec.sub_model) || S(rec.model), S(rec.trim_name)].filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) for (const tok of part.split(/\s+/).filter(Boolean)) {
    const key = tok.toLowerCase().replace(/[\s\-_./()（）·,]/g, '');
    if (seen.has(key)) continue; seen.add(key); out.push(tok);
  }
  return out.join(' ');
}
