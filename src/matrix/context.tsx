import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { loadConnectionConfig } from "../features/settings/settings-storage";
import { MatrixForumStore } from "./forum-store";

const MatrixForumStoreContext = createContext<MatrixForumStore | null>(null);

type MatrixForumProviderProps = {
  children: ReactNode;
};

export function MatrixForumProvider({ children }: MatrixForumProviderProps) {
  const storeRef = useRef<MatrixForumStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = new MatrixForumStore();
  }

  useEffect(() => {
    const store = storeRef.current;
    if (!store) {
      return;
    }

    const savedConnection = loadConnectionConfig();
    if (savedConnection) {
      void store.connect(savedConnection);
    }

    return () => {
      store.dispose();
    };
  }, []);

  return (
    <MatrixForumStoreContext.Provider value={storeRef.current}>
      {children}
    </MatrixForumStoreContext.Provider>
  );
}

const useMatrixForumStore = (): MatrixForumStore => {
  const store = useContext(MatrixForumStoreContext);
  if (!store) {
    throw new Error("useMatrixForum must be used within MatrixForumProvider");
  }

  return store;
};

export function useMatrixForum() {
  const store = useMatrixForumStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    state,
    connect: store.connect,
    disconnect: store.disconnect,
    selectSpace: store.setSelectedSpace,
    refresh: store.refresh,
    createThread: store.createThread,
    replyToThread: store.replyToThread,
    reactToPost: store.reactToPost,
    editPost: store.editPost,
    redactPost: store.redactPost,
    listChatRooms: store.listChatRooms,
    loadChatMessages: store.loadChatMessages,
    postChatMessage: store.postChatMessage,
    startThreadFromChat: store.startThreadFromChat,
    voteInPoll: store.voteInPoll,
  };
}
