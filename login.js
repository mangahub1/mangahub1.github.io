import { bindCognitoLoginTrigger, startCognitoLogin } from "./auth-login.js";

const loginLink = document.getElementById("cognitoLoginLink");

bindCognitoLoginTrigger(loginLink);

// Streamline old route: visiting login.html now auto-starts Hosted UI.
void startCognitoLogin().catch(() => {
  // Ignore here; manual click remains available and surfaces the exact error.
});
