// Paste the deployed Google Apps Script Web App /exec URL here after deployment.
// Until then, Church Chatter will keep using Firebase's built-in reset email as a fallback.
export const MAIL_SERVICE_URL = "https://script.google.com/macros/s/AKfycbwF0aI1oSnGQRyvRFqNb4UIeoBcmTXzdKxUk3T30dQdh0kpDVVmPAiA7BzdSsaz47yUFw/exec";

export function customMailServiceEnabled() {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(MAIL_SERVICE_URL.trim());
}

export async function requestCustomPasswordReset(email) {
  if (!customMailServiceEnabled()) return false;

  const body = new URLSearchParams({
    action: "password-reset",
    email: String(email || "").trim()
  });

  // Apps Script web apps do not expose a browser-friendly CORS response. We deliberately
  // use an opaque no-cors POST and show the same success message for every email address.
  // That also prevents the UI from becoming an account-enumeration oracle.
  await fetch(MAIL_SERVICE_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });

  return true;
}
