import React from 'react';
import { Loader2, Search, Brain, Clock, ShieldCheck } from 'lucide-react';

interface StatusLineProps {
  stage: string | null;
  label: string | null;
}

export const StatusLine: React.FC<StatusLineProps> = ({ stage, label }) => {
  if (!label) return null;

  const renderIcon = () => {
    switch (stage) {
      case 'searching':
        return <Search className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />;
      case 'recalling':
        return <Clock className="w-3.5 h-3.5 text-amber-400" />;
      case 'verifying':
        return <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />;
      case 'synthesizing':
      case 'routing':
      default:
        return <Brain className="w-3.5 h-3.5 text-zinc-400 animate-pulse" />;
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 bg-zinc-900/90 backdrop-blur rounded-full border border-zinc-800 shadow-sm w-fit transition-all">
      {renderIcon()}
      <span className="font-medium text-zinc-300 text-[11px]">{label}</span>
      <Loader2 className="w-3 h-3 text-zinc-500 animate-spin ml-0.5" />
    </div>
  );
};
