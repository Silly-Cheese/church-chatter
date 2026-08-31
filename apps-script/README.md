# Church Chatter Mail Service

This Apps Script replaces Firebase's generic password-reset email with a branded Church Chatter transactional email while keeping Firebase Authentication responsible for the actual password-reset token and password change.

## What it does

1. Church Chatter submits a password-reset request to the deployed Apps Script web app.
2. Apps Script requests an authenticated Firebase password-reset action link using Identity Toolkit with `returnOobLink: true`.
3. Firebase creates the secure one-time reset code but does not send an email.
4. Apps Script rewrites the returned action URL to Church Chatter's `auth-action.html` handler.
5. Apps Script sends a branded HTML + plain-text email using `MailApp`.
6. The website always displays the same generic success message, whether or not an account exists.

## 1. Create the Apps Script project

1. Go to https://script.google.com and create a new project.
2. Name it **Church Chatter Mail Service**.
3. Replace the default `Code.gs` contents with this repository's `apps-script/Code.gs`.
4. Open **Project Settings** and enable **Show "appsscript.json" manifest file in editor**.
5. Replace the manifest with this repository's `apps-script/appsscript.json`.
6. Save the project.

Use a Google account that has appropriate access to the Firebase/Google Cloud project `church-chattrd`. The Identity Toolkit request requires the IAM permission `firebaseauth.users.sendEmail` on that project.

## 2. Authorize the script

Run any function that requires authorization, or deploy the web app and complete the authorization flow when prompted.

The script requests only these scopes:

- external HTTP requests
- sending email
- Identity Toolkit

The script does not request access to read your Gmail inbox.

## 3. Deploy as a web app

1. Click **Deploy → New deployment**.
2. Choose **Web app**.
3. Description: `Church Chatter Mail Service`.
4. **Execute as:** Me.
5. **Who has access:** Anyone.
6. Click **Deploy**.
7. Copy the URL ending in `/exec`.

Do not use the `/dev` testing URL in Church Chatter.

## 4. Connect Church Chatter

Open `src/mail-service.js` and replace:

```js
export const MAIL_SERVICE_URL = "";
```

with your deployed URL, for example:

```js
export const MAIL_SERVICE_URL = "https://script.google.com/macros/s/DEPLOYMENT_ID/exec";
```

Commit the change to `main`. GitHub Pages will deploy it automatically.

Until `MAIL_SERVICE_URL` is set, Church Chatter intentionally keeps Firebase's built-in reset email as a fallback.

## 5. Test

1. Open the deployed web-app URL with `?action=health`. You should see a small JSON health response.
2. Open Church Chatter in an incognito/private browser window.
3. Enter the email address of a Firebase email/password account.
4. Select **Forgot password?**.
5. Church Chatter should show a generic `Check your email` confirmation.
6. The email should be branded as **Church Chatter** and its button should open Church Chatter's custom `auth-action.html` page.
7. Choose a new password and sign in with it.

## Security behavior

- Unknown accounts receive no email, but the public website shows the same success message.
- Repeated requests for the same email are throttled.
- A global rolling-window limit protects the Apps Script mail quota from basic abuse.
- Firebase generates and validates the reset token; Apps Script never sees or stores a user's password.
- The reset URL is one-time and remains governed by Firebase Authentication.

## Sender address

`MailApp` can set the sender **display name** to `Church Chatter`, but the underlying sender address is the Google account that owns/deploys the script.

For a future address such as `accounts@yourdomain.com`, use a Google Workspace sender/alias and switch the sender implementation to `GmailApp` with a verified alias. Do not place SMTP passwords or Google credentials in the public GitHub repository.

## If Firebase returns 403

The Google account deploying the script does not have enough IAM access to `church-chattrd`. Give that account a Firebase Authentication role that includes `firebaseauth.users.sendEmail`, then authorize/redeploy the script.

## Updating the Apps Script

When you modify `Code.gs` later, create a **new version of the web-app deployment** from **Deploy → Manage deployments → Edit → New version → Deploy**. The `/exec` URL can remain the same when updating the existing deployment.
