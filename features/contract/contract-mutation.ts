/**
 * 계약 엔진은 체크/상태를 먼저 저장한 뒤 정산·차량 잠금에서 실패할 수 있다.
 * 성공 여부와 무관하게 최신 계약을 다시 읽고 전역 카운터를 갱신해,
 * 부분 성공 상태(5/5 완료처리 대기·취소 등)를 화면에 즉시 드러낸다.
 */
export async function runContractMutation(
  mutate: () => Promise<void>,
  reload: () => Promise<void>,
  notify: () => void,
): Promise<void> {
  let failure: unknown;
  let failed = false;

  try {
    await mutate();
  } catch (error) {
    failure = error;
    failed = true;
  }

  try {
    await reload();
  } catch (error) {
    if (!failed) {
      failure = error;
      failed = true;
    }
  }

  try {
    notify();
  } catch (error) {
    if (!failed) {
      failure = error;
      failed = true;
    }
  }

  if (failed) throw failure;
}
