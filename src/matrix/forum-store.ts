import {
  ClientEvent,
  EventTimeline,
  type ISendEventResponse,
  type MatrixEvent,
  MatrixClient,
  RoomEvent,
  SyncState,
  createClient,
  type Room,
  type SyncStateData,
} from "matrix-js-sdk";
import {
  ANNOTATION_RELATION_TYPE,
  DEFAULT_INITIAL_SYNC_LIMIT,
  MESSAGE_AUDIO_TYPE,
  MESSAGE_FILE_TYPE,
  MESSAGE_IMAGE_TYPE,
  MESSAGE_TEXT_TYPE,
  MESSAGE_VIDEO_TYPE,
  POLL_RESPONSE_EVENT_TYPE,
  POLL_RESPONSE_EVENT_TYPE_UNSTABLE,
  POLL_START_EVENT_TYPE,
  POLL_START_EVENT_TYPE_UNSTABLE,
  REACTION_EVENT_TYPE,
  REPLACE_RELATION_TYPE,
  ROOM_ENCRYPTION_EVENT_TYPE,
  ROOM_MESSAGE_EVENT_TYPE,
  ROOM_POWER_LEVELS_EVENT_TYPE,
  ROOM_TOPIC_EVENT_TYPE,
  ROOM_AVATAR_EVENT_TYPE,
  THREAD_RELATION_TYPE,
} from "./constants";
import {
  type EndpointThreadRoot,
  buildForumSpace,
  buildForumGroup,
  buildThreadsForRoom,
  getSpaceChildRoomIds,
  isSpaceRoom,
} from "./thread-index";
import {
  type PollDraft,
  type ChatMessage,
  type ChatRoomSummary,
  type ForumAttachment,
  type ForumPoll,
  type ForumState,
  type ForumThread,
  type LoadChatMessagesOptions,
  type LoadChatMessagesResult,
  type MatrixConnectionConfig,
  type SendChatMessagePayload,
  type StartThreadFromChatPayload,
  createEmptySnapshot,
} from "./types";

type Listener = () => void;

type MatrixContent = Record<string, unknown>;

type ThreadEndpointEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: MatrixContent;
  unsigned?: MatrixContent;
  "m.relations"?: MatrixContent;
};

type ThreadsEndpointResponse = {
  chunk?: ThreadEndpointEvent[];
  next_batch?: string;
};

type MessageRelation = {
  relationType: string | null;
  relatedEventId: string | null;
  replyToEventId: string | null;
};

type AnnotationRelation = {
  targetEventId: string;
  key: string;
};

type ReplaceRelation = {
  targetEventId: string;
};

type PollResponse = {
  targetEventId: string;
  answerIds: string[];
};

type PollVoteRecord = {
  answerIds: string[];
  createdAt: number;
};

type RelationsEndpointEvent = {
  event_id?: string;
  sender?: string;
  content?: MatrixContent;
  unsigned?: MatrixContent;
};

type RelationsEndpointResponse = {
  chunk?: RelationsEndpointEvent[];
  next_batch?: string;
};

type EditPayload = {
  body: string | null;
  editedAt: number;
};

const THREADS_PAGE_LIMIT = 50;
const THREADS_MAX_PAGES = 200;
const RELATIONS_PAGE_LIMIT = 200;
const RELATIONS_MAX_PAGES = 120;
const CHAT_INITIAL_BACKFILL_PASSES = 2;
const CHAT_BACKFILL_LIMIT = 200;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

const asInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string") {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isNaN(parsedValue) ? null : Math.max(0, parsedValue);
  }

  return null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const readThreadReplyCount = (event: ThreadEndpointEvent): number | null => {
  const topLevelRelations = asRecord(event["m.relations"]);
  const unsignedRelations = asRecord(asRecord(event.unsigned)?.["m.relations"]);
  const contentRelations = asRecord(asRecord(event.content)?.["m.relations"]);

  const threadSummary =
    asRecord(topLevelRelations?.["m.thread"]) ??
    asRecord(unsignedRelations?.["m.thread"]) ??
    asRecord(contentRelations?.["m.thread"]);

  return asInteger(threadSummary?.count);
};

const SELECTED_SPACE_STORAGE_KEY = "matricesbb.selected-space";

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown Matrix client error";
};

const normalizeHomeserver = (value: string): string => value.trim().replace(/\/$/, "");

const loadPersistedSelectedSpaceId = (): string | null => {
  const storedValue = localStorage.getItem(SELECTED_SPACE_STORAGE_KEY);
  return storedValue?.trim() || null;
};

const persistSelectedSpaceId = (spaceId: string | null): void => {
  if (!spaceId) {
    localStorage.removeItem(SELECTED_SPACE_STORAGE_KEY);
    return;
  }

  localStorage.setItem(SELECTED_SPACE_STORAGE_KEY, spaceId);
};

const guessAttachmentMsgType = (mimeType: string): string => {
  if (mimeType.startsWith("image/")) {
    return MESSAGE_IMAGE_TYPE;
  }

  if (mimeType.startsWith("video/")) {
    return MESSAGE_VIDEO_TYPE;
  }

  if (mimeType.startsWith("audio/")) {
    return MESSAGE_AUDIO_TYPE;
  }

  return MESSAGE_FILE_TYPE;
};

const isPollStartType = (eventType: string): boolean =>
  eventType === POLL_START_EVENT_TYPE || eventType === POLL_START_EVENT_TYPE_UNSTABLE;

const isPollResponseType = (eventType: string): boolean =>
  eventType === POLL_RESPONSE_EVENT_TYPE || eventType === POLL_RESPONSE_EVENT_TYPE_UNSTABLE;

const readMessageBody = (content: MatrixContent): string => {
  const body = asString(content.body);
  return body?.trim() ?? "";
};

const readMessageRelation = (content: MatrixContent): MessageRelation | null => {
  const relatesTo = asRecord(content["m.relates_to"]);
  if (!relatesTo) {
    return null;
  }

  const inReplyTo = asRecord(relatesTo["m.in_reply_to"]);
  return {
    relationType: asString(relatesTo.rel_type),
    relatedEventId: asString(relatesTo.event_id),
    replyToEventId: asString(inReplyTo?.event_id),
  };
};

const readAnnotationRelation = (content: MatrixContent): AnnotationRelation | null => {
  const relation = readMessageRelation(content);
  if (!relation || relation.relationType !== ANNOTATION_RELATION_TYPE || !relation.relatedEventId) {
    return null;
  }

  const relatesTo = asRecord(content["m.relates_to"]);
  const key = asString(relatesTo?.key);
  if (!key) {
    return null;
  }

  return {
    targetEventId: relation.relatedEventId,
    key,
  };
};

const readReplaceRelation = (content: MatrixContent): ReplaceRelation | null => {
  const relation = readMessageRelation(content);
  if (!relation || relation.relationType !== REPLACE_RELATION_TYPE || !relation.relatedEventId) {
    return null;
  }

  return {
    targetEventId: relation.relatedEventId,
  };
};

const readPollQuestion = (pollStartContent: Record<string, unknown>): string => {
  const questionRecord = asRecord(pollStartContent.question);
  const unstableQuestion = asString(questionRecord?.["org.matrix.msc1767.text"]);
  if (unstableQuestion) {
    return unstableQuestion.trim();
  }

  const stableQuestion = asString(questionRecord?.["m.text"]);
  return stableQuestion?.trim() ?? "";
};

const readPollOptions = (pollStartContent: Record<string, unknown>) => {
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

const readPollResponse = (content: MatrixContent): PollResponse | null => {
  const relation = readMessageRelation(content);
  if (!relation?.relatedEventId) {
    return null;
  }

  const responseContent =
    asRecord(content[POLL_RESPONSE_EVENT_TYPE_UNSTABLE]) ??
    asRecord(content[POLL_RESPONSE_EVENT_TYPE]);
  const answerIds = asStringArray(responseContent?.answers);

  if (answerIds.length === 0) {
    return null;
  }

  return {
    targetEventId: relation.relatedEventId,
    answerIds,
  };
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

const readAttachments = (
  content: MatrixContent,
  room: Room,
  eventId: string,
): ForumAttachment[] => {
  const msgType = asString(content.msgtype);
  if (!msgType) {
    return [];
  }

  const info = asRecord(content.info);
  const mimeType = asString(info?.mimetype);
  const kind = mapAttachmentKind(msgType, mimeType);
  if (!kind) {
    return [];
  }

  const mxcUrl = asString(content.url);
  if (!mxcUrl) {
    return [];
  }

  return [
    {
      eventId,
      kind,
      name: asString(content.body)?.trim() || "Attachment",
      url: room.client.mxcUrlToHttp(mxcUrl) ?? mxcUrl,
      mimeType,
      size: asNumber(info?.size),
    },
  ];
};

const readRoomTopic = (room: Room): string | null => {
  const topicEvent = room.currentState.getStateEvents(ROOM_TOPIC_EVENT_TYPE, "");
  if (!topicEvent) {
    return null;
  }

  const topic = asString(topicEvent.getContent<MatrixContent>().topic);
  return topic?.trim() || null;
};

const readRoomAvatarUrl = (room: Room): string | null => {
  const avatarEvent = room.currentState.getStateEvents(ROOM_AVATAR_EVENT_TYPE, "");
  const mxcUrl = avatarEvent
    ? asString(avatarEvent.getContent<MatrixContent>().url)
    : ((room as { getAvatarMxcUrl?: () => string | null }).getAvatarMxcUrl?.() ?? null);

  return mxcUrl ? room.client.mxcUrlToHttp(mxcUrl, 72, 72, "crop", true) : null;
};

const readRoomUnreadCount = (room: Room): { unreadCount: number; highlightCount: number } => ({
  unreadCount: room.getUnreadNotificationCount() ?? 0,
  highlightCount: room.getUnreadNotificationCount("highlight" as never) ?? 0,
});

const canModerateRoom = (room: Room): boolean => {
  const myUserId = room.myUserId;
  if (!myUserId) {
    return false;
  }

  const powerLevelsEvent = room.currentState.getStateEvents(ROOM_POWER_LEVELS_EVENT_TYPE, "");
  const powerLevelsContent = powerLevelsEvent?.getContent<MatrixContent>();
  const users = asRecord(powerLevelsContent?.users);
  const usersDefault = asNumber(powerLevelsContent?.users_default) ?? 0;
  const redactLevel = asNumber(powerLevelsContent?.redact) ?? 50;
  const userPowerLevel = asNumber(users?.[myUserId]) ?? usersDefault;

  return userPowerLevel >= redactLevel;
};

const applyPollVotes = (
  poll: ForumPoll | null,
  votesByOptionId: Map<string, Set<string>> | undefined,
  myUserId: string,
): ForumPoll | null => {
  if (!poll) {
    return poll;
  }

  return {
    ...poll,
    options: poll.options.map((option) => ({
      ...option,
      voteCount: votesByOptionId?.get(option.id)?.size ?? 0,
      selectedByCurrentUser: votesByOptionId?.get(option.id)?.has(myUserId) ?? false,
    })),
  };
};

const buildPollVotesByTargetEventId = (
  latestVotesByTargetAndSender: Map<string, Map<string, PollVoteRecord>>,
): Map<string, Map<string, Set<string>>> => {
  const votesByTargetEventId = new Map<string, Map<string, Set<string>>>();

  for (const [targetEventId, latestVotesBySender] of latestVotesByTargetAndSender.entries()) {
    const votesByOptionId = new Map<string, Set<string>>();

    for (const [senderId, voteRecord] of latestVotesBySender.entries()) {
      for (const answerId of new Set(voteRecord.answerIds)) {
        const senders = votesByOptionId.get(answerId) ?? new Set<string>();
        senders.add(senderId);
        votesByOptionId.set(answerId, senders);
      }
    }

    votesByTargetEventId.set(targetEventId, votesByOptionId);
  }

  return votesByTargetEventId;
};

const applyReactions = <T extends { eventId: string; reactions: ChatMessage["reactions"] }>(
  post: T,
  myUserId: string,
  reactionsByEventId: Map<string, Map<string, Set<string>>>,
): T => {
  const reactionsForPost = reactionsByEventId.get(post.eventId);
  if (!reactionsForPost || reactionsForPost.size === 0) {
    return post;
  }

  const reactions = [...reactionsForPost.entries()]
    .map(([key, senders]) => ({
      key,
      count: senders.size,
      reactedByCurrentUser: senders.has(myUserId),
    }))
    .sort((left, right) => {
      if (left.count === right.count) {
        return left.key.localeCompare(right.key);
      }

      return right.count - left.count;
    });

  return {
    ...post,
    reactions,
  };
};

export class MatrixForumStore {
  private readonly listeners = new Set<Listener>();
  private state: ForumState = {
    status: "idle",
    errorMessage: null,
    config: null,
    selectedSpaceId: null,
    isLoading: false,
    snapshot: createEmptySnapshot(),
  };

  private client: MatrixClient | null = null;
  private scheduledRefresh: ReturnType<typeof setTimeout> | null = null;
  private connectionGeneration = 0;
  private refreshGeneration = 0;
  private readonly backfilledRoomIds = new Set<string>();
  private readonly backfillingRoomIds = new Set<string>();
  private readonly roomThreadRoots = new Map<string, Map<string, EndpointThreadRoot>>();
  private readonly roomThreadRootRequests = new Map<
    string,
    Promise<Map<string, EndpointThreadRoot>>
  >();
  private readonly chatBackfilledRoomIds = new Set<string>();
  private readonly chatBackfillRequests = new Map<string, Promise<boolean>>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ForumState => this.state;

  connect = async (config: MatrixConnectionConfig): Promise<void> => {
    const normalizedConfig: MatrixConnectionConfig = {
      ...config,
      homeserverUrl: normalizeHomeserver(config.homeserverUrl),
      initialSyncLimit: config.initialSyncLimit || DEFAULT_INITIAL_SYNC_LIMIT,
    };

    this.connectionGeneration += 1;
    const generation = this.connectionGeneration;
    this.refreshGeneration += 1;
    this.backfilledRoomIds.clear();
    this.backfillingRoomIds.clear();
    this.roomThreadRoots.clear();
    this.roomThreadRootRequests.clear();
    this.chatBackfilledRoomIds.clear();
    this.chatBackfillRequests.clear();

    this.teardownClient();
    this.setState({
      status: "connecting",
      errorMessage: null,
      config: normalizedConfig,
      selectedSpaceId: this.state.selectedSpaceId ?? loadPersistedSelectedSpaceId(),
      isLoading: true,
      snapshot: createEmptySnapshot(),
    });

    const client = createClient({
      baseUrl: normalizedConfig.homeserverUrl,
      accessToken: normalizedConfig.accessToken,
      userId: normalizedConfig.userId,
      timelineSupport: true,
    });

    this.client = client;
    client.on(ClientEvent.Sync, this.handleSyncState);
    client.on(RoomEvent.Timeline, this.handleTimeline);

    try {
      await client.startClient({
        initialSyncLimit: normalizedConfig.initialSyncLimit,
        includeArchivedRooms: false,
        lazyLoadMembers: true,
        threadSupport: true,
      });
    } catch (error) {
      if (generation !== this.connectionGeneration) {
        return;
      }

      this.setState({
        status: "error",
        errorMessage: toErrorMessage(error),
      });

      return;
    }

    if (generation !== this.connectionGeneration) {
      return;
    }

    this.scheduleRefresh(120);
  };

  disconnect = (): void => {
    this.connectionGeneration += 1;
    this.refreshGeneration += 1;
    this.backfilledRoomIds.clear();
    this.backfillingRoomIds.clear();
    this.roomThreadRoots.clear();
    this.roomThreadRootRequests.clear();
    this.chatBackfilledRoomIds.clear();
    this.chatBackfillRequests.clear();
    this.teardownClient();
    this.setState({
      status: "idle",
      errorMessage: null,
      config: null,
      selectedSpaceId: null,
      isLoading: false,
      snapshot: createEmptySnapshot(),
    });
  };

  dispose = (): void => {
    this.connectionGeneration += 1;
    this.refreshGeneration += 1;
    this.backfilledRoomIds.clear();
    this.backfillingRoomIds.clear();
    this.roomThreadRoots.clear();
    this.roomThreadRootRequests.clear();
    this.chatBackfilledRoomIds.clear();
    this.chatBackfillRequests.clear();
    this.teardownClient();
    this.listeners.clear();
  };

  refresh = async (): Promise<void> => {
    await this.rebuildSnapshot();
  };

  setSelectedSpace = (spaceId: string | null): void => {
    const nextSpaceId = spaceId?.trim() || null;
    if (this.state.selectedSpaceId === nextSpaceId) {
      return;
    }

    persistSelectedSpaceId(nextSpaceId);

    this.setState({
      selectedSpaceId: nextSpaceId,
    });

    this.roomThreadRoots.clear();
    this.roomThreadRootRequests.clear();
    void this.rebuildSnapshot();
  };

  createThread = async (
    roomId: string,
    title: string,
    markdown: string,
    attachments: File[],
    poll: PollDraft | null,
  ): Promise<void> => {
    const client = this.getConnectedClient();
    const rootBody = title.trim();
    const replyBody = markdown.trim();

    if (!rootBody) {
      throw new Error("Thread title cannot be empty");
    }

    if (!replyBody && attachments.length === 0 && !poll) {
      throw new Error("Thread content cannot be empty");
    }

    const rootResponse = await client.sendEvent(
      roomId,
      ROOM_MESSAGE_EVENT_TYPE as never,
      {
        msgtype: MESSAGE_TEXT_TYPE,
        body: rootBody,
      } as never,
    );

    const rootEventId = rootResponse.event_id;
    if (!rootEventId) {
      throw new Error("Could not determine new thread root event ID");
    }

    if (replyBody) {
      await this.sendThreadMessage(roomId, rootEventId, replyBody, rootEventId);
    }

    for (const attachment of attachments) {
      await this.sendThreadAttachment(roomId, rootEventId, attachment, rootEventId);
    }

    if (poll) {
      await this.sendThreadPoll(roomId, rootEventId, poll, rootEventId);
    }

    this.invalidateRoomThreadRoots(roomId);
    this.scheduleRefresh(40);
  };

  replyToThread = async (
    roomId: string,
    rootEventId: string,
    markdown: string,
    replyToEventId: string | null,
    attachments: File[],
    poll: PollDraft | null,
  ): Promise<void> => {
    const body = markdown.trim();

    if (!body && attachments.length === 0 && !poll) {
      throw new Error("Reply content cannot be empty");
    }

    if (body) {
      await this.sendThreadMessage(roomId, rootEventId, body, replyToEventId ?? rootEventId);
    }

    for (const attachment of attachments) {
      await this.sendThreadAttachment(
        roomId,
        rootEventId,
        attachment,
        replyToEventId ?? rootEventId,
      );
    }

    if (poll) {
      await this.sendThreadPoll(roomId, rootEventId, poll, replyToEventId ?? rootEventId);
    }

    this.scheduleRefresh(40);
  };

  listChatRooms = (): ChatRoomSummary[] => {
    return this.getJoinedRooms()
      .filter((room) => !isSpaceRoom(room))
      .filter((room) => !this.isRoomEncrypted(room))
      .map((room) => this.buildChatRoomSummary(room))
      .sort((left, right) => {
        if (left.lastActivityAt === right.lastActivityAt) {
          return left.name.localeCompare(right.name);
        }

        return right.lastActivityAt - left.lastActivityAt;
      });
  };

  loadChatMessages = async (
    roomId: string,
    options?: LoadChatMessagesOptions,
  ): Promise<LoadChatMessagesResult> => {
    const client = this.getConnectedClient();
    const room = client.getRoom(roomId);

    if (!room || room.getMyMembership() !== "join") {
      throw new Error("Room not available in your joined rooms.");
    }

    if (isSpaceRoom(room)) {
      throw new Error("Cannot open chat view for a space room.");
    }

    if (this.isRoomEncrypted(room)) {
      throw new Error("Encrypted rooms are hidden in chat pane.");
    }

    const requestedBackfillPasses = Math.max(
      0,
      options?.backfillPasses ?? CHAT_INITIAL_BACKFILL_PASSES,
    );
    const pageSize = Math.max(1, Math.min(400, options?.pageSize ?? 80));
    const cursorEventId = options?.cursorEventId?.trim() || null;

    const hasMoreServerHistory = await this.ensureChatRoomBackfill(
      room,
      client,
      requestedBackfillPasses,
    );
    const allMessages = this.buildChatMessagesForRoom(room);

    let endIndex = allMessages.length;
    if (cursorEventId) {
      const cursorIndex = allMessages.findIndex((message) => message.eventId === cursorEventId);
      if (cursorIndex >= 0) {
        endIndex = cursorIndex;
      }
    }

    const startIndex = Math.max(0, endIndex - pageSize);
    const pageMessages = allMessages.slice(startIndex, endIndex);
    const nextCursorEventId = pageMessages[0]?.eventId ?? cursorEventId;
    const hasLocalHistory = startIndex > 0;

    return {
      room: this.buildChatRoomSummary(room),
      messages: pageMessages,
      hasMoreHistory: hasLocalHistory || hasMoreServerHistory,
      nextCursorEventId,
    };
  };

  postChatMessage = async ({
    roomId,
    markdown,
    replyToEventId,
    attachments,
    poll,
  }: SendChatMessagePayload): Promise<void> => {
    const body = markdown.trim();

    if (!body && attachments.length === 0 && !poll) {
      throw new Error("Message content cannot be empty");
    }

    if (body) {
      await this.sendChatText(roomId, body, replyToEventId);
    }

    for (const attachment of attachments) {
      await this.sendChatAttachment(roomId, attachment, replyToEventId);
    }

    if (poll) {
      await this.sendChatPoll(roomId, poll, replyToEventId);
    }

    this.scheduleRefresh(40);
  };

  startThreadFromChat = async ({
    roomId,
    rootEventId,
    markdown,
    attachments,
    poll,
  }: StartThreadFromChatPayload): Promise<string> => {
    const rootEventIdTrimmed = rootEventId.trim();
    if (!rootEventIdTrimmed) {
      throw new Error("A chat post is required to start a thread.");
    }

    await this.replyToThread(
      roomId,
      rootEventIdTrimmed,
      markdown,
      rootEventIdTrimmed,
      attachments,
      poll,
    );
    this.invalidateRoomThreadRoots(roomId);

    return rootEventIdTrimmed;
  };

  voteInPoll = async (roomId: string, pollEventId: string, answerIds: string[]): Promise<void> => {
    const client = this.getConnectedClient();
    const normalizedPollEventId = pollEventId.trim();
    const normalizedAnswerIds = answerIds.map((answerId) => answerId.trim()).filter(Boolean);

    if (!normalizedPollEventId) {
      throw new Error("Poll event ID is required.");
    }

    if (normalizedAnswerIds.length === 0) {
      throw new Error("Select at least one poll option.");
    }

    await client.sendEvent(
      roomId,
      POLL_RESPONSE_EVENT_TYPE_UNSTABLE as never,
      {
        msgtype: "m.poll.response",
        [POLL_RESPONSE_EVENT_TYPE_UNSTABLE]: {
          answers: [...new Set(normalizedAnswerIds)],
        },
        [POLL_RESPONSE_EVENT_TYPE]: {
          answers: [...new Set(normalizedAnswerIds)],
        },
        "m.relates_to": {
          rel_type: "m.reference",
          event_id: normalizedPollEventId,
        },
      } as never,
    );

    this.scheduleRefresh(40);
  };

  editPost = async (roomId: string, eventId: string, markdown: string): Promise<void> => {
    const client = this.getConnectedClient();
    const body = markdown.trim();

    if (!body) {
      throw new Error("Edited content cannot be empty");
    }

    const content = {
      msgtype: MESSAGE_TEXT_TYPE,
      body: `* ${body}`,
      "m.new_content": {
        msgtype: MESSAGE_TEXT_TYPE,
        body,
      },
      "m.relates_to": {
        rel_type: REPLACE_RELATION_TYPE,
        event_id: eventId,
      },
    };

    await client.sendEvent(roomId, ROOM_MESSAGE_EVENT_TYPE as never, content as never);
    this.scheduleRefresh(40);
  };

  redactPost = async (roomId: string, eventId: string, reason?: string): Promise<void> => {
    const client = this.getConnectedClient();

    await client.redactEvent(roomId, eventId, undefined, {
      reason: reason?.trim() || "Removed by moderation",
    });

    this.scheduleRefresh(40);
  };

  reactToPost = async (roomId: string, eventId: string, emoji: string): Promise<void> => {
    const client = this.getConnectedClient();
    const key = emoji.trim();

    if (!key) {
      throw new Error("Emoji key is required for reaction");
    }

    const room = client.getRoom(roomId);
    if (!room || room.getMyMembership() !== "join") {
      throw new Error("Room not available in your joined rooms.");
    }

    const myUserId = this.state.config?.userId ?? room.myUserId;

    const existingReactionEventId =
      this.findOwnReactionEventId(room, eventId, key) ??
      (myUserId
        ? await this.findOwnReactionEventIdFromRelations(roomId, eventId, key, myUserId)
        : null);

    if (existingReactionEventId) {
      await client.redactEvent(roomId, existingReactionEventId, undefined, {
        reason: "Removed reaction",
      });
      this.scheduleRefresh(40);
      return;
    }

    const content = {
      "m.relates_to": {
        rel_type: ANNOTATION_RELATION_TYPE,
        event_id: eventId,
        key,
      },
    };

    await client.sendEvent(roomId, REACTION_EVENT_TYPE as never, content as never);
    this.scheduleRefresh(40);
  };

  private async findOwnReactionEventIdFromRelations(
    roomId: string,
    targetEventId: string,
    emoji: string,
    myUserId: string,
  ): Promise<string | null> {
    const config = this.state.config;
    if (!config) {
      return null;
    }

    const visitedPaginationTokens = new Set<string>();
    let from: string | null = null;

    for (let page = 0; page < RELATIONS_MAX_PAGES; page += 1) {
      if (from && visitedPaginationTokens.has(from)) {
        break;
      }

      const endpoint = new URL(
        `${config.homeserverUrl}/_matrix/client/v1/rooms/${encodeURIComponent(
          roomId,
        )}/relations/${encodeURIComponent(targetEventId)}/${encodeURIComponent(
          ANNOTATION_RELATION_TYPE,
        )}/${encodeURIComponent(REACTION_EVENT_TYPE)}`,
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
          Authorization: `Bearer ${config.accessToken}`,
        },
      });

      if (!response.ok) {
        break;
      }

      const body = (await response.json()) as RelationsEndpointResponse;
      for (const event of body.chunk ?? []) {
        if (event.sender !== myUserId) {
          continue;
        }

        if (asRecord(event.unsigned)?.redacted_because) {
          continue;
        }

        const annotation = readAnnotationRelation(asRecord(event.content) ?? {});
        if (!annotation) {
          continue;
        }

        if (annotation.targetEventId !== targetEventId || annotation.key !== emoji) {
          continue;
        }

        const reactionEventId = asString(event.event_id);
        if (reactionEventId) {
          return reactionEventId;
        }
      }

      from = asString(body.next_batch);
      if (!from) {
        break;
      }
    }

    return null;
  }

  private findOwnReactionEventId(room: Room, targetEventId: string, emoji: string): string | null {
    const myUserId = this.state.config?.userId ?? room.myUserId;
    if (!myUserId) {
      return null;
    }

    let latestMatchEventId: string | null = null;
    let latestMatchTimestamp = Number.NEGATIVE_INFINITY;

    const inspectEvent = (event: MatrixEvent) => {
      if (event.isRedacted() || event.getType() !== REACTION_EVENT_TYPE) {
        return;
      }

      if (event.getSender() !== myUserId) {
        return;
      }

      const annotation = readAnnotationRelation(event.getContent<MatrixContent>());
      if (!annotation) {
        return;
      }

      if (annotation.targetEventId !== targetEventId || annotation.key !== emoji) {
        return;
      }

      const reactionEventId = event.getId();
      if (!reactionEventId) {
        return;
      }

      const eventTimestamp = event.getTs() ?? 0;
      if (eventTimestamp >= latestMatchTimestamp) {
        latestMatchEventId = reactionEventId;
        latestMatchTimestamp = eventTimestamp;
      }
    };

    for (const event of room.getLiveTimeline().getEvents()) {
      inspectEvent(event);
    }

    for (const sdkThread of room.getThreads()) {
      const threadEvents = (sdkThread as { events?: MatrixEvent[] }).events ?? [];
      for (const event of threadEvents) {
        inspectEvent(event);
      }
    }

    return latestMatchEventId;
  }

  private buildThreadRelation(rootEventId: string, replyToEventId: string) {
    return {
      rel_type: THREAD_RELATION_TYPE,
      event_id: rootEventId,
      is_falling_back: true,
      "m.in_reply_to": {
        event_id: replyToEventId,
      },
    };
  }

  private buildReplyRelation(replyToEventId: string | null): Record<string, unknown> | undefined {
    if (!replyToEventId) {
      return undefined;
    }

    return {
      "m.in_reply_to": {
        event_id: replyToEventId,
      },
    };
  }

  private async sendChatText(
    roomId: string,
    body: string,
    replyToEventId: string | null,
  ): Promise<ISendEventResponse> {
    const client = this.getConnectedClient();
    const relatesTo = this.buildReplyRelation(replyToEventId);

    return client.sendEvent(
      roomId,
      ROOM_MESSAGE_EVENT_TYPE as never,
      {
        msgtype: MESSAGE_TEXT_TYPE,
        body,
        ...(relatesTo ? { "m.relates_to": relatesTo } : {}),
      } as never,
    );
  }

  private async sendChatAttachment(
    roomId: string,
    file: File,
    replyToEventId: string | null,
  ): Promise<ISendEventResponse> {
    const client = this.getConnectedClient();

    const uploadResult = await client.uploadContent(file, {
      includeFilename: true,
      type: file.type,
      name: file.name,
    });

    const mxcUrl =
      typeof uploadResult === "string"
        ? uploadResult
        : (uploadResult as { content_uri?: string }).content_uri;

    if (!mxcUrl) {
      throw new Error("Failed to upload attachment");
    }

    const relatesTo = this.buildReplyRelation(replyToEventId);

    return client.sendEvent(
      roomId,
      ROOM_MESSAGE_EVENT_TYPE as never,
      {
        msgtype: guessAttachmentMsgType(file.type),
        body: file.name,
        url: mxcUrl,
        info: {
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        },
        ...(relatesTo ? { "m.relates_to": relatesTo } : {}),
      } as never,
    );
  }

  private async sendChatPoll(
    roomId: string,
    poll: PollDraft,
    replyToEventId: string | null,
  ): Promise<ISendEventResponse> {
    const client = this.getConnectedClient();
    const question = poll.question.trim();
    const options = poll.options.map((option) => option.trim()).filter(Boolean);

    if (!question || options.length < 2) {
      throw new Error("Poll question and at least two options are required");
    }

    const relatesTo = this.buildReplyRelation(replyToEventId);

    return client.sendEvent(
      roomId,
      POLL_START_EVENT_TYPE_UNSTABLE as never,
      {
        msgtype: "m.poll.start",
        body: question,
        [POLL_START_EVENT_TYPE_UNSTABLE]: {
          question: {
            "org.matrix.msc1767.text": question,
          },
          kind: "org.matrix.msc3381.poll.disclosed",
          max_selections: Math.max(1, poll.maxSelections || 1),
          answers: options.map((label, index) => ({
            id: `option-${index + 1}`,
            "org.matrix.msc1767.text": label,
          })),
        },
        ...(relatesTo ? { "m.relates_to": relatesTo } : {}),
      } as never,
    );
  }

  private async sendThreadMessage(
    roomId: string,
    rootEventId: string,
    body: string,
    replyToEventId: string,
  ): Promise<ISendEventResponse> {
    const client = this.getConnectedClient();

    return client.sendEvent(
      roomId,
      ROOM_MESSAGE_EVENT_TYPE as never,
      {
        msgtype: MESSAGE_TEXT_TYPE,
        body,
        "m.relates_to": this.buildThreadRelation(rootEventId, replyToEventId),
      } as never,
    );
  }

  private async sendThreadAttachment(
    roomId: string,
    rootEventId: string,
    file: File,
    replyToEventId: string,
  ): Promise<ISendEventResponse> {
    const client = this.getConnectedClient();

    const uploadResult = await client.uploadContent(file, {
      includeFilename: true,
      type: file.type,
      name: file.name,
    });

    const mxcUrl =
      typeof uploadResult === "string"
        ? uploadResult
        : (uploadResult as { content_uri?: string }).content_uri;

    if (!mxcUrl) {
      throw new Error("Failed to upload attachment");
    }

    return client.sendEvent(
      roomId,
      ROOM_MESSAGE_EVENT_TYPE as never,
      {
        msgtype: guessAttachmentMsgType(file.type),
        body: file.name,
        url: mxcUrl,
        info: {
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        },
        "m.relates_to": this.buildThreadRelation(rootEventId, replyToEventId),
      } as never,
    );
  }

  private async sendThreadPoll(
    roomId: string,
    rootEventId: string,
    poll: PollDraft,
    replyToEventId: string,
  ): Promise<ISendEventResponse> {
    const client = this.getConnectedClient();
    const question = poll.question.trim();
    const options = poll.options.map((option) => option.trim()).filter(Boolean);

    if (!question || options.length < 2) {
      throw new Error("Poll question and at least two options are required");
    }

    return client.sendEvent(
      roomId,
      POLL_START_EVENT_TYPE_UNSTABLE as never,
      {
        msgtype: "m.poll.start",
        body: question,
        [POLL_START_EVENT_TYPE_UNSTABLE]: {
          question: {
            "org.matrix.msc1767.text": question,
          },
          kind: "org.matrix.msc3381.poll.disclosed",
          max_selections: Math.max(1, poll.maxSelections || 1),
          answers: options.map((label, index) => ({
            id: `option-${index + 1}`,
            "org.matrix.msc1767.text": label,
          })),
        },
        "m.relates_to": this.buildThreadRelation(rootEventId, replyToEventId),
      } as never,
    );
  }

  private invalidateRoomThreadRoots(roomId: string): void {
    this.roomThreadRoots.delete(roomId);
    this.roomThreadRootRequests.delete(roomId);
  }

  private getConnectedClient(): MatrixClient {
    if (!this.client) {
      throw new Error("No active Matrix session. Please sign in first.");
    }

    return this.client;
  }

  private handleSyncState = (
    syncState: SyncState,
    _previousSyncState: SyncState | null,
    data?: SyncStateData,
  ): void => {
    if (syncState === SyncState.Error) {
      this.setState({
        status: "error",
        errorMessage: data?.error ? toErrorMessage(data.error) : "Matrix sync failed",
      });

      return;
    }

    if (syncState === SyncState.Prepared || syncState === SyncState.Syncing) {
      if (this.state.status !== "live") {
        this.setState({
          status: "live",
          errorMessage: null,
        });
      }

      this.scheduleRefresh(80);
    }
  };

  private handleTimeline = (): void => {
    this.roomThreadRoots.clear();
    this.roomThreadRootRequests.clear();
    this.chatBackfilledRoomIds.clear();
    this.chatBackfillRequests.clear();
    this.scheduleRefresh(200);
  };

  private getJoinedRooms(): ReturnType<MatrixClient["getRooms"]> {
    if (!this.client) {
      return [];
    }

    return this.client
      .getRooms()
      .filter((room) => room.getMyMembership() === "join")
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private isRoomEncrypted(room: Room): boolean {
    return Boolean(room.currentState.getStateEvents(ROOM_ENCRYPTION_EVENT_TYPE, ""));
  }

  private buildChatRoomSummary(room: Room): ChatRoomSummary {
    const timelineEvents = room.getLiveTimeline().getEvents();
    const lastActivityAt = timelineEvents.at(-1)?.getTs() ?? 0;

    return {
      id: room.roomId,
      name: room.name.trim() || room.getCanonicalAlias() || room.roomId,
      topic: readRoomTopic(room),
      avatarUrl: readRoomAvatarUrl(room),
      ...readRoomUnreadCount(room),
      memberCount: room.getJoinedMemberCount(),
      lastActivityAt,
      canModerate: canModerateRoom(room),
    };
  }

  private async ensureChatRoomBackfill(
    room: Room,
    client: MatrixClient,
    maxPasses: number,
  ): Promise<boolean> {
    if (this.chatBackfilledRoomIds.has(room.roomId)) {
      return false;
    }

    if (maxPasses <= 0) {
      return Boolean(room.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS));
    }

    const pendingRequest = this.chatBackfillRequests.get(room.roomId);
    if (pendingRequest) {
      return pendingRequest;
    }

    const request = this.backfillChatRoomTimeline(room, client, maxPasses)
      .then((hasMoreHistory) => {
        if (!hasMoreHistory) {
          this.chatBackfilledRoomIds.add(room.roomId);
        }

        return hasMoreHistory;
      })
      .catch(() => {
        // Ignore backfill failures and use currently available events.
        return Boolean(room.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS));
      })
      .finally(() => {
        this.chatBackfillRequests.delete(room.roomId);
      });

    this.chatBackfillRequests.set(room.roomId, request);

    return request;
  }

  private async backfillChatRoomTimeline(
    room: Room,
    client: MatrixClient,
    maxPasses: number,
  ): Promise<boolean> {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const timeline = room.getLiveTimeline();
      const backwardsToken = timeline.getPaginationToken(EventTimeline.BACKWARDS);
      if (!backwardsToken) {
        return false;
      }

      const beforeCount = timeline.getEvents().length;
      await client.scrollback(room, CHAT_BACKFILL_LIMIT);
      const afterCount = timeline.getEvents().length;

      if (afterCount <= beforeCount) {
        return Boolean(timeline.getPaginationToken(EventTimeline.BACKWARDS));
      }
    }

    return Boolean(room.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS));
  }

  private buildChatMessagesForRoom(room: Room): ChatMessage[] {
    const timelineEvents = room.getLiveTimeline().getEvents();
    const messagesByEventId = new Map<string, ChatMessage>();
    const editsByTargetEventId = new Map<string, EditPayload>();
    const reactionsByEventId = new Map<string, Map<string, Set<string>>>();
    const latestPollVotesByTargetAndSender = new Map<string, Map<string, PollVoteRecord>>();
    const threadSummaryByRootEventId = new Map<string, { threadId: string; replyCount: number }>();

    for (const sdkThread of room.getThreads()) {
      const loadedReplyCount =
        (sdkThread as unknown as { events?: unknown[] }).events?.filter(Boolean).length ?? 0;

      threadSummaryByRootEventId.set(sdkThread.id, {
        threadId: sdkThread.id,
        replyCount: Math.max(0, loadedReplyCount),
      });
    }

    for (const thread of this.state.snapshot.threads) {
      if (thread.roomId !== room.roomId) {
        continue;
      }

      const existingSummary = threadSummaryByRootEventId.get(thread.id);
      threadSummaryByRootEventId.set(thread.id, {
        threadId: thread.id,
        replyCount: Math.max(existingSummary?.replyCount ?? 0, thread.replyCount),
      });
    }

    const addReaction = (targetEventId: string, key: string, senderId: string | undefined) => {
      if (!senderId) {
        return;
      }

      const reactionsForEvent =
        reactionsByEventId.get(targetEventId) ?? new Map<string, Set<string>>();
      const senders = reactionsForEvent.get(key) ?? new Set<string>();
      senders.add(senderId);
      reactionsForEvent.set(key, senders);
      reactionsByEventId.set(targetEventId, reactionsForEvent);
    };

    const addPollVote = (
      targetEventId: string,
      answerIds: string[],
      senderId: string | undefined,
      createdAt: number,
    ) => {
      if (!senderId) {
        return;
      }

      const votesBySender =
        latestPollVotesByTargetAndSender.get(targetEventId) ?? new Map<string, PollVoteRecord>();
      const existingVote = votesBySender.get(senderId);
      if (existingVote && existingVote.createdAt > createdAt) {
        return;
      }

      votesBySender.set(senderId, {
        answerIds: answerIds.map((answerId) => answerId.trim()).filter(Boolean),
        createdAt,
      });
      latestPollVotesByTargetAndSender.set(targetEventId, votesBySender);
    };

    const addEdit = (targetEventId: string, body: string | null, editedAt: number) => {
      const existing = editsByTargetEventId.get(targetEventId);
      if (existing && existing.editedAt >= editedAt) {
        return;
      }

      editsByTargetEventId.set(targetEventId, {
        body,
        editedAt,
      });
    };

    for (const event of timelineEvents) {
      if (event.isRedacted()) {
        continue;
      }

      const eventType = event.getType();
      const content = event.getContent<MatrixContent>();

      if (eventType === REACTION_EVENT_TYPE) {
        const annotation = readAnnotationRelation(content);
        if (annotation) {
          addReaction(annotation.targetEventId, annotation.key, event.getSender());
        }

        continue;
      }

      if (isPollResponseType(eventType)) {
        const pollResponse = readPollResponse(content);
        if (pollResponse) {
          addPollVote(
            pollResponse.targetEventId,
            pollResponse.answerIds,
            event.getSender(),
            event.getTs(),
          );
        }

        continue;
      }

      if (eventType !== ROOM_MESSAGE_EVENT_TYPE && !isPollStartType(eventType)) {
        continue;
      }

      const eventId = event.getId();
      if (!eventId) {
        continue;
      }

      const replace = readReplaceRelation(content);
      if (replace) {
        const newContent = asRecord(content["m.new_content"]);
        const editBody = newContent ? readMessageBody(newContent) : readMessageBody(content);
        addEdit(replace.targetEventId, editBody || null, event.getTs());
        continue;
      }

      const relation = readMessageRelation(content);
      if (relation?.relationType === THREAD_RELATION_TYPE) {
        continue;
      }

      const body = readMessageBody(content);
      const attachments = readAttachments(content, room, eventId);
      const poll = readPollStart(eventType, content);

      if (!body && attachments.length === 0 && !poll) {
        continue;
      }

      const authorId = event.getSender() ?? "@unknown:local";
      const authorMember = room.getMember(authorId);
      const authorDisplayName = authorMember?.name ?? authorId;
      const authorAvatarMxc = authorMember?.getMxcAvatarUrl();
      const authorAvatarUrl = authorAvatarMxc
        ? room.client.mxcUrlToHttp(authorAvatarMxc, 72, 72, "crop", true)
        : null;

      messagesByEventId.set(eventId, {
        eventId,
        roomId: room.roomId,
        authorId,
        authorDisplayName,
        avatarUrl: authorAvatarUrl,
        body,
        attachments,
        poll,
        editedAt: null,
        reactions: [],
        createdAt: event.getTs(),
        replyToEventId: relation?.replyToEventId ?? null,
        thread: threadSummaryByRootEventId.get(eventId) ?? null,
      });
    }

    for (const [targetEventId, editPayload] of editsByTargetEventId.entries()) {
      const targetMessage = messagesByEventId.get(targetEventId);
      if (!targetMessage) {
        continue;
      }

      messagesByEventId.set(targetEventId, {
        ...targetMessage,
        body: editPayload.body ?? "",
        editedAt: editPayload.editedAt,
      });
    }

    const myUserId = room.myUserId;
    const pollVotesByTargetEventId = buildPollVotesByTargetEventId(
      latestPollVotesByTargetAndSender,
    );

    return [...messagesByEventId.values()]
      .map((message) => ({
        ...message,
        poll: applyPollVotes(
          message.poll,
          pollVotesByTargetEventId.get(message.eventId),
          myUserId ?? "@unknown:local",
        ),
      }))
      .filter((message) => message.body || message.attachments.length > 0 || message.poll)
      .map((message) => applyReactions(message, myUserId ?? "@unknown:local", reactionsByEventId))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  private collectJoinedContentRooms(
    joinedRooms: ReturnType<MatrixClient["getRooms"]>,
    selectedSpaceId: string | null,
  ): ReturnType<MatrixClient["getRooms"]> {
    const joinedNonSpaceRooms = joinedRooms.filter((room) => !isSpaceRoom(room));

    if (!selectedSpaceId) {
      return joinedNonSpaceRooms;
    }

    const spaceRoom = joinedRooms.find((room) => room.roomId === selectedSpaceId);
    if (!spaceRoom) {
      return joinedNonSpaceRooms;
    }

    if (!isSpaceRoom(spaceRoom)) {
      return joinedNonSpaceRooms;
    }

    const joinedRoomById = new Map(joinedRooms.map((room) => [room.roomId, room] as const));
    const scopedNonSpaceRoomIds = new Set<string>();
    const queue: string[] = [spaceRoom.roomId];
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const currentRoomId = queue.shift();
      if (!currentRoomId) {
        continue;
      }

      const currentRoom = joinedRoomById.get(currentRoomId);
      if (!currentRoom) {
        continue;
      }

      const childRoomIds = getSpaceChildRoomIds(currentRoom);
      for (const childRoomId of childRoomIds) {
        if (visited.has(childRoomId)) {
          continue;
        }

        visited.add(childRoomId);
        const childRoom = joinedRoomById.get(childRoomId);
        if (!childRoom) {
          continue;
        }

        if (isSpaceRoom(childRoom)) {
          queue.push(childRoomId);
          continue;
        }

        scopedNonSpaceRoomIds.add(childRoomId);
      }
    }

    return joinedNonSpaceRooms.filter((room) => scopedNonSpaceRoomIds.has(room.roomId));
  }

  private collectJoinedSpaces(joinedRooms: ReturnType<MatrixClient["getRooms"]>) {
    return joinedRooms
      .filter((room) => isSpaceRoom(room))
      .map((room) => buildForumSpace(room))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private ensureRoomBackfill(rooms: Room[]): void {
    const client = this.client;
    if (!client) {
      return;
    }

    for (const room of rooms) {
      if (this.backfilledRoomIds.has(room.roomId) || this.backfillingRoomIds.has(room.roomId)) {
        continue;
      }

      this.backfillingRoomIds.add(room.roomId);

      void this.backfillRoomTimeline(room, client)
        .catch(() => {
          // Ignore pagination failures; current timeline data remains usable.
        })
        .finally(() => {
          this.backfillingRoomIds.delete(room.roomId);
          this.backfilledRoomIds.add(room.roomId);
          this.scheduleRefresh(100);
        });
    }
  }

  private async backfillRoomTimeline(room: Room, client: MatrixClient): Promise<void> {
    const maxPasses = 64;

    await room.createThreadsTimelineSets().catch(() => null);

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const timeline = room.getLiveTimeline();
      const backwardsToken = timeline.getPaginationToken(EventTimeline.BACKWARDS);
      if (!backwardsToken) {
        break;
      }

      const beforeCount = timeline.getEvents().length;
      await client.scrollback(room, 250);
      const afterCount = timeline.getEvents().length;

      if (afterCount <= beforeCount) {
        break;
      }
    }
  }

  private parseEndpointThreadRoot(event: ThreadEndpointEvent): EndpointThreadRoot | null {
    const eventId = event.event_id;
    if (!eventId) {
      return null;
    }

    return {
      eventId,
      eventType: asString(event.type) ?? ROOM_MESSAGE_EVENT_TYPE,
      senderId: asString(event.sender) ?? "@unknown:local",
      createdAt: asNumber(event.origin_server_ts) ?? 0,
      content: asRecord(event.content) ?? {},
      replyCount: readThreadReplyCount(event),
    };
  }

  private mergeSdkThreadRoots(
    roomId: string,
    endpointRoots: Map<string, EndpointThreadRoot>,
  ): Map<string, EndpointThreadRoot> {
    if (!this.client) {
      return endpointRoots;
    }

    const sdkRoom = this.client.getRoom(roomId);
    if (!sdkRoom) {
      return endpointRoots;
    }

    const mergedRoots = new Map(endpointRoots);
    for (const sdkThread of sdkRoom.getThreads()) {
      if (mergedRoots.has(sdkThread.id)) {
        continue;
      }

      const rootEvent = sdkThread.rootEvent ?? sdkRoom.findEventById(sdkThread.id);
      if (rootEvent) {
        const loadedReplyCount =
          (sdkThread as unknown as { events?: unknown[] }).events?.filter(Boolean).length ?? 0;

        mergedRoots.set(sdkThread.id, {
          eventId: sdkThread.id,
          eventType: rootEvent.getType(),
          senderId: rootEvent.getSender() ?? "@unknown:local",
          createdAt: rootEvent.getTs(),
          content: rootEvent.getContent<Record<string, unknown>>() ?? {},
          replyCount: loadedReplyCount,
        });
      } else {
        mergedRoots.set(sdkThread.id, {
          eventId: sdkThread.id,
          eventType: ROOM_MESSAGE_EVENT_TYPE,
          senderId: "@unknown:local",
          createdAt: 0,
          content: {},
          replyCount: null,
        });
      }
    }

    return mergedRoots;
  }

  private async getThreadRootsForRoom(roomId: string): Promise<Map<string, EndpointThreadRoot>> {
    const cachedRoots = this.roomThreadRoots.get(roomId);
    if (cachedRoots) {
      return cachedRoots;
    }

    const pendingRequest = this.roomThreadRootRequests.get(roomId);
    if (pendingRequest) {
      return pendingRequest;
    }

    const request = this.fetchThreadRootsForRoom(roomId)
      .catch(() => {
        return new Map<string, EndpointThreadRoot>();
      })
      .then((endpointRoots) => this.mergeSdkThreadRoots(roomId, endpointRoots))
      .finally(() => {
        this.roomThreadRootRequests.delete(roomId);
      });

    this.roomThreadRootRequests.set(roomId, request);
    const roots = await request;
    this.roomThreadRoots.set(roomId, roots);

    return roots;
  }

  private async fetchThreadRootsForRoom(roomId: string): Promise<Map<string, EndpointThreadRoot>> {
    const config = this.state.config;
    if (!config) {
      return new Map<string, EndpointThreadRoot>();
    }

    const roots = new Map<string, EndpointThreadRoot>();
    let from: string | null = null;

    for (let page = 0; page < THREADS_MAX_PAGES; page += 1) {
      const endpoint = new URL(
        `${config.homeserverUrl}/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/threads`,
      );
      endpoint.searchParams.set("include", "all");
      endpoint.searchParams.set("limit", String(THREADS_PAGE_LIMIT));

      if (from) {
        endpoint.searchParams.set("from", from);
      }

      const response = await fetch(endpoint.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.accessToken}`,
        },
      });

      if (response.status === 404) {
        break;
      }

      if (!response.ok) {
        throw new Error(`Failed to load room threads (${response.status})`);
      }

      const body = (await response.json()) as ThreadsEndpointResponse;
      for (const event of body.chunk ?? []) {
        const parsedRoot = this.parseEndpointThreadRoot(event);
        if (parsedRoot) {
          roots.set(parsedRoot.eventId, parsedRoot);
        }
      }

      from = body.next_batch ?? null;
      if (!from) {
        break;
      }
    }

    return roots;
  }

  private async rebuildSnapshot(): Promise<void> {
    if (!this.client || !this.state.config) {
      return;
    }

    const rebuildGeneration = ++this.refreshGeneration;
    this.setState({ isLoading: true });

    const joinedRooms = this.getJoinedRooms();
    const spaces = this.collectJoinedSpaces(joinedRooms);

    let selectedSpaceId = this.state.selectedSpaceId;
    if (
      selectedSpaceId &&
      spaces.length > 0 &&
      !spaces.some((space) => space.id === selectedSpaceId)
    ) {
      selectedSpaceId = null;
    }

    if (selectedSpaceId !== this.state.selectedSpaceId) {
      persistSelectedSpaceId(selectedSpaceId);
    }

    const contentRooms = this.collectJoinedContentRooms(joinedRooms, selectedSpaceId);
    this.ensureRoomBackfill(contentRooms);

    const roomThreadRoots = await Promise.all(
      contentRooms.map(async (room) => ({
        room,
        roots: await this.getThreadRootsForRoom(room.roomId),
      })),
    );

    if (rebuildGeneration !== this.refreshGeneration) {
      return;
    }

    const groups = contentRooms
      .map((room) => buildForumGroup(room))
      .sort((left, right) => left.name.localeCompare(right.name));

    const threads = roomThreadRoots
      .flatMap(({ room, roots }) => buildThreadsForRoom(room, roots))
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt);

    const threadMap: Record<string, ForumThread> = {};
    for (const thread of threads) {
      threadMap[thread.id] = thread;
    }

    this.setState({
      status: this.state.status === "error" ? "error" : "live",
      selectedSpaceId,
      isLoading: false,
      snapshot: {
        spaces,
        groups,
        threads,
        threadMap,
        updatedAt: Date.now(),
      },
    });
  }

  private teardownClient(): void {
    if (this.scheduledRefresh) {
      clearTimeout(this.scheduledRefresh);
      this.scheduledRefresh = null;
    }

    if (!this.client) {
      return;
    }

    this.client.off(ClientEvent.Sync, this.handleSyncState);
    this.client.off(RoomEvent.Timeline, this.handleTimeline);
    this.client.stopClient();
    this.client = null;
  }

  private scheduleRefresh(delayMs: number): void {
    if (!this.client) {
      return;
    }

    if (this.scheduledRefresh) {
      clearTimeout(this.scheduledRefresh);
    }

    this.scheduledRefresh = setTimeout(() => {
      this.scheduledRefresh = null;
      void this.rebuildSnapshot();
    }, delayMs);
  }

  private setState(patch: Partial<ForumState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
