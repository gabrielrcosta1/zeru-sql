import { useEffect } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { useApp } from "@/store/app";
import { TitleBar } from "@/components/shell/TitleBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { CenterPane } from "@/components/editor/CenterPane";
import { RightPanel } from "@/components/ai/RightPanel";
import { ConnectionModal } from "@/components/screens/ConnectionModal";
import { CommandPalette } from "@/components/screens/CommandPalette";
import { AiSettingsModal } from "@/components/screens/AiSettingsModal";

export default function App() {
  const { sidebarOpen, rightOpen, hydrateConnections, hydrateHistory } = useApp();

  // Load persisted connections and query history once on startup.
  useEffect(() => {
    hydrateConnections();
    hydrateHistory();
  }, [hydrateConnections, hydrateHistory]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base text-content">
      <TitleBar />

      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="zeru-main">
          {sidebarOpen && (
            <>
              <Panel id="sidebar" defaultSize={19} minSize={14} maxSize={32} order={1}>
                <Sidebar />
              </Panel>
              <ResizeHandle />
            </>
          )}

          <Panel id="center" minSize={30} order={2}>
            <CenterPane />
          </Panel>

          {rightOpen && (
            <>
              <ResizeHandle />
              <Panel id="right" defaultSize={26} minSize={18} maxSize={42} order={3}>
                <RightPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <StatusBar />

      <ConnectionModal />
      <CommandPalette />
      <AiSettingsModal />
    </div>
  );
}
