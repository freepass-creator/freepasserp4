import { companyAlias } from '@/lib/domain/identity';

const S = (value: unknown) => String(value ?? '').trim();

/** 채널시트 한 회사 탭으로 합치는 관계사 규칙. 발행과 사후감사가 같은 함수를 쓴다. */
const CHANNEL_COMPANY_FAMILY: Readonly<Record<string, string>> = {
  경진카: '경진', 경진렌트카: '경진', 경진렌트: '경진',
  스타: '스타스카이', 스카이: '스타스카이', 스카이렌트카: '스타스카이', 스타렌트카: '스타스카이',
};

export function channelCompanyOf(raw: unknown, nameByProvider: ReadonlyMap<string, string>): string {
  const source = S(raw);
  const named = /^(RP|PT)[-_]?\d+/i.test(source) ? (nameByProvider.get(source) || source) : source;
  const canonical = companyAlias(named) || named;
  return CHANNEL_COMPANY_FAMILY[canonical] || canonical;
}
