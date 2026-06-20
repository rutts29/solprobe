export const API_KEY_STORAGE = "solprobe-api-key";
export const API_KEY_HEADER = "X-SolProbe-API-Key";
export const AUTH_CHANGED_EVENT = "solprobe-auth-changed";

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(API_KEY_STORAGE)?.trim();
  return value || null;
}

export function setStoredApiKey(apiKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(API_KEY_STORAGE, apiKey.trim());
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearStoredApiKey(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(API_KEY_STORAGE);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function authHeaders(): Record<string, string> {
  const apiKey = getStoredApiKey();
  return apiKey ? { [API_KEY_HEADER]: apiKey } : {};
}

export function withApiKey(url: string): string {
  const apiKey = getStoredApiKey();
  if (!apiKey || typeof window === "undefined") return url;
  const next = new URL(url, window.location.href);
  next.searchParams.set("api_key", apiKey);
  return next.toString();
}
