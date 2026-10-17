import { ApiError, trustedHttpsUrl } from "./config";
export interface User { id: string; email: string }
export async function verifyUser(request: Request): Promise<User> {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ") || token.length > 10000) throw new ApiError(401, "Sign in to access Pro features.");
  const base = trustedHttpsUrl(process.env.SUPABASE_URL).href.replace(/\/$/, "");
  const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY || "", Authorization: token }, signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error" });
  if (!response.ok) throw new ApiError(401, "Your session has expired. Sign in again.");
  const user = await response.json();
  if (!/^[a-f\d-]{36}$/i.test(user.id || "") || !user.email_confirmed_at) throw new ApiError(401, "Confirm your account email before using Pro.");
  return { id: user.id, email: user.email };
}
export async function authenticate(data: unknown, register: boolean) {
  const value = data as { email?: unknown; password?: unknown };
  if (typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254 || typeof value.password !== "string" || value.password.length > 128 || value.password.length < (register ? 12 : 1)) throw new ApiError(400, "Enter a valid email and password. New passwords need at least 12 characters.");
  const base = trustedHttpsUrl(process.env.SUPABASE_URL).href.replace(/\/$/, "");
  const response = await fetch(`${base}/auth/v1/${register ? "signup" : "token?grant_type=password"}`, { method: "POST", headers: { apikey: process.env.SUPABASE_ANON_KEY || "", "Content-Type": "application/json" }, body: JSON.stringify({ email: value.email, password: value.password }), redirect: "error", signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 401, register ? "Account creation could not be completed. Check the email, password policy, and authentication configuration." : "Sign-in failed. Check your email, password, and email confirmation.");
  return { accessToken: result.access_token || null, message: "Check your email to confirm your account, then sign in." };
}
