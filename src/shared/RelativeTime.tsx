import { format } from "date-fns";
import { formatRelativeTimestamp } from "./format";

type RelativeTimeProps = {
  timestamp: number;
  className?: string;
};

export function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  const date = new Date(timestamp);

  return (
    <time className={className} dateTime={date.toISOString()} title={format(date, "PPpp")}>
      {formatRelativeTimestamp(timestamp)}
    </time>
  );
}
