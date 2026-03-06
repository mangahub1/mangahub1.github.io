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
  getJwtGivenName,
  getJwtName,
  getJwtPicture,
  isJwtExpired,
  saveAuthSession,
} from "./auth-session.js";

const statusEl = document.getElementById("status");
const messageEl = document.getElementById("message");
const actionsEl = document.getElementById("actions");
const logoOrbitEl = document.querySelector(".logo-orbit");
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

function stopProgressAnimation() {
  logoOrbitEl?.classList.add("is-static");
}

function showFailureActions() {
  if (actionsEl) {
    actionsEl.classList.remove("hidden");
  }
  if (continueBtn) {
    continueBtn.classList.add("hidden");
  }
}

function showPendingActions() {
  if (actionsEl) {
    actionsEl.classList.remove("hidden");
  }
  if (continueBtn) {
    continueBtn.classList.add("hidden");
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

async function validateUserPermission({ email, name, given_name, image, accessToken }) {
  const endpoint = appAuthzConfig.validateUserEndpoint;
  const payload = {};
  if (email) {
    payload.email = email;
  }
  if (name) {
    payload.name = name;
  }
  if (given_name) {
    payload.given_name = given_name;
  }
  if (image) {
    payload.image = image;
  }
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
    const nameFromIdToken = getJwtName(idToken);
    const givenNameFromIdToken = getJwtGivenName(idToken);
    const imageFromIdToken = getJwtPicture(idToken);

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
    let validation;
    try {
      validation = await validateUserPermission({
        email: emailFromIdToken,
        name: nameFromIdToken,
        given_name: givenNameFromIdToken,
        image: imageFromIdToken,
        accessToken,
      });
    } finally {
      stopProgressAnimation();
    }

    const user = validation?.user || {};
    const email = String(user?.email || emailFromIdToken || "").trim();
    const givenName = String(user?.given_name || givenNameFromIdToken || "").trim();
    const image = String(user?.image || imageFromIdToken || "").trim();
    const role = String(user?.role || "").trim();
    const admin = Number(user?.admin ?? 0);
    sessionStorage.removeItem(authStorageKeys.state);
    sessionStorage.removeItem(authStorageKeys.codeVerifier);
    const status = Number(user?.status ?? 0);
    const isApproved = Boolean(validation?.isApproved || status === 1);

    if (isApproved) {
      const isAdmin = Boolean(validation?.isAdmin || role.toLowerCase() === "admin");
      saveAuthSession({
        email,
        idToken,
        accessToken,
        refreshToken,
        role,
        admin,
        givenName,
        image,
        status: 1,
        isAdmin,
        expiresAt: getJwtExpiry(idToken),
        validatedAt: new Date().toISOString(),
      });
      setStatus("Access granted");
      setMessage("Your account is approved. Redirecting to the library...");
      continueToLibrary();
      return;
    }

    clearAuthSession();
    if (status === -1) {
      setStatus("Access request received");
      setMessage(
        "Your request to access BluPetal is pending review. You will be granted library access once approved."
      );
      showPendingActions();
      return;
    }

    if (status === 0) {
      setStatus("Account disabled");
      setMessage("This account has been disabled. Contact support if you believe this is an error.");
      showFailureActions();
      return;
    }

    setStatus("Access unavailable");
    setMessage("Your account is not currently approved for library access.");
    showFailureActions();
  } catch (error) {
    markFailure("Validation failed", error instanceof Error ? error.message : String(error));
  }
}

void handleCognitoCallback();
