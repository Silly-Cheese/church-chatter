import { customMailServiceEnabled, requestCustomPasswordReset } from "./mail-service.js";

function toast(title, message, type = "") {
  const root = document.querySelector("#toast-root");
  if (!root) return;
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = title;
  node.appendChild(strong);
  if (message) {
    const span = document.createElement("span");
    span.textContent = message;
    node.appendChild(span);
  }
  root.appendChild(node);
  window.setTimeout(() => node.remove(), 5200);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("#reset-password");
  if (!button || !customMailServiceEnabled()) return;

  // When the custom service is configured, intercept the older Firebase reset handler.
  event.preventDefault();
  event.stopImmediatePropagation();

  const email = document.querySelector("#auth-email")?.value?.trim();
  if (!email) {
    toast("Enter your email first", "Then choose Forgot password? again.");
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Sending…";

  try {
    await requestCustomPasswordReset(email);
    toast(
      "Check your email",
      "If an eligible Church Chatter account exists for that address, reset instructions are on the way.",
      "success"
    );
  } catch (error) {
    console.error("Church Chatter custom mail request failed", error);
    // Keep the public response deliberately generic. The server logs contain diagnostic detail.
    toast(
      "Check your email",
      "If an eligible Church Chatter account exists for that address, reset instructions are on the way.",
      "success"
    );
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}, true);
