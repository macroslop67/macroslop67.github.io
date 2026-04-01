import { z } from "zod";
import { DEFAULT_INITIAL_SYNC_LIMIT } from "../../matrix/constants";
import { type MatrixConnectionConfig } from "../../matrix/types";

const SESSION_STORAGE_KEY = "matricesbb.connection.session";
const LEGACY_LOCAL_STORAGE_KEY = "matricesbb.connection";
const THEME_PREFERENCE_STORAGE_KEY = "matricesbb.theme";

export type ThemePreference = "light" | "dark";

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
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // If session storage is unavailable, skip persistence and keep runtime-only session.
  }

  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }
};

export const loadConnectionConfig = (): MatrixConnectionConfig | null => {
  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }

  let rawValue: string | null = null;
  try {
    rawValue = sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    rawValue = null;
  }

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
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }

  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }
};

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === "light" || value === "dark";

export const loadThemePreference = (): ThemePreference | null => {
  try {
    const storedValue = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return isThemePreference(storedValue) ? storedValue : null;
  } catch {
    return null;
  }
};

export const saveThemePreference = (themePreference: ThemePreference): void => {
  try {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, themePreference);
  } catch {
    // If local storage is unavailable, keep preference runtime-only.
  }
};
