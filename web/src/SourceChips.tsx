import React from 'react';
import { ExternalLink, Globe, Calendar, Link2 } from 'lucide-react';

export interface SourceItem {
  id: string;
  url: string;
  domain: string;
  title: string;
  publishedAt?: string | null;
  snippet?: string;
  score?: number;
}

interface SourceChipsProps {
  sources: SourceItem[];
}

export const SourceChips: React.FC<SourceChipsProps> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 pt-2.5 border-t border-zinc-800/60">
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-zinc-400">
        <Link2 className="w-3 h-3 text-zinc-400" />
        <span>Sources ({sources.length})</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.snippet || source.title}
            className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-white transition shadow-sm max-w-[240px]"
          >
            <span className="font-mono text-[10px] text-zinc-400 font-semibold">
              [{source.id}]
            </span>
            <Globe className="w-3 h-3 text-zinc-500 group-hover:text-zinc-300 shrink-0" />
            <span className="truncate">{source.domain}</span>
            {source.publishedAt && (
              <span className="text-[10px] text-zinc-500 shrink-0">
                • {source.publishedAt.slice(0, 10)}
              </span>
            )}
            <ExternalLink className="w-2.5 h-2.5 text-zinc-600 group-hover:text-zinc-400 shrink-0 ml-auto" />
          </a>
        ))}
      </div>
    </div>
  );
};
