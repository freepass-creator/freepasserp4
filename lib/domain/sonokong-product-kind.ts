export type SonokongProductKind = '중고렌트' | '오공구독' | '픽업구독' | '중고구독' | '';

/** 요청한 손오공 화면 버킷이 상품 갈래의 정본이다. */
export function sonokongProductKind(input: {
  sourceBucket?: unknown;
  responseBucket?: unknown;
  used?: unknown;
}): SonokongProductKind {
  const source = String(input.sourceBucket || '').trim();
  if (source === 'LOW_SONOKONG_DAILY') return '중고렌트';
  if (source === 'LOW_SONOKONG') return '오공구독';
  if (source === 'LOW_TCAR') return '픽업구독';

  // 과거 덤프 호환. 신규 덤프는 반드시 sourceBucket을 보존한다.
  const response = String(input.responseBucket || '').trim();
  if (response === 'TCAR_EXTERNAL') return '픽업구독';
  if (response === 'SON_NO_KONG') return '오공구독';
  return input.used === true ? '중고구독' : '';
}
