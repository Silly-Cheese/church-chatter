# Church Chatter

**Your church. Your community. Connected all week.**

Church Chatter is a denomination-neutral private community platform for local churches. The platform provides the structure; each congregation supplies its own identity, terminology, leadership model, and teaching.

## Current build: Phase 2

Phase 1 established the platform foundation and Phase 2 adds the living church-community experience.

### Identity and church foundation

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

### Chatter

- Real-time congregation Chatter feed
- Custom Chatter Rooms
- Create and edit posts
- Delete your own posts
- Moderator deletion and pinning
- Comments
- Amen reactions with transaction-protected counters
- Church-scoped authorship and moderation rules

### Prayer

- Congregation prayer wall
- Leadership-only prayer requests
- Truly anonymous prayer documents that do not store the author's account ID
- “I Prayed” instead of social-media likes
- Transaction-protected prayer counts
- Mark requests as answered
- Reopen answered requests when needed

### Gather

- Church events and gatherings
- Start/end times
- Locations and descriptions
- Going / Maybe / Can't go RSVPs
- Event cancellation by authorized church leadership
- Upcoming-event presentation on Home

### Groups

- Open and private church groups
- Group leaders and members
- Self-join for open groups
- Group-specific Chatter
- Group-specific Prayer
- Group-specific Gather/events
- Ministry/class/team terminology remains church-defined

### Announcements and activity

- Official church announcements
- Normal, important, and urgent priorities
- Announcement surfacing on Home
- Church Activity Center
- Recent Chatter, Prayer, Gather, and announcements in one timeline
- Per-user activity checkpoint storage

### Home

The Phase 1 placeholder dashboard is progressively upgraded into a live church dashboard containing recent conversations, prayer activity, gatherings, announcements, and church shortcuts.

## Security hardening

Phase 2 expands `firestore.rules` around explicit collection-specific permissions rather than simply allowing all church members to write to community data.

Important protections include:

- Active church membership checks
- Authorship validation on Chatter and comments
- Body length validation
- Moderator-only pinning
- Transaction-coupled reaction and prayer counters
- Leadership-only prayer isolation in a separate collection
- Anonymous prayer requests without stored author UIDs
- Event-management permissions
- RSVP ownership rules
- Group membership boundaries
- Group-leader controls
- Restricted administrative-permission delegation
- Protected owner and default-member role permissions
- Exact invitation lookup without global invitation enumeration

## Technology

- Static HTML/CSS/JavaScript
- GitHub Pages
- Firebase Authentication
- Cloud Firestore
- Firebase Web SDK 12.18.0

No Firebase Storage, Functions, Realtime Database, or custom backend is used.

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

The app is intentionally static and can be served directly from the repository root. In repository settings, configure GitHub Pages to deploy from the `main` branch root.

Hash-based navigation is used so no server-side route rewriting is required.

## Data model

```text
users/{uid}
users/{uid}/memberships/{churchId}
users/{uid}/activity/{churchId}

churches/{churchId}
churches/{churchId}/members/{uid}
churches/{churchId}/roles/{roleId}
churches/{churchId}/invites/{code}
churches/{churchId}/rooms/{roomId}
churches/{churchId}/chatter/{postId}
churches/{churchId}/chatter/{postId}/comments/{commentId}
churches/{churchId}/chatter/{postId}/reactions/{uid}
churches/{churchId}/prayers/{prayerId}
churches/{churchId}/prayers/{prayerId}/prayedBy/{uid}
churches/{churchId}/leadershipPrayers/{prayerId}
churches/{churchId}/leadershipPrayers/{prayerId}/prayedBy/{uid}
churches/{churchId}/announcements/{announcementId}
churches/{churchId}/events/{eventId}
churches/{churchId}/events/{eventId}/rsvps/{uid}
churches/{churchId}/groups/{groupId}
churches/{churchId}/groups/{groupId}/members/{uid}
churches/{churchId}/groups/{groupId}/chatter/{postId}
churches/{churchId}/groups/{groupId}/prayers/{prayerId}
churches/{churchId}/groups/{groupId}/events/{eventId}

inviteCodes/{code}
```

The top-level `inviteCodes` collection supports exact invitation lookup but is not listable by clients. A mirrored church-scoped invitation document allows authorized church administrators to manage their own invitation history without exposing a global directory of invitation codes.

## Denomination neutrality

Church Chatter does not hard-code titles such as Pastor, Elder, Priest, Deacon, Minister, Bishop, or Parishioner. Churches create the roles and labels that reflect their own congregation. Role titles are separate from permissions, so a congregation's terminology never determines what the platform assumes about its theology or governance.

## Phase 3 direction

Phase 3 is reserved for administration and finishing work: a fuller church-admin dashboard, member moderation workflows, Sunday Hub, volunteer/Serve tools, deeper church profile resources, final accessibility/performance polish, and production-readiness review.
