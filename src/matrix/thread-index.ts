import { MatrixEvent, Room } from "matrix-js-sdk";
import {
  ANNOTATION_RELATION_TYPE,
  MESSAGE_AUDIO_TYPE,
  MESSAGE_FILE_TYPE,
  MESSAGE_IMAGE_TYPE,
  MESSAGE_VIDEO_TYPE,
  POLL_RESPONSE_EVENT_TYPE,
  POLL_RESPONSE_EVENT_TYPE_UNSTABLE,
  POLL_START_EVENT_TYPE,
  POLL_START_EVENT_TYPE_UNSTABLE,
  REPLACE_RELATION_TYPE,
  REACTION_EVENT_TYPE,
  ROOM_AVATAR_EVENT_TYPE,
  ROOM_CREATE_EVENT_TYPE,
  ROOM_POWER_LEVELS_EVENT_TYPE,
  ROOM_MESSAGE_EVENT_TYPE,
  ROOM_TOPIC_EVENT_TYPE,
  SPACE_CHILD_EVENT_TYPE,
  THREAD_RELATION_TYPE,
} from "./constants";
import {
  type ForumAttachment,
  type ForumGroup,
  type ForumPoll,
  type ForumPost,
  type ForumSpace,
  type ForumThread,
  type ThreadReply,
} from "./types";

const resolveAuthorProfile = (
  room: Room,
  authorId: string,
): { authorDisplayName: string; avatarUrl: string | null } => {
  const authorMember = room.getMember(authorId);
  const authorDisplayName = authorMember?.name ?? authorId;
  const mxcAvatarUrl = authorMember?.getMxcAvatarUrl();
  const avatarUrl = mxcAvatarUrl
    ? room.client.mxcUrlToHttp(mxcAvatarUrl, 72, 72, "crop", true)
    : null;

  return {
    authorDisplayName,
    avatarUrl,
  };
};

type MatrixContent = Record<string, unknown>;

export interface EndpointThreadRoot {
  eventId: string;
  eventType: string;
  senderId: string;
  createdAt: number;
  content: MatrixContent;
  replyCount: number | null;
}

interface ThreadRelation {
  rootEventId: string;
  replyToEventId: string | null;
}

interface AnnotationRelation {
  targetEventId: string;
  key: string;
}

interface ReplaceRelation {
  targetEventId: string;
}

interface EditPayload {
  body: string | null;
  editedAt: number;
}

interface PollResponse {
  targetEventId: string;
  answerIds: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const isPollStartType = (eventType: string): boolean =>
  eventType === POLL_START_EVENT_TYPE || eventType === POLL_START_EVENT_TYPE_UNSTABLE;

const isPollResponseType = (eventType: string): boolean =>
  eventType === POLL_RESPONSE_EVENT_TYPE || eventType === POLL_RESPONSE_EVENT_TYPE_UNSTABLE;

const readMessageBody = (content: MatrixContent): string => {
  const body = asString(content.body);
  return body?.trim() ?? "";
};

const readThreadRelation = (content: MatrixContent): ThreadRelation | null => {
  const relatesTo = asRecord(content["m.relates_to"]);
  if (!relatesTo) {
    return null;
  }

  if (asString(relatesTo.rel_type) !== THREAD_RELATION_TYPE) {
    return null;
  }

  const rootEventId = asString(relatesTo.event_id);
  if (!rootEventId) {
    return null;
  }

  const inReplyTo = asRecord(relatesTo["m.in_reply_to"]);
  const replyToEventId = asString(inReplyTo?.event_id);

  return {
    rootEventId,
    replyToEventId: replyToEventId ?? null,
  };
};

const readAnnotationRelation = (content: MatrixContent): AnnotationRelation | null => {
  const relatesTo = asRecord(content["m.relates_to"]);
  if (!relatesTo) {
    return null;
  }

  if (asString(relatesTo.rel_type) !== ANNOTATION_RELATION_TYPE) {
    return null;
  }

  const targetEventId = asString(relatesTo.event_id);
  const key = asString(relatesTo.key);

  if (!targetEventId || !key) {
    return null;
  }

  return {
    targetEventId,
    key,
  };
};

const readReplaceRelation = (content: MatrixContent): ReplaceRelation | null => {
  const relatesTo = asRecord(content["m.relates_to"]);
  if (!relatesTo) {
    return null;
  }

  if (asString(relatesTo.rel_type) !== REPLACE_RELATION_TYPE) {
    return null;
  }

  const targetEventId = asString(relatesTo.event_id);
  if (!targetEventId) {
    return null;
  }

  return { targetEventId };
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
  const relatesTo = asRecord(content["m.relates_to"]);
  const targetEventId = asString(relatesTo?.event_id);
  if (!targetEventId) {
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
    targetEventId,
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

const toHttpUrl = (room: Room, mxcUrl: string): string =>
  room.client.mxcUrlToHttp(mxcUrl) ?? mxcUrl;

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
      url: toHttpUrl(room, mxcUrl),
      mimeType,
      size: asNumber(info?.size),
    },
  ];
};

const deriveThreadTitle = (post: ForumPost): string => {
  const candidate =
    post.body || post.poll?.question || post.attachments[0]?.name || "Untitled thread";

  const firstLine = candidate
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return "Untitled thread";
  }

  const cleanLine = firstLine.replace(/^#{1,6}\s+/, "").replace(/^>\s*/, "");
  if (cleanLine.length <= 88) {
    return cleanLine;
  }

  return `${cleanLine.slice(0, 85)}...`;
};

const isPostEvent = (event: MatrixEvent): boolean => {
  if (event.isRedacted()) {
    return false;
  }

  return event.getType() === ROOM_MESSAGE_EVENT_TYPE || isPollStartType(event.getType());
};

const applyPollVotes = (
  poll: ForumPoll | null,
  votesByOptionId: Map<string, Set<string>> | undefined,
): ForumPoll | null => {
  if (!poll || !votesByOptionId) {
    return poll;
  }

  return {
    ...poll,
    options: poll.options.map((option) => ({
      ...option,
      voteCount: votesByOptionId.get(option.id)?.size ?? 0,
    })),
  };
};

const toForumPost = (event: MatrixEvent, room: Room): ForumPost | null => {
  const eventId = event.getId();
  if (!eventId) {
    return null;
  }

  const content = event.getContent<MatrixContent>();
  const body = readMessageBody(content);
  const attachments = readAttachments(content, room, eventId);
  const poll = readPollStart(event.getType(), content);

  const authorId = event.getSender() ?? "@unknown:local";
  const authorMember = room.getMember(authorId);
  const authorDisplayName = authorMember?.name ?? authorId;
  const mxcAvatarUrl = authorMember?.getMxcAvatarUrl();
  const avatarUrl = mxcAvatarUrl
    ? room.client.mxcUrlToHttp(mxcAvatarUrl, 72, 72, "crop", true)
    : null;

  if (!body && attachments.length === 0 && !poll) {
    return null;
  }

  return {
    eventId,
    roomId: room.roomId,
    authorId,
    authorDisplayName,
    avatarUrl,
    body,
    attachments,
    poll,
    editedAt: null,
    reactions: [],
    createdAt: event.getTs(),
  };
};

const toForumPostFromEndpointRoot = (root: EndpointThreadRoot, room: Room): ForumPost | null => {
  const body = readMessageBody(root.content);
  const attachments = readAttachments(root.content, room, root.eventId);
  const poll = readPollStart(root.eventType, root.content);
  const { authorDisplayName, avatarUrl } = resolveAuthorProfile(room, root.senderId);

  return {
    eventId: root.eventId,
    roomId: room.roomId,
    authorId: root.senderId,
    authorDisplayName,
    avatarUrl,
    body: body || "Thread root could not be fully loaded yet.",
    attachments,
    poll,
    editedAt: null,
    reactions: [],
    createdAt: root.createdAt,
  };
};

const applyReactions = <T extends ForumPost>(
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
  } as T;
};

const buildSyntheticRootPost = (
  room: Room,
  rootEventId: string,
  replyEvents: MatrixEvent[],
  reactionsByEventId: Map<string, Map<string, Set<string>>>,
): ForumPost | null => {
  if (replyEvents.length === 0) {
    return null;
  }

  const earliestReply = [...replyEvents].sort((left, right) => left.getTs() - right.getTs())[0];
  if (!earliestReply) {
    return null;
  }

  const replyPost = toForumPost(earliestReply, room);
  if (!replyPost) {
    return null;
  }

  return {
    eventId: rootEventId,
    roomId: room.roomId,
    authorId: replyPost.authorId,
    authorDisplayName: replyPost.authorDisplayName,
    avatarUrl: replyPost.avatarUrl,
    body: `Thread root is not in the currently loaded timeline.\n\nPreview from first visible reply:\n\n${replyPost.body}`,
    attachments: [],
    poll: null,
    editedAt: null,
    reactions: applyReactions(
      {
        ...replyPost,
        eventId: rootEventId,
      },
      room.myUserId,
      reactionsByEventId,
    ).reactions,
    createdAt: replyPost.createdAt,
  };
};

const toThreadReply = (
  event: MatrixEvent,
  expectedRootEventId: string,
  room: Room,
  editsByTargetEventId: Map<string, EditPayload>,
  pollVotesByTargetEventId: Map<string, Map<string, Set<string>>>,
): ThreadReply | null => {
  const post = toForumPost(event, room);
  if (!post) {
    return null;
  }

  const eventId = post.eventId;
  const editPayload = editsByTargetEventId.get(eventId);
  const relation = readThreadRelation(event.getContent<MatrixContent>());
  if (!relation || relation.rootEventId !== expectedRootEventId) {
    return null;
  }

  const mergedPost: ForumPost = {
    ...post,
    body: editPayload?.body ?? post.body,
    editedAt: editPayload?.editedAt ?? null,
    poll: applyPollVotes(post.poll, pollVotesByTargetEventId.get(eventId)),
  };

  if (!mergedPost.body && mergedPost.attachments.length === 0 && !mergedPost.poll) {
    return null;
  }

  return {
    ...mergedPost,
    rootEventId: expectedRootEventId,
    replyToEventId: relation.replyToEventId,
  };
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

export const isSpaceRoom = (room: Room): boolean => {
  const createEvent = room.currentState.getStateEvents(ROOM_CREATE_EVENT_TYPE, "");
  if (!createEvent) {
    return false;
  }

  return asString(createEvent.getContent<MatrixContent>().type) === "m.space";
};

export const getSpaceChildRoomIds = (spaceRoom: Room): string[] => {
  const childEvents = spaceRoom.currentState.getStateEvents(SPACE_CHILD_EVENT_TYPE);
  const childIds = new Set<string>();

  for (const childEvent of childEvents) {
    const stateKey = childEvent.getStateKey();
    if (stateKey) {
      childIds.add(stateKey);
    }
  }

  return [...childIds];
};

export const buildForumGroup = (room: Room): ForumGroup => ({
  id: room.roomId,
  name: room.name.trim() || room.getCanonicalAlias() || room.roomId,
  topic: readRoomTopic(room),
  avatarUrl: readRoomAvatarUrl(room),
  ...readRoomUnreadCount(room),
  memberCount: room.getJoinedMemberCount(),
});

export const buildForumSpace = (room: Room): ForumSpace => ({
  id: room.roomId,
  name: room.name.trim() || room.getCanonicalAlias() || room.roomId,
  topic: readRoomTopic(room),
  avatarUrl: readRoomAvatarUrl(room),
  ...readRoomUnreadCount(room),
  childRoomCount: getSpaceChildRoomIds(room).length,
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

export const buildThreadsForRoom = (
  room: Room,
  allowedRootEvents?: Map<string, EndpointThreadRoot>,
): ForumThread[] => {
  const timelineEvents = room.getLiveTimeline().getEvents();
  const allowedRootEventIds = allowedRootEvents
    ? new Set<string>(allowedRootEvents.keys())
    : undefined;

  const addReplyEvent = (
    rootEventId: string,
    replyEvent: MatrixEvent,
    repliesByRoot: Map<string, MatrixEvent[]>,
  ) => {
    const replyEventId = replyEvent.getId();
    if (!replyEventId) {
      return;
    }

    const replies = repliesByRoot.get(rootEventId) ?? [];
    if (replies.some((event) => event.getId() === replyEventId)) {
      return;
    }

    replies.push(replyEvent);
    repliesByRoot.set(rootEventId, replies);
  };

  const eventsById = new Map<string, MatrixEvent>();
  const rootEventsById = new Map<string, MatrixEvent>();
  const repliesByRootId = new Map<string, MatrixEvent[]>();
  const reactionsByEventId = new Map<string, Map<string, Set<string>>>();
  const editsByTargetEventId = new Map<string, EditPayload>();
  const pollVotesByTargetEventId = new Map<string, Map<string, Set<string>>>();

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

  const addPollVote = (targetEventId: string, answerId: string, senderId: string | undefined) => {
    if (!senderId) {
      return;
    }

    const votesForPoll =
      pollVotesByTargetEventId.get(targetEventId) ?? new Map<string, Set<string>>();
    const votesForOption = votesForPoll.get(answerId) ?? new Set<string>();
    votesForOption.add(senderId);
    votesForPoll.set(answerId, votesForOption);
    pollVotesByTargetEventId.set(targetEventId, votesForPoll);
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
    if (!event.isRedacted() && event.getType() === REACTION_EVENT_TYPE) {
      const annotation = readAnnotationRelation(event.getContent<MatrixContent>());
      if (annotation) {
        addReaction(annotation.targetEventId, annotation.key, event.getSender());
      }

      continue;
    }

    if (!event.isRedacted() && isPollResponseType(event.getType())) {
      const pollResponse = readPollResponse(event.getContent<MatrixContent>());
      if (pollResponse) {
        for (const answerId of pollResponse.answerIds) {
          addPollVote(pollResponse.targetEventId, answerId, event.getSender());
        }
      }

      continue;
    }

    if (!isPostEvent(event)) {
      continue;
    }

    const eventId = event.getId();
    if (!eventId) {
      continue;
    }

    eventsById.set(eventId, event);

    const content = event.getContent<MatrixContent>();
    const replace = readReplaceRelation(content);
    if (replace) {
      const newContent = asRecord(content["m.new_content"]);
      const editBody = newContent ? readMessageBody(newContent) : readMessageBody(content);
      addEdit(replace.targetEventId, editBody || null, event.getTs());
      continue;
    }

    const relation = readThreadRelation(content);
    if (relation) {
      addReplyEvent(relation.rootEventId, event, repliesByRootId);
      continue;
    }

    if (allowedRootEventIds?.has(eventId) || (!allowedRootEventIds && !content["m.relates_to"])) {
      rootEventsById.set(eventId, event);
    }
  }

  const sdkThreads = room.getThreads();
  for (const sdkThread of sdkThreads) {
    const sdkRootEvent = sdkThread.rootEvent ?? room.findEventById(sdkThread.id);
    const sdkRootEventId = sdkRootEvent?.getId();

    if (!sdkRootEvent || !sdkRootEventId || !isPostEvent(sdkRootEvent)) {
      continue;
    }

    if (allowedRootEventIds?.has(sdkRootEventId) || !allowedRootEventIds) {
      rootEventsById.set(sdkRootEventId, sdkRootEvent);
    }

    for (const sdkThreadEvent of sdkThread.events) {
      if (!sdkThreadEvent.isRedacted() && sdkThreadEvent.getType() === REACTION_EVENT_TYPE) {
        const annotation = readAnnotationRelation(sdkThreadEvent.getContent<MatrixContent>());
        if (annotation) {
          addReaction(annotation.targetEventId, annotation.key, sdkThreadEvent.getSender());
        }

        continue;
      }

      if (!sdkThreadEvent.isRedacted() && isPollResponseType(sdkThreadEvent.getType())) {
        const pollResponse = readPollResponse(sdkThreadEvent.getContent<MatrixContent>());
        if (pollResponse) {
          for (const answerId of pollResponse.answerIds) {
            addPollVote(pollResponse.targetEventId, answerId, sdkThreadEvent.getSender());
          }
        }

        continue;
      }

      if (!isPostEvent(sdkThreadEvent)) {
        continue;
      }

      const content = sdkThreadEvent.getContent<MatrixContent>();
      const replace = readReplaceRelation(content);
      if (replace) {
        const newContent = asRecord(content["m.new_content"]);
        const editBody = newContent ? readMessageBody(newContent) : readMessageBody(content);
        addEdit(replace.targetEventId, editBody || null, sdkThreadEvent.getTs());
        continue;
      }

      const relation = readThreadRelation(content);
      if (!relation || relation.rootEventId !== sdkRootEventId) {
        continue;
      }

      addReplyEvent(sdkRootEventId, sdkThreadEvent, repliesByRootId);
    }
  }

  if (!allowedRootEventIds) {
    for (const rootEventId of repliesByRootId.keys()) {
      if (rootEventsById.has(rootEventId)) {
        continue;
      }

      const fallbackRoot = eventsById.get(rootEventId) ?? room.findEventById(rootEventId);
      if (fallbackRoot && isPostEvent(fallbackRoot)) {
        rootEventsById.set(rootEventId, fallbackRoot);
      }
    }
  } else {
    for (const rootEventId of allowedRootEventIds) {
      if (rootEventsById.has(rootEventId)) {
        continue;
      }

      const fallbackRoot = eventsById.get(rootEventId) ?? room.findEventById(rootEventId);
      if (fallbackRoot && isPostEvent(fallbackRoot)) {
        rootEventsById.set(rootEventId, fallbackRoot);
      }
    }
  }

  const groupName = room.name.trim() || room.roomId;
  const threads: ForumThread[] = [];
  const allThreadRootIds = allowedRootEventIds
    ? new Set<string>(allowedRootEventIds)
    : new Set<string>([...rootEventsById.keys(), ...repliesByRootId.keys()]);
  const roomCanModerate = canModerateRoom(room);

  for (const rootEventId of allThreadRootIds) {
    const rootEvent = rootEventsById.get(rootEventId);
    const endpointRoot = allowedRootEvents?.get(rootEventId);
    const replyEvents = repliesByRootId.get(rootEventId) ?? [];

    const root = rootEvent
      ? toForumPost(rootEvent, room)
      : endpointRoot
        ? toForumPostFromEndpointRoot(endpointRoot, room)
        : buildSyntheticRootPost(room, rootEventId, replyEvents, reactionsByEventId);

    if (!root) {
      continue;
    }

    const rootEdit = editsByTargetEventId.get(root.eventId);
    const rootWithEdits: ForumPost = {
      ...root,
      body: rootEdit?.body ?? root.body,
      editedAt: rootEdit?.editedAt ?? null,
      poll: applyPollVotes(root.poll, pollVotesByTargetEventId.get(root.eventId)),
    };

    if (!rootWithEdits.body && rootWithEdits.attachments.length === 0 && !rootWithEdits.poll) {
      continue;
    }

    const rootWithReactions = applyReactions(rootWithEdits, room.myUserId, reactionsByEventId);

    const replies = replyEvents
      .map((replyEvent) =>
        toThreadReply(
          replyEvent,
          rootEventId,
          room,
          editsByTargetEventId,
          pollVotesByTargetEventId,
        ),
      )
      .filter((reply): reply is ThreadReply => Boolean(reply))
      .map((reply) => applyReactions(reply, room.myUserId, reactionsByEventId))
      .sort((left, right) => left.createdAt - right.createdAt);

    const title = deriveThreadTitle(rootWithReactions);
    const lastReply = replies.at(-1);
    const lastActivityAt = lastReply
      ? Math.max(rootWithReactions.createdAt, lastReply.createdAt)
      : rootWithReactions.createdAt;
    const endpointReplyCount = endpointRoot?.replyCount;
    const replyCount = Math.max(replies.length, endpointReplyCount ?? 0);

    threads.push({
      id: root.eventId,
      roomId: room.roomId,
      groupId: room.roomId,
      groupName,
      title,
      root: rootWithReactions,
      replies,
      replyCount,
      lastActivityAt,
      canModerate: roomCanModerate,
    });
  }

  threads.sort((left, right) => right.lastActivityAt - left.lastActivityAt);

  return threads;
};
