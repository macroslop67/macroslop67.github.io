import { Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMatrixForum } from "../../matrix/context";
import { compactText, shortUserId } from "../../shared/format";
import { InlineTitleMarkdown } from "../../shared/InlineTitleMarkdown";
import { RelativeTime } from "../../shared/RelativeTime";
import { type ComposerPayload, ThreadComposer } from "../threads/ThreadComposer";
import { useCreateThreadMutation } from "../threads/use-thread-mutations";

type GroupPageProps = {
  groupId: string;
};

export function GroupPage({ groupId }: GroupPageProps) {
  const { state, refresh } = useMatrixForum();
  const createThreadMutation = useCreateThreadMutation();
  const [composerOpen, setComposerOpen] = useState(false);

  if (!state.config) {
    return <Navigate to="/login" />;
  }

  const group = state.snapshot.groups.find((candidate) => candidate.id === groupId) ?? null;
  const groupThreads = state.snapshot.threads.filter((thread) => thread.groupId === groupId);

  const showSkeletons = state.isLoading && state.snapshot.updatedAt === 0;

  const createThread = async ({ title, markdown, attachments, poll }: ComposerPayload) => {
    await createThreadMutation.mutateAsync({
      roomId: groupId,
      title,
      markdown,
      attachments,
      poll,
    });

    setComposerOpen(false);
  };

  if (!group) {
    return (
      <section className="empty-state">
        <h2>Group Not Found</h2>
        <p>
          This group is not visible in the currently selected space. Switch spaces from the home
          page and try again.
        </p>
        <Link to="/home" className="ghost-button">
          Return to Home
        </Link>
      </section>
    );
  }

  return (
    <section className="group-page">
      <header className="group-header">
        <nav className="forum-breadcrumbs">
          <Link to="/home">Home</Link>
          <span>/</span>
          <span>{group.name}</span>
        </nav>

        <div className="group-title-row">
          <div>
            <div className="group-heading-with-avatar">
              {group.avatarUrl ? (
                <img
                  src={group.avatarUrl}
                  alt={`${group.name} avatar`}
                  className="group-avatar"
                  loading="lazy"
                />
              ) : null}
              <h2 className="group-title">{group.name}</h2>
            </div>
            <p className="subtle-line">
              {group.topic ? compactText(group.topic, 180) : "No group topic set."}
            </p>
            <p className="inline-note">
              {group.unreadCount} unread
              {group.highlightCount > 0 ? ` · ${group.highlightCount} mentions` : ""}
            </p>
          </div>

          <div className="group-header-actions">
            <button type="button" className="ghost-button" onClick={() => void refresh()}>
              Refresh
            </button>

            <button
              type="button"
              className="solid-button"
              onClick={() => setComposerOpen((value) => !value)}
            >
              {composerOpen ? "Hide Composer" : "New Topic"}
            </button>
          </div>
        </div>
      </header>

      {composerOpen ? (
        <ThreadComposer
          heading={`New topic in #${group.name}`}
          submitLabel="Publish topic"
          withTitle
          busy={createThreadMutation.isPending}
          onSubmit={createThread}
          onCancel={() => setComposerOpen(false)}
        />
      ) : null}

      <section className="topic-list-card">
        <header className="card-heading-row">
          <h3>Topics</h3>
          <span className="inline-note">{groupThreads.length} visible</span>
        </header>

        {groupThreads.length > 0 ? (
          <div className="topic-list-table" role="list">
            {groupThreads.map((thread) => (
              <Link
                role="listitem"
                key={thread.id}
                to="/threads/$threadId"
                params={{ threadId: thread.id }}
                className="topic-row"
              >
                <div className="topic-main">
                  <strong>
                    <InlineTitleMarkdown title={thread.title} />
                  </strong>
                  <p>
                    {compactText(
                      thread.replies[0]?.body ||
                        thread.replies[0]?.attachments[0]?.name ||
                        thread.root.body ||
                        thread.root.attachments[0]?.name ||
                        "No text body",
                      200,
                    )}
                  </p>
                </div>

                <div className="topic-stats">
                  <span>{thread.replyCount} replies</span>
                  <span>Starter @{shortUserId(thread.root.authorId)}</span>
                  <span>
                    <RelativeTime timestamp={thread.lastActivityAt} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : showSkeletons ? (
          <TopicSkeletonRows />
        ) : (
          <article className="post-card">
            <p className="inline-note">No topics in this group yet.</p>
          </article>
        )}
      </section>
    </section>
  );
}

function TopicSkeletonRows() {
  return (
    <div className="topic-list-table" role="list">
      {Array.from({ length: 6 }).map((_, index) => (
        <article className="topic-row" key={`topic-skeleton-${index}`}>
          <div className="topic-main">
            <div className="skeleton skeleton-line" style={{ width: "52%", height: 13 }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: "88%", height: 10, marginTop: 8 }}
            />
          </div>
          <div className="topic-stats">
            <div className="skeleton skeleton-line" style={{ width: 100, height: 10 }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: 84, height: 10, marginTop: 6 }}
            />
          </div>
        </article>
      ))}
    </div>
  );
}
