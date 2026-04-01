import { type FormEvent, useEffect, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { useMatrixForum } from "../../matrix/context";
import { DEFAULT_INITIAL_SYNC_LIMIT } from "../../matrix/constants";
import { acquireTokenWithPassword } from "./auth-bootstrap";
import { createDefaultDraft, parseConnectionDraft, saveConnectionConfig } from "./settings-storage";

const statusMessageByState = {
  idle: "No active Matrix session.",
  connecting: "Signing in and synchronizing...",
  live: "Signed in and receiving updates.",
  error: "Sign-in failed. Check homeserver and credentials.",
} as const;

export function SettingsPage() {
  const { state, connect } = useMatrixForum();
  const [draft, setDraft] = useState(() => createDefaultDraft(state.config));
  const [loginUser, setLoginUser] = useState(state.config?.userId ?? "");
  const [password, setPassword] = useState("");
  const [useAccessTokenMode, setUseAccessTokenMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(createDefaultDraft(state.config));
    if (state.config?.userId) {
      setLoginUser(state.config.userId);
    }
  }, [state.config]);

  if (state.config && (state.status === "live" || state.status === "connecting")) {
    return <Navigate to="/home" />;
  }

  const updateDraftField = (field: "homeserverUrl" | "accessToken" | "userId", value: string) => {
    setDraft((previousValue) => ({
      ...previousValue,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNoticeMessage(null);
    setErrorMessage(null);
    setSaving(true);

    try {
      let parsedConfig;

      if (useAccessTokenMode) {
        const accessToken = draft.accessToken.trim();
        const fallbackUserId = loginUser.trim().startsWith("@") ? loginUser.trim() : "";
        const userId = draft.userId.trim() || fallbackUserId;

        if (!accessToken) {
          throw new Error("Access token is required in token mode.");
        }

        if (!userId) {
          throw new Error("Matrix user ID is required in token mode.");
        }

        parsedConfig = parseConnectionDraft({
          ...draft,
          accessToken,
          userId,
          initialSyncLimit: draft.initialSyncLimit || String(DEFAULT_INITIAL_SYNC_LIMIT),
        });
      } else {
        if (!loginUser.trim()) {
          throw new Error("Login user is required.");
        }

        if (!password.trim()) {
          throw new Error("Password is required.");
        }

        const bootstrap = await acquireTokenWithPassword({
          homeserverUrl: draft.homeserverUrl,
          user: loginUser,
          password,
        });

        parsedConfig = parseConnectionDraft({
          ...draft,
          accessToken: bootstrap.accessToken,
          userId: bootstrap.userId,
          initialSyncLimit: draft.initialSyncLimit || String(DEFAULT_INITIAL_SYNC_LIMIT),
        });

        setDraft((previousValue) => ({
          ...previousValue,
          accessToken: bootstrap.accessToken,
          userId: bootstrap.userId,
        }));
        setPassword("");
      }

      saveConnectionConfig(parsedConfig);
      await connect(parsedConfig);
      setNoticeMessage("Signed in successfully.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not complete sign-in.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-page settings-page-single">
      <article className="settings-card auth-card">
        <h2>Log in</h2>
        <p className="subtle-line">Use account credentials, or switch to token mode if needed.</p>

        {errorMessage ? <p className="status-banner status-banner-error">{errorMessage}</p> : null}
        {noticeMessage ? <p className="status-banner">{noticeMessage}</p> : null}

        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="homeserverUrl">Homeserver URL</label>
            <input
              id="homeserverUrl"
              className="text-input"
              autoComplete="url"
              value={draft.homeserverUrl}
              onChange={(event) => updateDraftField("homeserverUrl", event.target.value)}
              placeholder="https://matrix.org"
            />
          </div>

          <div className="field-group">
            <label htmlFor="loginUser">User</label>
            <input
              id="loginUser"
              className="text-input"
              autoComplete="username"
              value={loginUser}
              onChange={(event) => setLoginUser(event.target.value)}
              placeholder="@alice:matrix.org or alice"
            />
          </div>

          <div className="field-group">
            <label htmlFor="loginPassword">Password</label>
            <input
              id="loginPassword"
              className="text-input"
              type="password"
              autoComplete="current-password"
              disabled={useAccessTokenMode}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Account password"
            />
          </div>

          <label className="token-mode-toggle">
            <input
              type="checkbox"
              checked={useAccessTokenMode}
              onChange={(event) => setUseAccessTokenMode(event.target.checked)}
            />
            Use access token instead of password
          </label>

          {useAccessTokenMode ? (
            <div className="token-mode-grid">
              <div className="field-group">
                <label htmlFor="tokenUserId">Matrix User ID</label>
                <input
                  id="tokenUserId"
                  className="text-input"
                  value={draft.userId}
                  onChange={(event) => updateDraftField("userId", event.target.value)}
                  placeholder="@alice:matrix.org"
                />
              </div>

              <div className="field-group">
                <label htmlFor="tokenValue">Access Token</label>
                <input
                  id="tokenValue"
                  className="text-input"
                  type="password"
                  value={draft.accessToken}
                  onChange={(event) => updateDraftField("accessToken", event.target.value)}
                  placeholder="syt_..."
                />
              </div>
            </div>
          ) : null}

          <div className="settings-actions">
            <button className="solid-button" type="submit" disabled={saving}>
              {saving ? "Logging in..." : "Log in"}
            </button>

            <span className="status-line">{statusMessageByState[state.status]}</span>
          </div>
        </form>
      </article>
    </section>
  );
}
