import { type ForumThread, type ThreadReply } from "../../matrix/types";

export interface ReplyNode {
  reply: ThreadReply;
  children: ReplyNode[];
}

export const MAX_TREE_NESTING_DEPTH = 7;

export const buildReplyForest = (
  thread: ForumThread,
  maxDepth: number = MAX_TREE_NESTING_DEPTH,
): ReplyNode[] => {
  const effectiveMaxDepth = Math.max(1, maxDepth);
  const sortedReplies = [...thread.replies].sort((left, right) => left.createdAt - right.createdAt);

  const nodesByEventId = new Map<string, ReplyNode>();
  const depthByEventId = new Map<string, number>();
  const parentByEventId = new Map<string, string | null>();

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
      depthByEventId.set(reply.eventId, 0);
      parentByEventId.set(reply.eventId, null);
      continue;
    }

    const directParentNode = nodesByEventId.get(reply.replyToEventId);
    if (!directParentNode) {
      roots.push(node);
      depthByEventId.set(reply.eventId, 0);
      parentByEventId.set(reply.eventId, null);
      continue;
    }

    let attachParentEventId: string | null = reply.replyToEventId;
    while (attachParentEventId) {
      const parentDepth = depthByEventId.get(attachParentEventId);
      if (parentDepth === undefined) {
        attachParentEventId = null;
        break;
      }

      if (parentDepth < effectiveMaxDepth - 1) {
        break;
      }

      attachParentEventId = parentByEventId.get(attachParentEventId) ?? null;
    }

    if (!attachParentEventId) {
      roots.push(node);
      depthByEventId.set(reply.eventId, 0);
      parentByEventId.set(reply.eventId, null);
      continue;
    }

    const attachParentNode = nodesByEventId.get(attachParentEventId);
    if (!attachParentNode) {
      roots.push(node);
      depthByEventId.set(reply.eventId, 0);
      parentByEventId.set(reply.eventId, null);
      continue;
    }

    const attachParentDepth = depthByEventId.get(attachParentEventId) ?? 0;
    attachParentNode.children.push(node);
    depthByEventId.set(reply.eventId, attachParentDepth + 1);
    parentByEventId.set(reply.eventId, attachParentEventId);
  }

  return roots;
};
