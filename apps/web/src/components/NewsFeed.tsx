import { Newspaper } from 'lucide-react';
import { motion } from 'motion/react';

export default function NewsFeed({ headlines, sentiment }: { headlines: string[], sentiment: number }) {
  if (!headlines || headlines.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all h-full"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-pink-400" /> Market Context
        </h3>
        {typeof sentiment === 'number' && (
          <span className={`text-xs font-medium px-2 py-1 rounded border ${sentiment >= 60 ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-pink-500/10 text-pink-400 border-pink-500/20'}`}>
            Confidence: {sentiment}%
          </span>
        )}
      </div>

      <div className="space-y-3">
        {headlines.map((title, i) => (
          <div key={i} className="text-sm text-slate-300 border-b border-white/5 pb-2 last:border-0 hover:text-white transition-colors">
            {title}
          </div>
        ))}
      </div>

      {sentiment > 0 && (
        <div className="mt-4 p-3 bg-purple-500/5 text-purple-300 text-xs rounded-lg border border-purple-500/20">
          <strong className="text-purple-400">Bot Analysis:</strong> These are the latest reasons from the fee-adjusted BTC 5m decision engine.
        </div>
      )}
    </motion.div>
  );
}
