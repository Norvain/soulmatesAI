import React, { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { MessageCircle } from "lucide-react";
import { getChats } from "../lib/api";

const PRESET_CHARACTERS: Record<string, { name: string; avatarUrl: string }> = {
  preset_lintang: { name: "林棠", avatarUrl: "/avatars/lintang-avatar.png" },
  preset_guchengze: { name: "顾承泽", avatarUrl: "/avatars/guchengze-avatar.png" },
  preset_shenzhiyi: { name: "沈知意", avatarUrl: "/avatars/shenzhiyi-avatar.png" },
};

const POLL_INTERVAL = 5_000;

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return date.toLocaleDateString();
}

interface MessagesProps {
  onSelectChat: (character: any) => void;
  onViewProfile?: (character: any) => void;
}

function getPreviewText(chat: any) {
  if (chat.replyState === "processing" || chat.pendingTurnsCount > 0) {
    return "对方正在回复...";
  }

  if (chat.lastMessage) {
    return `${chat.lastMessageRole === "model" ? `${chat.character.name}: ` : "我: "}${chat.lastMessage}`;
  }

  if (chat.lastMessageImageUrl) {
    return `${chat.lastMessageRole === "model" ? `${chat.character.name}: ` : "我: "}[图片]`;
  }

  return chat.character.greeting || "开始聊天吧";
}

export default function Messages({ onSelectChat, onViewProfile }: MessagesProps) {
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChats = useCallback(async () => {
    const rows = await getChats();
    const mapped = rows
      .map((chat: any) => {
        const preset = PRESET_CHARACTERS[chat.character_id];
        return {
          id: chat.id,
          character: {
            id: chat.id,
            characterId: chat.character_id,
            name: chat.character_name || preset?.name || "AI",
            avatarUrl: chat.character_avatar_url || preset?.avatarUrl || `/avatars/${chat.character_id}.png`,
            persona: chat.persona,
            overview: chat.overview,
            greeting: chat.greeting,
          },
          updatedAt: chat.updated_at,
          lastMessage: chat.last_message || null,
          lastMessageImageUrl: chat.last_message_image_url || null,
          lastMessageRole: chat.last_message_role || null,
          unreadCount: chat.unread_ai_count || 0,
          replyState: chat.reply_state || "idle",
          pendingTurnsCount: chat.pending_turns_count || 0,
        };
      })
      .filter((chat: any) => chat.character.name);

    setChats(mapped);
  }, []);

  useEffect(() => {
    fetchChats()
      .catch(console.error)
      .finally(() => setLoading(false));

    const timer = setInterval(() => {
      fetchChats().catch(console.error);
    }, POLL_INTERVAL);

    return () => clearInterval(timer);
  }, [fetchChats]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted">加载中...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-page p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-heading mb-6">消息</h1>

        {chats.length === 0 ? (
          <div className="text-center py-20 text-muted">
            <MessageCircle size={48} className="mx-auto mb-4 opacity-50" />
            <p>还没有聊天记录，去探索角色吧。</p>
          </div>
        ) : (
          <div className="space-y-1">
            {chats.map((chat) => {
              const preview = getPreviewText(chat);
              return (
                <motion.div
                  key={chat.id}
                  onClick={() => onSelectChat(chat.character)}
                  className="bg-surface px-4 py-3 rounded-xl cursor-pointer flex items-center space-x-3 border border-transparent hover:border-divider hover:bg-surface-alt transition-all"
                >
                  <div className="relative shrink-0">
                    <img
                      src={chat.character.avatarUrl}
                      alt={chat.character.name}
                      className="w-12 h-12 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewProfile?.(chat.character);
                      }}
                    />
                    {chat.unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
                        {chat.unreadCount >= 10 ? "…" : chat.unreadCount}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="font-semibold text-body text-[15px] truncate">{chat.character.name}</h3>
                      <span className="text-muted text-xs shrink-0 ml-2">
                        {chat.updatedAt ? formatTime(chat.updatedAt) : ""}
                      </span>
                    </div>
                    <p className="text-muted text-sm truncate">
                      {preview.length > 34 ? `${preview.slice(0, 34)}…` : preview}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
