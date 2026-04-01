import { useMutation } from "@tanstack/react-query";
import { useMatrixForum } from "../../matrix/context";
import {
  type PollDraft,
  type SendChatMessagePayload,
  type StartThreadFromChatPayload,
} from "../../matrix/types";

export interface CreateThreadPayload {
  roomId: string;
  title: string;
  markdown: string;
  attachments: File[];
  poll: PollDraft | null;
}

export interface ReplyToThreadPayload {
  roomId: string;
  rootEventId: string;
  markdown: string;
  replyToEventId: string | null;
  attachments: File[];
  poll: PollDraft | null;
}

export interface ReactToPostPayload {
  roomId: string;
  eventId: string;
  emoji: string;
}

export interface EditPostPayload {
  roomId: string;
  eventId: string;
  markdown: string;
}

export interface RedactPostPayload {
  roomId: string;
  eventId: string;
  reason?: string;
}

export type PostChatMessagePayload = SendChatMessagePayload;
export type StartThreadFromChatMutationPayload = StartThreadFromChatPayload;

export const useCreateThreadMutation = () => {
  const { createThread, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: CreateThreadPayload) =>
      createThread(
        payload.roomId,
        payload.title,
        payload.markdown,
        payload.attachments,
        payload.poll,
      ),
    onSuccess: () => {
      void refresh();
    },
  });
};

export const useReplyToThreadMutation = () => {
  const { replyToThread, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: ReplyToThreadPayload) =>
      replyToThread(
        payload.roomId,
        payload.rootEventId,
        payload.markdown,
        payload.replyToEventId,
        payload.attachments,
        payload.poll,
      ),
    onSuccess: () => {
      void refresh();
    },
  });
};

export const useReactToPostMutation = () => {
  const { reactToPost, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: ReactToPostPayload) =>
      reactToPost(payload.roomId, payload.eventId, payload.emoji),
    onSuccess: () => {
      void refresh();
    },
  });
};

export const useEditPostMutation = () => {
  const { editPost, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: EditPostPayload) =>
      editPost(payload.roomId, payload.eventId, payload.markdown),
    onSuccess: () => {
      void refresh();
    },
  });
};

export const useRedactPostMutation = () => {
  const { redactPost, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: RedactPostPayload) =>
      redactPost(payload.roomId, payload.eventId, payload.reason),
    onSuccess: () => {
      void refresh();
    },
  });
};

export const usePostChatMessageMutation = () => {
  const { postChatMessage, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: PostChatMessagePayload) => postChatMessage(payload),
    onSuccess: () => {
      void refresh();
    },
  });
};

export const useStartThreadFromChatMutation = () => {
  const { startThreadFromChat, refresh } = useMatrixForum();

  return useMutation({
    mutationFn: async (payload: StartThreadFromChatMutationPayload) => startThreadFromChat(payload),
    onSuccess: () => {
      void refresh();
    },
  });
};
