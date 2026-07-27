// ── Result export ─────────────────────────────────────────────────────────
// Exports go through a native save dialog in the backend, not through a
// browser download. WKWebView — the engine behind the app window on macOS —
// ignores the `download` attribute on blob URLs, so the anchor-click approach
// fails silently there: the click registers, and nothing whatsoever happens.

import { invoke } from "@tauri-apps/api/core";
import type { Cell, ResultColumn } from "@/types";
import { isTauri } from "@/lib/api";

function toText(v: Cell): string {
  if (v === null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * Write `content` to a file the user picks. Resolves to the saved path, or
 * `null` when the dialog was cancelled.
 */
async function save(name: string, content: string): Promise<string | null> {
  if (!isTauri) {
    // Browser preview has no backend; the anchor path at least works there.
    const url = URL.createObjectURL(new Blob([content]));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return name;
  }
  return invoke<string | null>("export_file", {
    defaultName: name,
    contents: content,
  });
}

export function exportCsv(cols: ResultColumn[], rows: Cell[][]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = cols.map((c) => esc(c.name)).join(",");
  const body = rows.map((r) => r.map((c) => esc(toText(c))).join(",")).join("\n");
  // The BOM makes Excel read UTF-8 correctly instead of mangling accents.
  return save("zeru-export.csv", `\uFEFF${head}\n${body}`);
}

export function exportJson(cols: ResultColumn[], rows: Cell[][]) {
  const objs = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c.name, r[i]])));
  return save("zeru-export.json", JSON.stringify(objs, null, 2));
}

export function exportExcel(cols: ResultColumn[], rows: Cell[][]) {
  // Minimal SpreadsheetML that Excel opens natively.
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const th = cols.map((c) => `<th>${esc(c.name)}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(toText(c))}</td>`).join("")}</tr>`)
    .join("");
  const html =
    `<html><head><meta charset="utf-8"></head><body>` +
    `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>` +
    `</body></html>`;
  return save("zeru-export.xls", html);
}

export function rowToText(cols: ResultColumn[], row: Cell[]): string {
  return cols.map((c, i) => `${c.name}: ${toText(row[i])}`).join("\t");
}
