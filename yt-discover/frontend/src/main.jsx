import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { applyTheme, loadTheme } from "./prefs";
import "./styles.css";

// Before the first render, so a saved dark choice doesn't flash a light page
// (or the reverse) while React boots.
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
