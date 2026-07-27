import { useApp } from "@/store/app";
import { EditorTabs } from "./EditorTabs";
import { EditorPane } from "./EditorPane";
import { TableExplorer } from "@/components/screens/TableExplorer";
import { RelationshipsDiagram } from "@/components/screens/RelationshipsDiagram";

export function CenterPane() {
  const { centerView } = useApp();

  return (
    <div className="flex h-full flex-col bg-base">
      <EditorTabs />
      <div
        key={centerView.kind === "table" ? `table-${centerView.table}` : centerView.kind}
        className="min-h-0 flex-1 animate-view-in"
      >
        {centerView.kind === "editor" && <EditorPane />}
        {centerView.kind === "table" && <TableExplorer tableName={centerView.table} />}
        {centerView.kind === "relationships" && <RelationshipsDiagram />}
      </div>
    </div>
  );
}
