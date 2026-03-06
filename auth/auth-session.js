import { authStorageKeys } from "./auth-config.js";

function parseJwtPayload(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);

  try {
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function getEpochNow() {
  return Math.floor(Date.now() / 1000);
}

export function isJwtExpired(token, skewSeconds = 30) {
  const payload = parseJwtPayload(token);
  const exp = Number(payload?.exp || 0);
  if (!exp) {
    return true;
  }
  return getEpochNow() >= exp - skewSeconds;
}

export function getJwtEmail(token) {
  const payload = parseJwtPayload(token);
  return String(payload?.email || "").trim();
}

export function getJwtName(token) {
  const payload = parseJwtPayload(token);
  return String(payload?.name || "").trim();
}

export function getJwtGivenName(token) {
  const payload = parseJwtPayload(token);
  return String(payload?.given_name || "").trim();
}

export function getJwtPicture(token) {
  const payload = parseJwtPayload(token);
  return String(payload?.picture || payload?.image || "").trim();
}

export function getJwtExpiry(token) {
  const payload = parseJwtPayload(token);
  const exp = Number(payload?.exp || 0);
  return Number.isFinite(exp) && exp > 0 ? exp : 0;
}

export function clearAuthSession() {
  sessionStorage.removeItem(authStorageKeys.session);
}

export function saveAuthSession(session) {
  sessionStorage.setItem(authStorageKeys.session, JSON.stringify(session));
}

export function getAuthSession() {
  const raw = sessionStorage.getItem(authStorageKeys.session);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
