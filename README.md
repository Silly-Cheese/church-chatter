# Church Chatter

**Your church. Your community. Connected all week.**

Church Chatter is a denomination-neutral private community platform for local churches. The platform provides the structure; each congregation supplies its own identity, terminology, leadership model, and teaching.

## Phase 1

Phase 1 establishes the complete product foundation:

- Google sign-in as the primary authentication method
- Email/password account creation and sign-in as an alternative
- Password reset support
- First-run onboarding
- Create a church community
- Join a church with a private invitation code
- Multiple churches on one user account
- Church switching
- Member directory
- Church profiles
- Custom church roles
- Permission-based access
- Role assignment
- Invitation creation, limits, expiration, revocation, and reactivation
- User profile management
- Responsive desktop/mobile interface
- Installable PWA shell
- Firestore security rules

No Firebase Storage, Functions, Realtime Database, or custom backend is used.

## Technology

- Static HTML/CSS/JavaScript
- GitHub Pages
- Firebase Authentication
- Cloud Firestore
- Firebase Web SDK 12.18.0

## Firebase setup

The project is configured for Firebase project `church-chattrd`.

In Firebase Console:

1. Open **Authentication → Sign-in method**.
2. Enable **Google**.
3. Enable **Email/Password**.
4. Add the GitHub Pages hostname and any future custom Church Chatter domain to **Authentication → Settings → Authorized domains**.
5. Create a **Cloud Firestore** database.
6. Publish the rules from `firestore.rules`.

If using Firebase CLI, the included `firebase.json` and `.firebaserc` are intentionally limited to Firestore rules:

```bash
firebase deploy --only firestore:rules
```

## GitHub Pages

The app is intentionally static and can be served directly from the repository root. In repository settings, configure GitHub Pages to deploy from the `main` branch root (or use a Pages workflow later if desired).

Hash-based navigation is used so no server-side route rewriting is required.

## Data model

```text
users/{uid}
users/{uid}/memberships/{churchId}

churches/{churchId}
churches/{churchId}/members/{uid}
churches/{churchId}/roles/{roleId}
churches/{churchId}/invites/{code}

inviteCodes/{code}
```

The top-level `inviteCodes` collection supports exact invitation lookup but is not listable by clients. A mirrored church-scoped invitation document allows authorized church administrators to manage their own invitation history without exposing a global directory of invitation codes.

## Denomination neutrality

Church Chatter does not hard-code titles such as Pastor, Elder, Priest, Deacon, Minister, Bishop, or Parishioner. Churches create the roles and labels that reflect their own congregation. Role titles are separate from permissions, so a congregation's terminology never determines what the platform assumes about its theology or governance.

## Next phase

Phase 2 will use the existing membership and permission foundation to add the core community experience: Chatter, Prayer, Gather, Groups, announcements, and real-time member activity.
