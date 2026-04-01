import { type ForumThread, type ThreadReply } from "../../matrix/types";

export interface ReplyNode {
  reply: ThreadReply;
  children: ReplyNode[];
}

export const buildReplyForest = (thread: ForumThread): ReplyNode[] => {
  const sortedReplies = [...thread.replies].sort((left, right) => left.createdAt - right.createdAt);

  const nodesByEventId = new Map<string, ReplyNode>();
  for (const reply of sortedReplies) {
    nodesByEventId.set(reply.eventId, {
      reply,
      children: [],
    });
  }

  const roots: ReplyNode[] = [];

  for (const reply of sortedReplies) {
    const node = nodesByEventId.get(reply.eventId);
    if (!node) {
      continue;
    }

    if (!reply.replyToEventId || reply.replyToEventId === thread.root.eventId) {
      roots.push(node);
      continue;
    }

    const parentNode = nodesByEventId.get(reply.replyToEventId);
    if (!parentNode) {
      roots.push(node);
      continue;
    }

    parentNode.children.push(node);
  }

  return roots;
};
