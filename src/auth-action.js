import { auth } from "./firebase.js";
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  sendPasswordResetEmail,
  verifyPasswordResetCode
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const code = params.get("oobCode");
const continueUrl = params.get("continueUrl");
const card = document.querySelector("#auth-action-card");

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function appUrl() {
  try {
    if (continueUrl) {
      const url = new URL(continueUrl);
      if (url.origin === window.location.origin) return url.href;
    }
  } catch (_) {}
  return new URL("./", window.location.href).href;
}

function errorText(error) {
  const codeValue = error?.code || "";
  if (codeValue.includes("expired-action-code")) return "This security link has expired. Request a new one and try again.";
  if (codeValue.includes("invalid-action-code")) return "This security link is invalid or has already been used.";
  if (codeValue.includes("weak-password")) return "Choose a stronger password with at least 6 characters.";
  if (codeValue.includes("user-disabled")) return "This account is currently disabled.";
  if (codeValue.includes("user-not-found")) return "This account could not be found.";
  return "We could not complete that account action. Request a new link and try again.";
}

function showError(message) {
  card.innerHTML = `<div class="status-icon error">!</div><p class="eyebrow">Link unavailable</p><h1>We couldn't complete that.</h1><p class="supporting">${esc(message)}</p><div class="actions"><a class="btn btn-primary" href="${esc(appUrl())}">Return to Church Chatter</a></div>`;
}

function showSuccess(title, body) {
  card.innerHTML = `<div class="status-icon">✓</div><p class="eyebrow">Account secured</p><h1>${esc(title)}</h1><p class="supporting">${esc(body)}</p><div class="actions"><a class="btn btn-primary" href="${esc(appUrl())}">Continue to Church Chatter</a></div>`;
}

async function handleResetPassword() {
  const email = await verifyPasswordResetCode(auth, code);
  card.innerHTML = `<p class="eyebrow">Password reset</p><h1>Choose a new password.</h1><p class="supporting">Create a new password for your Church Chatter account.</p><div class="secure-email">${esc(email)}</div><form class="form" id="reset-form"><div class="field"><label for="password">New password</label><input id="password" name="password" type="password" minlength="6" autocomplete="new-password" required><span class="help">Use at least 6 characters. A longer, unique password is better.</span></div><div class="field"><label for="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" minlength="6" autocomplete="new-password" required></div><div id="form-error" class="error-box" hidden></div><div class="actions"><button class="btn btn-primary" type="submit">Reset password</button><a class="btn btn-secondary" href="${esc(appUrl())}">Cancel</a></div></form>`;
  const form = document.querySelector("#reset-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    const errorBox = form.querySelector("#form-error");
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirm = String(data.get("confirm") || "");
    errorBox.hidden = true;
    if (password !== confirm) {
      errorBox.textContent = "The passwords do not match.";
      errorBox.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "Resetting…";
    try {
      await confirmPasswordReset(auth, code, password);
      showSuccess("Your password is changed.", "You can now sign in to Church Chatter with your new password.");
    } catch (error) {
      errorBox.textContent = errorText(error);
      errorBox.hidden = false;
      button.disabled = false;
      button.textContent = "Reset password";
    }
  });
}

async function handleVerifyEmail() {
  await applyActionCode(auth, code);
  showSuccess("Your email is verified.", "Your Church Chatter account is ready to use with this verified email address.");
}

async function handleRecoverEmail() {
  const info = await checkActionCode(auth, code);
  const restoredEmail = info?.data?.email;
  await applyActionCode(auth, code);
  if (restoredEmail) {
    try { await sendPasswordResetEmail(auth, restoredEmail); } catch (_) {}
  }
  showSuccess("Your email has been restored.", restoredEmail ? "For security, we've also sent a password reset message to the restored email address." : "Your account email change has been reversed.");
}

async function handleVerifyBeforeChangeEmail() {
  await applyActionCode(auth, code);
  showSuccess("Your new email is verified.", "The email address on your Church Chatter account has been updated.");
}

async function start() {
  if (!mode || !code) return showError("This link is missing required security information.");
  try {
    if (mode === "resetPassword") return await handleResetPassword();
    if (mode === "verifyEmail") return await handleVerifyEmail();
    if (mode === "recoverEmail") return await handleRecoverEmail();
    if (mode === "verifyAndChangeEmail") return await handleVerifyBeforeChangeEmail();
    showError("This account action is not supported by this Church Chatter page.");
  } catch (error) {
    showError(errorText(error));
  }
}

start();
