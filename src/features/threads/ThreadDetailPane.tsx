import { useEffect, useMemo, useRef, useState } from "react";
import { useMatrixForum } from "../../matrix/context";
import {
  type ForumAttachment,
  type ForumPost,
  type ForumThread,
  type ThreadReply,
  type ThreadViewMode,
} from "../../matrix/types";
import { avatarInitials, shortUserId } from "../../shared/format";
import { MarkdownView } from "../../shared/MarkdownView";
import { RelativeTime } from "../../shared/RelativeTime";
import { type ComposerPayload, ThreadComposer } from "./ThreadComposer";
import { MAX_TREE_NESTING_DEPTH, type ReplyNode, buildReplyForest } from "./reply-tree";
import {
  useEditPostMutation,
  useReactToPostMutation,
  useRedactPostMutation,
  useReplyToThreadMutation,
} from "./use-thread-mutations";

const DEFAULT_REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀"];
const REPLY_COMPOSER_FORM_ID = "threadReplyComposer";

const getPostAnchorId = (eventId: string): string =>
  `post-${eventId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

const MAX_TREE_INDENT_LEVEL = MAX_TREE_NESTING_DEPTH - 1;

const normalizeInlineText = (value: string): string => value.trim().replace(/\s+/g, " ");

const hasRenderableBody = (body: string, attachments: ForumAttachment[]): boolean => {
  const normalizedBody = normalizeInlineText(body);
  if (!normalizedBody) {
    return false;
  }

  return !attachments.some((attachment) => normalizeInlineText(attachment.name) === normalizedBody);
};

type ThreadDetailPaneProps = {
  thread: ForumThread;
  viewMode: ThreadViewMode;
};

export function ThreadDetailPane({ thread, viewMode }: ThreadDetailPaneProps) {
  const { state } = useMatrixForum();
  const replyMutation = useReplyToThreadMutation();
  const reactionMutation = useReactToPostMutation();
  const editMutation = useEditPostMutation();
  const redactMutation = useRedactPostMutation();

  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingMarkdown, setEditingMarkdown] = useState("");
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);

  const currentUserId = state.config?.userId ?? null;

  useEffect(() => {
    setReplyTargetId(null);
    setEditingPostId(null);
    setEditingMarkdown("");
    setHighlightedPostId(null);
  }, [thread.id]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const replyTarget = useMemo(
    () => thread.replies.find((reply) => reply.eventId === replyTargetId) ?? null,
    [replyTargetId, thread.replies],
  );

  const orderedPosts = useMemo(() => [thread.root, ...thread.replies], [thread]);
  const postIndexByEventId = useMemo(() => {
    const indices = new Map<string, number>();
    for (const [index, post] of orderedPosts.entries()) {
      indices.set(post.eventId, index + 1);
    }

    return indices;
  }, [orderedPosts]);

  const replyRelationByEventId = useMemo(() => {
    const relationByEventId = new Map<string, { parentEventId: string | null; depth: number }>();
    const replyByEventId = new Map(thread.replies.map((reply) => [reply.eventId, reply] as const));

    const resolveDepth = (eventId: string, chain = new Set<string>()): number => {
      if (chain.has(eventId)) {
        return 0;
      }

      const existing = relationByEventId.get(eventId);
      if (existing) {
        return existing.depth;
      }

      const reply = replyByEventId.get(eventId);
      if (!reply) {
        relationByEventId.set(eventId, {
          parentEventId: null,
          depth: 0,
        });
        return 0;
      }

      const parentEventId = reply.replyToEventId;
      if (!parentEventId || parentEventId === thread.root.eventId) {
        relationByEventId.set(eventId, {
          parentEventId: null,
          depth: 0,
        });
        return 0;
      }

      chain.add(eventId);
      const parentDepth = resolveDepth(parentEventId, chain);
      chain.delete(eventId);

      const depth = parentDepth + 1;
      relationByEventId.set(eventId, {
        parentEventId,
        depth,
      });
      return depth;
    };

    for (const reply of thread.replies) {
      resolveDepth(reply.eventId);
    }

    return relationByEventId;
  }, [thread.replies, thread.root.eventId]);

  const replyForest = useMemo(() => buildReplyForest(thread, MAX_TREE_NESTING_DEPTH), [thread]);
  const threadStarterUserId = thread.root.authorId;

  const resolveReplyReference = (
    reply: ThreadReply,
  ): { replyToEventId: string; replyToIndex: number } | null => {
    if (!reply.replyToEventId || reply.replyToEventId === thread.root.eventId) {
      return null;
    }

    const replyToIndex = postIndexByEventId.get(reply.replyToEventId);
    if (!replyToIndex) {
      return null;
    }

    return {
      replyToEventId: reply.replyToEventId,
      replyToIndex,
    };
  };

  const highlightPost = (eventId: string) => {
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    setHighlightedPostId(eventId);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedPostId((currentValue) => (currentValue === eventId ? null : currentValue));
    }, 1700);
  };

  const resolveFocusablePostEventId = (requestedEventId: string): string | null => {
    let preferredEventId = requestedEventId;

    if (viewMode === "tree") {
      const relation = replyRelationByEventId.get(requestedEventId);
      if (relation && relation.depth > MAX_TREE_INDENT_LEVEL) {
        preferredEventId = requestedEventId;

        // Deep nodes may be visually flattened in tree view; focus their nearest visible ancestor.
        for (let hop = 0; hop < 64; hop += 1) {
          const nextRelation = replyRelationByEventId.get(preferredEventId);
          if (!nextRelation || nextRelation.depth <= MAX_TREE_INDENT_LEVEL) {
            break;
          }

          if (!nextRelation.parentEventId) {
            preferredEventId = thread.root.eventId;
            break;
          }

          preferredEventId = nextRelation.parentEventId;
        }
      }
    }

    let currentEventId: string | null = preferredEventId;
    for (let hop = 0; hop < 64 && currentEventId; hop += 1) {
      const candidateElement = document.getElementById(getPostAnchorId(currentEventId));
      if (candidateElement) {
        return currentEventId;
      }

      const relation = replyRelationByEventId.get(currentEventId);
      currentEventId =
        relation?.parentEventId ??
        (currentEventId === thread.root.eventId ? null : thread.root.eventId);
    }

    return null;
  };

  const focusReplyComposer = () => {
    const composerElement = document.getElementById(REPLY_COMPOSER_FORM_ID);
    if (!composerElement) {
      return;
    }

    composerElement.scrollIntoView({ behavior: "smooth", block: "center" });

    const editorElement = composerElement.querySelector<HTMLElement>("[contenteditable='true']");
    if (editorElement) {
      editorElement.focus();
      return;
    }

    const textAreaElement = composerElement.querySelector<HTMLTextAreaElement>("textarea");
    textAreaElement?.focus();
  };

  const focusParentPost = (eventId: string) => {
    const focusEventId = resolveFocusablePostEventId(eventId);
    if (!focusEventId) {
      return;
    }

    const anchorId = getPostAnchorId(focusEventId);
    const postElement = document.getElementById(anchorId);
    if (!postElement) {
      return;
    }

    postElement.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightPost(focusEventId);

    if (postElement instanceof HTMLElement) {
      postElement.focus();
    }

    window.history.replaceState(null, "", `#${anchorId}`);
  };

  const openReplyComposer = (targetPostId: string | null) => {
    setReplyTargetId(targetPostId);
    requestAnimationFrame(() => {
      focusReplyComposer();
    });
  };

  const publishReply = async ({ markdown, attachments, poll }: ComposerPayload) => {
    await replyMutation.mutateAsync({
      roomId: thread.roomId,
      rootEventId: thread.id,
      markdown,
      replyToEventId: replyTargetId,
      attachments,
      poll,
    });
    setReplyTargetId(null);
  };

  const reactToPost = (eventId: string, emoji: string) => {
    void reactionMutation.mutateAsync({
      roomId: thread.roomId,
      eventId,
      emoji,
    });
  };

  const startEditingPost = (post: ForumPost) => {
    setEditingPostId(post.eventId);
    setEditingMarkdown(post.body);
  };

  const cancelEditing = () => {
    setEditingPostId(null);
    setEditingMarkdown("");
  };

  const savePostEdit = (post: ForumPost) => {
    const nextBody = editingMarkdown.trim();
    if (!nextBody) {
      return;
    }

    void editMutation.mutateAsync({
      roomId: post.roomId,
      eventId: post.eventId,
      markdown: nextBody,
    });

    cancelEditing();
  };

  const canDeletePost = (post: ForumPost): boolean => {
    return thread.canModerate || currentUserId === post.authorId;
  };

  const deletePost = (post: ForumPost) => {
    if (!window.confirm("Delete this message?")) {
      return;
    }

    void redactMutation.mutateAsync({
      roomId: post.roomId,
      eventId: post.eventId,
    });
  };

  return (
    <section className="thread-detail">
      <header className="detail-top">
        <p className="detail-subline">
          #{thread.groupName} · {thread.replyCount} replies · last activity{" "}
          <RelativeTime timestamp={thread.lastActivityAt} />
        </p>

        <button className="reply-button" type="button" onClick={() => openReplyComposer(null)}>
          Reply to thread
        </button>
      </header>

      {thread.replies.length > 0 ? (
        viewMode === "tree" ? (
          <section className="reply-list">
            <TreeStylePost
              post={thread.root}
              postIndex={postIndexByEventId.get(thread.root.eventId) ?? 1}
              isHighlighted={highlightedPostId === thread.root.eventId}
              threadStarter={true}
              canEdit={currentUserId === thread.root.authorId && thread.root.body.trim().length > 0}
              canDelete={canDeletePost(thread.root)}
              isEditing={editingPostId === thread.root.eventId}
              editingMarkdown={editingMarkdown}
              onEditMarkdownChange={setEditingMarkdown}
              onStartEdit={() => startEditingPost(thread.root)}
              onCancelEdit={cancelEditing}
              onSaveEdit={() => savePostEdit(thread.root)}
              onDelete={() => deletePost(thread.root)}
              onReply={() => openReplyComposer(null)}
              onReact={(emoji) => reactToPost(thread.root.eventId, emoji)}
            />

            {replyForest.map((node) => (
              <ReplyTreeNode
                key={node.reply.eventId}
                node={node}
                depth={0}
                threadStarterUserId={threadStarterUserId}
                currentUserId={currentUserId}
                threadRootEventId={thread.root.eventId}
                postIndexByEventId={postIndexByEventId}
                editingPostId={editingPostId}
                editingMarkdown={editingMarkdown}
                highlightedPostId={highlightedPostId}
                onEditMarkdownChange={setEditingMarkdown}
                onStartEdit={startEditingPost}
                onCancelEdit={cancelEditing}
                onSaveEdit={savePostEdit}
                onDelete={deletePost}
                canDeletePost={canDeletePost}
                onReply={(eventId) => openReplyComposer(eventId)}
                onReact={reactToPost}
                onFocusReplyTarget={focusParentPost}
              />
            ))}
          </section>
        ) : (
          <section className="forum-post-list">
            <ForumStylePost
              post={thread.root}
              postIndex={postIndexByEventId.get(thread.root.eventId) ?? 1}
              isHighlighted={highlightedPostId === thread.root.eventId}
              threadStarter={thread.root.authorId === threadStarterUserId}
              canEdit={currentUserId === thread.root.authorId && thread.root.body.trim().length > 0}
              canDelete={canDeletePost(thread.root)}
              isEditing={editingPostId === thread.root.eventId}
              editingMarkdown={editingMarkdown}
              onEditMarkdownChange={setEditingMarkdown}
              onStartEdit={() => startEditingPost(thread.root)}
              onCancelEdit={cancelEditing}
              onSaveEdit={() => savePostEdit(thread.root)}
              onDelete={() => deletePost(thread.root)}
              onReply={() => openReplyComposer(null)}
              onReact={(emoji) => reactToPost(thread.root.eventId, emoji)}
            />

            {thread.replies.map((reply) => {
              const replyReference = resolveReplyReference(reply);

              return (
                <ForumStylePost
                  key={reply.eventId}
                  post={reply}
                  postIndex={postIndexByEventId.get(reply.eventId) ?? 0}
                  replyToEventId={replyReference?.replyToEventId ?? null}
                  replyToIndex={replyReference?.replyToIndex ?? null}
                  onFocusReplyTarget={focusParentPost}
                  isHighlighted={highlightedPostId === reply.eventId}
                  threadStarter={reply.authorId === threadStarterUserId}
                  canEdit={currentUserId === reply.authorId && reply.body.trim().length > 0}
                  canDelete={canDeletePost(reply)}
                  isEditing={editingPostId === reply.eventId}
                  editingMarkdown={editingMarkdown}
                  onEditMarkdownChange={setEditingMarkdown}
                  onStartEdit={() => startEditingPost(reply)}
                  onCancelEdit={cancelEditing}
                  onSaveEdit={() => savePostEdit(reply)}
                  onDelete={() => deletePost(reply)}
                  onReply={() => openReplyComposer(reply.eventId)}
                  onReact={(emoji) => reactToPost(reply.eventId, emoji)}
                />
              );
            })}
          </section>
        )
      ) : (
        <section className="forum-post-list">
          <ForumStylePost
            post={thread.root}
            postIndex={postIndexByEventId.get(thread.root.eventId) ?? 1}
            isHighlighted={highlightedPostId === thread.root.eventId}
            threadStarter={thread.root.authorId === threadStarterUserId}
            canEdit={currentUserId === thread.root.authorId && thread.root.body.trim().length > 0}
            canDelete={canDeletePost(thread.root)}
            isEditing={editingPostId === thread.root.eventId}
            editingMarkdown={editingMarkdown}
            onEditMarkdownChange={setEditingMarkdown}
            onStartEdit={() => startEditingPost(thread.root)}
            onCancelEdit={cancelEditing}
            onSaveEdit={() => savePostEdit(thread.root)}
            onDelete={() => deletePost(thread.root)}
            onReply={() => openReplyComposer(null)}
            onReact={(emoji) => reactToPost(thread.root.eventId, emoji)}
          />

          <article className="post-card">
            <p className="inline-note">
              No replies yet. Start the discussion with the editor below.
            </p>
          </article>
        </section>
      )}

      <ThreadComposer
        formId={REPLY_COMPOSER_FORM_ID}
        heading="Post reply"
        submitLabel="Publish reply"
        busy={replyMutation.isPending}
        contextPreview={
          replyTarget ? (
            <ReplyParentPreview
              replyTarget={replyTarget}
              onFocusParent={() => focusParentPost(replyTarget.eventId)}
              onClear={() => setReplyTargetId(null)}
            />
          ) : null
        }
        onSubmit={publishReply}
      />
    </section>
  );
}

type ForumStylePostProps = {
  post: ForumPost;
  postIndex: number;
  replyToEventId?: string | null;
  replyToIndex?: number | null;
  isHighlighted?: boolean;
  onFocusReplyTarget?: ((eventId: string) => void) | null;
  threadStarter?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isEditing: boolean;
  editingMarkdown: string;
  onEditMarkdownChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
};

function ForumStylePost({
  post,
  postIndex,
  replyToEventId = null,
  replyToIndex = null,
  isHighlighted = false,
  onFocusReplyTarget = null,
  threadStarter = false,
  canEdit,
  canDelete,
  isEditing,
  editingMarkdown,
  onEditMarkdownChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  onReact,
}: ForumStylePostProps) {
  return (
    <article
      className={`forum-post ${isHighlighted ? "forum-post-highlight" : ""}`}
      id={getPostAnchorId(post.eventId)}
      tabIndex={-1}
    >
      <aside className="forum-post-user">
        {post.avatarUrl ? (
          <img
            className="forum-user-avatar"
            src={post.avatarUrl}
            alt={`${post.authorDisplayName} avatar`}
            loading="lazy"
          />
        ) : (
          <div className="forum-user-avatar forum-user-avatar-fallback">
            {avatarInitials(post.authorDisplayName, post.authorId)}
          </div>
        )}

        <strong className="forum-user-name">{post.authorDisplayName}</strong>
        <span className="forum-user-handle">@{shortUserId(post.authorId)}</span>
        {threadStarter ? <span className="forum-user-badge">Thread starter</span> : null}
      </aside>

      <div className="forum-post-main">
        <header className="forum-post-header">
          <PostTimelineMeta
            post={post}
            postIndex={postIndex}
            replyToEventId={replyToEventId}
            replyToIndex={replyToIndex}
            onFocusReplyTarget={onFocusReplyTarget}
          />

          <PostActions
            post={post}
            canEdit={canEdit}
            canDelete={canDelete}
            isEditing={isEditing}
            onReply={onReply}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            onDelete={onDelete}
            onReact={onReact}
            showReactionsInActions={false}
          />
        </header>

        <PostContent
          post={post}
          isEditing={isEditing}
          editingMarkdown={editingMarkdown}
          onEditMarkdownChange={onEditMarkdownChange}
        />

        <PostReactions post={post} onReact={onReact} />
      </div>
    </article>
  );
}

type TreeStylePostProps = ForumStylePostProps;

function TreeStylePost({
  post,
  postIndex,
  replyToEventId,
  replyToIndex,
  isHighlighted,
  onFocusReplyTarget,
  threadStarter,
  canEdit,
  canDelete,
  isEditing,
  editingMarkdown,
  onEditMarkdownChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  onReact,
}: TreeStylePostProps) {
  return (
    <article
      className={`post-card ${isHighlighted ? "post-card-highlight" : ""}`}
      id={getPostAnchorId(post.eventId)}
      tabIndex={-1}
    >
      <header className="post-meta">
        <span className="reply-author-name">
          {post.authorDisplayName}
          {threadStarter ? <span className="forum-user-badge">Thread starter</span> : null}
        </span>
        <PostTimelineMeta
          post={post}
          postIndex={postIndex}
          replyToEventId={replyToEventId}
          replyToIndex={replyToIndex}
          onFocusReplyTarget={onFocusReplyTarget}
        />
      </header>

      <PostContent
        post={post}
        isEditing={isEditing}
        editingMarkdown={editingMarkdown}
        onEditMarkdownChange={onEditMarkdownChange}
      />

      <PostActions
        post={post}
        canEdit={canEdit}
        canDelete={canDelete}
        isEditing={isEditing}
        onReply={onReply}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onDelete={onDelete}
        onReact={onReact}
        showReactionsInActions={true}
      />
    </article>
  );
}

type ReplyTreeNodeProps = {
  node: ReplyNode;
  depth: number;
  threadStarterUserId: string;
  threadRootEventId: string;
  currentUserId: string | null;
  canDeletePost: (post: ForumPost) => boolean;
  postIndexByEventId: Map<string, number>;
  editingPostId: string | null;
  editingMarkdown: string;
  highlightedPostId: string | null;
  onEditMarkdownChange: (value: string) => void;
  onStartEdit: (post: ForumPost) => void;
  onCancelEdit: () => void;
  onSaveEdit: (post: ForumPost) => void;
  onDelete: (post: ForumPost) => void;
  onReply: (eventId: string) => void;
  onReact: (eventId: string, emoji: string) => void;
  onFocusReplyTarget: (eventId: string) => void;
};

function ReplyTreeNode({
  node,
  depth,
  threadStarterUserId,
  threadRootEventId,
  currentUserId,
  canDeletePost,
  postIndexByEventId,
  editingPostId,
  editingMarkdown,
  highlightedPostId,
  onEditMarkdownChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  onReact,
  onFocusReplyTarget,
}: ReplyTreeNodeProps) {
  const isEditing = editingPostId === node.reply.eventId;
  const canEdit = currentUserId === node.reply.authorId && node.reply.body.trim().length > 0;
  const replyToEventId =
    node.reply.replyToEventId && node.reply.replyToEventId !== threadRootEventId
      ? node.reply.replyToEventId
      : null;
  const replyToIndex = replyToEventId ? (postIndexByEventId.get(replyToEventId) ?? null) : null;

  return (
    <div className="reply-node">
      <TreeStylePost
        post={node.reply}
        postIndex={postIndexByEventId.get(node.reply.eventId) ?? 0}
        replyToEventId={replyToEventId}
        replyToIndex={replyToIndex}
        onFocusReplyTarget={onFocusReplyTarget}
        isHighlighted={highlightedPostId === node.reply.eventId}
        threadStarter={node.reply.authorId === threadStarterUserId}
        canEdit={canEdit}
        canDelete={canDeletePost(node.reply)}
        isEditing={isEditing}
        editingMarkdown={editingMarkdown}
        onEditMarkdownChange={onEditMarkdownChange}
        onStartEdit={() => onStartEdit(node.reply)}
        onCancelEdit={onCancelEdit}
        onSaveEdit={() => onSaveEdit(node.reply)}
        onDelete={() => onDelete(node.reply)}
        onReply={() => onReply(node.reply.eventId)}
        onReact={(emoji) => onReact(node.reply.eventId, emoji)}
      />

      {node.children.length > 0 ? (
        <div className="reply-children">
          {node.children.map((childNode) => (
            <ReplyTreeNode
              key={childNode.reply.eventId}
              node={childNode}
              depth={depth + 1}
              threadStarterUserId={threadStarterUserId}
              threadRootEventId={threadRootEventId}
              currentUserId={currentUserId}
              canDeletePost={canDeletePost}
              postIndexByEventId={postIndexByEventId}
              editingPostId={editingPostId}
              editingMarkdown={editingMarkdown}
              highlightedPostId={highlightedPostId}
              onEditMarkdownChange={onEditMarkdownChange}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onDelete={onDelete}
              onReply={onReply}
              onReact={onReact}
              onFocusReplyTarget={onFocusReplyTarget}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ReplyParentPreviewProps = {
  replyTarget: ForumPost;
  onFocusParent: () => void;
  onClear: () => void;
};

function ReplyParentPreview({ replyTarget, onFocusParent, onClear }: ReplyParentPreviewProps) {
  const previewText =
    replyTarget.body ||
    replyTarget.poll?.question ||
    replyTarget.attachments[0]?.name ||
    "(no text content)";

  return (
    <div className="reply-target">
      <button className="link-action" type="button" onClick={onFocusParent}>
        Replying to {replyTarget.authorDisplayName}: “{previewText.slice(0, 80)}
        {previewText.length > 80 ? "..." : ""}”
      </button>

      <button className="link-action" type="button" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

type PostTimelineMetaProps = {
  post: ForumPost;
  postIndex: number;
  replyToEventId?: string | null;
  replyToIndex?: number | null;
  onFocusReplyTarget?: ((eventId: string) => void) | null;
};

function PostTimelineMeta({
  post,
  postIndex,
  replyToEventId = null,
  replyToIndex = null,
  onFocusReplyTarget = null,
}: PostTimelineMetaProps) {
  const anchorId = getPostAnchorId(post.eventId);

  const handleAnchorClick = () => {
    const url = new URL(window.location.href);
    url.hash = anchorId;
    void navigator.clipboard?.writeText(url.toString());
  };

  return (
    <span className="post-time-line">
      <a href={`#${anchorId}`} className="post-anchor-link" onClick={handleAnchorClick}>
        #{postIndex}
      </a>
      {replyToEventId && replyToIndex && onFocusReplyTarget ? (
        <>
          <span>·</span>
          <button
            type="button"
            className="post-reply-reference"
            onClick={() => onFocusReplyTarget(replyToEventId)}
          >
            In reply to #{replyToIndex}
          </button>
        </>
      ) : null}
      <span>·</span>
      <RelativeTime timestamp={post.createdAt} />
      {post.editedAt ? (
        <>
          <span>·</span>
          <span>
            edited <RelativeTime timestamp={post.editedAt} />
          </span>
        </>
      ) : null}
    </span>
  );
}

type PostReactionsProps = {
  post: ForumPost;
  onReact: (emoji: string) => void;
};

function PostReactions({ post, onReact }: PostReactionsProps) {
  const usedEmoji = new Set(post.reactions.map((reaction) => reaction.key));
  const quickEmoji = DEFAULT_REACTION_EMOJIS.filter((emoji) => !usedEmoji.has(emoji));

  if (post.reactions.length === 0 && quickEmoji.length === 0) {
    return null;
  }

  return (
    <div className="post-reactions">
      {post.reactions.map((reaction) => (
        <button
          key={`${post.eventId}-${reaction.key}`}
          type="button"
          className={`reaction-chip ${reaction.reactedByCurrentUser ? "reaction-chip-active" : ""}`}
          onClick={() => onReact(reaction.key)}
          title={reaction.reactedByCurrentUser ? "Remove reaction" : "Add reaction"}
        >
          {reaction.key} <span>{reaction.count}</span>
        </button>
      ))}

      {quickEmoji.map((emoji) => (
        <button
          key={`${post.eventId}-quick-${emoji}`}
          type="button"
          className="reaction-chip reaction-chip-add"
          onClick={() => onReact(emoji)}
          title="Add reaction"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

type PostContentProps = {
  post: ForumPost;
  isEditing: boolean;
  editingMarkdown: string;
  onEditMarkdownChange: (value: string) => void;
};

function PostContent({ post, isEditing, editingMarkdown, onEditMarkdownChange }: PostContentProps) {
  const shouldRenderBody = hasRenderableBody(post.body, post.attachments);

  return (
    <>
      {isEditing ? (
        <textarea
          className="text-input"
          value={editingMarkdown}
          onChange={(event) => onEditMarkdownChange(event.target.value)}
          rows={6}
        />
      ) : shouldRenderBody ? (
        <MarkdownView markdown={post.body} />
      ) : null}

      {post.attachments.length > 0 ? <PostAttachments post={post} /> : null}
      {post.poll ? <PostPoll post={post} /> : null}
    </>
  );
}

type PostActionsProps = {
  post: ForumPost;
  canEdit: boolean;
  canDelete: boolean;
  isEditing: boolean;
  onReply: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  showReactionsInActions: boolean;
};

function PostActions({
  post,
  canEdit,
  canDelete,
  isEditing,
  onReply,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReact,
  showReactionsInActions,
}: PostActionsProps) {
  return (
    <div className="post-action-row">
      <div className="post-action-primary">
        <button className="reply-button" type="button" onClick={onReply}>
          Reply
        </button>

        {canEdit && !isEditing ? (
          <button className="reply-button" type="button" onClick={onStartEdit}>
            Edit
          </button>
        ) : null}

        {isEditing ? (
          <>
            <button className="reply-button" type="button" onClick={onSaveEdit}>
              Save
            </button>
            <button className="reply-button" type="button" onClick={onCancelEdit}>
              Cancel
            </button>
          </>
        ) : null}

        {canDelete ? (
          <button className="reply-button" type="button" onClick={onDelete}>
            Delete
          </button>
        ) : null}
      </div>

      {showReactionsInActions ? <PostReactions post={post} onReact={onReact} /> : null}
    </div>
  );
}

function PostAttachments({ post }: { post: ForumPost }) {
  return (
    <div className="post-attachments">
      {post.attachments.map((attachment) => (
        <div
          key={`${post.eventId}-${attachment.name}-${attachment.url}`}
          className="post-attachment-item"
        >
          {attachment.kind === "image" ? (
            <a href={attachment.url} target="_blank" rel="noreferrer" className="attachment-link">
              <img
                src={attachment.url}
                alt={attachment.name}
                loading="lazy"
                className="attachment-image"
              />
            </a>
          ) : null}

          <a href={attachment.url} target="_blank" rel="noreferrer" className="attachment-link">
            {attachment.name}
          </a>

          <span className="inline-note">
            {attachment.mimeType ?? "attachment"}
            {attachment.size ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function PostPoll({ post }: { post: ForumPost }) {
  if (!post.poll) {
    return null;
  }

  return (
    <section className="post-poll">
      <h4>{post.poll.question}</h4>
      <ul>
        {post.poll.options.map((option) => (
          <li key={`${post.eventId}-${option.id}`}>
            <span>{option.label}</span>
            <span className="inline-note">{option.voteCount} vote(s)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
