import { getAuthSession, isJwtExpired, clearAuthSession } from "./auth-session.js";

function redirectToHome() {
  window.location.replace("./index.html");
}

function ensureAuthorizedSession() {
  const session = getAuthSession();
  if (!session) {
    redirectToHome();
    return;
  }

  const idToken = String(session.idToken || "").trim();
  const email = String(session.email || "").trim();
  const status = Number(session.status || 0);

  if (!idToken || !email || status !== 1 || isJwtExpired(idToken)) {
    clearAuthSession();
    redirectToHome();
  }
}

function wireSignoutCleanup() {
  const signoutLink = document.querySelector(".settings-item.signout");
  if (!signoutLink) {
    return;
  }
  signoutLink.addEventListener("click", () => {
    clearAuthSession();
  });
}

ensureAuthorizedSession();
wireSignoutCleanup();
