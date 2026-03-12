export const cognitoAuthConfig = {
  domain: "https://us-east-1xapalpoxy.auth.us-east-1.amazoncognito.com",
  clientId: "4kouds34d4k125an6q7pd6gbmo",
  scopes: ["openid", "email", "profile"],
  responseType: "code",
  // Optional, for direct provider selection with Hosted UI (for example: Google).
  identityProvider: "Google",
};

export const appAuthzConfig = {
  validateUserEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/auth/validate",
  getUsersEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-users",
  updateUserEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/update-user",
  getMangaEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-manga",
  updateMangaEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/update-manga",
  getMangaUploadUrlEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-manga-upload-url",
  getMangaContentEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-manga-content",
  updateMangaContentEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/update-manga-content",
  getMangaContentUploadUrlEndpoint:
    "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-manga-content-upload-url",
};

export const appUploadConfig = {
  mangaCoverMaxUploadBytes: 3 * 1024 * 1024,
};

export const authStorageKeys = {
  codeVerifier: "blupetal.auth.pkce_verifier",
  state: "blupetal.auth.state",
  session: "blupetal.auth.session",
};

export function getCallbackUrl() {
  return `${window.location.origin}/auth/callback.html`;
}

export function getPostLoginUrl() {
  return `${window.location.origin}/library.html`;
}

export function configLooksReady() {
  const domain = String(cognitoAuthConfig.domain || "").trim();
  const clientId = String(cognitoAuthConfig.clientId || "").trim();
  return (
    domain.startsWith("https://") &&
    !domain.includes("YOUR_COGNITO_DOMAIN") &&
    clientId.length > 0 &&
    !clientId.includes("YOUR_APP_CLIENT_ID")
  );
}

export function authzConfigLooksReady() {
  const validateUserEndpoint = String(appAuthzConfig.validateUserEndpoint || "").trim();
  return (
    validateUserEndpoint.startsWith("https://") &&
    !validateUserEndpoint.includes("YOUR_VALIDATE_USER_API_ENDPOINT")
  );
}

export function adminApiConfigLooksReady() {
  const getUsersEndpoint = String(appAuthzConfig.getUsersEndpoint || "").trim();
  const updateUserEndpoint = String(appAuthzConfig.updateUserEndpoint || "").trim();
  return getUsersEndpoint.startsWith("https://") && updateUserEndpoint.startsWith("https://");
}

export function mangaApiConfigLooksReady() {
  const getEndpoint = String(appAuthzConfig.getMangaEndpoint || "").trim();
  const updateEndpoint = String(appAuthzConfig.updateMangaEndpoint || "").trim();
  return getEndpoint.startsWith("https://") && updateEndpoint.startsWith("https://");
}

export function mangaUploadApiConfigLooksReady() {
  const uploadEndpoint = String(appAuthzConfig.getMangaUploadUrlEndpoint || "").trim();
  return uploadEndpoint.startsWith("https://");
}

export function mangaContentApiConfigLooksReady() {
  const getEndpoint = String(appAuthzConfig.getMangaContentEndpoint || "").trim();
  const updateEndpoint = String(appAuthzConfig.updateMangaContentEndpoint || "").trim();
  return getEndpoint.startsWith("https://") && updateEndpoint.startsWith("https://");
}

export function mangaContentUploadApiConfigLooksReady() {
  const uploadEndpoint = String(appAuthzConfig.getMangaContentUploadUrlEndpoint || "").trim();
  return uploadEndpoint.startsWith("https://");
}
