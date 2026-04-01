import { Link, Navigate } from "@tanstack/react-router";
import { useMatrixForum } from "../../matrix/context";
import { compactText, shortUserId } from "../../shared/format";
import { RelativeTime } from "../../shared/RelativeTime";

export function HomePage() {
  const { state, refresh, selectSpace } = useMatrixForum();

  if (!state.config) {
    return <Navigate to="/login" />;
  }

  const spaces = state.snapshot.spaces;
  const groups = state.snapshot.groups;
  const threads = state.snapshot.threads;

  const selectedSpace = spaces.find((space) => space.id === state.selectedSpaceId) ?? null;
  const showSkeletons = state.isLoading && state.snapshot.updatedAt === 0;

  const recentThreadsByGroup = new Map<string, typeof threads>();
  for (const thread of threads) {
    const groupThreads = recentThreadsByGroup.get(thread.groupId) ?? [];
    if (groupThreads.length < 3) {
      groupThreads.push(thread);
      recentThreadsByGroup.set(thread.groupId, groupThreads);
    }
  }

  return (
    <section className="home-page">
      <header className="home-toolbar">
        <div>
          <h2 className="home-title">Forum Index</h2>
          <p className="subtle-line">
            {selectedSpace
              ? `Current space: ${selectedSpace.name} · ${selectedSpace.unreadCount} unread${
                  selectedSpace.highlightCount > 0
                    ? ` · ${selectedSpace.highlightCount} mentions`
                    : ""
                }`
              : spaces.length > 0
                ? "Current scope: all joined rooms."
                : "No joined spaces found yet. Join at least one space to continue."}
          </p>

          {selectedSpace?.avatarUrl ? (
            <img
              src={selectedSpace.avatarUrl}
              alt={`${selectedSpace.name} avatar`}
              className="group-avatar"
              loading="lazy"
            />
          ) : null}
        </div>

        <div className="home-toolbar-actions">
          <div className="space-selector-wrap">
            <label className="space-selector-label" htmlFor="homeSpaceSelector">
              Space
            </label>
            <select
              id="homeSpaceSelector"
              className="space-selector"
              value={state.selectedSpaceId ?? ""}
              onChange={(event) => selectSpace(event.target.value || null)}
              disabled={spaces.length === 0}
            >
              {spaces.length === 0 ? <option value="">No joined spaces</option> : null}
              {spaces.length > 0 ? <option value="">All joined rooms</option> : null}
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </div>

          <button type="button" className="ghost-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {state.errorMessage ? (
        <p className="status-banner status-banner-error">{state.errorMessage}</p>
      ) : null}

      <div className="home-layout">
        <section className="group-index-card">
          <header className="card-heading-row">
            <h3>Groups</h3>
            <span className="inline-note">{groups.length} total</span>
          </header>

          {groups.length > 0 ? (
            <div className="group-index-list">
              {groups.map((group) => {
                const previewThreads = recentThreadsByGroup.get(group.id) ?? [];

                return (
                  <article className="group-index-row" key={group.id}>
                    <div className="group-index-header">
                      <div className="group-heading-with-avatar">
                        {group.avatarUrl ? (
                          <img
                            src={group.avatarUrl}
                            alt={`${group.name} avatar`}
                            className="group-avatar"
                            loading="lazy"
                          />
                        ) : null}
                        <Link
                          to="/groups/$groupId"
                          params={{ groupId: group.id }}
                          className="group-index-link"
                        >
                          {group.name}
                        </Link>
                      </div>
                      <span className="inline-note">
                        {group.memberCount} members · {group.unreadCount} unread
                        {group.highlightCount > 0 ? ` · ${group.highlightCount} mentions` : ""}
                      </span>
                    </div>

                    {group.topic ? (
                      <p className="group-topic">{compactText(group.topic, 140)}</p>
                    ) : null}

                    {previewThreads.length > 0 ? (
                      <ul className="thread-preview-list">
                        {previewThreads.map((thread) => (
                          <li key={thread.id}>
                            <Link
                              to="/threads/$threadId"
                              params={{ threadId: thread.id }}
                              className="thread-preview-link"
                            >
                              {thread.title}
                            </Link>{" "}
                            <span className="inline-note">
                              <RelativeTime timestamp={thread.lastActivityAt} /> · @
                              {shortUserId(thread.root.authorId)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="inline-note">No visible threads yet in this group.</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : showSkeletons ? (
            <SkeletonGroupRows />
          ) : (
            <article className="post-card">
              <p className="inline-note">No groups found for the currently selected space.</p>
            </article>
          )}
        </section>

        <section className="recent-activity-card">
          <header className="card-heading-row">
            <h3>Recently Active Topics</h3>
            <span className="inline-note">Latest {Math.min(threads.length, 16)}</span>
          </header>

          {threads.length > 0 ? (
            <ul className="recent-activity-list">
              {threads.slice(0, 16).map((thread) => (
                <li key={thread.id}>
                  <Link
                    to="/threads/$threadId"
                    params={{ threadId: thread.id }}
                    className="recent-activity-link"
                  >
                    {thread.title}
                  </Link>
                  <div className="recent-activity-meta">
                    <Link
                      to="/groups/$groupId"
                      params={{ groupId: thread.groupId }}
                      className="link-action"
                    >
                      #{thread.groupName}
                    </Link>
                    <span>{thread.replyCount} replies</span>
                    <span>
                      <RelativeTime timestamp={thread.lastActivityAt} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : showSkeletons ? (
            <SkeletonRecentRows />
          ) : (
            <article className="post-card">
              <p className="inline-note">No thread activity visible yet.</p>
            </article>
          )}
        </section>
      </div>
    </section>
  );
}

function SkeletonGroupRows() {
  return (
    <div className="group-index-list">
      {Array.from({ length: 4 }).map((_, index) => (
        <article className="group-index-row" key={`group-skeleton-${index}`}>
          <div className="skeleton skeleton-line" style={{ width: "42%", height: 14 }} />
          <div
            className="skeleton skeleton-line"
            style={{ width: "85%", height: 10, marginTop: 8 }}
          />
          <div
            className="skeleton skeleton-line"
            style={{ width: "60%", height: 10, marginTop: 6 }}
          />
        </article>
      ))}
    </div>
  );
}

function SkeletonRecentRows() {
  return (
    <ul className="recent-activity-list">
      {Array.from({ length: 5 }).map((_, index) => (
        <li key={`recent-skeleton-${index}`}>
          <div className="skeleton skeleton-line" style={{ width: "70%", height: 12 }} />
          <div
            className="skeleton skeleton-line"
            style={{ width: "45%", height: 10, marginTop: 8 }}
          />
        </li>
      ))}
    </ul>
  );
}
