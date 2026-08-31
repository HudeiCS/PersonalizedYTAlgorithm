import { useEffect, useState } from "react";
import { applyTheme, loadTheme, resolveTheme } from "../prefs";

/** Light/dark switch that sits beside the account control in the header.
 *
 *  Three states, not two: light, dark, and system. Starting from "system"
 *  means a first-time visitor gets whatever their OS asks for; the button
 *  then flips to the opposite of what is currently on screen, which is what
 *  a single click is expected to do. The choice is written to <html> and
 *  persisted, and while it is still "system" the page keeps following the OS
 *  if that changes mid-session. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(loadTheme);
  const [resolved, setResolved] = useState(() => resolveTheme(loadTheme()));

  useEffect(() => {
    applyTheme(theme);
    setResolved(resolveTheme(theme));

    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const next = resolved === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
