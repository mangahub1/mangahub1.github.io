import { bindCognitoLoginTrigger } from "./auth/auth-login.js";

const ctaSelectors = [".login-btn", ".hero-cta", ".join-cta"];

ctaSelectors.forEach((selector) => {
  const element = document.querySelector(selector);
  bindCognitoLoginTrigger(element);
});

