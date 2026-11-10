import React, { useEffect, useState } from 'react';
import { Settings, PanelLeft, PanelLeftClose } from 'lucide-react';
import { Chat } from './Chat.js';
import { SettingsModal } from './SettingsModal.js';

export const App: React.FC = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providerStatus, setProviderStatus] = useState<{
    hasGoogle: boolean;
    hasOpenAI: boolean;
    hasTavily: boolean;
    activeProvider: string;
  } | null>(null);

  const fetchStatus = () => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => setProviderStatus(data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-white">
      {/* Sleek Minimal Header */}
      <header className="h-14 border-b border-zinc-800/60 px-4 sm:px-5 flex items-center justify-between backdrop-blur-md bg-zinc-950/70 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          {/* Toggle Sidebar Button */}
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition"
            title={sidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeft className="w-4 h-4" />
            )}
          </button>

          <div className="flex items-center gap-2.5">
            <img
              src="/minimi-logo.png"
              alt="Minimi"
              className="h-5 w-auto brightness-0 invert opacity-95 select-none"
            />
            <span className="text-zinc-500 font-light text-xs">/</span>
            <span className="font-medium text-xs text-zinc-300 tracking-tight">Search</span>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 text-xs">
          {/* Settings Icon Button */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition shadow-sm"
            title="Configure API Keys & Models"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Chat Interface */}
      <main className="flex-1 overflow-hidden">
        <Chat
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={fetchStatus}
      />
    </div>
  );
};
