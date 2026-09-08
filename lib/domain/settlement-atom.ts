/**
 * **정산 원자 규격 (SSOT) — 한 줄이 무엇을 담는가.**
 *
 * ★★★사장님 2026-09-08 「일단 각 항목을 **항목별로** 접수일 인도일 영업채널 담당자 이런 거
 *   **어떤 거를 담아 가서 할 건지 뽑아내서** 파이어스토어에 담아내야지」
 *
 * ★★**왜 규격이 필요한가.** 실측 2026-09-08 — 원자 461줄에 밭이 **72개**인데 줄마다 달랐다.
 * ```
 * settleTarget  402줄에만    stage      53줄에만
 * agentCode      59줄에만    createdAt  59줄에만
 * ```
 *   밭이 들쭉날쭉하면 「이 줄에 그 값이 없다」와 「그 밭이 아예 없다」를 가를 수가 없다.
 *   그러면 세는 쪽이 매번 `?? 기본값`을 손으로 붙이게 되고, 그 기본값이 곳마다 달라진다.
 *   ⇒ **모든 줄이 모든 밭을 갖는다.** 값이 없으면 «규격이 정한 빈 값»이 들어간다.
 *
 * ★**한 밭은 한 곳에서만 온다.** `from` 이 그 출처(원장 칸 이름)다.
 *   출처가 없는 밭(`from: null`)은 우리가 «세거나 붙이는» 것이다 — 상태·이월처럼.
 *
 * ⚠ **여기 없는 밭은 원자에 넣지 않는다.** 넣고 싶으면 먼저 이 표에 적는다.
 *   `npm run check:atom` 이 표 밖의 밭을 잡는다.
 */

/** 밭 묶음 — 사람이 읽을 때의 차례이기도 하다. */
export type AtomGroup = '정체' | '상대' | '조건' | '요율·돈' | '날' | '정산 축' | '상태' | '이월' | '출처';

export type AtomField = {
  key: string;
  label: string;
  group: AtomGroup;
  type: 'string' | 'number' | 'boolean';
  /** 원장(F04) 어느 칸에서 오나. `null` = 우리가 세거나 붙인다. */
  from: string | null;
  /** 값이 없을 때 들어가는 것 — 「없음」의 꼴을 규격이 정한다. */
  empty: string | number | boolean;
  note?: string;
};

export const SETTLEMENT_FIELDS: AtomField[] = [
  // ── 정체 ─────────────────────────────────────────────
  { key: 'code', label: '원자 코드', group: '정체', type: 'string', from: null, empty: '', note: '차번+접수일+채널로 지은 열쇠. 문서 id 와 같다' },
  { key: 'plate', label: '차량번호', group: '정체', type: 'string', from: '차량번호', empty: '', note: '지원금처럼 차가 없는 줄은 빈 값' },
  { key: 'model', label: '모델명', group: '정체', type: 'string', from: '모델명', empty: '' },
  { key: 'customer', label: '임차인', group: '정체', type: 'string', from: '고객명', empty: '' },

  // ── 상대 ─────────────────────────────────────────────
  { key: 'supplier', label: '공급사', group: '상대', type: 'string', from: '공급사', empty: '', note: '청구하는 쪽' },
  { key: 'supplierCode', label: '공급사코드', group: '상대', type: 'string', from: null, empty: '', note: 'PARTNER_CI 에서 이름으로 찾는다 — 이름이 바뀌어도 잇는다' },
  { key: 'channel', label: '영업채널', group: '상대', type: 'string', from: '영업채널', empty: '', note: '지급하는 쪽' },
  { key: 'channelCode', label: '영업채널코드', group: '상대', type: 'string', from: null, empty: '' },
  { key: 'agent', label: '영업담당자', group: '상대', type: 'string', from: '영업담당자', empty: '' },
  { key: 'agentCode', label: '영업자코드', group: '상대', type: 'string', from: '영업자코드', empty: '' },
  /**
   * ⚠ **영업자 연락처는 안 담는다.** 정산은 «누가 얼마를 주고받나»만 알면 된다.
   *   손님 연락처를 안 담기로 한 것(사장님 2026-09-08)과 같은 이치다 —
   *   들고 있지 않으면 새지도 않는다. 연락은 회원(`members`)에서 한다.
   */

  // ── 조건 ─────────────────────────────────────────────
  { key: 'product', label: '상품 구분', group: '조건', type: 'string', from: '상품구분', empty: '', note: '요율을 고르는 첫 열쇠 — 선출고·신차발주·구독·장기렌트…' },
  { key: 'rentKind', label: '렌트 구분', group: '조건', type: 'string', from: '렌트구분', empty: '' },
  { key: 'contractType', label: '계약 형태', group: '조건', type: 'string', from: '계약형태', empty: '' },
  { key: 'term', label: '계약 기간', group: '조건', type: 'number', from: '계약기간', empty: 0, note: '개월' },
  { key: 'rent', label: '렌탈료', group: '조건', type: 'number', from: '렌탈료', empty: 0 },
  { key: 'deposit', label: '보증금', group: '조건', type: 'number', from: '보증금', empty: 0 },
  { key: 'price', label: '차량가액', group: '조건', type: 'number', from: '차량가액', empty: 0, note: '신차 요율의 밑' },
  { key: 'payKind', label: '납입 방식', group: '조건', type: 'string', from: '분납여부', empty: '' },

  // ── 요율·돈 ──────────────────────────────────────────
  { key: 'supplierRate', label: '공급사 요율', group: '요율·돈', type: 'number', from: '공급사수수료율', empty: 0 },
  { key: 'agentRate', label: '에이전시 요율', group: '요율·돈', type: 'number', from: '에이전시수수료율', empty: 0 },
  { key: 'claimWritten', label: '청구액(적힌)', group: '요율·돈', type: 'number', from: '판매수수료', empty: 0, note: '★적힌 값이 이긴다 — 요율로 다시 세지 않는다' },
  { key: 'payWritten', label: '지급액(적힌)', group: '요율·돈', type: 'number', from: '출고수수료', empty: 0 },
  { key: 'claimIncentive', label: '공급사 인센티브', group: '요율·돈', type: 'number', from: '공급사인센티브', empty: 0, note: '무보증 수수료 등 — 사다리 밖에서 붙는다' },
  { key: 'payIncentive', label: '에이전시 인센티브', group: '요율·돈', type: 'number', from: '에이전시인센티브', empty: 0 },

  // ── 날 ───────────────────────────────────────────────
  { key: 'receivedAt', label: '접수일', group: '날', type: 'string', from: '접수일', empty: '', note: 'YYYY-MM-DD' },
  { key: 'deliveredAt', label: '인도일', group: '날', type: 'string', from: '인도일', empty: '' },
  { key: 'delivered', label: '인도됨', group: '날', type: 'boolean', from: null, empty: false, note: '인도일이 있으면 참' },
  { key: 'paper', label: '계약 완료', group: '날', type: 'boolean', from: '인도완료', empty: false },
  { key: 'cancelled', label: '취소', group: '날', type: 'boolean', from: '취소', empty: false },
  { key: 'billMonth', label: '청구월', group: '날', type: 'string', from: '청구년/청구월', empty: '', note: '★이 줄이 «어느 달»에 서는가. 비면 어느 달에도 안 선다' },

  // ── 정산 축 ──────────────────────────────────────────
  { key: 'settleTarget', label: '정산 대상', group: '정산 축', type: 'string', from: '계약번호(메모)', empty: '양쪽', note: '양쪽 · 공급 · 영업' },
  { key: 'settleRatio', label: '정산 비율', group: '정산 축', type: 'number', from: '계약번호(메모)', empty: 1, note: '2회분납 1회차면 0.5' },
  { key: 'billHold', label: '청구보류', group: '정산 축', type: 'boolean', from: '계약번호(메모)', empty: false, note: '청구만 0 · 지급은 나간다' },
  { key: 'settleExclude', label: '보류', group: '정산 축', type: 'boolean', from: '계약번호(메모)', empty: false, note: '양쪽 다 0 — 당분간 안 센다' },
  { key: 'settledAlready', label: '정산 완료', group: '정산 축', type: 'boolean', from: '계약번호(메모)', empty: false },
  { key: 'vatIncluded', label: '부가세 포함', group: '정산 축', type: 'boolean', from: '계약번호(메모)', empty: false, note: '적힌 금액이 VAT 포함 — 낼 때 나눈다' },
  { key: 'settleNote', label: '산정 조건', group: '정산 축', type: 'string', from: '계약번호(메모)', empty: '', note: '축으로 옮긴 말을 «말로도» 남긴다' },

  // ── 상태 ─────────────────────────────────────────────
  { key: 'stage', label: '지금 어디', group: '상태', type: 'string', from: null, empty: '접수', note: '두 축을 모은 한 낱말 — 물으면 이걸 답한다' },
  { key: 'claimStage', label: '청구 축', group: '상태', type: 'string', from: null, empty: '접수', note: '접수→청구→확인→수금. 공급사에게 «받는» 길' },
  { key: 'payStage', label: '지급 축', group: '상태', type: 'string', from: null, empty: '접수', note: '접수→통보→확인→지급. 영업채널에 «주는» 길' },
  { key: 'billed', label: '청구서 나감', group: '상태', type: 'boolean', from: null, empty: false },
  { key: 'billedAt', label: '청구서 나간 날', group: '상태', type: 'string', from: null, empty: '' },
  { key: 'collected', label: '수금됨', group: '상태', type: 'boolean', from: '수금', empty: false, note: '공급사가 돈을 냈다' },
  { key: 'collectedAt', label: '수금한 날', group: '상태', type: 'string', from: null, empty: '' },
  { key: 'collectedAmt', label: '수금액', group: '상태', type: 'number', from: null, empty: 0, note: '일부만 들어올 수 있다 — 청구액과 다를 수 있다' },
  { key: 'paid', label: '지급됨', group: '상태', type: 'boolean', from: null, empty: false, note: '영업채널에 돈을 줬다' },
  { key: 'paidAt', label: '지급한 날', group: '상태', type: 'string', from: null, empty: '' },
  { key: 'paidAmt', label: '지급액(실제)', group: '상태', type: 'number', from: null, empty: 0 },
  { key: 'supplierOk', label: '공급사 확인', group: '상태', type: 'boolean', from: null, empty: false, note: '상대가 시트에서 켠 체크' },
  { key: 'supplierFix', label: '공급사 정정요청', group: '상태', type: 'boolean', from: null, empty: false },
  { key: 'supplierFixAmt', label: '공급사 정정금액', group: '상태', type: 'number', from: null, empty: 0 },
  { key: 'supplierMemo', label: '공급사 메모', group: '상태', type: 'string', from: null, empty: '' },
  { key: 'channelOk', label: '영업채널 확인', group: '상태', type: 'boolean', from: null, empty: false },
  { key: 'channelFix', label: '영업채널 정정요청', group: '상태', type: 'boolean', from: null, empty: false },
  { key: 'channelFixAmt', label: '영업채널 정정금액', group: '상태', type: 'number', from: null, empty: 0 },
  { key: 'channelMemo', label: '영업채널 메모', group: '상태', type: 'string', from: null, empty: '' },
  { key: 'stateAt', label: '상태 거둔 때', group: '상태', type: 'string', from: null, empty: '' },

  // ── 이월 ─────────────────────────────────────────────
  { key: 'carryNote', label: '다음 달에 할 말', group: '이월', type: 'string', from: '가감사유', empty: '', note: '계산서 수정·가감처럼 이 달에 못 끝낸 것' },
  { key: 'carryMonth', label: '넘길 달', group: '이월', type: 'string', from: null, empty: '' },

  // ── 출처 ─────────────────────────────────────────────
  { key: 'note', label: '비고', group: '출처', type: 'string', from: '계약번호', empty: '', note: '축으로 못 옮긴 말' },
  { key: 'sourceTab', label: '원천 탭', group: '출처', type: 'string', from: null, empty: '' },
  { key: 'sourceRow', label: '원천 줄', group: '출처', type: 'number', from: null, empty: 0 },
  { key: 'fromSheet', label: '올린 원천', group: '출처', type: 'string', from: null, empty: '', note: '묵은 줄을 걷을 때 «같은 원천 + 같은 달»로 가른다' },
  { key: 'createdAt', label: '처음 만든 때', group: '출처', type: 'number', from: null, empty: 0, note: '한 번 서면 안 바뀐다 — 언제부터 있던 줄인지' },
  { key: 'updatedAt', label: '올린 때', group: '출처', type: 'number', from: null, empty: 0 },
];

/**
 * ★★**일부러 «안 담는» 밭** — 지웠다가 누가 또 넣으면 안 되니 이유를 남긴다.
 * ```
 * phone · age         손님 연락처·나이. 정산은 «누가 얼마를 주고받나»만 알면 된다
 *                     (사장님 2026-09-08 「프리패스가 손님 연락처 취득할 이유 없음」)
 * agentPhone          영업자 연락처도 같은 이치 — 연락은 회원(members)에서 한다
 * clawback·clawback*  환수는 «별도 컬렉션»(settlement_clawbacks)이 든다. 두 곳에 두면 갈린다
 * contractNo          「계약번호」 칸의 말은 축(settleTarget·settleRatio…)과 note 가 이미 나른다
 * settleTerms         settleNote 로 갈음됐다 — 402줄 전부 빈 값이었다
 * paidRounds·paperBy·paperFee·region·upsell
 *                     원장에 칸은 있으나 정산이 안 쓴다. 쓰게 되면 그때 이 표에 적는다
 * ```
 */
export const ATOM_NOT_KEPT = ['phone', 'age', 'agentPhone', 'clawback', 'clawbackAmount', 'clawbackAt',
  'clawbackReason', 'contractNo', 'settleTerms', 'paidRounds', 'paperBy', 'paperFee', 'region', 'upsell'] as const;

/**
 * ★★★**정산 생애주기 — 접수부터 «돈 받은 것»까지.**
 *
 *   사장님 2026-09-08 「**청구까지 완료, 돈 받은 거까지 정산 생애주기를 관리**하면 되지」
 *
 * ★★**축이 둘이다.** 한 줄에서 우리는 공급사에게 «받고» 영업채널에 «준다».
 *   두 축은 따로 흐른다 — 공급사가 아직 안 냈는데 채널에는 이미 줬을 수 있다.
 *   한 낱말로 뭉치면 그 어긋남이 안 보인다.
 * ```
 * 청구 축(공급사)   접수 → 청구 → 확인 → 수금        ← 받는 길
 * 지급 축(영업채널) 접수 → 통보 → 확인 → 지급        ← 주는 길
 *
 * 곁길   보류(당분간 안 센다) · 취소(계약이 깨졌다) · 정정(상대가 다르다고 했다)
 * ```
 *
 * ★**「모른다」와 「아니다」를 가른다.** 수금·지급은 통장이 알려 준다 —
 *   아직 그 길이 안 뚫려 있으면 `collected`·`paid` 는 거짓이 아니라 «모름»이다.
 *   그래서 물으면 「아직」이라 답하지 「안 받았다」고 하지 않는다.
 */
export const CLAIM_STAGES = ['접수', '청구', '정정', '확인', '수금'] as const;
export const PAY_STAGES = ['접수', '통보', '정정', '확인', '지급'] as const;
export const OFF_STAGES = ['보류', '취소'] as const;

/** 두 축을 모아 «한 낱말»로. 곁길이 먼저 이기고, 그 다음은 «덜 간 쪽»이 그 줄의 지금이다. */
export function stageOf(claim: string, pay: string, off?: '보류' | '취소' | ''): string {
  if (off) return off;
  const rank = (s: string, order: readonly string[]) => {
    const i = order.indexOf(s);
    return i < 0 ? 0 : i;
  };
  /** 정정은 «멈춘» 것이라 어느 쪽이든 정정이면 그게 지금이다 — 우리가 볼 차례라는 뜻. */
  if (claim === '정정' || pay === '정정') return '정정';
  return rank(claim, CLAIM_STAGES) <= rank(pay, PAY_STAGES) ? claim : pay;
}

export const ATOM_KEYS = SETTLEMENT_FIELDS.map((f) => f.key);
export const atomField = (key: string) => SETTLEMENT_FIELDS.find((f) => f.key === key);
export const atomGroups = (): AtomGroup[] => [...new Set(SETTLEMENT_FIELDS.map((f) => f.group))];

/**
 * **규격대로 «모든 밭»을 갖춘 한 줄을 만든다.** 값이 없으면 규격이 정한 빈 값이 들어간다.
 * ⚠ 표 밖의 밭은 버린다 — 원자에 몰래 끼는 밭이 없어야 규격이 규격 노릇을 한다.
 */
export function shapeAtom(raw: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of SETTLEMENT_FIELDS) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === '') { out[f.key] = f.empty; continue; }
    out[f.key] = f.type === 'number' ? (Number(String(v).replace(/[,\s원]/g, '')) || 0)
      : f.type === 'boolean' ? v === true || v === 'TRUE' || v === 'true'
        : String(v).trim();
  }
  return out;
}
