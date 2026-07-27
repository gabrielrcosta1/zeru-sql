import { useCallback, useRef, useState } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { format as formatSql } from "sql-formatter";
// Configures @monaco-editor/react to use the bundled monaco. Imported here (not
// in the app entry) so the heavy monaco graph lives in this lazily-loaded chunk.
import "@/lib/monaco";
import { Play, Wand2, Sparkles, AlignLeft, Braces, Check } from "lucide-react";
import { useApp } from "@/store/app";
import { Button, IconButton } from "@/components/ui/Button";
import { Tooltip, Kbd, VDivider, Spinner } from "@/components/ui/misc";
import type { QueryTab } from "@/types";

const THEME = "zeru-dark";

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.sql", foreground: "7c89ff", fontStyle: "bold" },
      { token: "keyword", foreground: "7c89ff" },
      { token: "operator.sql", foreground: "9aa3b2" },
      { token: "string.sql", foreground: "2dd4bf" },
      { token: "number.sql", foreground: "60b2f6" },
      { token: "comment", foreground: "5f6875", fontStyle: "italic" },
      { token: "predefined.sql", foreground: "f5be5a" },
      { token: "identifier", foreground: "e6e9ef" },
    ],
    colors: {
      "editor.background": "#0b0d10",
      "editor.foreground": "#e6e9ef",
      "editorLineNumber.foreground": "#39404c",
      "editorLineNumber.activeForeground": "#9aa3b2",
      "editor.lineHighlightBackground": "#12151a",
      "editor.selectionBackground": "#7c89ff33",
      "editorCursor.foreground": "#7c89ff",
      "editorIndentGuide.background1": "#1a1f27",
      "editorGutter.background": "#0b0d10",
      "editorWidget.background": "#171b22",
      "editorSuggestWidget.background": "#171b22",
      "editorSuggestWidget.border": "#303742",
      "scrollbarSlider.background": "#30374266",
    },
  });
};

/** sql-formatter dialect for the connection's engine. */
function formatterLanguage(engine?: string) {
  switch (engine) {
    case "mysql":
      return "mysql" as const;
    case "mariabd":
    case "mariadb":
      return "mariadb" as const;
    case "sqlite":
      return "sqlite" as const;
    case "sqlserver":
      return "transactsql" as const;
    default:
      return "postgresql" as const;
  }
}

export default function SqlEditor({ tab }: { tab: QueryTab }) {
  const {
    updateTabSql,
    runTab,
    sendAi,
    setRightView,
    connections,
    activeConnectionId,
  } = useApp();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [copied, setCopied] = useState(false);

  const engine = connections.find((c) => c.id === activeConnectionId)?.engine;
  const result = tab.results[tab.activeResultIndex];

  /** Highlighted text, or empty when the selection is collapsed. */
  const selection = () => {
    const ed = editorRef.current;
    const range = ed?.getSelection();
    if (!ed || !range || range.isEmpty()) return "";
    return ed.getModel()?.getValueInRange(range) ?? "";
  };

  const runSelection = () => runTab(tab.id, selection() || tab.sql);

  const formatDocument = () => {
    if (!tab.sql.trim()) return;
    try {
      updateTabSql(
        tab.id,
        formatSql(tab.sql, { language: formatterLanguage(engine), keywordCase: "upper" })
      );
    } catch (e) {
      // Formatting half-typed SQL throws; leaving the text untouched is the
      // right outcome, and a thrown error must not blank the editor.
      console.warn("Não foi possível formatar este SQL:", e);
    }
  };

  const copyResultJson = () => {
    if (!result || result.kind !== "rows") return;
    const objs = result.rows.map((row) =>
      Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]]))
    );
    navigator.clipboard?.writeText(JSON.stringify(objs, null, 2)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      (e) => console.warn("Falha ao copiar:", e)
    );
  };

  const explain = () => {
    const sql = selection() || tab.sql;
    if (!sql.trim()) return;
    setRightView("ai");
    sendAi(`Explique esta consulta, passo a passo:\n\n\`\`\`sql\n${sql.trim()}\n\`\`\``);
  };

  const handleMount: OnMount = useCallback(
    (ed, monaco) => {
      editorRef.current = ed;
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        runTab(tab.id);
      });
      // ⌘⇧↵ runs just the selection, matching the toolbar button.
      ed.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => {
          const range = ed.getSelection();
          const picked =
            range && !range.isEmpty() ? ed.getModel()?.getValueInRange(range) : undefined;
          runTab(tab.id, picked);
        }
      );
    },
    [runTab, tab.id]
  );

  return (
    <div className="flex h-full flex-col bg-base">
      {/* Local toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <Button size="sm" variant="primary" onClick={() => runTab(tab.id)} className="gap-1.5">
          {tab.running ? <Spinner size={12} /> : <Play size={12} className="fill-current" />}
          Executar
        </Button>
        <Tooltip label="Executar seleção (⌘⇧↵)">
          <IconButton size="sm" onClick={runSelection} disabled={tab.running}>
            <Wand2 size={14} />
          </IconButton>
        </Tooltip>
        <VDivider className="mx-1 h-4" />
        <Tooltip label="Formatar SQL">
          <IconButton size="sm" onClick={formatDocument} disabled={!tab.sql.trim()}>
            <AlignLeft size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip label={result?.kind === "rows" ? "Copiar resultado como JSON" : "Sem resultado para copiar"}>
          <IconButton size="sm" onClick={copyResultJson} disabled={result?.kind !== "rows"}>
            {copied ? <Check size={14} className="text-teal" /> : <Braces size={14} />}
          </IconButton>
        </Tooltip>

        <div className="flex-1" />

        <span className="mr-1 text-2xs text-content-faint">
          <Kbd>⌘↵</Kbd> executar
        </span>
        <Button
          size="sm"
          variant="subtle"
          onClick={explain}
          disabled={!tab.sql.trim()}
          className="gap-1.5 text-iris"
        >
          <Sparkles size={12} />
          Explicar com IA
        </Button>
      </div>

      {/* Monaco */}
      <div className="relative flex-1">
        <Editor
          language="sql"
          theme={THEME}
          beforeMount={defineTheme}
          onMount={handleMount}
          value={tab.sql}
          onChange={(v) => updateTabSql(tab.id, v ?? "")}
          options={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 13,
            lineHeight: 21,
            minimap: { enabled: false },
            padding: { top: 14, bottom: 14 },
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            roundedSelection: true,
            fontLigatures: true,
            lineNumbersMinChars: 3,
            glyphMargin: false,
            folding: true,
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            overviewRulerLanes: 0,
            guides: { indentation: false },
          }}
        />
      </div>
    </div>
  );
}
