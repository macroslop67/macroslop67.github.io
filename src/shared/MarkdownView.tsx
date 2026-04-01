import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownViewProps = {
  markdown: string;
  className?: string;
};

export function MarkdownView({ markdown, className }: MarkdownViewProps) {
  return (
    <div className={clsx("post-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
