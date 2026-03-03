import {
  appAuthzConfig,
  authzConfigLooksReady,
  authStorageKeys,
  cognitoAuthConfig,
  configLooksReady,
  getCallbackUrl,
  getPostLoginUrl,
} from "./auth-config.js";
import {
  clearAuthSession,
  getJwtEmail,
  getJwtExpiry,
  isJwtExpired,
  saveAuthSession,
} from "./auth-session.js";

const statusEl = document.getElementById("status");
const messageEl = document.getElementById("message");
const actionsEl = document.getElementById("actions");
const continueBtn = document.getElementById("continueBtn");
const returnHomeBtn = document.getElementById("returnHomeBtn");
const retryBtn = document.getElementById("retryBtn");

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function setMessage(text) {
  if (messageEl) {
    messageEl.textContent = text;
  }
}

function showFailureActions() {
  if (actionsEl) {
    actionsEl.classList.remove("hidden");
  }
  if (continueBtn) {
    continueBtn.classList.add("hidden");
  }
}

function showSuccessActions() {
  if (actionsEl) {
    actionsEl.classList.remove("hidden");
  }
  if (continueBtn) {
    continueBtn.classList.remove("hidden");
  }
}

function goHome() {
  window.location.replace(`${window.location.origin}/index.html`);
}

function restartLogin() {
  window.location.replace(`${window.location.origin}/login.html`);
}

async function exchangeAuthorizationCodeForTokens(code, codeVerifier) {
  const tokenEndpoint = `${cognitoAuthConfig.domain}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cognitoAuthConfig.clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: getCallbackUrl(),
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}). ${raw}`);
  }

  return JSON.parse(raw);
}

async function validateUserPermission({ email, accessToken }) {
  const endpoint = appAuthzConfig.validateUserEndpoint;
  const payload = email ? { email } : {};
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Authorization API failed (${response.status}). ${raw}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true, raw };
  }
}

function markFailure(status, message) {
  setStatus(status);
  setMessage(message);
  clearAuthSession();
  showFailureActions();
}

function continueToLibrary() {
  window.location.replace(getPostLoginUrl());
}

async function handleCognitoCallback() {
  continueBtn?.addEventListener("click", continueToLibrary);
  returnHomeBtn?.addEventListener("click", goHome);
  retryBtn?.addEventListener("click", restartLogin);

  if (!configLooksReady() || !authzConfigLooksReady()) {
    markFailure(
      "Configuration incomplete",
      "Update auth-config.js with Cognito and API endpoint settings."
    );
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const errorDescription = params.get("error_description");
  const code = params.get("code");
  const state = params.get("state");

  if (error) {
    markFailure(
      "Sign-in error",
      `Cognito returned ${error}. ${errorDescription || "Please try again."}`
    );
    return;
  }

  if (!code) {
    markFailure("Missing authorization code", "Please start sign-in again.");
    return;
  }

  const expectedState = sessionStorage.getItem(authStorageKeys.state);
  const codeVerifier = sessionStorage.getItem(authStorageKeys.codeVerifier);

  if (!expectedState || !codeVerifier) {
    markFailure(
      "Session validation failed",
      "PKCE state was not found in this browser session. Start login again."
    );
    return;
  }

  if (state !== expectedState) {
    markFailure("Security check failed", "State validation failed. Start login again.");
    return;
  }

  try {
    setStatus("Completing sign in");
    setMessage("Exchanging secure login code...");
    const tokenResponse = await exchangeAuthorizationCodeForTokens(code, codeVerifier);
    const idToken = String(tokenResponse.id_token || "").trim();
    const accessToken = String(tokenResponse.access_token || "").trim();
    const refreshToken = String(tokenResponse.refresh_token || "").trim();
    const emailFromIdToken = getJwtEmail(idToken);

    if (!idToken) {
      throw new Error("ID token is missing.");
    }
    if (isJwtExpired(idToken)) {
      throw new Error("ID token is expired.");
    }

    if (!accessToken) {
      throw new Error("Access token is missing.");
    }

    setStatus("Validating access");
    setMessage("Checking your BluPetal account permissions...");
    const validation = await validateUserPermission({ email: emailFromIdToken, accessToken });

    const user = validation?.user || {};
    const email = String(user?.email || emailFromIdToken || "").trim();
    const role = String(user?.role || "").trim();
    const isAdmin = Boolean(validation?.isAdmin || role.toLowerCase() === "admin");

    saveAuthSession({
      email,
      idToken,
      accessToken,
      refreshToken,
      role,
      status: 1,
      isAdmin,
      expiresAt: getJwtExpiry(idToken),
      validatedAt: new Date().toISOString(),
    });

    sessionStorage.removeItem(authStorageKeys.state);
    sessionStorage.removeItem(authStorageKeys.codeVerifier);

    setStatus("Access granted");
    setMessage("API validated the token. You can proceed to the library.");
    alert("API validated the token and the user can proceed to the library.");
    showSuccessActions();
  } catch (error) {
    markFailure("Validation failed", error instanceof Error ? error.message : String(error));
  }
}

void handleCognitoCallback();
