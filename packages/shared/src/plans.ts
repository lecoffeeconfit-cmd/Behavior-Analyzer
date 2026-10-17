export const FREE_FEATURES = ["Local uploads & video inspection", "Face, eye & body landmarks", "Movement, audio & lighting charts", "Captions, timeline & annotated frames", "Evidence-based authenticity inspection", "Searchable local history & JSON export"] as const;
export const PRO_FEATURES = ["Cloud explanations & event questions", "Compare up to 3 local reports", "Detailed downloadable HTML reports", "Monthly allowance with server-enforced limits"] as const;
export const DEFAULT_PLAN = { name: "Pro", monthlyPriceCents: 299, currency: "USD", monthlyCredits: 60, requestCredits: 1 };
export interface Entitlement {
  configured: boolean; billingReady: boolean; authenticated: boolean; tier: "free" | "pro";
  monthlyPriceCents: number; currency: string; allowance: number; used: number; remaining: number;
  requestCredits: number; estimatedMaxCostCents: number; renewsAt: string | null;
  capabilities: string[];
  processingBudgetRemainingCents?: number;
}
export const OFFLINE_ENTITLEMENT: Entitlement = { configured: false, billingReady: false, authenticated: false, tier: "free", monthlyPriceCents: 299, currency: "USD", allowance: 0, used: 0, remaining: 0, requestCredits: 1, estimatedMaxCostCents: 0, renewsAt: null, capabilities: [] };
