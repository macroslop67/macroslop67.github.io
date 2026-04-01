import { type FormEvent, useEffect, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMatrixForum } from "../../matrix/context";
import { DEFAULT_INITIAL_SYNC_LIMIT } from "../../matrix/constants";
import { acquireTokenWithPassword } from "./auth-bootstrap";
import { createDefaultDraft, parseConnectionDraft, saveConnectionConfig } from "./settings-storage";

export function SettingsPage() {
  const { t } = useTranslation();
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
          throw new Error(t("settings.tokenRequired"));
        }

        if (!userId) {
          throw new Error(t("settings.matrixUserRequired"));
        }

        parsedConfig = parseConnectionDraft({
          ...draft,
          accessToken,
          userId,
          initialSyncLimit: draft.initialSyncLimit || String(DEFAULT_INITIAL_SYNC_LIMIT),
        });
      } else {
        if (!loginUser.trim()) {
          throw new Error(t("settings.userRequired"));
        }

        if (!password.trim()) {
          throw new Error(t("settings.passwordRequired"));
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
      setNoticeMessage(t("settings.loggedInNotice"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("settings.loginFailed"));
    } finally {
      setSaving(false);
    }
  };

  const statusMessageByState = {
    idle: t("settings.status.idle"),
    connecting: t("settings.status.connecting"),
    live: t("settings.status.live"),
    error: t("settings.status.error"),
  } as const;

  return (
    <section className="settings-page settings-page-single">
      <article className="settings-card auth-card">
        <h2>{t("settings.title")}</h2>
        <p className="subtle-line">{t("settings.intro")}</p>

        {errorMessage ? <p className="status-banner status-banner-error">{errorMessage}</p> : null}
        {noticeMessage ? <p className="status-banner">{noticeMessage}</p> : null}

        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="homeserverUrl">{t("settings.homeserverUrl")}</label>
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
            <label htmlFor="loginUser">{t("settings.user")}</label>
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
            <label htmlFor="loginPassword">{t("settings.password")}</label>
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
            {t("settings.useAccessToken")}
          </label>

          {useAccessTokenMode ? (
            <div className="token-mode-grid">
              <div className="field-group">
                <label htmlFor="tokenUserId">{t("settings.matrixUserId")}</label>
                <input
                  id="tokenUserId"
                  className="text-input"
                  value={draft.userId}
                  onChange={(event) => updateDraftField("userId", event.target.value)}
                  placeholder="@alice:matrix.org"
                />
              </div>

              <div className="field-group">
                <label htmlFor="tokenValue">{t("settings.accessToken")}</label>
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
              {saving ? t("settings.loggingIn") : t("composer.login")}
            </button>

            <span className="status-line">{statusMessageByState[state.status]}</span>
          </div>
        </form>
      </article>
    </section>
  );
}
