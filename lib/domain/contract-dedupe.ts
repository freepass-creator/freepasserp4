import { type EntityRecord } from '@/lib/intake/entities';

/**
 * 같은 계약이 **두 벌로 저장돼 있는 것**을 읽는 자리에서 한 벌로 세운다.
 *
 * 2026-08-05 v3→v4 이관이 계약을 **원본 push key 그대로** 한 번 더 넣었다(실측 2026-08-08:
 * `v4/contracts` 키 70개 = 고유 계약 40건 + 중복 30건). 앱은 `contract_code` 를 키로 쓰므로
 * (`entities.contract.idFrom`) push key 쪽은 이관 잔재다.
 *
 * 방치하면 **같은 계약이 두 줄로 보이고, 진행 건수가 두 배로 세지고, 방↔계약 조인이 어느 쪽을
 * 잡느냐에 따라 단계가 달라 보인다.** 실제로 한 계약은 한쪽에 `agent_delivery_inquiry: true`,
 * 다른 쪽엔 없음이었다 — 화면마다 계약 단계가 다르게 나올 수 있는 상태다.
 *
 * ★데이터를 고치지 않는다. 지우는 건 되돌릴 수 없어 사람 승인·백업 뒤에 할 일이고,
 *   그 전에도 화면은 맞아야 하므로 **읽기에서 합친다.**
 *
 * 규칙(덮어쓰기 금지):
 *   1) `contract_code` 로 묶는다. 코드가 없으면 합칠 근거가 없으니 그대로 둔다.
 *   2) 정본 = `_key === contract_code` 인 레코드(앱이 쓰는 키). 없으면 `updated_at` 최신.
 *   3) 나머지에서 **정본에 비어 있는 칸만** 채운다. 이관 잔재가 살아 있는 값을 덮지 못하게.
 */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

export function dedupeContractsByCode(rows: EntityRecord[]): EntityRecord[] {
  const groups = new Map<string, EntityRecord[]>();
  const out: EntityRecord[] = [];
  for (const row of rows) {
    const code = String(row?.contract_code || '').trim();
    if (!code) { out.push(row); continue; } // 코드 없는 레코드는 손대지 않는다
    groups.set(code, [...(groups.get(code) || []), row]);
  }
  for (const [code, list] of groups) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const canonical = list.find((r) => String(r._key) === code)
      || list.slice().sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
    const merged: EntityRecord = { ...canonical };
    for (const other of list) {
      if (other === canonical) continue;
      for (const [k, v] of Object.entries(other)) {
        // _key 는 정본의 것을 지킨다 — 키가 흔들리면 선택·라우팅이 통째로 어긋난다.
        if (k === '_key' || isEmpty(v)) continue;
        if (isEmpty(merged[k])) merged[k] = v as EntityRecord[string];
      }
    }
    out.push(merged);
  }
  return out;
}
