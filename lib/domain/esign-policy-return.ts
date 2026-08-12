export const ESIGN_POLICY_DRAFT_SESSION_KEY = 'fp4:esign:policy-draft:v1';
export const ESIGN_POLICY_SELECTION_SESSION_KEY = 'fp4:esign:policy-selection:v1';

export interface EsignPolicySelection {
  providerCompanyCode: string;
  policyCode: string;
}
