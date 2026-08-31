const CHURCH_CHATTER = Object.freeze({
  PROJECT_ID: 'church-chattrd',
  APP_URL: 'https://silly-cheese.github.io/church-chatter/',
  ACTION_HANDLER_URL: 'https://silly-cheese.github.io/church-chatter/auth-action.html',
  SENDER_NAME: 'Church Chatter',
  REPLY_TO: '',
  PER_EMAIL_COOLDOWN_SECONDS: 75,
  GLOBAL_WINDOW_SECONDS: 600,
  GLOBAL_WINDOW_LIMIT: 120
});

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || '').toLowerCase();
  if (action === 'health') {
    return json_({ ok: true, service: 'Church Chatter Mail Service' });
  }
  return json_({ ok: true });
}

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || '').toLowerCase();
    const email = normalizeEmail_(params.email);

    if (action !== 'password-reset' || !email) {
      return genericResponse_();
    }

    if (!allowRequest_(email)) {
      return genericResponse_();
    }

    const resetLink = generatePasswordResetLink_(email);
    if (resetLink) sendPasswordResetEmail_(email, resetLink);
  } catch (error) {
    console.error('Church Chatter mail request failed', error && error.stack ? error.stack : error);
  }

  // Deliberately identical for valid users, unknown users, throttled requests, and errors.
  return genericResponse_();
}

/**
 * MANUAL DIAGNOSTIC #1
 * Run this directly from the Apps Script editor first.
 * Set a private Script Property named TEST_EMAIL before running it.
 * This proves MailApp permission/quota without involving Firebase.
 */
function testMailOnly() {
  const email = getTestEmail_();

  MailApp.sendEmail({
    to: email,
    subject: 'Church Chatter mail test',
    body: 'Church Chatter MailApp is working. This test does not use Firebase.',
    htmlBody: '<div style="font-family:Arial,sans-serif;padding:24px"><h2 style="color:#16352f">Church Chatter</h2><p>MailApp is working correctly.</p><p>This test did not use Firebase Authentication.</p></div>',
    name: CHURCH_CHATTER.SENDER_NAME
  });

  console.log('Mail-only test sent to ' + email + '. Remaining daily quota: ' + MailApp.getRemainingDailyQuota());
}

/**
 * MANUAL DIAGNOSTIC #2
 * Run this after testMailOnly succeeds.
 * Set TEST_EMAIL to an address that exists in Firebase Authentication with Email/Password.
 */
function testPasswordResetFlow() {
  const email = getTestEmail_();

  console.log('Testing Firebase password-reset link generation for ' + email + '…');
  const resetLink = generatePasswordResetLink_(email);

  if (!resetLink) {
    throw new Error('Firebase did not find an eligible email/password account for ' + email + '. Use an address that exists in Firebase Authentication with the Email/Password provider.');
  }

  console.log('Firebase reset link generated successfully. Sending Church Chatter email…');
  sendPasswordResetEmail_(email, resetLink);
  console.log('Full password-reset test sent successfully to ' + email + '.');
}

/**
 * Optional quick diagnostic that does not send anything.
 */
function diagnosticStatus() {
  const properties = PropertiesService.getScriptProperties();
  console.log(JSON.stringify({
    projectId: CHURCH_CHATTER.PROJECT_ID,
    testEmailConfigured: Boolean(normalizeEmail_(properties.getProperty('TEST_EMAIL'))),
    remainingDailyMailQuota: MailApp.getRemainingDailyQuota()
  }));
}

function getTestEmail_() {
  const value = PropertiesService.getScriptProperties().getProperty('TEST_EMAIL');
  const email = normalizeEmail_(value);
  if (!email) {
    throw new Error('Set a Script Property named TEST_EMAIL to the address you want to test. Apps Script → Project Settings → Script properties.');
  }
  return email;
}

function generatePasswordResetLink_(email) {
  // The privileged returnOobLink flow must use the project-scoped Identity Toolkit endpoint.
  const endpoint = 'https://identitytoolkit.googleapis.com/v1/projects/'
    + encodeURIComponent(CHURCH_CHATTER.PROJECT_ID)
    + '/accounts:sendOobCode';

  const payload = {
    requestType: 'PASSWORD_RESET',
    email: email,
    continueUrl: CHURCH_CHATTER.APP_URL,
    returnOobLink: true
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const raw = response.getContentText() || '{}';
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch (_) {}

  if (status >= 200 && status < 300 && body.oobLink) {
    return rewriteActionLink_(body.oobLink);
  }

  const message = String(body && body.error && body.error.message || raw || 'Unknown Identity Toolkit error');
  if (message.includes('EMAIL_NOT_FOUND') || message.includes('USER_NOT_FOUND')) {
    return null;
  }

  throw new Error('Firebase action-link request failed (' + status + '): ' + message);
}

function rewriteActionLink_(firebaseLink) {
  const queryIndex = firebaseLink.indexOf('?');
  if (queryIndex === -1) throw new Error('Firebase returned an invalid action link.');
  return CHURCH_CHATTER.ACTION_HANDLER_URL + firebaseLink.substring(queryIndex);
}

function sendPasswordResetEmail_(email, resetLink) {
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('Apps Script email quota is exhausted for today.');
  }

  const subject = 'Reset your Church Chatter password';
  const plainText = [
    'Church Chatter',
    '',
    'Reset your password',
    '',
    'We received a request to reset the password for your Church Chatter account.',
    '',
    'Reset your password:',
    resetLink,
    '',
    'If you did not request this, you can safely ignore this message. Your password will not change unless the secure link is used.',
    '',
    'Church Chatter',
    'Your church. Your community. Connected all week.'
  ].join('\n');

  const options = {
    to: email,
    subject: subject,
    body: plainText,
    htmlBody: passwordResetHtml_(resetLink),
    name: CHURCH_CHATTER.SENDER_NAME
  };

  if (CHURCH_CHATTER.REPLY_TO) options.replyTo = CHURCH_CHATTER.REPLY_TO;
  MailApp.sendEmail(options);
}

function passwordResetHtml_(resetLink) {
  const safeLink = htmlEscape_(resetLink);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#10201c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f4;padding:32px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe7e3;border-radius:22px;overflow:hidden;box-shadow:0 14px 40px rgba(16,32,28,.08);">
            <tr>
              <td style="background:#16352f;padding:28px 30px;color:#ffffff;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="width:44px;height:44px;border-radius:14px 14px 14px 5px;background:#ffffff;color:#16352f;text-align:center;font-weight:800;font-size:16px;">CC</td>
                    <td style="padding-left:13px;">
                      <div style="font-weight:800;font-size:18px;line-height:1.2;">Church Chatter</div>
                      <div style="margin-top:3px;font-size:12px;color:#c8d8d2;">Your church. Connected all week.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:38px 34px 34px;">
                <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:#c88b52;margin-bottom:12px;">Account security</div>
                <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.08;letter-spacing:-.02em;margin:0 0 14px;color:#10201c;">Reset your password.</h1>
                <p style="font-size:16px;line-height:1.65;color:#5f6f69;margin:0 0 26px;">We received a request to reset the password for your Church Chatter account. Use the secure button below to choose a new password.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                  <tr>
                    <td style="border-radius:12px;background:#16352f;">
                      <a href="${safeLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;">Reset my password</a>
                    </td>
                  </tr>
                </table>
                <div style="border-top:1px solid #e6ece9;padding-top:22px;">
                  <p style="font-size:13px;line-height:1.6;color:#78847f;margin:0 0 10px;">If you didn't request a password reset, you can safely ignore this email. Your password will stay exactly as it is.</p>
                  <p style="font-size:12px;line-height:1.55;color:#9aa49f;margin:0;word-break:break-all;">Button not working? Copy this secure link into your browser:<br><a href="${safeLink}" style="color:#24584d;">${safeLink}</a></p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#f8faf8;border-top:1px solid #e7edea;padding:20px 34px;color:#84908b;font-size:12px;line-height:1.55;">
                This automated security message was sent by Church Chatter. Never share your password or reset link with anyone.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function allowRequest_(email) {
  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email.toLowerCase());
  const emailKey = 'pwd:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '').substring(0, 32);
  if (cache.get(emailKey)) return false;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) return false;

  try {
    const properties = PropertiesService.getScriptProperties();
    const now = Math.floor(Date.now() / 1000);
    let windowStart = Number(properties.getProperty('MAIL_WINDOW_START') || 0);
    let count = Number(properties.getProperty('MAIL_WINDOW_COUNT') || 0);

    if (!windowStart || now - windowStart >= CHURCH_CHATTER.GLOBAL_WINDOW_SECONDS) {
      windowStart = now;
      count = 0;
    }

    if (count >= CHURCH_CHATTER.GLOBAL_WINDOW_LIMIT) return false;

    properties.setProperties({
      MAIL_WINDOW_START: String(windowStart),
      MAIL_WINDOW_COUNT: String(count + 1)
    });
    cache.put(emailKey, '1', CHURCH_CHATTER.PER_EMAIL_COOLDOWN_SECONDS);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function normalizeEmail_(value) {
  const email = String(value || '').trim().toLowerCase().substring(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function htmlEscape_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function genericResponse_() {
  return json_({
    ok: true,
    message: 'If an eligible Church Chatter account exists for that email, reset instructions will be sent.'
  });
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}