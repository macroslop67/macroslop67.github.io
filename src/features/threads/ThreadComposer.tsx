import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  toolbarPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  InsertThematicBreak,
} from "@mdxeditor/editor";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { type PollDraft } from "../../matrix/types";

export interface ComposerPayload {
  title: string;
  markdown: string;
  attachments: File[];
  poll: PollDraft | null;
}

type ThreadComposerProps = {
  formId?: string;
  heading: string;
  submitLabel: string;
  withTitle?: boolean;
  compact?: boolean;
  busy?: boolean;
  initialTitle?: string;
  initialMarkdown?: string;
  resetOnSubmit?: boolean;
  contextPreview?: ReactNode;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
  onCancel?: () => void;
};

const readCurrentTheme = (): "light" | "dark" => {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
};

export function ThreadComposer({
  formId,
  heading,
  submitLabel,
  withTitle = false,
  compact = false,
  busy = false,
  initialTitle = "",
  initialMarkdown = "",
  resetOnSubmit = true,
  contextPreview,
  onSubmit,
  onCancel,
}: ThreadComposerProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMaxSelections, setPollMaxSelections] = useState(1);
  const [editorKey, setEditorKey] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(readCurrentTheme);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const rootElement = document.documentElement;
    const updateTheme = () => {
      setTheme(rootElement.dataset.theme === "dark" ? "dark" : "light");
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(rootElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  const editorPlugins = useMemo(
    () => [
      toolbarPlugin({
        toolbarContents: () => (
          <>
            <UndoRedo />
            <BoldItalicUnderlineToggles />
            <ListsToggle />
            <BlockTypeSelect />
            <CodeToggle />
            <CreateLink />
            <InsertThematicBreak />
          </>
        ),
      }),
      headingsPlugin({ allowedHeadingLevels: [2, 3] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      markdownShortcutPlugin(),
    ],
    [],
  );

  const normalizedPollOptions = pollOptions.map((option) => option.trim()).filter(Boolean);
  const pollReady =
    pollEnabled && pollQuestion.trim().length > 0 && normalizedPollOptions.length >= 2;
  const hasAnyContent = markdown.trim().length > 0 || attachments.length > 0 || pollReady;
  const canSubmit = hasAnyContent && (!withTitle || title.trim().length > 0);

  const handleAttachmentChange = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }

    setAttachments((existingAttachments) => [
      ...existingAttachments,
      ...Array.from(fileList).filter((file) =>
        existingAttachments.every(
          (existing) =>
            `${existing.name}:${existing.size}:${existing.lastModified}` !==
            `${file.name}:${file.size}:${file.lastModified}`,
        ),
      ),
    ]);
  };

  const removeAttachment = (attachmentIndex: number) => {
    setAttachments((existingAttachments) =>
      existingAttachments.filter((_, index) => index !== attachmentIndex),
    );
  };

  const updatePollOption = (optionIndex: number, value: string) => {
    setPollOptions((existingOptions) =>
      existingOptions.map((option, index) => (index === optionIndex ? value : option)),
    );
  };

  const addPollOption = () => {
    setPollOptions((existingOptions) => [...existingOptions, ""]);
  };

  const removePollOption = (optionIndex: number) => {
    setPollOptions((existingOptions) => {
      if (existingOptions.length <= 2) {
        return existingOptions;
      }

      return existingOptions.filter((_, index) => index !== optionIndex);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || busy) {
      return;
    }

    await onSubmit({
      title: title.trim(),
      markdown: markdown.trim(),
      attachments,
      poll: pollReady
        ? {
            question: pollQuestion.trim(),
            options: normalizedPollOptions,
            maxSelections: Math.max(1, pollMaxSelections || 1),
          }
        : null,
    });

    if (resetOnSubmit) {
      setTitle(initialTitle);
      setMarkdown(initialMarkdown);
      setAttachments([]);
      setPollEnabled(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollMaxSelections(1);
      setEditorKey((previousValue) => previousValue + 1);
    }
  };

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!canSubmit || busy) {
        return;
      }

      event.currentTarget.requestSubmit();
    }
  };

  const triggerAttachmentPicker = () => {
    attachmentInputRef.current?.click();
  };

  const attachmentInputId = `${formId ?? "threadComposer"}-attachments`;

  return (
    <form
      id={formId}
      className={`composer-card ${compact ? "composer-card-compact" : ""}`}
      onSubmit={handleSubmit}
      onKeyDown={handleFormKeyDown}
    >
      {!compact && (
        <div className="composer-header">
          <h3>{heading}</h3>
        </div>
      )}

      {contextPreview ? <div className="composer-context-preview">{contextPreview}</div> : null}

      {withTitle ? (
        <div className="field-group">
          <label htmlFor="threadComposerTitle">{t("composer.titleLabel")}</label>
          <input
            id="threadComposerTitle"
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("composer.titlePlaceholder")}
          />
        </div>
      ) : null}

      {compact ? (
        <div className="editor-shell editor-shell-compact">
          <textarea
            key={editorKey}
            className="text-input composer-inline-editor"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            rows={1}
            placeholder={t("composer.compactPlaceholder")}
          />
        </div>
      ) : (
        <div className="editor-shell">
          <MDXEditor
            key={editorKey}
            className={`mdx-editor ${theme === "dark" ? "dark-theme" : "light-theme"}`}
            contentEditableClassName="mdx-editor-content"
            markdown={markdown}
            onChange={setMarkdown}
            plugins={editorPlugins}
          />
        </div>
      )}

      {compact ? (
        <input
          id={attachmentInputId}
          ref={attachmentInputRef}
          className="composer-hidden-file-input"
          type="file"
          multiple
          onChange={(event) => {
            handleAttachmentChange(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      ) : (
        <div className="field-group">
          <label htmlFor={attachmentInputId}>{t("composer.attachmentsLabel")}</label>
          <input
            id={attachmentInputId}
            className="text-input"
            type="file"
            multiple
            onChange={(event) => {
              handleAttachmentChange(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </div>
      )}

      {attachments.length > 0 ? (
        <div className="attachment-pending-list">
          {attachments.map((attachment, index) => (
            <div key={`${attachment.name}-${attachment.size}-${attachment.lastModified}`}>
              <span>{attachment.name}</span>
              <button type="button" className="link-action" onClick={() => removeAttachment(index)}>
                {t("common.remove")}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {compact ? null : (
        <label className="token-mode-toggle">
          <input
            type="checkbox"
            checked={pollEnabled}
            onChange={(event) => setPollEnabled(event.target.checked)}
          />
          {t("composer.addPoll")}
        </label>
      )}

      {pollEnabled ? (
        <div className="poll-builder">
          <div className="field-group">
            <label htmlFor="pollQuestion">{t("composer.pollQuestionLabel")}</label>
            <input
              id="pollQuestion"
              className="text-input"
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              placeholder={t("composer.pollQuestionPlaceholder")}
            />
          </div>

          <div className="field-group">
            <label htmlFor="pollMaxSelections">{t("composer.maxSelectionsLabel")}</label>
            <input
              id="pollMaxSelections"
              className="number-input"
              type="number"
              min={1}
              value={pollMaxSelections}
              onChange={(event) =>
                setPollMaxSelections(Math.max(1, Number.parseInt(event.target.value, 10) || 1))
              }
            />
          </div>

          <div className="poll-options-list">
            {pollOptions.map((option, index) => (
              <div key={`poll-option-${index}`} className="poll-option-row">
                <input
                  className="text-input"
                  value={option}
                  onChange={(event) => updatePollOption(index, event.target.value)}
                  placeholder={t("composer.optionPlaceholder", { index: index + 1 })}
                />
                <button
                  type="button"
                  className="link-action"
                  onClick={() => removePollOption(index)}
                  disabled={pollOptions.length <= 2}
                >
                  {t("common.remove")}
                </button>
              </div>
            ))}
          </div>

          <button type="button" className="ghost-button" onClick={addPollOption}>
            {t("composer.addOption")}
          </button>
        </div>
      ) : null}

      <div className="composer-actions">
        {onCancel ? (
          <button className="ghost-button" type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        ) : null}

        {compact ? (
          <div className="composer-compact-actions-right">
            <button
              type="button"
              className="composer-mini-button"
              onClick={triggerAttachmentPicker}
              title="Upload attachments"
            >
              {t("common.upload")}
            </button>
            <button
              type="button"
              className={`composer-mini-button ${pollEnabled ? "composer-mini-button-active" : ""}`}
              onClick={() => setPollEnabled((enabled) => !enabled)}
              title="Toggle poll builder"
            >
              {t("common.poll")}
            </button>

            <button className="solid-button" type="submit" disabled={busy || !canSubmit}>
              {busy ? t("composer.sending") : submitLabel}
            </button>
          </div>
        ) : (
          <button className="solid-button" type="submit" disabled={busy || !canSubmit}>
            {busy ? t("composer.sending") : submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}
