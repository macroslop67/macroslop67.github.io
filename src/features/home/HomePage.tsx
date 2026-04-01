import { Link, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMatrixForum } from "../../matrix/context";
import { compactText, shortUserId } from "../../shared/format";
import { InlineTitleMarkdown } from "../../shared/InlineTitleMarkdown";
import { RelativeTime } from "../../shared/RelativeTime";

export function HomePage() {
  const { t } = useTranslation();
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
          <h2 className="home-title">{t("homePage.title")}</h2>
          <p className="subtle-line home-scope-indicator">
            {selectedSpace?.avatarUrl ? (
              <img
                src={selectedSpace.avatarUrl}
                alt={`${selectedSpace.name} avatar`}
                className="group-avatar"
                loading="lazy"
              />
            ) : null}
            {selectedSpace
              ? `${t("homePage.currentSpace", { name: selectedSpace.name })} · ${t("count.unread", {
                  count: selectedSpace.unreadCount,
                })}${
                  selectedSpace.highlightCount > 0
                    ? ` · ${t("count.mention", { count: selectedSpace.highlightCount })}`
                    : ""
                }`
              : spaces.length > 0
                ? t("homePage.currentScopeAll")
                : t("homePage.noJoinedSpaces")}
          </p>
        </div>

        <div className="home-toolbar-actions">
          <div className="space-selector-wrap">
            <label className="space-selector-label" htmlFor="homeSpaceSelector">
              {t("homePage.spaceLabel")}
            </label>
            <select
              id="homeSpaceSelector"
              className="space-selector"
              value={state.selectedSpaceId ?? ""}
              onChange={(event) => selectSpace(event.target.value || null)}
              disabled={spaces.length === 0}
            >
              {spaces.length === 0 ? (
                <option value="">{t("homePage.noJoinedSpacesOption")}</option>
              ) : null}
              {spaces.length > 0 ? (
                <option value="">{t("homePage.allJoinedRoomsOption")}</option>
              ) : null}
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </div>

          <button type="button" className="ghost-button" onClick={() => void refresh()}>
            {t("common.refresh")}
          </button>
        </div>
      </header>

      {state.errorMessage ? (
        <p className="status-banner status-banner-error">{state.errorMessage}</p>
      ) : null}

      <div className="home-layout">
        <section className="group-index-card">
          <header className="card-heading-row">
            <h3>{t("homePage.groupsTitle")}</h3>
            <span className="inline-note">{t("count.total", { count: groups.length })}</span>
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
                        {t("count.member", { count: group.memberCount })} ·{" "}
                        {t("count.unread", { count: group.unreadCount })}
                        {group.highlightCount > 0
                          ? ` · ${t("count.mention", { count: group.highlightCount })}`
                          : ""}
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
                              <InlineTitleMarkdown title={thread.title} />
                            </Link>{" "}
                            <span className="inline-note">
                              <RelativeTime timestamp={thread.lastActivityAt} /> · @
                              {shortUserId(thread.root.authorId)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="inline-note">{t("homePage.noVisibleThreadsInGroup")}</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : showSkeletons ? (
            <SkeletonGroupRows />
          ) : (
            <article className="post-card">
              <p className="inline-note">{t("homePage.noGroupsInScope")}</p>
            </article>
          )}
        </section>

        <section className="recent-activity-card">
          <header className="card-heading-row">
            <h3>{t("homePage.recentTopicsTitle")}</h3>
            <span className="inline-note">
              {t("homePage.latestN", { count: Math.min(threads.length, 16) })}
            </span>
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
                    <InlineTitleMarkdown title={thread.title} />
                  </Link>
                  <div className="recent-activity-meta">
                    <Link
                      to="/groups/$groupId"
                      params={{ groupId: thread.groupId }}
                      className="link-action"
                    >
                      #{thread.groupName}
                    </Link>
                    <span>{t("count.reply", { count: thread.replyCount })}</span>
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
              <p className="inline-note">{t("homePage.noThreadActivity")}</p>
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
