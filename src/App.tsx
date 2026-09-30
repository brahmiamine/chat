import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsTab } from './types';
import { useSettings } from './hooks/useSettings';
import { useTheme } from './hooks/useTheme';
import { useViewport } from './hooks/useViewport';
import { useServerHealth } from './hooks/useServerHealth';
import { useChat } from './hooks/useChat';
import { currentModel } from './lib/settings';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatHeader } from './components/chat/ChatHeader';
import { ChatView, type ChatViewHandle } from './components/chat/ChatView';
import { SearchDialog } from './components/search/SearchDialog';
import { SettingsModal } from './components/settings/SettingsModal';
import { StatisticsModal } from './components/statistics/StatisticsModal';
import { PreviewProvider } from './components/ui/Lightbox';
import { ArtifactPanel } from './components/artifact/ArtifactPanel';

const COLLAPSED_KEY = 'lueur.collapsed';

export default function App() {
  const { settings, update } = useSettings();
  useTheme(settings.theme, settings.fontSize);
  const { isMobile, vh } = useViewport();
  const server = useServerHealth(settings);
  const chat = useChat(settings, { onConnectionError: server.check });
  const model = currentModel(settings);

  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const view = useRef<ChatViewHandle>(null);
  // Artifact shown in the side panel (desktop) / full screen (mobile).
  const [artifact, setArtifact] = useState<{ cid: string; id: string } | null>(null);

  const collapse = useCallback((v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const focusComposer = useCallback(() => {
    if (window.innerWidth >= 768) requestAnimationFrame(() => view.current?.focus());
  }, []);

  const { setActiveId } = chat;
  const newChat = useCallback(() => {
    setActiveId(null);
    view.current?.clear();
    setDrawer(false);
    setSearchOpen(false);
    focusComposer();
  }, [setActiveId, focusComposer]);

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    setDrawer(false);
    setSearchOpen(false);
  }, [setActiveId]);

  const openSearch = useCallback(() => {
    setDrawer(false);
    setStatsOpen(false);
    setSearchOpen(true);
  }, []);
  const openStatistics = useCallback(() => {
    setDrawer(false);
    setSearchOpen(false);
    setSettingsTab(null);
    setStatsOpen(true);
  }, []);
  const lastTab = useRef<SettingsTab>('connection');
  if (settingsTab) lastTab.current = settingsTab;
  const openSettings = useCallback((tab?: SettingsTab) => {
    setDrawer(false);
    setSearchOpen(false);
    setStatsOpen(false);
    setSettingsTab(tab || lastTab.current);
  }, []);
  const openSettingsDefault = useCallback(() => openSettings(), [openSettings]);

  const { regenerate } = chat;
  const retryWithDemo = useCallback((cid: string, mid: string) => {
    update({ provider: 'demo' });
    regenerate(cid, mid, { provider: 'demo' });
  }, [update, regenerate]);

  // A new artifact (or version) was just built in the open conversation:
  // show it right away on wide screens; on mobile the chip in the answer opens it.
  const { artifactOpen } = chat;
  useEffect(() => {
    if (artifactOpen && artifactOpen.cid === chat.activeId && !isMobile) setArtifact({ cid: artifactOpen.cid, id: artifactOpen.id });
  }, [artifactOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const openArtifact = useCallback((cid: string, id: string) => setArtifact({ cid, id }), []);
  const panelConv = artifact && artifact.cid === chat.activeId ? chat.active : null;
  const { send } = chat;
  const fixFromPanel = useCallback((prompt: string) => {
    if (chat.generating) return;
    send(prompt, []);
    if (isMobile) setArtifact(null);
  }, [send, chat.generating, isMobile]);

  // Focus the composer on first load (desktop).
  useEffect(() => { focusComposer(); }, [focusComposer]);

  // Global shortcuts.
  const state = useRef({ searchOpen, statsOpen, settingsTab, drawer, artifact: !!artifact, generating: chat.generating });
  state.current = { searchOpen, statsOpen, settingsTab, drawer, artifact: !!artifact, generating: chat.generating };
  const { stop } = chat;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = (e.key || '').toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); setDrawer(false); setSearchOpen(o => !o); return; }
      if (mod && (k === 'n' || (e.shiftKey && k === 'o'))) { e.preventDefault(); newChat(); return; }
      if (k === 'escape') {
        const s = state.current;
        if (s.searchOpen) setSearchOpen(false);
        else if (s.statsOpen) setStatsOpen(false);
        else if (s.settingsTab) setSettingsTab(null);
        else if (s.drawer) setDrawer(false);
        else if (s.artifact) setArtifact(null);
        else if (s.generating) stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, stop]);

  const generatingHere = chat.generating && chat.generatingCid === chat.activeId;

  return (
    <PreviewProvider>
      <div className="app" style={isMobile ? { height: vh } : undefined}>
        <Sidebar
          conversations={chat.conversations}
          activeId={chat.activeId}
          generatingId={chat.generatingCid}
          isMobile={isMobile}
          collapsed={collapsed}
          drawerOpen={drawer}
          onCollapse={collapse}
          onCloseDrawer={() => setDrawer(false)}
          onNewChat={newChat}
          onOpenSearch={openSearch}
          onOpenStatistics={openStatistics}
          onOpenSettings={openSettingsDefault}
          onSelect={openConversation}
          onRename={chat.rename}
          onDelete={chat.remove}
        />

        <main className="main">
          <ChatHeader
            isMobile={isMobile}
            models={settings.models}
            modelId={settings.modelId}
            currentLabel={model.label}
            health={server.health}
            onSelectModel={id => update({ modelId: id })}
            onManageModels={() => openSettings('model')}
            onOpenConnection={() => openSettings('connection')}
            onOpenDrawer={() => setDrawer(true)}
            onNewChat={newChat}
          />
          <ChatView
            ref={view}
            conversation={chat.active}
            live={chat.live}
            generatingHere={generatingHere}
            busy={chat.generating}
            isMobile={isMobile}
            onSend={chat.send}
            onStop={chat.stop}
            onRegenerate={chat.regenerate}
            onUseDemo={retryWithDemo}
            onOpenConnection={() => openSettings('connection')}
            onContinue={chat.continueAnswer}
            onOpenArtifact={openArtifact}
          />
        </main>

        {panelConv && artifact && (
          <ArtifactPanel
            conversation={panelConv}
            artifactId={artifact.id}
            isMobile={isMobile}
            onClose={() => setArtifact(null)}
            onSelect={id => setArtifact({ cid: artifact.cid, id })}
            onSaveEdit={(id, files) => chat.saveArtifactEdit(artifact.cid, id, files)}
            onRestore={(id, index) => chat.restoreArtifactVersion(artifact.cid, id, index)}
            onFix={fixFromPanel}
          />
        )}

        {searchOpen && <SearchDialog conversations={chat.conversations} onOpen={openConversation} onClose={() => setSearchOpen(false)} />}
        {statsOpen && <StatisticsModal conversations={chat.conversations} onClose={() => setStatsOpen(false)} />}

        {settingsTab && (
          <SettingsModal
            tab={settingsTab}
            onTab={setSettingsTab}
            onClose={() => setSettingsTab(null)}
            settings={settings}
            update={update}
            health={server.health}
            server={server.server}
            test={server.test}
            onTest={server.testConnection}
            loadServerInfo={server.loadServerInfo}
            conversationCount={chat.conversations.length}
            onClearAll={chat.clearAll}
          />
        )}
      </div>
    </PreviewProvider>
  );
}
