const S = (v: unknown) => String(v ?? '').trim();

/** 공급사 「옵션」 한 칸을 판매 선택옵션과 표준장비로 의미 분리한다. */
export function splitSourceOption(providerCode: unknown, raw: unknown): { options: string; standardEquipment: string } {
  const value = S(raw);
  const items = value.split(/[,\n]/).map(S).filter(Boolean);
  const autoplusStandard = S(providerCode) === 'RP023'
    && items.length >= 40
    && /에어백/.test(value)
    && /(ABS|잠김 방지)/i.test(value)
    && /(열선시트|전동시트|가죽 시트)/.test(value);
  return autoplusStandard
    ? { options: '', standardEquipment: value }
    : { options: value, standardEquipment: '' };
}
