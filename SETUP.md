# Church Chatter Setup & Deployment

Church Chatter uses only:

- GitHub Pages for the web app
- Firebase Authentication
- Cloud Firestore

It does **not** require Firebase Hosting, Storage, Functions, Realtime Database, or a custom server.

## 1. Firebase Authentication

Open the Firebase project `church-chattrd`.

### Google sign-in

1. Open **Authentication** in Firebase Console.
2. Open **Sign-in method**.
3. Select **Google**.
4. Enable the provider.
5. Choose the support email requested by Firebase.
6. Save.

### Email/password fallback

1. Still under **Authentication → Sign-in method**, select **Email/Password**.
2. Enable **Email/Password**.
3. Leave email-link/passwordless sign-in disabled unless you intentionally add it later.
4. Save.

### Authorized domains

After GitHub Pages is enabled, add the site host under **Authentication → Settings → Authorized domains**.

For the default GitHub Pages deployment, add:

```text
silly-cheese.github.io
```

Add only the hostname — do not include `https://` or `/church-chatter`.

If Church Chatter later uses a custom domain, add that hostname as well.

Only add `localhost` if you intentionally need local Firebase Authentication testing. It is not required for production.

## 2. Cloud Firestore

1. Open **Firestore Database** in Firebase Console.
2. Create the `(default)` database using **Standard edition**.
3. Start in **Production mode**.
4. Choose the database location carefully; Firestore database location is a long-term infrastructure choice.
5. Do not add open development rules.

### Deploy Church Chatter rules

The repository already contains the production rules in `firestore.rules`, and `firebase.json` points to that file.

#### Firebase Console method

1. Open **Firestore Database → Rules**.
2. Replace the editor contents with the repository's current `firestore.rules`.
3. Click **Publish**.

#### Firebase CLI method

From a clone of the repository:

```bash
npm install -g firebase-tools
firebase login
git clone https://github.com/Silly-Cheese/church-chatter.git
cd church-chatter
firebase deploy --only firestore:rules
```

`.firebaserc` already selects the `church-chattrd` project.

Do not use Firebase Hosting for this project; the frontend is deployed with GitHub Pages.

## 3. GitHub Pages

In `Silly-Cheese/church-chatter`:

1. Open **Settings**.
2. In the left sidebar, open **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select branch **main**.
5. Select folder **/(root)**.
6. Save.

The default project-site address should be:

```text
https://silly-cheese.github.io/church-chatter/
```

GitHub will show the final live URL on the Pages settings screen after deployment completes.

## 4. First production test

After both Pages and Firestore rules are live:

1. Open the GitHub Pages site in a private/incognito window.
2. Test **Continue with Google**.
3. Sign out.
4. Create a second test account with **Email/Password**.
5. Create a test church with the first account.
6. Generate an invitation code.
7. Join with the second account.
8. Verify the second account cannot see Church Admin controls unless granted permission.
9. Test Chatter, Prayer, Gather, Groups, Serve, Resources, and Sunday Hub.
10. Test reporting content and resolving the report with an authorized moderator account.
11. Create a Serve opportunity with one slot and verify a second simultaneous signup cannot overbook it.

## 5. Important security notes

The Firebase web configuration in `src/firebase.js` is client-side configuration and is expected to be visible in a web application. Access control is enforced by Firebase Authentication and `firestore.rules`.

The hardened rules protect church boundaries, administrative permission delegation, invitation joins, content authorship, private prayer areas, reaction/prayer counters, volunteer capacity, volunteer-roster privacy, resource URLs, Sunday Hub settings, and moderation reports.

When changing Firestore collections or write behavior later, update and test `firestore.rules` at the same time. Do not temporarily deploy blanket `allow read, write: if true` rules to production.
