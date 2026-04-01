import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage, resources } from "./resources";

const LANGUAGE_STORAGE_KEY = "matricesbb.language";

const isSupportedLanguage = (value: string | null): value is SupportedLanguage =>
  value !== null && SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);

const normalizeLanguage = (value: string | null): SupportedLanguage | null => {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized.startsWith("pl")) {
    return "pl";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return null;
};

const loadStoredLanguage = (): SupportedLanguage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(storedValue) ? storedValue : null;
  } catch {
    return null;
  }
};

const detectBrowserLanguage = (): SupportedLanguage => {
  if (typeof navigator === "undefined") {
    return "en";
  }

  return normalizeLanguage(navigator.language) ?? "en";
};

const initialLanguage = loadStoredLanguage() ?? detectBrowserLanguage();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

if (typeof window !== "undefined") {
  i18n.on("languageChanged", (language) => {
    const normalized = normalizeLanguage(language);
    if (!normalized) {
      return;
    }

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage failures and keep runtime-only language preference.
    }
  });
}

export { i18n };
