import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMatrixForum } from "../../matrix/context";
import { type ChatMessage, type ChatRoomSummary } from "../../matrix/types";
import { avatarInitials, compactText } from "../../shared/format";
import { MarkdownView } from "../../shared/MarkdownView";
import { RelativeTime } from "../../shared/RelativeTime";
import { type ComposerPayload, ThreadComposer } from "../threads/ThreadComposer";
import {
  useEditPostMutation,
  usePostChatMessageMutation,
  useReactToPostMutation,
  useRedactPostMutation,
  useStartThreadFromChatMutation,
  useVoteInPollMutation,
} from "../threads/use-thread-mutations";

const CHAT_COMPOSER_FORM_ID = "chatMessageComposer";
const THREAD_INIT_COMPOSER_FORM_ID = "chatThreadInitComposer";
const CHAT_PANE_SECTION_ID = "chatPaneSection";
const DEFAULT_REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀"];
const CHAT_ROOMS_REFRESH_INTERVAL_MS = 15_000;
const CHAT_MESSAGES_REFRESH_INTERVAL_MS = 4_000;
const CHAT_INITIAL_HISTORY_PASSES = 1;
const CHAT_INCREMENTAL_HISTORY_PASSES = 6;
const CHAT_PAGE_SIZE = 80;

type RefreshMessagesOptions = {
  backfillPasses?: number;
  showLoader?: boolean;
  cursorEventId?: string | null;
  pageSize?: number;
  replaceMessages?: boolean;
};

const mergeMessages = (existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  const mergedByEventId = new Map<string, ChatMessage>();

  for (const message of existing) {
    mergedByEventId.set(message.eventId, message);
  }

  for (const message of incoming) {
    const existingMessage = mergedByEventId.get(message.eventId);
    mergedByEventId.set(message.eventId, {
      ...(existingMessage ?? message),
      ...message,
      reactions: message.reactions,
      attachments: message.attachments,
      poll: message.poll,
    });
  }

  return [...mergedByEventId.values()].sort((left, right) => left.createdAt - right.createdAt);
};

const getPostAnchorId = (eventId: string): string =>
  `chat-post-${eventId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

const toErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return fallbackMessage;
};

const normalizeInlineText = (value: string): string => value.trim().replace(/\s+/g, " ");

const hasRenderableBody = (body: string, attachments: ChatMessage["attachments"]): boolean => {
  const normalizedBody = normalizeInlineText(body);
  if (!normalizedBody) {
    return false;
  }

  return !attachments.some((attachment) => normalizeInlineText(attachment.name) === normalizedBody);
};

export function ChatPane() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, listChatRooms, loadChatMessages, selectSpace } = useMatrixForum();
  const postChatMessageMutation = usePostChatMessageMutation();
  const startThreadFromChatMutation = useStartThreadFromChatMutation();
  const editMutation = useEditPostMutation();
  const reactMutation = useReactToPostMutation();
  const redactMutation = useRedactPostMutation();
  const votePollMutation = useVoteInPollMutation();

  const [expanded, setExpanded] = useState(false);
  const [chatRooms, setChatRooms] = useState<ChatRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [paginationCursorEventId, setPaginationCursorEventId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [threadInitTargetId, setThreadInitTargetId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingMarkdown, setEditingMarkdown] = useState("");
  const [focusRequestedEventId, setFocusRequestedEventId] = useState<string | null>(null);

  const roomRequestGenerationRef = useRef(0);
  const messageRequestGenerationRef = useRef(0);
  const chatPaneToggleRef = useRef<HTMLButtonElement | null>(null);
  const chatPaneSectionRef = useRef<HTMLElement | null>(null);

  const currentUserId = state.config?.userId ?? null;

  const messageByEventId = useMemo(() => {
    const byEventId = new Map<string, ChatMessage>();

    for (const message of messages) {
      byEventId.set(message.eventId, message);
    }

    return byEventId;
  }, [messages]);

  const postIndexByEventId = useMemo(() => {
    const indices = new Map<string, number>();

    for (const [index, message] of messages.entries()) {
      indices.set(message.eventId, index + 1);
    }

    return indices;
  }, [messages]);

  const replyTarget = replyTargetId ? (messageByEventId.get(replyTargetId) ?? null) : null;
  const threadInitTarget = threadInitTargetId
    ? (messageByEventId.get(threadInitTargetId) ?? null)
    : null;

  const selectedRoom = selectedRoomId
    ? (chatRooms.find((room) => room.id === selectedRoomId) ?? null)
    : null;

  const openChatPane = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapseChatPane = useCallback(() => {
    setExpanded(false);

    requestAnimationFrame(() => {
      chatPaneToggleRef.current?.focus();
    });
  }, []);

  const refreshRooms = useCallback(() => {
    const requestGeneration = ++roomRequestGenerationRef.current;
    setRoomsLoading(true);
    setErrorMessage(null);

    try {
      const rooms = listChatRooms();
      if (requestGeneration !== roomRequestGenerationRef.current) {
        return;
      }

      setChatRooms(rooms);

      setSelectedRoomId((previousRoomId) => {
        if (previousRoomId && rooms.some((room) => room.id === previousRoomId)) {
          return previousRoomId;
        }

        return rooms[0]?.id ?? null;
      });
    } catch (error) {
      if (requestGeneration !== roomRequestGenerationRef.current) {
        return;
      }

      setErrorMessage(toErrorMessage(error, t("common.unknownError")));
      setChatRooms([]);
      setSelectedRoomId(null);
    } finally {
      if (requestGeneration === roomRequestGenerationRef.current) {
        setRoomsLoading(false);
      }
    }
  }, [listChatRooms, t]);

  const refreshMessagesForRoom = useCallback(
    async (roomId: string, options?: RefreshMessagesOptions) => {
      const requestGeneration = ++messageRequestGenerationRef.current;
      const showLoader = options?.showLoader ?? true;
      const replaceMessages = options?.replaceMessages ?? false;
      const cursorEventId = options?.cursorEventId?.trim() || null;

      if (showLoader) {
        setMessagesLoading(true);
      }

      setErrorMessage(null);

      try {
        const result = await loadChatMessages(roomId, {
          backfillPasses: options?.backfillPasses ?? CHAT_INITIAL_HISTORY_PASSES,
          cursorEventId,
          pageSize: options?.pageSize ?? CHAT_PAGE_SIZE,
        });

        if (requestGeneration !== messageRequestGenerationRef.current) {
          return;
        }

        if (replaceMessages) {
          setMessages(result.messages);
          setPaginationCursorEventId(result.nextCursorEventId);
        } else {
          setMessages((previousMessages) => mergeMessages(previousMessages, result.messages));

          if (cursorEventId) {
            setPaginationCursorEventId(result.nextCursorEventId);
          } else {
            setPaginationCursorEventId(
              (previousCursorEventId) => previousCursorEventId ?? result.nextCursorEventId,
            );
          }
        }

        setHasMoreHistory(result.hasMoreHistory);
        setChatRooms((previousRooms) =>
          previousRooms
            .map((room) => (room.id === result.room.id ? result.room : room))
            .sort((left, right) => {
              if (left.lastActivityAt === right.lastActivityAt) {
                return left.name.localeCompare(right.name);
              }

              return right.lastActivityAt - left.lastActivityAt;
            }),
        );
      } catch (error) {
        if (requestGeneration !== messageRequestGenerationRef.current) {
          return;
        }

        setErrorMessage(toErrorMessage(error, t("common.unknownError")));
        if (replaceMessages) {
          setMessages([]);
          setHasMoreHistory(false);
          setPaginationCursorEventId(null);
        }
      } finally {
        if (showLoader && requestGeneration === messageRequestGenerationRef.current) {
          setMessagesLoading(false);
        }
      }
    },
    [loadChatMessages, t],
  );

  useEffect(() => {
    if (!expanded || !state.config) {
      return;
    }

    refreshRooms();
  }, [expanded, refreshRooms, state.config]);

  useEffect(() => {
    if (!expanded || !state.config) {
      return;
    }

    const refreshInterval = window.setInterval(() => {
      refreshRooms();
    }, CHAT_ROOMS_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [expanded, refreshRooms, state.config]);

  useEffect(() => {
    if (!expanded || !selectedRoomId || !state.config) {
      return;
    }

    void refreshMessagesForRoom(selectedRoomId, {
      backfillPasses: CHAT_INITIAL_HISTORY_PASSES,
      showLoader: true,
      pageSize: CHAT_PAGE_SIZE,
      replaceMessages: true,
    });
  }, [expanded, refreshMessagesForRoom, selectedRoomId, state.config]);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape") {
        return;
      }

      collapseChatPane();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [collapseChatPane, expanded]);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    requestAnimationFrame(() => {
      chatPaneSectionRef.current?.focus();
    });
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !selectedRoomId || !state.config) {
      return;
    }

    const refreshInterval = window.setInterval(() => {
      void refreshMessagesForRoom(selectedRoomId, {
        backfillPasses: 0,
        showLoader: false,
        pageSize: CHAT_PAGE_SIZE,
        replaceMessages: false,
      });
    }, CHAT_MESSAGES_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [expanded, refreshMessagesForRoom, selectedRoomId, state.config]);

  useEffect(() => {
    setReplyTargetId(null);
    setThreadInitTargetId(null);
    setEditingPostId(null);
    setEditingMarkdown("");
    setFocusRequestedEventId(null);
    setMessages([]);
    setHasMoreHistory(false);
    setHistoryLoading(false);
    setPaginationCursorEventId(null);
  }, [selectedRoomId]);

  const focusComposer = (formId: string) => {
    const composerElement = document.getElementById(formId);
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

  const focusParentMessage = (eventId: string) => {
    if (!messageByEventId.has(eventId)) {
      return;
    }

    setFocusRequestedEventId(eventId);
  };

  const openReplyComposer = (messageId: string | null) => {
    setReplyTargetId(messageId);
    setThreadInitTargetId(null);

    requestAnimationFrame(() => {
      focusComposer(CHAT_COMPOSER_FORM_ID);
    });
  };

  const openThreadInitComposer = (messageId: string) => {
    setThreadInitTargetId(messageId);
    setReplyTargetId(null);

    requestAnimationFrame(() => {
      focusComposer(THREAD_INIT_COMPOSER_FORM_ID);
    });
  };

  const sendMessage = async ({ markdown, attachments, poll }: ComposerPayload) => {
    if (!selectedRoomId) {
      throw new Error(t("chat.pickRoom"));
    }

    await postChatMessageMutation.mutateAsync({
      roomId: selectedRoomId,
      markdown,
      replyToEventId: replyTargetId,
      attachments,
      poll,
    });

    setReplyTargetId(null);
    await refreshMessagesForRoom(selectedRoomId, {
      backfillPasses: 0,
      showLoader: false,
      pageSize: CHAT_PAGE_SIZE,
      replaceMessages: false,
    });
  };

  const initializeThread = async ({ markdown, attachments, poll }: ComposerPayload) => {
    if (!selectedRoomId || !threadInitTarget) {
      throw new Error(t("matrixErrors.startThreadMissingPost"));
    }

    const createdThreadId = await startThreadFromChatMutation.mutateAsync({
      roomId: selectedRoomId,
      rootEventId: threadInitTarget.eventId,
      markdown,
      attachments,
      poll,
    });

    setThreadInitTargetId(null);
    setReplyTargetId(null);
    selectSpace(null);
    setExpanded(false);

    void navigate({
      to: "/threads/$threadId",
      params: { threadId: createdThreadId },
    });
  };

  const startEditingPost = (message: ChatMessage) => {
    setEditingPostId(message.eventId);
    setEditingMarkdown(message.body);
  };

  const cancelEditing = () => {
    setEditingPostId(null);
    setEditingMarkdown("");
  };

  const saveEdit = async (message: ChatMessage) => {
    const nextBody = editingMarkdown.trim();
    if (!nextBody) {
      return;
    }

    await editMutation.mutateAsync({
      roomId: message.roomId,
      eventId: message.eventId,
      markdown: nextBody,
    });

    cancelEditing();

    if (selectedRoomId) {
      await refreshMessagesForRoom(selectedRoomId, {
        backfillPasses: 0,
        showLoader: false,
        pageSize: CHAT_PAGE_SIZE,
        replaceMessages: false,
      });
    }
  };

  const reactToPost = async (message: ChatMessage, emoji: string) => {
    await reactMutation.mutateAsync({
      roomId: message.roomId,
      eventId: message.eventId,
      emoji,
    });

    if (selectedRoomId) {
      await refreshMessagesForRoom(selectedRoomId, {
        backfillPasses: 0,
        showLoader: false,
        pageSize: CHAT_PAGE_SIZE,
        replaceMessages: false,
      });
    }
  };

  const removePost = async (message: ChatMessage, canDelete: boolean) => {
    if (!canDelete) {
      return;
    }

    if (!window.confirm(t("threadDetail.deleteConfirm"))) {
      return;
    }

    await redactMutation.mutateAsync({
      roomId: message.roomId,
      eventId: message.eventId,
    });

    if (selectedRoomId) {
      await refreshMessagesForRoom(selectedRoomId, {
        backfillPasses: 0,
        showLoader: false,
        pageSize: CHAT_PAGE_SIZE,
        replaceMessages: false,
      });
    }
  };

  const voteInPoll = async (message: ChatMessage, answerIds: string[]) => {
    if (!message.poll) {
      return;
    }

    await votePollMutation.mutateAsync({
      roomId: message.roomId,
      pollEventId: message.eventId,
      answerIds,
    });

    if (selectedRoomId) {
      await refreshMessagesForRoom(selectedRoomId, {
        backfillPasses: 0,
        showLoader: false,
        pageSize: CHAT_PAGE_SIZE,
        replaceMessages: false,
      });
    }
  };

  const loadOlderHistory = useCallback(async () => {
    if (!selectedRoomId || historyLoading || !hasMoreHistory) {
      return;
    }

    const oldestEventId = paginationCursorEventId ?? messages[0]?.eventId ?? null;
    if (!oldestEventId) {
      return;
    }

    setHistoryLoading(true);

    try {
      await refreshMessagesForRoom(selectedRoomId, {
        backfillPasses: CHAT_INCREMENTAL_HISTORY_PASSES,
        showLoader: false,
        cursorEventId: oldestEventId,
        pageSize: CHAT_PAGE_SIZE,
        replaceMessages: false,
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [
    hasMoreHistory,
    historyLoading,
    messages,
    paginationCursorEventId,
    refreshMessagesForRoom,
    selectedRoomId,
  ]);

  if (!state.config) {
    return null;
  }

  return (
    <div className="chat-pane-root">
      {!expanded ? (
        <button
          ref={chatPaneToggleRef}
          type="button"
          className="chat-pane-toggle"
          onClick={openChatPane}
          aria-label={t("chat.openPaneAria")}
          aria-expanded={expanded}
          aria-controls={CHAT_PANE_SECTION_ID}
        >
          {t("chat.chats")}
          {chatRooms.length > 0 ? <span>{chatRooms.length}</span> : ""}
        </button>
      ) : null}

      {expanded ? (
        <section
          ref={chatPaneSectionRef}
          id={CHAT_PANE_SECTION_ID}
          className="chat-pane"
          aria-label={t("chat.chats")}
          aria-keyshortcuts="Escape"
          tabIndex={-1}
        >
          <header className="chat-pane-header">
            <h3>{t("chat.chats")}</h3>

            <div className="chat-pane-header-actions" role="group">
              <button type="button" className="ghost-button" onClick={refreshRooms}>
                {t("common.refresh")}
              </button>
              <button type="button" className="ghost-button" onClick={collapseChatPane}>
                {t("chat.collapse")}
              </button>
            </div>
          </header>

          <div className="chat-pane-body">
            <aside className="chat-room-list" aria-label={t("chat.chats")}>
              {roomsLoading ? (
                <ChatRoomListSkeleton />
              ) : chatRooms.length === 0 ? (
                <div className="chat-empty">{t("chat.noJoinedRooms")}</div>
              ) : (
                chatRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    className={`chat-room-button ${selectedRoomId === room.id ? "chat-room-button-active" : ""}`}
                    onClick={() => setSelectedRoomId(room.id)}
                  >
                    <div className="chat-room-button-heading">
                      {room.avatarUrl ? (
                        <img
                          src={room.avatarUrl}
                          alt={`${room.name} avatar`}
                          className="group-avatar"
                          loading="lazy"
                        />
                      ) : null}
                      <strong>{room.name}</strong>
                    </div>
                    <span className="inline-note">
                      {t("count.unread", { count: room.unreadCount })}
                      {room.highlightCount > 0
                        ? ` · ${t("count.mention", { count: room.highlightCount })}`
                        : ""}
                    </span>
                  </button>
                ))
              )}
            </aside>

            <section className="chat-room-main">
              {selectedRoom ? (
                <>
                  <header className="chat-room-header">
                    <div>
                      <h4>{selectedRoom.name}</h4>
                      <p className="inline-note">
                        {t("count.member", { count: selectedRoom.memberCount })} ·{" "}
                        {t("common.lastActivity")}{" "}
                        <RelativeTime timestamp={selectedRoom.lastActivityAt} />
                      </p>
                      {selectedRoom.topic ? (
                        <p className="inline-note">{compactText(selectedRoom.topic, 160)}</p>
                      ) : null}
                    </div>
                  </header>

                  {errorMessage ? (
                    <p className="status-banner status-banner-error">{errorMessage}</p>
                  ) : null}

                  <div className="chat-message-panel">
                    {messagesLoading ? <ChatMessageListSkeleton /> : null}

                    {!messagesLoading && messages.length === 0 ? (
                      <article className="post-card">
                        <p className="inline-note">{t("chat.noVisibleMessages")}</p>
                      </article>
                    ) : null}

                    {!messagesLoading && messages.length > 0 ? (
                      <VirtualizedChatMessages
                        roomId={selectedRoom.id}
                        messages={messages}
                        currentUserId={currentUserId}
                        roomCanModerate={selectedRoom.canModerate}
                        messageByEventId={messageByEventId}
                        postIndexByEventId={postIndexByEventId}
                        hasMoreHistory={hasMoreHistory}
                        historyLoading={historyLoading}
                        focusEventId={focusRequestedEventId}
                        editingPostId={editingPostId}
                        editingMarkdown={editingMarkdown}
                        onFocusConsumed={() => setFocusRequestedEventId(null)}
                        onLoadOlderHistory={loadOlderHistory}
                        onReply={(messageId) => openReplyComposer(messageId)}
                        onStartThread={(messageId) => openThreadInitComposer(messageId)}
                        onFocusParent={focusParentMessage}
                        onStartEdit={startEditingPost}
                        onCancelEdit={cancelEditing}
                        onSaveEdit={(message) => void saveEdit(message)}
                        onEditMarkdownChange={setEditingMarkdown}
                        onReact={(message, emoji) => void reactToPost(message, emoji)}
                        onVotePoll={(message, answerIds) => void voteInPoll(message, answerIds)}
                        pollVoteBusy={votePollMutation.isPending}
                        onRemove={(message) =>
                          void removePost(
                            message,
                            selectedRoom.canModerate || currentUserId === message.authorId,
                          )
                        }
                      />
                    ) : null}
                  </div>

                  {threadInitTarget ? (
                    <ThreadComposer
                      formId={THREAD_INIT_COMPOSER_FORM_ID}
                      heading={t("chat.startThreadFrom", {
                        index: postIndexByEventId.get(threadInitTarget.eventId) ?? "?",
                      })}
                      submitLabel={t("chat.startThread")}
                      compact
                      busy={startThreadFromChatMutation.isPending}
                      contextPreview={
                        <div className="reply-target">
                          <button
                            className="link-action"
                            type="button"
                            onClick={() => focusParentMessage(threadInitTarget.eventId)}
                          >
                            {t("chat.threadRootLabel")}:{" "}
                            {compactText(threadInitTarget.body || t("chat.noTextRoot"), 80)}
                          </button>

                          <button
                            className="link-action"
                            type="button"
                            onClick={() => setThreadInitTargetId(null)}
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      }
                      onSubmit={initializeThread}
                    />
                  ) : (
                    <ThreadComposer
                      formId={CHAT_COMPOSER_FORM_ID}
                      heading={replyTarget ? t("common.reply") : t("chat.sendMessage")}
                      submitLabel={t("common.send")}
                      compact
                      busy={postChatMessageMutation.isPending}
                      contextPreview={
                        replyTarget ? (
                          <div className="reply-target">
                            <button
                              className="link-action"
                              type="button"
                              onClick={() => focusParentMessage(replyTarget.eventId)}
                            >
                              {t("chat.replyingTo", {
                                index: postIndexByEventId.get(replyTarget.eventId) ?? "?",
                                author: replyTarget.authorDisplayName,
                              })}
                            </button>

                            <button
                              className="link-action"
                              type="button"
                              onClick={() => setReplyTargetId(null)}
                            >
                              {t("common.clear")}
                            </button>
                          </div>
                        ) : null
                      }
                      onSubmit={sendMessage}
                    />
                  )}
                </>
              ) : (
                <div className="chat-empty">{t("chat.pickRoom")}</div>
              )}
            </section>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type VirtualizedChatMessagesProps = {
  roomId: string;
  messages: ChatMessage[];
  currentUserId: string | null;
  roomCanModerate: boolean;
  messageByEventId: Map<string, ChatMessage>;
  postIndexByEventId: Map<string, number>;
  hasMoreHistory: boolean;
  historyLoading: boolean;
  focusEventId: string | null;
  editingPostId: string | null;
  editingMarkdown: string;
  onFocusConsumed: () => void;
  onLoadOlderHistory: () => Promise<void>;
  onReply: (messageId: string) => void;
  onStartThread: (messageId: string) => void;
  onFocusParent: (eventId: string) => void;
  onStartEdit: (message: ChatMessage) => void;
  onCancelEdit: () => void;
  onSaveEdit: (message: ChatMessage) => void;
  onEditMarkdownChange: (markdown: string) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onVotePoll: (message: ChatMessage, answerIds: string[]) => void;
  pollVoteBusy: boolean;
  onRemove: (message: ChatMessage) => void;
};

function VirtualizedChatMessages({
  roomId,
  messages,
  currentUserId,
  roomCanModerate,
  messageByEventId,
  postIndexByEventId,
  hasMoreHistory,
  historyLoading,
  focusEventId,
  editingPostId,
  editingMarkdown,
  onFocusConsumed,
  onLoadOlderHistory,
  onReply,
  onStartThread,
  onFocusParent,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditMarkdownChange,
  onReact,
  onVotePoll,
  pollVoteBusy,
  onRemove,
}: VirtualizedChatMessagesProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const topHistoryRequestInFlightRef = useRef(false);
  const pendingHistoryScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const delayedBottomSyncTimerRef = useRef<number | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  const messageIndexByEventId = useMemo(() => {
    const byEventId = new Map<string, number>();

    for (const [index, message] of messages.entries()) {
      byEventId.set(message.eventId, index);
    }

    return byEventId;
  }, [messages]);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 236,
    overscan: 8,
    getItemKey: (index) => messages[index]?.eventId ?? index,
  });

  const scrollToLatestMessage = useCallback(() => {
    if (messages.length === 0) {
      return;
    }

    if (delayedBottomSyncTimerRef.current) {
      window.clearTimeout(delayedBottomSyncTimerRef.current);
      delayedBottomSyncTimerRef.current = null;
    }

    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });

      // A second pass keeps the viewport pinned when row measurements settle after render.
      requestAnimationFrame(() => {
        const viewportElement = viewportRef.current;
        if (!viewportElement) {
          return;
        }

        viewportElement.scrollTop = viewportElement.scrollHeight;
      });
    });

    delayedBottomSyncTimerRef.current = window.setTimeout(() => {
      const viewportElement = viewportRef.current;
      if (!viewportElement) {
        return;
      }

      rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      viewportElement.scrollTop = viewportElement.scrollHeight;
      delayedBottomSyncTimerRef.current = null;
    }, 90);
  }, [messages.length, rowVirtualizer]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    previousMessageCountRef.current = 0;
    topHistoryRequestInFlightRef.current = false;
    pendingHistoryScrollRef.current = null;

    if (delayedBottomSyncTimerRef.current) {
      window.clearTimeout(delayedBottomSyncTimerRef.current);
      delayedBottomSyncTimerRef.current = null;
    }
  }, [roomId]);

  useEffect(() => {
    return () => {
      if (delayedBottomSyncTimerRef.current) {
        window.clearTimeout(delayedBottomSyncTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    const updateStickiness = () => {
      const distanceToBottom =
        viewportElement.scrollHeight - viewportElement.scrollTop - viewportElement.clientHeight;
      shouldStickToBottomRef.current = distanceToBottom < 160;

      if (
        viewportElement.scrollTop <= 80 &&
        hasMoreHistory &&
        !historyLoading &&
        !topHistoryRequestInFlightRef.current
      ) {
        topHistoryRequestInFlightRef.current = true;
        pendingHistoryScrollRef.current = {
          scrollTop: viewportElement.scrollTop,
          scrollHeight: viewportElement.scrollHeight,
        };

        void onLoadOlderHistory().finally(() => {
          topHistoryRequestInFlightRef.current = false;
        });
      }
    };

    updateStickiness();
    viewportElement.addEventListener("scroll", updateStickiness, { passive: true });

    return () => {
      viewportElement.removeEventListener("scroll", updateStickiness);
    };
  }, [hasMoreHistory, historyLoading, onLoadOlderHistory, roomId]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const historyScrollSnapshot = pendingHistoryScrollRef.current;

    if (!historyLoading && historyScrollSnapshot) {
      requestAnimationFrame(() => {
        const viewportElement = viewportRef.current;
        if (!viewportElement) {
          pendingHistoryScrollRef.current = null;
          return;
        }

        const delta = viewportElement.scrollHeight - historyScrollSnapshot.scrollHeight;
        viewportElement.scrollTop = historyScrollSnapshot.scrollTop + Math.max(0, delta);
        pendingHistoryScrollRef.current = null;
      });

      previousMessageCountRef.current = messages.length;
      return;
    }

    const hasNewMessages = messages.length > previousCount;
    const shouldScrollToLatest =
      previousCount === 0 || (hasNewMessages && shouldStickToBottomRef.current);

    if (messages.length > 0 && shouldScrollToLatest) {
      scrollToLatestMessage();
    }

    previousMessageCountRef.current = messages.length;
  }, [historyLoading, messages.length, scrollToLatestMessage]);

  useEffect(() => {
    if (!focusEventId) {
      return;
    }

    const targetIndex = messageIndexByEventId.get(focusEventId);
    if (targetIndex === undefined) {
      onFocusConsumed();
      return;
    }

    rowVirtualizer.scrollToIndex(targetIndex, { align: "center" });
    setHighlightedEventId(focusEventId);

    const clearFocusTimer = window.setTimeout(() => {
      onFocusConsumed();
      setHighlightedEventId((currentValue) =>
        currentValue === focusEventId ? null : currentValue,
      );
    }, 1400);

    return () => {
      window.clearTimeout(clearFocusTimer);
    };
  }, [focusEventId, messageIndexByEventId, onFocusConsumed, rowVirtualizer]);

  return (
    <div ref={viewportRef} className="chat-message-viewport" aria-label={t("chat.messagesAria")}>
      {historyLoading ? (
        <div className="chat-history-loading">{t("chat.loadingOlderMessages")}</div>
      ) : null}
      <div className="chat-message-spacer" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const message = messages[virtualItem.index];
          if (!message) {
            return null;
          }

          const parentMessage = message.replyToEventId
            ? (messageByEventId.get(message.replyToEventId) ?? null)
            : null;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
              className="chat-message-item"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <ChatMessageRow
                message={message}
                parentMessage={parentMessage}
                postIndex={postIndexByEventId.get(message.eventId) ?? virtualItem.index + 1}
                isOwnMessage={currentUserId === message.authorId}
                isEditing={editingPostId === message.eventId}
                isHighlighted={highlightedEventId === message.eventId}
                editingMarkdown={editingMarkdown}
                canEdit={currentUserId === message.authorId && message.body.trim().length > 0}
                canDelete={roomCanModerate || currentUserId === message.authorId}
                onReply={() => onReply(message.eventId)}
                onStartThread={() => onStartThread(message.eventId)}
                onFocusParent={() =>
                  message.replyToEventId ? onFocusParent(message.replyToEventId) : undefined
                }
                onStartEdit={() => onStartEdit(message)}
                onCancelEdit={onCancelEdit}
                onSaveEdit={() => onSaveEdit(message)}
                onEditMarkdownChange={onEditMarkdownChange}
                onReact={(emoji) => onReact(message, emoji)}
                onVotePoll={(answerIds) => onVotePoll(message, answerIds)}
                pollVoteBusy={pollVoteBusy}
                onRemove={() => onRemove(message)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ChatMessageRowProps = {
  message: ChatMessage;
  parentMessage: ChatMessage | null;
  postIndex: number;
  isOwnMessage: boolean;
  isEditing: boolean;
  isHighlighted: boolean;
  editingMarkdown: string;
  canEdit: boolean;
  canDelete: boolean;
  onReply: () => void;
  onStartThread: () => void;
  onFocusParent: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditMarkdownChange: (markdown: string) => void;
  onReact: (emoji: string) => void;
  onVotePoll: (answerIds: string[]) => void;
  pollVoteBusy: boolean;
  onRemove: () => void;
};

function ChatMessageRow({
  message,
  parentMessage,
  postIndex,
  isOwnMessage,
  isEditing,
  isHighlighted,
  editingMarkdown,
  canEdit,
  canDelete,
  onReply,
  onStartThread,
  onFocusParent,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditMarkdownChange,
  onReact,
  onVotePoll,
  pollVoteBusy,
  onRemove,
}: ChatMessageRowProps) {
  const { t } = useTranslation();
  const anchorId = getPostAnchorId(message.eventId);

  const copyAnchorLink = () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = anchorId;
    void navigator.clipboard?.writeText(nextUrl.toString());
  };

  return (
    <article
      className={`chat-message-row ${isOwnMessage ? "chat-message-row-own" : ""} ${
        isHighlighted ? "chat-message-row-highlight" : ""
      }`}
      id={anchorId}
      tabIndex={-1}
    >
      {message.avatarUrl ? (
        <img
          className="chat-message-avatar"
          src={message.avatarUrl}
          alt={`${message.authorDisplayName} avatar`}
          loading="lazy"
        />
      ) : (
        <div className="chat-message-avatar chat-message-avatar-fallback">
          {avatarInitials(message.authorDisplayName, message.authorId)}
        </div>
      )}

      <div className="chat-message-content">
        <header className="chat-message-meta">
          <span className="chat-message-author">{message.authorDisplayName}</span>
          <button type="button" className="chat-anchor-button" onClick={copyAnchorLink}>
            #{postIndex}
          </button>
          <span>·</span>
          <RelativeTime timestamp={message.createdAt} />
          {message.editedAt ? (
            <>
              <span>·</span>
              <span>
                {t("common.edited")} <RelativeTime timestamp={message.editedAt} />
              </span>
            </>
          ) : null}
        </header>

        {parentMessage ? (
          <button type="button" className="chat-reply-pill" onClick={onFocusParent}>
            {t("threadDetail.replyingToPreview", { author: parentMessage.authorDisplayName })}: “
            {compactText(
              parentMessage.body ||
                parentMessage.poll?.question ||
                parentMessage.attachments[0]?.name ||
                t("common.noText"),
              72,
            )}
            ”
          </button>
        ) : null}

        <div className="chat-message-bubble">
          {isEditing ? (
            <textarea
              className="text-input"
              value={editingMarkdown}
              onChange={(event) => onEditMarkdownChange(event.target.value)}
              rows={5}
            />
          ) : hasRenderableBody(message.body, message.attachments) ? (
            <MarkdownView markdown={message.body} />
          ) : null}

          <ChatMessageAttachments message={message} />
          <ChatMessagePoll message={message} onVote={onVotePoll} busy={pollVoteBusy} />
          <ChatMessageReactions message={message} onReact={onReact} />
        </div>

        <div className="chat-message-actions">
          <button type="button" className="reply-button" onClick={onReply}>
            {t("common.reply")}
          </button>
          {message.thread ? (
            <Link
              to="/threads/$threadId"
              params={{ threadId: message.thread.threadId }}
              className="reply-button"
            >
              {t("chat.viewThread")} ({t("count.reply", { count: message.thread.replyCount })})
            </Link>
          ) : (
            <button type="button" className="reply-button" onClick={onStartThread}>
              {t("chat.startThread")}
            </button>
          )}

          {canEdit && !isEditing ? (
            <button type="button" className="reply-button" onClick={onStartEdit}>
              {t("common.edit")}
            </button>
          ) : null}

          {isEditing ? (
            <>
              <button type="button" className="reply-button" onClick={onSaveEdit}>
                {t("common.save")}
              </button>
              <button type="button" className="reply-button" onClick={onCancelEdit}>
                {t("common.cancel")}
              </button>
            </>
          ) : null}

          {canDelete ? (
            <button type="button" className="reply-button" onClick={onRemove}>
              {t("common.delete")}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ChatMessageAttachments({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();

  if (message.attachments.length === 0) {
    return null;
  }

  return (
    <div className="post-attachments">
      {message.attachments.map((attachment) => (
        <div
          key={`${message.eventId}-${attachment.name}-${attachment.url}`}
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
            {attachment.mimeType ?? t("common.attachment")}
            {attachment.size ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChatMessagePoll({
  message,
  onVote,
  busy,
}: {
  message: ChatMessage;
  onVote: (answerIds: string[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();

  if (!message.poll) {
    return null;
  }

  const poll = message.poll;

  const selectedFromServer = useMemo(
    () => poll.options.filter((option) => option.selectedByCurrentUser).map((option) => option.id),
    [poll.options],
  );
  const selectedFromServerKey = selectedFromServer.join("|");

  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(selectedFromServer);

  useEffect(() => {
    setSelectedOptionIds(selectedFromServer);
  }, [message.eventId, selectedFromServer, selectedFromServerKey]);

  const toggleOption = (optionId: string) => {
    setSelectedOptionIds((previousOptionIds) => {
      const alreadySelected = previousOptionIds.includes(optionId);
      if (alreadySelected) {
        return previousOptionIds.filter((id) => id !== optionId);
      }

      if (previousOptionIds.length >= poll.maxSelections) {
        if (poll.maxSelections === 1) {
          return [optionId];
        }

        return previousOptionIds;
      }

      return [...previousOptionIds, optionId];
    });
  };

  const submitVote = () => {
    if (selectedOptionIds.length === 0 || busy) {
      return;
    }

    onVote(selectedOptionIds);
  };

  return (
    <section className="post-poll post-poll-voting">
      <h4>{poll.question}</h4>
      <ul className="post-poll-options">
        {poll.options.map((option) => (
          <li
            key={`${message.eventId}-${option.id}`}
            className={`post-poll-option ${selectedOptionIds.includes(option.id) ? "post-poll-option-selected" : ""}`}
          >
            <button
              type="button"
              className={`reply-button post-poll-option-button ${selectedOptionIds.includes(option.id) ? "post-poll-option-button-selected" : ""}`}
              onClick={() => toggleOption(option.id)}
            >
              {option.label}
            </button>
            <span className="inline-note post-poll-vote-count">
              {t("count.vote", { count: option.voteCount })}
            </span>
          </li>
        ))}
      </ul>
      <div className="chat-message-actions post-poll-actions">
        <span className="inline-note post-poll-hint">
          {t("poll.maxSelections", { count: poll.maxSelections })}
        </span>
        <button
          type="button"
          className="reply-button post-poll-submit"
          onClick={submitVote}
          disabled={busy || selectedOptionIds.length === 0}
        >
          {busy ? t("poll.votingAction") : t("poll.voteAction")}
        </button>
      </div>
    </section>
  );
}

function ChatMessageReactions({
  message,
  onReact,
}: {
  message: ChatMessage;
  onReact: (emoji: string) => void;
}) {
  const { t } = useTranslation();
  const usedReactions = new Set(message.reactions.map((reaction) => reaction.key));
  const quickReactions = DEFAULT_REACTION_EMOJIS.filter((emoji) => !usedReactions.has(emoji));

  if (message.reactions.length === 0 && quickReactions.length === 0) {
    return null;
  }

  return (
    <div className="post-reactions">
      {message.reactions.map((reaction) => (
        <button
          key={`${message.eventId}-${reaction.key}`}
          type="button"
          className={`reaction-chip ${reaction.reactedByCurrentUser ? "reaction-chip-active" : ""}`}
          onClick={() => onReact(reaction.key)}
          title={
            reaction.reactedByCurrentUser ? t("common.removeReaction") : t("common.addReaction")
          }
        >
          {reaction.key} <span>{reaction.count}</span>
        </button>
      ))}

      {quickReactions.map((emoji) => (
        <button
          key={`${message.eventId}-quick-${emoji}`}
          type="button"
          className="reaction-chip reaction-chip-add"
          onClick={() => onReact(emoji)}
          title={t("common.addReaction")}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ChatRoomListSkeleton() {
  const { t } = useTranslation();

  return (
    <div className="chat-room-skeleton-list" aria-label={t("chat.loadingRoomsAria")}>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={`chat-room-skeleton-${index}`} className="chat-room-skeleton-item">
          <div className="chat-room-skeleton-heading">
            <div className="skeleton chat-room-skeleton-avatar" />
            <div className="skeleton skeleton-line" style={{ width: "62%", height: 12 }} />
          </div>
          <div className="skeleton skeleton-line" style={{ width: "44%", height: 10 }} />
        </div>
      ))}
    </div>
  );
}

function ChatMessageListSkeleton() {
  const { t } = useTranslation();

  return (
    <div className="chat-message-skeleton-list" aria-label={t("chat.loadingMessagesAria")}>
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={`chat-message-skeleton-${index}`}
          className={`chat-message-skeleton-row ${index % 3 === 2 ? "chat-message-skeleton-row-own" : ""}`}
        >
          <div className="skeleton chat-message-skeleton-avatar" />
          <div className="chat-message-skeleton-bubble">
            <div className="skeleton skeleton-line" style={{ width: "38%", height: 10 }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: "100%", height: 10, marginTop: 7 }}
            />
            <div
              className="skeleton skeleton-line"
              style={{ width: "72%", height: 10, marginTop: 7 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
