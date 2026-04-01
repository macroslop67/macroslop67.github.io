# AGENTS Notes

This file captures key product and architecture choices for MatricesBB.

## Product Direction

- UI target: hybrid between phpBB density and Discourse clarity.
- Primary navigation is route-based, not pane state:
  - `/home`: forum index (groups + recent topic previews)
  - `/groups/:groupId`: group topic list + topic composer
  - `/threads/:threadId`: focused thread detail + reply composer
- Space scope is selected from the Home toolbar and persisted across refreshes.

## Authentication UX

- Unauthenticated users are redirected to `/login`.
- Login page is login-first (homeserver + user + password).
- Optional token mode is available for direct access-token sign-in.
- Credentials are persisted locally for development convenience.
- Header navigation does not expose a separate "Connection" tab.

## Matrix Behavior

- Encryption is intentionally out of scope for this iteration.
- Thread roots must be sourced from `/_matrix/client/v1/rooms/{roomId}/threads`.
- Threads endpoint usage must support pagination while `next_batch` is present.
- Thread reply hydration should use the parent-child relations API (`/_matrix/client/v1/rooms/{roomId}/relations/{eventId}`) and filter thread relations client-side.
- Thread discovery may merge endpoint roots with SDK thread data for resiliency.
- Thread creation semantics:
  - root post is the thread title text,
  - immediate thread reply contains the body content.
- If a root event is missing from currently loaded history, a synthetic root preview is generated.
- Room backfill is intentionally aggressive to improve historical thread visibility.

## Rendering Rules

- Thread page supports two modes:
  - forum mode (dense post layout with left user column and avatar)
  - tree mode (nested replies)
- "Thread starter" badge is shown on all posts authored by thread starter.
- Reply composer shows parent-reply preview between heading and editor when replying to a specific post.
- Reply-preview click should focus/scroll the parent post.
- For replies that target non-root posts, post metadata should surface an inline `In reply to #index` reference.
- Focused/linked-to posts should be temporarily highlighted to aid visual discovery after scroll.
- Each post should have a stable anchor id and a copyable `#index` link near publication time.
- Edited metadata should render inline with publication time metadata.
- All visible relative timestamps should use semantic `<time>` output with absolute tooltip title.
- Space and group avatars should be surfaced in forum UI areas.
- Unread and mention counts should be surfaced in forum UI areas.

## Interaction Features

- Composer uses MDXEditor with explicit toolbar controls (formatting, lists, links, separators).
- Chat compact composer should default to a single-line markdown input and stay space-efficient.
- In chat compact composer, attachment picker UI stays hidden until explicit upload action.
- In chat compact composer, small Upload and Poll controls share the same action row as Send.
- Emoji reactions are supported on root posts and replies via `m.reaction` / `m.annotation`.
- Reaction chips should support toggling an existing self-reaction off (unreact) on second click.
- Composer supports attachments and poll creation.
- Users can edit their own posts.
- Moderation-capable users can remove posts.
- `Ctrl+Enter` (and `Cmd+Enter`) submits thread/reply forms.
- Reply actions should focus the reply form.
- Loading states should use skeleton placeholders where appropriate.

## Chat Pane

- Chats are a separate interface feature rendered as an expandable pane at the bottom-right.
- Chat pane must show all joined non-space rooms, including rooms outside any selected space scope.
- Encrypted rooms should be filtered out of chat lists when encryption state is detectable.
- No chat-specific data prefetch is allowed while the chat pane is collapsed.
- Chat message rendering should be chat-like (bubble/feed), not forum-card style.
- Chat message lists should use virtualization/windowing to keep large rooms responsive.
- Chat history loading must be paginated (newest page first, older pages on explicit demand), not eager full-history loads.
- Opening or switching chat rooms should place the message viewport at the latest message by default.
- Chat loading states should use skeleton placeholders for room list and message list.
- If a chat post already has an initialized thread, chat actions should expose thread link + reply count in place of `Start thread`.
- Chat view should support forum-equivalent authoring/moderation capabilities (attachments, polls, reactions, editing own posts, moderation removal).
- Chat composer must support replying to specific posts.
- Chat view must allow initializing a thread from a chat post and navigate to `/threads/:threadId`.

## Content Presentation

- If post text only duplicates attachment filename, suppress body rendering and show attachment UI only.

## Thread Hydration

- Thread reply hydration should revalidate relations endpoint data even when cached replies exist to avoid stale or partial reply lists.

## Tooling

- Linting/formatting uses oxlint + oxfmt.
- No test framework is configured by design in this repository state.

## Maintenance Rule

- Whenever the user provides new product, UX, or architecture directives in chat, update this file in the same work session to keep decisions current.
