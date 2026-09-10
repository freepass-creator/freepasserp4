/**
 * **요구서류를 «읽는» 자리 — 공용.** 어느 채(館)에서든 「무슨 서류가 필요한가」를 읽을 수 있어야 한다.
 *
 * ★★★**왜 갈랐나.** 2026-09-08 채 셋(찾기·견적·거래)의 경계를 재 보니,
 *   손님만 보는 `/shop`·`/q`·`/m` 까지 **전자계약 코드를 통째로 끌고** 있었다. 길은 이랬다.
 * ```
 * lib/domain/product.ts  →  esign-required-documents  →  esign-contract-kind
 *                           (프리셋·서명자 역할·직렬화)  (위약금율·지연이자·계약종류)
 * ```
 *   그런데 `product.ts` 가 실제로 쓰는 것은 **서류 이름 목록 하나**뿐이다 —
 *   「무슨 서류 필요해요?」에 영업자가 바로 답하라고 카드에 적는 그 줄(`product.ts` 727행).
 *   서류를 «읽는» 일과 계약을 «진행하는» 일이 한 파일에 섞여 있어서, 읽기만 하려는 쪽이
 *   진행 로직까지 짊어졌다.
 *
 * ⇒ **읽기는 여기(공용), 진행은 `esign-required-documents`(거래 채).**
 *   상품찾기를 화이트라벨로 뜯어낼 때 이 파일만 따라가면 되고, 위약금·계약종류는 안 따라간다.
 *
 * ⚠ 여기에는 **바깥을 향한 import 가 없어야 한다.** 하나라도 생기면 그게 다음 번 «따라오는 짐»이다.
 * ⚠ 기존 부르던 이름은 `esign-required-documents` 가 그대로 다시 내보낸다 — 부르던 쪽은 안 고친다.
 */

export type EsignRequiredDocument = {
  key: string;
  label: string;
  note: string;
  required: boolean;
};

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();

export const MAX_ESIGN_REQUIRED_DOCUMENTS = 10; // 시트 체크 6(사장님 2026-08-19) + 기타서류

export function safeDocumentKey(value: unknown, index: number, used: Set<string>): string {
  const base = S(value).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
    || `document_${index + 1}`;
  let key = base.slice(0, 48);
  let suffix = 2;
  while (used.has(key)) key = `${base.slice(0, 42)}_${suffix++}`;
  used.add(key);
  return key;
}

export function normalizeEsignRequiredDocuments(value: unknown): EsignRequiredDocument[] {
  let source = value;
  if (typeof source === 'string') {
    if (!source.trim()) return [];
    try { source = JSON.parse(source); }
    catch { return []; }
  }
  if (!Array.isArray(source)) return [];
  const used = new Set<string>();
  return source.slice(0, MAX_ESIGN_REQUIRED_DOCUMENTS).flatMap((item, index) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Rec : {};
    const label = S(row.label).slice(0, 40);
    if (!label) return [];
    return [{
      key: safeDocumentKey(row.key, index, used),
      label,
      note: S(row.note).slice(0, 160),
      required: row.required !== false,
    }];
  });
}

export function policyEsignRequiredDocuments(policy: Rec | null | undefined): EsignRequiredDocument[] {
  return normalizeEsignRequiredDocuments(
    policy?.esign_required_documents ?? policy?.required_documents,
  );
}

/** 여러 출처의 요구서류를 키 기준으로 합친다. 앞쪽 항목을 우선해 고객 화면의 순서도 고정한다. */
export function mergeEsignRequiredDocuments(
  ...groups: Array<EsignRequiredDocument[] | null | undefined>
): EsignRequiredDocument[] {
  const byKey = new Map<string, EsignRequiredDocument>();
  for (const group of groups) {
    for (const document of normalizeEsignRequiredDocuments(group || [])) {
      const prev = byKey.get(document.key);
      byKey.set(document.key, prev
        ? { ...prev, required: prev.required || document.required }
        : document);
    }
  }
  return [...byKey.values()].slice(0, MAX_ESIGN_REQUIRED_DOCUMENTS);
}

/** ⚠ 빈 목록도 `"[]"` 로 적는다 — 「없다」와 「안 적혔다」를 시트·저장소가 가르지 못하게 하면 안 된다. */
export function serializeEsignRequiredDocuments(documents: EsignRequiredDocument[]): string {
  return JSON.stringify(normalizeEsignRequiredDocuments(documents));
}
