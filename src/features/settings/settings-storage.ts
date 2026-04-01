import { z } from "zod";
import { DEFAULT_INITIAL_SYNC_LIMIT } from "../../matrix/constants";
import { type MatrixConnectionConfig } from "../../matrix/types";

const STORAGE_KEY = "matricesbb.connection";

export const connectionConfigSchema = z
  .object({
    homeserverUrl: z.string().trim().url(),
    accessToken: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    initialSyncLimit: z.coerce.number().int().min(10).max(200),
  })
  .transform((value) => ({
    ...value,
    homeserverUrl: value.homeserverUrl.replace(/\/$/, ""),
  }));

export type ConnectionConfigDraft = {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  initialSyncLimit: string;
};

export const createDefaultDraft = (seed: MatrixConnectionConfig | null): ConnectionConfigDraft => ({
  homeserverUrl: seed?.homeserverUrl ?? "https://matrix.org",
  accessToken: seed?.accessToken ?? "",
  userId: seed?.userId ?? "",
  initialSyncLimit: String(seed?.initialSyncLimit ?? DEFAULT_INITIAL_SYNC_LIMIT),
});

export const parseConnectionDraft = (draft: ConnectionConfigDraft): MatrixConnectionConfig =>
  connectionConfigSchema.parse({
    ...draft,
    initialSyncLimit: Number.parseInt(draft.initialSyncLimit, 10),
  });

export const saveConnectionConfig = (config: MatrixConnectionConfig): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

export const loadConnectionConfig = (): MatrixConnectionConfig | null => {
  const rawValue = localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedJson = JSON.parse(rawValue);
    const parsedConfig = connectionConfigSchema.safeParse(parsedJson);
    return parsedConfig.success ? parsedConfig.data : null;
  } catch {
    return null;
  }
};

export const clearConnectionConfig = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};
