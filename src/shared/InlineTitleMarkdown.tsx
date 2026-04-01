import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type InlineTitleMarkdownProps = {
  title: string;
  className?: string;
  fallback?: string;
};

const sanitizeInlineTitle = (rawTitle: string): string => {
  const firstLine = rawTitle.replace(/\r/g, "").split("\n")[0] ?? "";
  const withoutHeadingPrefix = firstLine.replace(/^#{1,6}\s+/, "");
  const withoutBackticks = withoutHeadingPrefix.replace(/`+/g, "");

  return withoutBackticks.replace(/\s+/g, " ").trim();
};

export function InlineTitleMarkdown({
  title,
  className,
  fallback = "Untitled",
}: InlineTitleMarkdownProps) {
  const normalizedTitle = sanitizeInlineTitle(title);

  return (
    <span className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        unwrapDisallowed
        disallowedElements={[
          "a",
          "blockquote",
          "code",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "hr",
          "img",
          "li",
          "ol",
          "pre",
          "table",
          "tbody",
          "td",
          "th",
          "thead",
          "tr",
          "ul",
        ]}
        components={{
          p: ({ children }) => <>{children}</>,
        }}
      >
        {normalizedTitle || fallback}
      </ReactMarkdown>
    </span>
  );
}
