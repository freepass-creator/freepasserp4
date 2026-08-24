/**
 * **프리패스 정산원장 — 계약 한 건이 한 줄.**
 *
 * ★사장님 2026-08-24 「정산시트 입력을 계약금 들어온 거 차량번호만 올리면 알아서 계약중으로 바뀌는 거지」
 *   팀장이 넣는 것은 **차량번호 하나**다. 나머지는 두 갈래로 찬다 —
 *   ① 시트 수식(「_상품」·「수수료표」에서 끌어옴) ② `sync-contract-from-ledger`(상태·접수일·정산월 + 공급사 시트)
 *
 * ⚠ 사장님 «개인 내 드라이브»에 있다(2026-08-21 aiops 가 만듦). 옛 51열·월별 40탭 → 38열 한 탭.
 *   「이 시트는」 탭은 「직원이 입력」이라 적혀 있는데 만든 뒤 아무에게도 안 열려 있었다 —
 *   **보는 권한은 사장님이 직접 주신다.**
 */
export const SETTLEMENT_LEDGER_ID = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
export const SETTLEMENT_LEDGER_TAB = '정산';
/** 새 줄로 알아보는 조건 — 차번이 있고 상태가 비어 있다. 상태가 적힌 줄은 팀장이 정한 것이다. */
export const SETTLEMENT_CONTRACT_STATE = '계약중';
