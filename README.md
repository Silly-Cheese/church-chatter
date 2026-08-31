# Church Chatter

**Your church. Your community. Connected all week.**

Church Chatter is a denomination-neutral private community platform for local churches. The platform provides the structure; each congregation supplies its own identity, terminology, leadership model, teaching, and ministry language.

## Current build: Phase 3

Phase 3 completes the first full Church Chatter product build while keeping the technical stack intentionally simple: GitHub Pages, Firebase Authentication, and Cloud Firestore.

### Foundation

- Google sign-in as the primary authentication method
- Email/password as an alternative
- Password reset
- Create or join a church
- Private invitation codes
- Multiple churches per account
- Church switching
- Church profiles and member directory
- Custom church roles and permission-based access
- Denomination-neutral terminology
- Responsive desktop/mobile interface
- Installable PWA

### Chatter

- Real-time congregation feed
- Chatter Rooms
- Posts, comments, editing, deletion, pinning, and Amen reactions
- Moderator controls
- Member reporting workflow into Church Admin

### Prayer

- Congregation prayer wall
- Leadership-only prayer requests
- Anonymous prayer documents without stored author UIDs
- “I Prayed” acknowledgements
- Answered-prayer status
- Moderation reporting

### Gather

- Church events and gatherings
- Locations and descriptions
- Going / Maybe / Can't go RSVPs
- Authorized event management and cancellation

### Groups

- Open and private groups
- Group leaders and members
- Group-specific Chatter, Prayer, and Gather
- Church-defined ministry/class/team terminology

### Announcements and Activity

- Normal, important, and urgent announcements
- Live Home surfacing
- Activity Center combining recent church activity

### Serve

- Church volunteer opportunities
- Ministry/team labels
- Date, location, description, and requested spots
- Member self-signup and withdrawal
- Leadership volunteer roster view
- Open/close opportunity controls

### Resources

- Church-managed resource library
- Sermons, studies, forms, documents, and links
- Categories and descriptions
- Archive/restore support
- Link-only design: no Firebase Storage or file uploads

### Sunday Hub

Churches can configure a Sunday-focused Home experience with:

- Welcome message
- Up to two primary gathering/service times
- Sermon title and Scripture
- Bulletin link
- Sermon-notes link
- Visitor/connect link

When enabled, the Hub appears automatically on Sundays according to the member's local device time.

### Church Admin

Authorized church leaders receive a dedicated administration center with:

- Member, group, gathering, Serve, resource, and report snapshots
- Shortcuts into existing permission-controlled management tools
- Moderation report queue
- Resolve, dismiss, and reopen report workflows
- Sunday Hub configuration

Administrative access is permission-based rather than title-based.

## Security hardening

The Phase 3 ruleset consolidates and hardens the complete Phase 1–3 data model.

Important protections include:

- Active church membership boundaries
- Authorship validation on community content
- Narrow field-level update rules
- Protected owner/default-member role behavior
- Restricted delegation of administrative permissions
- Transaction-coupled Chatter reaction and prayer counters
- Leadership-only prayer isolation
- Anonymous prayer requests without stored author UIDs
- Group membership boundaries
- Group author identity fields protected from crafted-client rewrites
- Event and announcement mutation restrictions
- Self-owned RSVPs and Serve signups
- Church-admin-only resource and Sunday Hub writes
- Moderator-only report access and resolution
- Exact invitation lookup without global invite enumeration

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

1. Enable **Google** under Authentication sign-in methods.
2. Enable **Email/Password**.
3. Add the GitHub Pages hostname and any future Church Chatter custom domain to **Authorized domains**.
4. Create the Cloud Firestore database.
5. Publish the repository's current `firestore.rules`.

Using Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

## GitHub Pages

The app is static and can be served from the repository root. Hash-based routing avoids server-side rewrite requirements.

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
churches/{churchId}/resources/{resourceId}
churches/{churchId}/serveOpportunities/{opportunityId}
churches/{churchId}/serveOpportunities/{opportunityId}/signups/{uid}
churches/{churchId}/settings/sundayHub
churches/{churchId}/reports/{reportId}

inviteCodes/{code}
```

## Product principle

**Church Chatter provides the structure; the church provides the identity.**

The platform does not hard-code denominational offices, theology, worship terminology, or ministry structure. A congregation's title for a role never determines its permissions.
