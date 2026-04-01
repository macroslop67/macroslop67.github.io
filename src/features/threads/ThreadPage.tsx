import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MESSAGE_AUDIO_TYPE,
  MESSAGE_FILE_TYPE,
  MESSAGE_IMAGE_TYPE,
  MESSAGE_VIDEO_TYPE,
  POLL_START_EVENT_TYPE,
  POLL_START_EVENT_TYPE_UNSTABLE,
  REPLACE_RELATION_TYPE,
  ROOM_MESSAGE_EVENT_TYPE,
  THREAD_RELATION_TYPE,
} from "../../matrix/constants";
import { useMatrixForum } from "../../matrix/context";
import { type ForumAttachment, type ThreadReply, type ThreadViewMode } from "../../matrix/types";
import { InlineTitleMarkdown } from "../../shared/InlineTitleMarkdown";
import { RelativeTime } from "../../shared/RelativeTime";
import { ThreadDetailPane } from "./ThreadDetailPane";

type ThreadPageProps = {
  threadId: string;
};

type MatrixContent = Record<string, unknown>;

type RelationsEndpointEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: MatrixContent;
};

type RelationsEndpointResponse = {
  chunk?: RelationsEndpointEvent[];
  next_batch?: string;
};

type EditPayload = {
  body: string;
  editedAt: number;
};

type ForumPollOption = {
  id: string;
  label: string;
  voteCount: number;
  selectedByCurrentUser: boolean;
};

type ForumPoll = {
  question: string;
  options: ForumPollOption[];
  maxSelections: number;
};

const RELATIONS_PAGE_LIMIT = 100;
const RELATIONS_MAX_PAGES = 120;
const THREAD_VIEW_MODE_STORAGE_KEY = "matricesbb.thread-view-mode";
const THREAD_NOT_FOUND_GRACE_MS = 6_000;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

const isPollStartType = (eventType: string): boolean =>
  eventType === POLL_START_EVENT_TYPE || eventType === POLL_START_EVENT_TYPE_UNSTABLE;

const readPollQuestion = (pollStartContent: Record<string, unknown>): string => {
  const questionRecord = asRecord(pollStartContent.question);
  const unstableQuestion = asString(questionRecord?.["org.matrix.msc1767.text"]);
  if (unstableQuestion) {
    return unstableQuestion.trim();
  }

  const stableQuestion = asString(questionRecord?.["m.text"]);
  return stableQuestion?.trim() ?? "";
};

const readPollOptions = (pollStartContent: Record<string, unknown>): ForumPollOption[] => {
  const answers = Array.isArray(pollStartContent.answers) ? pollStartContent.answers : [];

  return answers
    .map((rawAnswer, index) => {
      const answer = asRecord(rawAnswer);
      const id = asString(answer?.id) ?? `option-${index + 1}`;
      const label =
        asString(answer?.["org.matrix.msc1767.text"]) ??
        asString(answer?.["m.text"]) ??
        asString(answer?.text) ??
        asString(rawAnswer) ??
        "";

      return {
        id,
        label: label.trim(),
        voteCount: 0,
        selectedByCurrentUser: false,
      };
    })
    .filter((option) => option.label.length > 0);
};

const readPollStart = (eventType: string, content: MatrixContent): ForumPoll | null => {
  const pollStartContent =
    asRecord(content[POLL_START_EVENT_TYPE_UNSTABLE]) ?? asRecord(content[POLL_START_EVENT_TYPE]);

  if (!pollStartContent && !isPollStartType(eventType)) {
    return null;
  }

  const question = pollStartContent ? readPollQuestion(pollStartContent) : "";
  const options = pollStartContent ? readPollOptions(pollStartContent) : [];
  const maxSelections = Math.max(1, asNumber(pollStartContent?.max_selections) ?? 1);

  if (!question && options.length === 0) {
    return null;
  }

  return {
    question: question || "Poll",
    options,
    maxSelections,
  };
};

const loadPersistedThreadViewMode = (): ThreadViewMode => {
  const storedValue = localStorage.getItem(THREAD_VIEW_MODE_STORAGE_KEY);
  return storedValue === "tree" ? "tree" : "board";
};

const persistThreadViewMode = (viewMode: ThreadViewMode): void => {
  localStorage.setItem(THREAD_VIEW_MODE_STORAGE_KEY, viewMode);
};

const mapAttachmentKind = (
  msgType: string,
  mimeType: string | null,
): ForumAttachment["kind"] | null => {
  if (mimeType?.startsWith("image/")) {
    return "image";
  }

  if (mimeType?.startsWith("video/")) {
    return "video";
  }

  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }

  if (msgType === MESSAGE_IMAGE_TYPE) {
    return "image";
  }

  if (msgType === MESSAGE_VIDEO_TYPE) {
    return "video";
  }

  if (msgType === MESSAGE_AUDIO_TYPE) {
    return "audio";
  }

  if (msgType === MESSAGE_FILE_TYPE) {
    return "file";
  }

  return null;
};

const toHttpAttachmentUrl = (homeserverUrl: string, mxcUrl: string): string => {
  if (!mxcUrl.startsWith("mxc://")) {
    return mxcUrl;
  }

  const mediaPath = mxcUrl.replace("mxc://", "");
  return `${homeserverUrl}/_matrix/media/v3/download/${mediaPath}`;
};

export function ThreadPage({ threadId }: ThreadPageProps) {
  const { state, refresh } = useMatrixForum();
  const [viewMode, setViewMode] = useState<ThreadViewMode>(() => loadPersistedThreadViewMode());
  const [endpointReplies, setEndpointReplies] = useState<ThreadReply[]>([]);
  const [endpointRepliesLoading, setEndpointRepliesLoading] = useState(false);
  const [showThreadNotFound, setShowThreadNotFound] = useState(false);
  const endpointReplyCacheRef = useRef(new Map<string, ThreadReply[]>());

  if (!state.config) {
    return <Navigate to="/login" />;
  }

  const thread = state.snapshot.threadMap[threadId] ?? null;
  const threadLookupKey = thread ? `${thread.roomId}:${thread.id}` : null;
  const homeserverUrl = state.config?.homeserverUrl ?? null;
  const accessToken = state.config?.accessToken ?? null;

  useEffect(() => {
    persistThreadViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (thread) {
      setShowThreadNotFound(false);
      return;
    }

    if (!state.config || state.status === "connecting") {
      setShowThreadNotFound(false);
      return;
    }

    setShowThreadNotFound(false);
    const notFoundTimer = window.setTimeout(() => {
      setShowThreadNotFound(true);
    }, THREAD_NOT_FOUND_GRACE_MS);

    return () => {
      window.clearTimeout(notFoundTimer);
    };
  }, [state.config, state.status, thread, threadId]);

  useEffect(() => {
    if (thread || state.status !== "live") {
      return;
    }

    void refresh();
  }, [refresh, state.status, thread]);

  useEffect(() => {
    if (!threadLookupKey || !thread || !homeserverUrl || !accessToken) {
      setEndpointReplies([]);
      setEndpointRepliesLoading(false);
      return;
    }

    const cachedReplies = endpointReplyCacheRef.current.get(threadLookupKey);
    if (cachedReplies) {
      setEndpointReplies(cachedReplies);
      setEndpointRepliesLoading(false);
    } else {
      setEndpointReplies([]);
      setEndpointRepliesLoading(true);
    }

    const knownUsers = new Map<string, { displayName: string; avatarUrl: string | null }>();
    for (const post of [thread.root, ...thread.replies]) {
      knownUsers.set(post.authorId, {
        displayName: post.authorDisplayName,
        avatarUrl: post.avatarUrl,
      });
    }

    let cancelled = false;

    const loadAllThreadReplies = async () => {
      try {
        const replyByEventId = new Map<string, ThreadReply>();
        const editsByEventId = new Map<string, EditPayload>();
        const visitedPaginationTokens = new Set<string>();
        let from: string | null = null;

        for (let page = 0; page < RELATIONS_MAX_PAGES; page += 1) {
          if (from && visitedPaginationTokens.has(from)) {
            break;
          }

          const endpoint = new URL(
            `${homeserverUrl}/_matrix/client/v1/rooms/${encodeURIComponent(
              thread.roomId,
            )}/relations/${encodeURIComponent(thread.id)}`,
          );
          endpoint.searchParams.set("dir", "b");
          endpoint.searchParams.set("limit", String(RELATIONS_PAGE_LIMIT));

          if (from) {
            visitedPaginationTokens.add(from);
            endpoint.searchParams.set("from", from);
          }

          const response = await fetch(endpoint.toString(), {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (!response.ok) {
            break;
          }

          const payload = (await response.json()) as RelationsEndpointResponse;

          for (const event of payload.chunk ?? []) {
            const eventId = event.event_id;
            if (!eventId) {
              continue;
            }

            const content = asRecord(event.content) ?? {};
            const relatesTo = asRecord(content["m.relates_to"]);
            const relType = asString(relatesTo?.rel_type);

            if (relType === REPLACE_RELATION_TYPE) {
              const targetEventId = asString(relatesTo?.event_id);
              if (!targetEventId) {
                continue;
              }

              const newContent = asRecord(content["m.new_content"]);
              const nextBody = asString((newContent ?? content).body)?.trim() ?? "";
              editsByEventId.set(targetEventId, {
                body: nextBody,
                editedAt: asNumber(event.origin_server_ts) ?? Date.now(),
              });
              continue;
            }

            if (relType !== THREAD_RELATION_TYPE || asString(relatesTo?.event_id) !== thread.id) {
              continue;
            }

            if (event.type !== ROOM_MESSAGE_EVENT_TYPE && !isPollStartType(event.type ?? "")) {
              continue;
            }

            const inReplyTo = asRecord(relatesTo?.["m.in_reply_to"]);
            const replyToEventId = asString(inReplyTo?.event_id) ?? thread.id;
            const body = asString(content.body)?.trim() ?? "";
            const poll = readPollStart(event.type ?? "", content);

            const info = asRecord(content.info);
            const mimeType = asString(info?.mimetype);
            const msgType = asString(content.msgtype);
            const attachmentKind = msgType ? mapAttachmentKind(msgType, mimeType) : null;
            const mxcUrl = asString(content.url);

            const attachments: ForumAttachment[] =
              attachmentKind && mxcUrl
                ? [
                    {
                      eventId,
                      kind: attachmentKind,
                      name: asString(content.body)?.trim() || "Attachment",
                      url: toHttpAttachmentUrl(homeserverUrl, mxcUrl),
                      mimeType,
                      size: asNumber(info?.size),
                    },
                  ]
                : [];

            const authorId = event.sender ?? "@unknown:local";
            const knownAuthor = knownUsers.get(authorId);

            if (!body && attachments.length === 0 && !poll) {
              continue;
            }

            replyByEventId.set(eventId, {
              eventId,
              roomId: thread.roomId,
              authorId,
              authorDisplayName: knownAuthor?.displayName ?? authorId,
              avatarUrl: knownAuthor?.avatarUrl ?? null,
              body,
              attachments,
              poll,
              editedAt: null,
              reactions: [],
              createdAt: asNumber(event.origin_server_ts) ?? Date.now(),
              rootEventId: thread.id,
              replyToEventId,
            });
          }

          from = payload.next_batch ?? null;
          if (!from) {
            break;
          }
        }

        for (const [editedEventId, editPayload] of editsByEventId.entries()) {
          const targetReply = replyByEventId.get(editedEventId);
          if (!targetReply) {
            continue;
          }

          replyByEventId.set(editedEventId, {
            ...targetReply,
            body: editPayload.body,
            editedAt: editPayload.editedAt,
          });
        }

        const mergedReplies = [...replyByEventId.values()]
          .filter((reply) => reply.body || reply.attachments.length > 0 || reply.poll)
          .sort((left, right) => left.createdAt - right.createdAt);

        if (!cancelled) {
          endpointReplyCacheRef.current.set(threadLookupKey, mergedReplies);
          setEndpointReplies(mergedReplies);
        }
      } finally {
        if (!cancelled) {
          setEndpointRepliesLoading(false);
        }
      }
    };

    void loadAllThreadReplies();

    return () => {
      cancelled = true;
    };
  }, [accessToken, homeserverUrl, thread, threadLookupKey]);

  const effectiveThread = useMemo(() => {
    if (!thread || endpointReplies.length === 0) {
      return thread;
    }

    const mergedReplyMap = new Map<string, ThreadReply>();

    for (const reply of thread.replies) {
      mergedReplyMap.set(reply.eventId, reply);
    }

    for (const reply of endpointReplies) {
      const existingReply = mergedReplyMap.get(reply.eventId);
      mergedReplyMap.set(reply.eventId, {
        ...(existingReply ?? reply),
        ...reply,
        reactions: existingReply?.reactions ?? reply.reactions,
      });
    }

    const replies = [...mergedReplyMap.values()].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    const lastActivityAt =
      replies.length > 0
        ? (replies.at(-1)?.createdAt ?? thread.root.createdAt)
        : thread.root.createdAt;

    return {
      ...thread,
      replies,
      replyCount: Math.max(thread.replyCount, replies.length),
      lastActivityAt,
    };
  }, [thread, endpointReplies]);

  if (!effectiveThread) {
    if (state.status === "connecting" || state.snapshot.updatedAt === 0 || !showThreadNotFound) {
      return (
        <section className="thread-page">
          <header className="thread-page-header">
            <div className="skeleton skeleton-line" style={{ width: "28%", height: 12 }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: "46%", height: 22, marginTop: 10 }}
            />
          </header>
          <article className="post-card">
            <div className="skeleton skeleton-line" style={{ width: "70%", height: 12 }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: "100%", height: 12, marginTop: 8 }}
            />
            <div
              className="skeleton skeleton-line"
              style={{ width: "82%", height: 12, marginTop: 8 }}
            />
          </article>
        </section>
      );
    }

    return (
      <section className="empty-state">
        <h2>Thread Not Found</h2>
        <p>
          This thread is not visible in the current scope yet. Open Home, choose the correct space,
          and refresh.
        </p>
        <Link to="/home" className="ghost-button">
          Return to Home
        </Link>
      </section>
    );
  }

  return (
    <section className="thread-page">
      <header className="thread-page-header">
        <nav className="forum-breadcrumbs">
          <Link to="/home">Home</Link>
          <span>/</span>
          <Link to="/groups/$groupId" params={{ groupId: effectiveThread.groupId }}>
            {effectiveThread.groupName}
          </Link>
        </nav>

        <div className="thread-page-topbar">
          <div>
            <h2 className="thread-page-title">
              <InlineTitleMarkdown title={effectiveThread.title} />
            </h2>
            <p className="subtle-line">
              {effectiveThread.replyCount} replies · last activity{" "}
              <RelativeTime timestamp={effectiveThread.lastActivityAt} />
              <p className="inline-note thread-hydration-note" aria-live="polite">
                {endpointRepliesLoading ? "Loading more replies..." : "\u00a0"}
              </p>
            </p>
          </div>

          <div className="button-set" aria-label="Thread view mode">
            <button
              type="button"
              className={`mode-button ${viewMode === "board" ? "mode-button-active" : ""}`}
              onClick={() => setViewMode("board")}
            >
              Linear
            </button>
            <button
              type="button"
              className={`mode-button ${viewMode === "tree" ? "mode-button-active" : ""}`}
              onClick={() => setViewMode("tree")}
            >
              Tree
            </button>
          </div>
        </div>
      </header>

      <ThreadDetailPane thread={effectiveThread} viewMode={viewMode} />
    </section>
  );
}
