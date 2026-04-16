import React, { useState, useEffect, useCallback } from "react";
import { MessageCircle, Compass, Plus, Aperture, User, Sun, Moon, Monitor, LogOut } from "lucide-react";
import { cn } from "../lib/utils";
import { logout, getChatsUnreadCount, getMomentsUnreadCount } from "../lib/api";
import { useTheme } from "../lib/theme-context";

export type ViewType = "messages" | "discover" | "explore" | "moments" | "profile" | "chat" | "characterProfile";

interface NavigationProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
}

const UNREAD_POLL_INTERVAL = 5_000;

const THEME_CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABELS = { light: "浅色", dark: "深色", system: "跟随系统" };

export default function Navigation({ currentView, onNavigate }: NavigationProps) {
  const { mode, setMode } = useTheme();
  const [momentsUnreadCount, setMomentsUnreadCount] = useState(0);
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const [{ count: messageCount }, { count: momentCount }] = await Promise.all([
        getChatsUnreadCount(),
        getMomentsUnreadCount(),
      ]);
      setMessagesUnreadCount(messageCount);
      setMomentsUnreadCount(momentCount);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();
    const timer = setInterval(fetchUnread, UNREAD_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchUnread]);

  useEffect(() => {
    if (currentView === "moments") setMomentsUnreadCount(0);
  }, [currentView]);

  return (
    <div className="w-20 h-full bg-stone-900 dark:bg-stone-950 flex flex-col items-center py-8 justify-between shrink-0">
      <div className="space-y-6 flex flex-col items-center w-full">
        <div className="w-10 h-10 bg-stone-800 rounded-xl flex items-center justify-center text-white font-bold text-xl mb-4 shadow-lg">
          S
        </div>

        <button
          onClick={() => onNavigate("messages")}
          className={cn("p-3 rounded-xl transition-all flex flex-col items-center space-y-1 w-full relative", (currentView === "messages" || currentView === "chat") ? "text-white" : "text-stone-400 hover:text-stone-200")}
          title="消息"
        >
          <div className="relative">
            <MessageCircle size={24} />
            {messagesUnreadCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                {messagesUnreadCount >= 10 ? "…" : messagesUnreadCount}
              </span>
            )}
          </div>
          <span className="text-[10px]">消息</span>
        </button>

        <button
          onClick={() => onNavigate("discover")}
          className={cn("p-3 rounded-xl transition-all flex flex-col items-center space-y-1 w-full", currentView === "discover" ? "text-white" : "text-stone-400 hover:text-stone-200")}
          title="发现"
        >
          <Compass size={24} />
          <span className="text-[10px]">发现</span>
        </button>

        <button
          onClick={() => onNavigate("explore")}
          className={cn("p-3 rounded-full transition-all flex items-center justify-center bg-indigo-500 text-white shadow-lg hover:bg-indigo-400 my-2", currentView === "explore" ? "ring-4 ring-indigo-500/30" : "")}
          title="探索角色"
        >
          <Plus size={24} />
        </button>

        <button
          onClick={() => onNavigate("moments")}
          className={cn("p-3 rounded-xl transition-all flex flex-col items-center space-y-1 w-full relative", currentView === "moments" ? "text-white" : "text-stone-400 hover:text-stone-200")}
          title="朋友圈"
        >
          <div className="relative">
            <Aperture size={24} />
            {momentsUnreadCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                {momentsUnreadCount >= 10 ? "…" : momentsUnreadCount}
              </span>
            )}
          </div>
          <span className="text-[10px]">朋友圈</span>
        </button>

        <button
          onClick={() => onNavigate("profile")}
          className={cn("p-3 rounded-xl transition-all flex flex-col items-center space-y-1 w-full", currentView === "profile" ? "text-white" : "text-stone-400 hover:text-stone-200")}
          title="我的"
        >
          <User size={24} />
          <span className="text-[10px]">我的</span>
        </button>
      </div>

      <div className="space-y-4 flex flex-col items-center">
        <button
          onClick={() => {
            const idx = THEME_CYCLE.indexOf(mode);
            setMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
          }}
          className="p-3 text-stone-400 hover:text-stone-200 transition-colors rounded-xl hover:bg-stone-800/50"
          title={THEME_LABELS[mode]}
        >
          {React.createElement(THEME_ICONS[mode], { size: 20 })}
        </button>
        <button
          onClick={logout}
          className="p-3 text-stone-400 hover:text-rose-400 transition-colors rounded-xl hover:bg-stone-800/50"
          title="退出登录"
        >
          <LogOut size={20} />
        </button>
      </div>
    </div>
  );
}
