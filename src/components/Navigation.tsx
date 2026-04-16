import React, { useState, useEffect, useCallback } from "react";
import { MessageCircle, Compass, Plus, Aperture, User, Sun, Moon, Monitor, LogOut } from "lucide-react";
import { cn } from "../lib/utils";
import { logout, getChatsUnreadCount, getMomentsUnreadCount } from "../lib/api";
import { useTheme } from "../lib/theme-context";

export type ViewType = "messages" | "discover" | "explore" | "moments" | "profile" | "chat" | "characterProfile";

interface NavigationProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  hideOnMobile?: boolean;
}

const UNREAD_POLL_INTERVAL = 5_000;

const THEME_CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABELS = { light: "浅色", dark: "深色", system: "跟随系统" };

export default function Navigation({ currentView, onNavigate, hideOnMobile = false }: NavigationProps) {
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

  const isMessagesActive = currentView === "messages" || currentView === "chat";

  return (
    <nav
      className={cn(
        "bg-stone-900 dark:bg-stone-950 shrink-0 z-30",
        "fixed bottom-0 inset-x-0 h-16 flex flex-row items-center justify-around pb-[env(safe-area-inset-bottom)]",
        "md:static md:w-20 md:h-full md:flex-col md:justify-between md:py-8 md:pb-8",
        hideOnMobile && "hidden md:flex"
      )}
    >
      <div className="hidden md:block">
        <div className="w-10 h-10 bg-stone-800 rounded-xl flex items-center justify-center text-white font-bold text-xl mb-4 shadow-lg mx-auto">
          S
        </div>
      </div>

      <div className="flex flex-row md:flex-col items-center justify-around md:justify-start w-full md:space-y-4 px-1">
        <TabButton
          icon={MessageCircle}
          label="消息"
          badge={messagesUnreadCount}
          active={isMessagesActive}
          onClick={() => onNavigate("messages")}
        />
        <TabButton
          icon={Compass}
          label="发现"
          active={currentView === "discover"}
          onClick={() => onNavigate("discover")}
        />

        <button
          onClick={() => onNavigate("explore")}
          className={cn(
            "shrink-0 rounded-full transition-all flex items-center justify-center bg-indigo-500 text-white shadow-lg hover:bg-indigo-400",
            "p-2.5 md:p-3 md:my-2",
            currentView === "explore" ? "ring-4 ring-indigo-500/30" : ""
          )}
          title="探索角色"
          aria-label="探索角色"
        >
          <Plus size={22} className="md:hidden" />
          <Plus size={24} className="hidden md:block" />
        </button>

        <TabButton
          icon={Aperture}
          label="朋友圈"
          badge={momentsUnreadCount}
          active={currentView === "moments"}
          onClick={() => onNavigate("moments")}
        />
        <TabButton
          icon={User}
          label="我的"
          active={currentView === "profile"}
          onClick={() => onNavigate("profile")}
        />
      </div>

      <div className="hidden md:flex md:flex-col md:items-center md:space-y-4">
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
    </nav>
  );
}

interface TabButtonProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}

function TabButton({ icon: Icon, label, active, badge = 0, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center transition-all shrink-0",
        "py-2 px-3 md:p-3 md:w-full md:space-y-1 rounded-xl",
        active ? "text-white" : "text-stone-400 hover:text-stone-200"
      )}
      title={label}
      aria-label={label}
    >
      <div className="relative">
        <Icon size={22} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
            {badge >= 10 ? "…" : badge}
          </span>
        )}
      </div>
      <span className="text-[10px] mt-0.5 md:mt-1">{label}</span>
    </button>
  );
}
