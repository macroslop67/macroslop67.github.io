import { useEffect, useRef, useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import {
  type ThemePreference,
  clearConnectionConfig,
  loadThemePreference,
  saveThemePreference,
} from "../features/settings/settings-storage";
import { useMatrixForum } from "../matrix/context";
import { avatarInitials, shortUserId } from "../shared/format";
import { RelativeTime } from "../shared/RelativeTime";
import { ChatPane } from "../features/chats/ChatPane";

const statusLabelByState = {
  idle: "⚪ Idle",
  connecting: "🟡 Connecting",
  live: "🟢 Live sync",
  error: "🔴 Sync error",
} as const;

const readSystemThemePreference = (): ThemePreference => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export function AppShell() {
  const { state, disconnect } = useMatrixForum();
  const totalUnread = state.snapshot.groups.reduce((total, group) => total + group.unreadCount, 0);
  const totalMentions = state.snapshot.groups.reduce(
    (total, group) => total + group.highlightCount,
    0,
  );
  const currentUserId = state.config?.userId ?? null;
  const currentUserLabel = currentUserId ? shortUserId(currentUserId) : "User";
  const currentUserInitials = avatarInitials(currentUserLabel, currentUserId ?? undefined);

  const [isAccountPopoverOpen, setIsAccountPopoverOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference | null>(() =>
    loadThemePreference(),
  );
  const [systemThemePreference, setSystemThemePreference] = useState<ThemePreference>(() =>
    readSystemThemePreference(),
  );

  const accountPopoverRef = useRef<HTMLDivElement | null>(null);
  const resolvedThemePreference = themePreference ?? systemThemePreference;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemPreference = () => {
      setSystemThemePreference(mediaQuery.matches ? "dark" : "light");
    };

    syncSystemPreference();
    mediaQuery.addEventListener("change", syncSystemPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncSystemPreference);
    };
  }, []);

  useEffect(() => {
    const rootElement = document.documentElement;
    rootElement.dataset.theme = resolvedThemePreference;
    rootElement.style.colorScheme = resolvedThemePreference;
  }, [resolvedThemePreference]);

  useEffect(() => {
    if (!isAccountPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (accountPopoverRef.current && !accountPopoverRef.current.contains(event.target)) {
        setIsAccountPopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAccountPopoverOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isAccountPopoverOpen]);

  useEffect(() => {
    if (!state.config) {
      setIsAccountPopoverOpen(false);
    }
  }, [state.config]);

  const handleLogout = () => {
    setIsAccountPopoverOpen(false);
    disconnect();
    clearConnectionConfig();
  };

  const toggleThemePreference = () => {
    const nextThemePreference: ThemePreference =
      resolvedThemePreference === "dark" ? "light" : "dark";

    setThemePreference(nextThemePreference);
    saveThemePreference(nextThemePreference);
  };

  return (
    <>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/home" className="brand-mark">
            <span className="brand-eyebrow">Matrix Space Client</span>
            <span className="brand-title">MatricesBB</span>
          </Link>

          <div className="header-meta">
            {state.config ? (
              <div className="account-popover-wrap" ref={accountPopoverRef}>
                <button
                  type="button"
                  className="account-popover-trigger"
                  aria-haspopup="menu"
                  aria-expanded={isAccountPopoverOpen}
                  onClick={() => setIsAccountPopoverOpen((isOpen) => !isOpen)}
                >
                  <span className="account-avatar account-avatar-fallback">
                    {currentUserInitials}
                  </span>
                  <span className="account-trigger-label">{currentUserLabel}</span>
                  <span aria-hidden="true">▾</span>
                </button>

                {isAccountPopoverOpen ? (
                  <div className="account-popover" role="menu" aria-label="Account">
                    <div className="account-popover-user">
                      <span className="account-avatar account-avatar-fallback">
                        {currentUserInitials}
                      </span>
                      <div className="account-popover-user-meta">
                        <strong>{currentUserLabel}</strong>
                        <span>{currentUserId}</span>
                      </div>
                    </div>

                    <div className={`sync-pill sync-${state.status}`}>
                      {statusLabelByState[state.status]}
                      <span>
                        {state.snapshot.updatedAt > 0 ? (
                          <>
                            Updated <RelativeTime timestamp={state.snapshot.updatedAt} />
                          </>
                        ) : (
                          "No sync yet"
                        )}
                      </span>
                    </div>

                    <div className="sync-pill">
                      {totalUnread} unread
                      <span>{totalMentions > 0 ? `${totalMentions} mentions` : "No mentions"}</span>
                    </div>

                    <div className="account-popover-row">
                      <div>
                        <strong>Dark mode</strong>
                        <div className="inline-note">
                          {themePreference ? "Saved for this browser" : "Using system preference"}
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`theme-toggle ${resolvedThemePreference === "dark" ? "theme-toggle-active" : ""}`}
                        aria-pressed={resolvedThemePreference === "dark"}
                        aria-label="Toggle dark mode"
                        onClick={toggleThemePreference}
                      >
                        <span className="theme-toggle-knob" />
                      </button>
                    </div>

                    <button type="button" className="ghost-button" onClick={handleLogout}>
                      Log out
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
      <ChatPane />
    </>
  );
}
