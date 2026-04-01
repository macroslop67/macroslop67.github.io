import { Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMatrixForum } from "../../matrix/context";
import { type ForumSpace, type ForumThread, type ThreadViewMode } from "../../matrix/types";
import { compactText, shortUserId } from "../../shared/format";
import { InlineTitleMarkdown } from "../../shared/InlineTitleMarkdown";
import { RelativeTime } from "../../shared/RelativeTime";
import { type ComposerPayload, ThreadComposer } from "./ThreadComposer";
import { ThreadDetailPane } from "./ThreadDetailPane";
import { type ReplyNode, buildReplyForest } from "./reply-tree";
import { useCreateThreadMutation } from "./use-thread-mutations";

type ThreadsPageProps = {
  selectedThreadId?: string;
};

export function ThreadsPage({ selectedThreadId }: ThreadsPageProps) {
  const navigate = useNavigate();
  const { state, refresh, selectSpace } = useMatrixForum();
  const createThreadMutation = useCreateThreadMutation();

  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [viewMode, setViewMode] = useState<ThreadViewMode>("board");
  const [composerOpen, setComposerOpen] = useState(false);

  const groups = state.snapshot.groups;
  const spaces = state.snapshot.spaces;
  const threads = state.snapshot.threads;

  const selectedSpace = spaces.find((space) => space.id === state.selectedSpaceId) ?? null;

  useEffect(() => {
    if (selectedGroupId === "all") {
      return;
    }

    if (groups.some((group) => group.id === selectedGroupId)) {
      return;
    }

    setSelectedGroupId("all");
  }, [groups, selectedGroupId]);

  const visibleThreads = useMemo(
    () =>
      selectedGroupId === "all"
        ? threads
        : threads.filter((thread) => thread.groupId === selectedGroupId),
    [selectedGroupId, threads],
  );

  const selectedThread = useMemo(() => {
    if (selectedThreadId) {
      return visibleThreads.find((thread) => thread.id === selectedThreadId) ?? null;
    }

    return visibleThreads[0] ?? null;
  }, [selectedThreadId, visibleThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    if (visibleThreads.some((thread) => thread.id === selectedThreadId)) {
      return;
    }

    void navigate({ to: "/threads" });
  }, [navigate, selectedThreadId, visibleThreads]);

  const selectedGroup =
    selectedGroupId === "all"
      ? null
      : (groups.find((group) => group.id === selectedGroupId) ?? null);

  const handleOpenThread = (threadId: string) => {
    void navigate({
      to: "/threads/$threadId",
      params: { threadId },
    });
  };

  const handleSpaceSelection = (spaceId: string) => {
    selectSpace(spaceId || null);
    setSelectedGroupId("all");
    setComposerOpen(false);
  };

  const handleCreateThread = async ({ title, markdown, attachments, poll }: ComposerPayload) => {
    if (selectedGroupId === "all") {
      throw new Error("Pick a group first to publish a thread.");
    }

    await createThreadMutation.mutateAsync({
      roomId: selectedGroupId,
      title,
      markdown,
      attachments,
      poll,
    });

    setComposerOpen(false);
  };

  if (!state.config) {
    return <Navigate to="/login" />;
  }

  return (
    <>
      {state.errorMessage ? (
        <p className="status-banner status-banner-error">{state.errorMessage}</p>
      ) : null}

      <section className="forum-grid">
        <aside className="group-panel">
          <h2>Groups</h2>
          <p className="subtle-line">
            {selectedSpace
              ? `Joined rooms in ${selectedSpace.name}.`
              : "No joined spaces detected yet."}
          </p>

          <div className="group-list">
            <button
              type="button"
              className={`group-button ${selectedGroupId === "all" ? "group-button-active" : ""}`}
              onClick={() => setSelectedGroupId("all")}
            >
              <strong>All groups</strong>
              <small>{threads.length} thread(s)</small>
            </button>

            {groups.map((group) => {
              const groupThreads = threads.filter((thread) => thread.groupId === group.id).length;

              return (
                <button
                  type="button"
                  key={group.id}
                  className={`group-button ${
                    selectedGroupId === group.id ? "group-button-active" : ""
                  }`}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <strong>{group.name}</strong>
                  <small>
                    {groupThreads} thread(s) · {group.memberCount} member(s)
                  </small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="thread-panel">
          <header className="thread-toolbar">
            <div className="toolbar-top">
              <h2>Bulletin Board</h2>
              <div className="toolbar-actions">
                <div className="space-selector-wrap">
                  <label className="space-selector-label" htmlFor="spaceSelector">
                    Space
                  </label>
                  <select
                    id="spaceSelector"
                    className="space-selector"
                    value={state.selectedSpaceId ?? ""}
                    onChange={(event) => handleSpaceSelection(event.target.value)}
                    disabled={spaces.length === 0}
                  >
                    {spaces.length === 0 ? <option value="">No joined spaces</option> : null}
                    {spaces.length > 0 ? <option value="">All joined rooms</option> : null}
                    {spaces.map((space) => (
                      <SpaceSelectorOption key={space.id} space={space} />
                    ))}
                  </select>
                </div>

                <div className="button-set">
                  <button
                    type="button"
                    className={`mode-button ${viewMode === "board" ? "mode-button-active" : ""}`}
                    onClick={() => setViewMode("board")}
                  >
                    Board
                  </button>
                  <button
                    type="button"
                    className={`mode-button ${viewMode === "tree" ? "mode-button-active" : ""}`}
                    onClick={() => setViewMode("tree")}
                  >
                    Tree
                  </button>
                </div>

                <button type="button" className="ghost-button" onClick={() => void refresh()}>
                  Refresh
                </button>

                <button
                  type="button"
                  className="solid-button"
                  disabled={selectedGroupId === "all"}
                  onClick={() => setComposerOpen((current) => !current)}
                >
                  {composerOpen ? "Hide Composer" : "New Thread"}
                </button>
              </div>
            </div>

            <p className="inline-note">
              {selectedGroup
                ? `Posting to #${selectedGroup.name}`
                : "Select a single group to publish new threads."}
            </p>
          </header>

          {composerOpen ? (
            <ThreadComposer
              heading={selectedGroup ? `New thread in #${selectedGroup.name}` : "New thread"}
              submitLabel="Publish thread"
              withTitle
              busy={createThreadMutation.isPending}
              onSubmit={handleCreateThread}
              onCancel={() => setComposerOpen(false)}
            />
          ) : null}

          <div className="thread-list">
            {visibleThreads.length > 0 ? (
              visibleThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  selected={selectedThread?.id === thread.id}
                  viewMode={viewMode}
                  onOpen={handleOpenThread}
                />
              ))
            ) : (
              <article className="post-card">
                <p className="inline-note">
                  No threads found in this filter. Publish a new one to start.
                </p>
              </article>
            )}
          </div>
        </section>

        <aside className="detail-panel">
          {selectedThread ? (
            <ThreadDetailPane thread={selectedThread} viewMode={viewMode} />
          ) : (
            <section className="empty-state">
              <h2>No Thread Selected</h2>
              <p>Pick a thread from the board to open details and reply.</p>
            </section>
          )}
        </aside>
      </section>
    </>
  );
}

type ThreadCardProps = {
  thread: ForumThread;
  selected: boolean;
  viewMode: ThreadViewMode;
  onOpen: (threadId: string) => void;
};

function ThreadCard({ thread, selected, viewMode, onOpen }: ThreadCardProps) {
  return (
    <button
      type="button"
      className={`thread-card ${selected ? "thread-card-selected" : ""}`}
      onClick={() => onOpen(thread.id)}
    >
      <h3>
        <InlineTitleMarkdown title={thread.title} />
      </h3>

      <div className="thread-card-meta">
        <span>#{thread.groupName}</span>
        <span>{thread.replyCount} replies</span>
        <RelativeTime timestamp={thread.lastActivityAt} />
      </div>

      <p className="thread-snippet">
        {compactText(
          thread.replies[0]?.body ||
            thread.replies[0]?.attachments[0]?.name ||
            thread.root.body ||
            thread.root.attachments[0]?.name ||
            "No text body",
          180,
        )}
      </p>

      <div className="thread-card-meta">
        <span>Started by @{shortUserId(thread.root.authorId)}</span>
      </div>

      {viewMode === "tree" ? <ThreadTreePreview thread={thread} /> : null}
    </button>
  );
}

function ThreadTreePreview({ thread }: { thread: ForumThread }) {
  const forest = buildReplyForest(thread);

  if (forest.length === 0) {
    return null;
  }

  return (
    <div className="thread-tree-preview">
      {forest.slice(0, 2).map((node) => (
        <TreePreviewNode key={node.reply.eventId} node={node} depth={0} />
      ))}
    </div>
  );
}

function SpaceSelectorOption({ space }: { space: ForumSpace }) {
  return <option value={space.id}>{space.name}</option>;
}

type TreePreviewNodeProps = {
  node: ReplyNode;
  depth: number;
};

function TreePreviewNode({ node, depth }: TreePreviewNodeProps) {
  if (depth >= 2) {
    return null;
  }

  return (
    <div className="tree-preview-node">
      <p>
        <strong>{node.reply.authorDisplayName}:</strong> {compactText(node.reply.body, 72)}
      </p>

      {node.children.slice(0, 1).map((childNode) => (
        <TreePreviewNode key={childNode.reply.eventId} node={childNode} depth={depth + 1} />
      ))}
    </div>
  );
}
