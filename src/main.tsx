import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// NOTE: Monaco is intentionally NOT imported here. It is a very large module
// graph; pulling it into the entry chunk blocks first paint (black window for
// seconds in dev). It is loaded lazily with the SQL editor instead.

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
