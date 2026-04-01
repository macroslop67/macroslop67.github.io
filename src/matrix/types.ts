export type ConnectionStatus = "idle" | "connecting" | "live" | "error";

export type ThreadViewMode = "board" | "tree";

export type AttachmentKind = "image" | "video" | "audio" | "file";

export interface MatrixConnectionConfig {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  initialSyncLimit: number;
}

export interface ForumSpace {
  id: string;
  name: string;
  topic: string | null;
  avatarUrl: string | null;
  unreadCount: number;
  highlightCount: number;
  childRoomCount: number;
}

export interface ForumReaction {
  key: string;
  count: number;
  reactedByCurrentUser: boolean;
}

export interface ForumAttachment {
  eventId: string;
  kind: AttachmentKind;
  name: string;
  url: string;
  mimeType: string | null;
  size: number | null;
}

export interface ForumPollOption {
  id: string;
  label: string;
  voteCount: number;
}

export interface ForumPoll {
  question: string;
  options: ForumPollOption[];
  maxSelections: number;
}

export interface PollDraft {
  question: string;
  options: string[];
  maxSelections: number;
}

export interface ForumGroup {
  id: string;
  name: string;
  topic: string | null;
  avatarUrl: string | null;
  unreadCount: number;
  highlightCount: number;
  memberCount: number;
}

export interface ForumPost {
  eventId: string;
  roomId: string;
  authorId: string;
  authorDisplayName: string;
  avatarUrl: string | null;
  body: string;
  attachments: ForumAttachment[];
  poll: ForumPoll | null;
  editedAt: number | null;
  reactions: ForumReaction[];
  createdAt: number;
}

export interface ThreadReply extends ForumPost {
  rootEventId: string;
  replyToEventId: string | null;
}

export interface ForumThread {
  id: string;
  roomId: string;
  groupId: string;
  groupName: string;
  title: string;
  root: ForumPost;
  replies: ThreadReply[];
  replyCount: number;
  lastActivityAt: number;
  canModerate: boolean;
}

export interface ChatRoomSummary {
  id: string;
  name: string;
  topic: string | null;
  avatarUrl: string | null;
  unreadCount: number;
  highlightCount: number;
  memberCount: number;
  lastActivityAt: number;
  canModerate: boolean;
}

export interface ChatMessage extends ForumPost {
  replyToEventId: string | null;
  thread: {
    threadId: string;
    replyCount: number;
  } | null;
}

export interface LoadChatMessagesOptions {
  backfillPasses?: number;
  cursorEventId?: string | null;
  pageSize?: number;
}

export interface LoadChatMessagesResult {
  room: ChatRoomSummary;
  messages: ChatMessage[];
  hasMoreHistory: boolean;
  nextCursorEventId: string | null;
}

export interface SendChatMessagePayload {
  roomId: string;
  markdown: string;
  replyToEventId: string | null;
  attachments: File[];
  poll: PollDraft | null;
}

export interface StartThreadFromChatPayload {
  roomId: string;
  rootEventId: string;
  markdown: string;
  attachments: File[];
  poll: PollDraft | null;
}

export interface ForumSnapshot {
  spaces: ForumSpace[];
  groups: ForumGroup[];
  threads: ForumThread[];
  threadMap: Record<string, ForumThread>;
  updatedAt: number;
}

export interface ForumState {
  status: ConnectionStatus;
  errorMessage: string | null;
  config: MatrixConnectionConfig | null;
  selectedSpaceId: string | null;
  isLoading: boolean;
  snapshot: ForumSnapshot;
}

export const createEmptySnapshot = (): ForumSnapshot => ({
  spaces: [],
  groups: [],
  threads: [],
  threadMap: {},
  updatedAt: 0,
});
