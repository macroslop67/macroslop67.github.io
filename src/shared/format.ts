import { formatDistanceToNow, type Locale } from "date-fns";

export const formatRelativeTimestamp = (timestamp: number, locale?: Locale): string =>
  formatDistanceToNow(timestamp, {
    addSuffix: true,
    ...(locale ? { locale } : {}),
  });

export const compactText = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

export const shortUserId = (userId: string): string => {
  const withoutSigil = userId.startsWith("@") ? userId.slice(1) : userId;
  return withoutSigil.split(":")[0] || userId;
};

export const avatarInitials = (displayName: string, fallbackUserId?: string): string => {
  const normalized = displayName.trim();
  if (normalized.length > 0) {
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
    }

    return normalized.slice(0, 2).toUpperCase();
  }

  if (!fallbackUserId) {
    return "?";
  }

  return shortUserId(fallbackUserId).slice(0, 2).toUpperCase();
};
