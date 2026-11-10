import React, { useState, useEffect } from 'react';
import { X, Key, Shield, Sparkles, CheckCircle2, Globe, Cpu } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [geminiKey, setGeminiKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [openaiKey, setOpenAIKey] = useState('');
  const [status, setStatus] = useState<{
    hasGoogle: boolean;
    hasOpenAI: boolean;
    hasTavily: boolean;
    activeProvider: string;
    mainModel: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => setStatus(data))
      .catch((err) => console.error('Failed to load settings:', err));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedSuccess(false);

    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiKey: geminiKey || undefined,
          tavilyKey: tavilyKey || undefined,
          openaiKey: openaiKey || undefined,
        }),
      });

      setSavedSuccess(true);
      const updated = await fetch('/api/settings').then((res) => res.json());
      setStatus(updated);
      setGeminiKey('');
      setTavilyKey('');
      setOpenAIKey('');
      if (onSaved) onSaved();
      setTimeout(() => {
        setSavedSuccess(false);
      }, 2500);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Model & Search Settings</h3>
              <p className="text-xs text-zinc-400">Configure your API keys for live synthesis</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Pill */}
        <div className="px-6 py-3 bg-zinc-950/60 border-b border-zinc-800/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Status:</span>
            {status?.hasGoogle || status?.hasOpenAI ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" /> Live LLM Active ({status.activeProvider})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                <Cpu className="w-3 h-3" /> Local Offline Mode
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-zinc-400">
            <Globe className="w-3 h-3" />
            <span>Search: {status?.hasTavily ? 'Tavily Live' : 'Mock Replay'}</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
              <span>Google Gemini API Key</span>
              {status?.hasGoogle && (
                <span className="text-[10px] text-emerald-400">● Configured</span>
              )}
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={status?.hasGoogle ? '••••••••••••••••' : 'AIzaSy...'}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition"
            />
            <p className="text-[11px] text-zinc-500">
              Powers Gemini 3.5 Flash Lite and 3.1 Flash Lite (500 free requests/day).
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
              <span>Tavily Search API Key</span>
              {status?.hasTavily && (
                <span className="text-[10px] text-emerald-400">● Configured</span>
              )}
            </label>
            <input
              type="password"
              value={tavilyKey}
              onChange={(e) => setTavilyKey(e.target.value)}
              placeholder={status?.hasTavily ? '••••••••••••••••' : 'tvly-...'}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition"
            />
            <p className="text-[11px] text-zinc-500">
              Powers live date-filtered web search and pricing verification.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
              <span>OpenAI API Key (Optional)</span>
              {status?.hasOpenAI && (
                <span className="text-[10px] text-emerald-400">● Configured</span>
              )}
            </label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenAIKey(e.target.value)}
              placeholder={status?.hasOpenAI ? '••••••••••••••••' : 'sk-...'}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition"
            />
          </div>

          {savedSuccess && (
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Settings saved! Your next request will use the updated keys.</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-white transition rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || (!geminiKey && !tavilyKey && !openaiKey)}
              className="px-4 py-2 text-xs font-medium bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white rounded-xl transition shadow-sm font-semibold"
            >
              {isSaving ? 'Saving...' : 'Save Keys'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

