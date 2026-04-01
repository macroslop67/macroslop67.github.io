import { format } from "date-fns";
import { enUS, pl } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { formatRelativeTimestamp } from "./format";

type RelativeTimeProps = {
  timestamp: number;
  className?: string;
};

export function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  const { i18n } = useTranslation();
  const date = new Date(timestamp);
  const dateLocale = i18n.resolvedLanguage?.startsWith("pl") ? pl : enUS;

  return (
    <time
      className={className}
      dateTime={date.toISOString()}
      title={format(date, "PPpp", { locale: dateLocale })}
    >
      {formatRelativeTimestamp(timestamp, dateLocale)}
    </time>
  );
}
