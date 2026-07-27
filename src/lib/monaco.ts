// Wire @monaco-editor/react to the *bundled* monaco instead of loading it from
// a CDN. This keeps the editor working offline inside the packaged desktop app.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });
