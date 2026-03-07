export const cognitoAuthConfig = {
  // Example: https://your-domain.auth.us-east-1.amazoncognito.com
  domain: "https://us-east-1xapalpoxy.auth.us-east-1.amazoncognito.com",
  // Example: 4m1e5ampleclientid123456
  clientId: "4kouds34d4k125an6q7pd6gbmo",
  scopes: ["openid", "email", "profile"],
  responseType: "code",
  // Optional, for direct provider selection with Hosted UI (for example: Google).
  identityProvider: "Google",
};

export const appAuthzConfig = {
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/auth/validate
  validateUserEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/validate-user",
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/admin/get-users
  getUsersEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-users",
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/admin/update-user
  updateUserEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/update-user",
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/admin/get-content
  getContentEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-content",
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/admin/update-content
  updateContentEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/update-content",
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/admin/get-content-upload-url
  getContentUploadUrlEndpoint: "https://jzijf1gjj8.execute-api.us-east-1.amazonaws.com/get-content-upload-url",
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

export function contentApiConfigLooksReady() {
  const getContentEndpoint = String(appAuthzConfig.getContentEndpoint || "").trim();
  const updateContentEndpoint = String(appAuthzConfig.updateContentEndpoint || "").trim();
  return getContentEndpoint.startsWith("https://") && updateContentEndpoint.startsWith("https://");
}

export function contentUploadApiConfigLooksReady() {
  const getContentUploadUrlEndpoint = String(appAuthzConfig.getContentUploadUrlEndpoint || "").trim();
  return getContentUploadUrlEndpoint.startsWith("https://");
}
