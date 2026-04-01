# MatricesBB

MatricesBB is a React client that turns Matrix thread traffic into a bulletin-board workflow.

The app follows a forum-oriented route structure:

- Home (`/home`): list groups and preview recent thread activity.
- Group (`/groups/:groupId`): list topics for one group.
- Thread (`/threads/:threadId`): focused thread view and replying.

Joined spaces are discovered from the authenticated account, and scope is selected at runtime from the Home page.

Thread roots and replies are rendered in two modes:

- Board mode: traditional forum card list with activity-focused sorting.
- Tree mode: Reddit-like nested reply preview in the board and nested discussion in thread detail.

## Stack

- React + TypeScript + Vite
- TanStack Router (code-based route tree)
- TanStack Query (mutation ergonomics)
- matrix-js-sdk
- @mdxeditor/editor for markdown composition
- react-markdown + remark-gfm for markdown rendering

## Current Feature Set

- Login-first Matrix connection page (homeserver + user + password) with persisted local config.
- Optional token mode on the connection page for direct access-token sign-in.
- Space selector on Home page for selecting the current browsing scope.
- Selected space persistence across refreshes.
- Live sync state with timeline-driven refreshes.
- Thread indexing backed by `/_matrix/client/v1/rooms/{roomId}/threads` with paginated discovery.
- New thread publishing where root post is the thread title and body is posted as an immediate reply.
- Reply publishing to threads, including nested reply targeting.
- Attachment upload and rendering for replies/posts.
- Poll creation and display in thread timelines.
- Editing for own posts and removal actions for users with moderation power.
- Emoji reactions for topics and replies.
- Semantic relative timestamps using `<time>` with absolute tooltip values.
- Dual read views:
  - Bulletin board card list
  - Reddit-like tree rendering

## Project Structure

- src/app: router, shell, provider wiring
- src/matrix: connection state, timeline-to-forum mapping, domain types
- src/features/settings: connection form + local storage helpers
- src/features/threads: board UI, detail UI, composer, mutations
- src/features/home: forum home/index page
- src/features/groups: per-group topic listing page
- src/shared: markdown renderer and UI formatting helpers

## Run Locally

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Lint and Formatting

```bash
npm run lint
npm run format
```

Format write mode:

```bash
npm run format:write
```

## Matrix Notes

- Encryption is intentionally not implemented in this iteration.
- The app is structured so encryption-aware event handling can be added in the Matrix store layer later.
- Thread roots are sourced from the Matrix threads endpoint and paginated until completion.

## Configuration Expectations

Default connection flow uses homeserver URL, user, and password.

If needed, enable token mode to provide user ID + access token manually.

Space scope is selected from the Home page toolbar selector.

All values are stored in localStorage for development convenience.
