import {
  authStorageKeys,
  cognitoAuthConfig,
  configLooksReady,
  getCallbackUrl,
} from "./auth-config.js";

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomUrlSafeString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

async function createPkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

export async function startCognitoLogin() {
  if (!configLooksReady()) {
    throw new Error(
      "Cognito config is not ready. Update auth-config.js with your Cognito domain and app client ID."
    );
  }

  const state = randomUrlSafeString(32);
  const codeVerifier = randomUrlSafeString(96);
  const codeChallenge = await createPkceChallenge(codeVerifier);

  sessionStorage.setItem(authStorageKeys.state, state);
  sessionStorage.setItem(authStorageKeys.codeVerifier, codeVerifier);

  const authorizeUrl = new URL(`${cognitoAuthConfig.domain}/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", cognitoAuthConfig.responseType);
  authorizeUrl.searchParams.set("client_id", cognitoAuthConfig.clientId);
  authorizeUrl.searchParams.set("redirect_uri", getCallbackUrl());
  authorizeUrl.searchParams.set("scope", cognitoAuthConfig.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);

  if (cognitoAuthConfig.identityProvider) {
    authorizeUrl.searchParams.set("identity_provider", cognitoAuthConfig.identityProvider);
  }

  window.location.assign(authorizeUrl.toString());
}

export function bindCognitoLoginTrigger(element) {
  if (!element) {
    return;
  }

  element.addEventListener("click", (event) => {
    event.preventDefault();
    void startCognitoLogin().catch((error) => {
      alert(error instanceof Error ? error.message : String(error));
    });
  });
}
