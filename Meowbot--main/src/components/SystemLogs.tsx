import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Log {
  id: number;
  timestamp: number;
  level: string;
  message: string;
}

export default function SystemLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get('/api/logs');
        if (Array.isArray(res.data)) {
          setLogs(res.data.reverse()); // Reverse to show oldest to newest if API returns newest first
        } else {
          setLogs([]);
        }
      } catch (error) {
        console.error('Error fetching logs:', error);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logsContainerRef.current) {
      const container = logsContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'INFO': return 'text-blue-400';
      case 'WARN': return 'text-yellow-400';
      case 'ERROR': return 'text-red-400';
      case 'TRADE': return 'text-pink-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all flex flex-col h-full"
    >
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Terminal className="w-5 h-5 text-purple-500" />
        System Logs
      </h3>

      <div
        ref={logsContainerRef}
        className="flex-1 bg-[#0B0E14] rounded-lg border border-white/5 p-4 overflow-y-auto max-h-[500px] font-mono text-xs space-y-2 min-h-0 custom-scrollbar"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-8">No logs available</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-3">
              <span className="text-slate-500 shrink-0">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`shrink-0 font-bold ${getLevelColor(log.level)}`}>
                [{log.level}]
              </span>
              <span className="text-slate-300 break-words">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
