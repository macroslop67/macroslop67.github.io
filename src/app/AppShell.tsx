import { Link, Outlet } from "@tanstack/react-router";
import { clearConnectionConfig } from "../features/settings/settings-storage";
import { useMatrixForum } from "../matrix/context";
import { RelativeTime } from "../shared/RelativeTime";
import { ChatPane } from "../features/chats/ChatPane";

const statusLabelByState = {
  idle: "⚪ Idle",
  connecting: "🟡 Connecting",
  live: "🟢 Live sync",
  error: "🔴 Sync error",
} as const;

export function AppShell() {
  const { state, disconnect } = useMatrixForum();
  const totalUnread = state.snapshot.groups.reduce((total, group) => total + group.unreadCount, 0);
  const totalMentions = state.snapshot.groups.reduce(
    (total, group) => total + group.highlightCount,
    0,
  );

  const handleLogout = () => {
    disconnect();
    clearConnectionConfig();
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

            {state.config ? (
              <div className="sync-pill">
                {totalUnread} unread
                <span>{totalMentions > 0 ? `${totalMentions} mentions` : "No mentions"}</span>
              </div>
            ) : null}

            {state.config ? (
              <button type="button" className="ghost-button" onClick={handleLogout}>
                Log out
              </button>
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
