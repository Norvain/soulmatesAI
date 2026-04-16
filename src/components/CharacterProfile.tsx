import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ArrowLeft, MessageCircle, Heart } from "lucide-react";
import { getCharacterMoments } from "../lib/api";

interface CharacterProfileProps {
  character: any;
  onBack: () => void;
  onChat: () => void;
}

export default function CharacterProfile({ character, onBack, onChat }: CharacterProfileProps) {
  const [moments, setMoments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const characterId = character?.characterId || character?.character_id || character?.id || "";

  useEffect(() => {
    if (!characterId) return;
    const presetId = characterId.includes("_preset_")
      ? characterId.slice(characterId.indexOf("_preset_") + 1)
      : characterId;
    getCharacterMoments(presetId)
      .then(setMoments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [characterId]);

  const avatarUrl = character?.avatarUrl || character?.avatar_url || "";
  const name = character?.name || "AI";
  const overview = character?.overview || "";
  const persona = character?.persona || "";

  return (
    <div className="flex-1 overflow-y-auto bg-surface-alt">
      {/* Background + Avatar Header */}
      <div className="relative">
        <div className="h-56 bg-gradient-to-br from-stone-700 to-stone-900 relative">
          <img
            src={avatarUrl}
            alt=""
            className="w-full h-full object-cover opacity-30 blur-sm"
          />
          <button
            onClick={onBack}
            className="absolute top-4 left-4 p-2 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors z-10"
          >
            <ArrowLeft size={20} />
          </button>
        </div>

        <div className="relative -mt-16 px-6 flex items-end space-x-4">
          <img
            src={avatarUrl}
            alt={name}
            className="w-24 h-24 rounded-2xl object-cover border-4 border-surface shadow-lg shrink-0"
          />
          <div className="pb-2 flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-heading">{name}</h1>
            <p className="text-secondary text-sm mt-1 line-clamp-2">{overview}</p>
          </div>
        </div>
      </div>

      {/* Info + Actions */}
      <div className="px-6 pt-4 pb-2">
        {persona && (
          <div className="bg-surface rounded-xl p-4 mb-4">
            <p className="text-secondary text-xs font-medium uppercase tracking-wider mb-2">性格特点</p>
            <p className="text-body text-sm">{persona}</p>
          </div>
        )}

        <button
          onClick={onChat}
          className="w-full bg-btn text-btn-text rounded-xl py-3 font-semibold flex items-center justify-center space-x-2 hover:bg-btn-hover transition-colors mb-6"
        >
          <MessageCircle size={18} />
          <span>发消息</span>
        </button>
      </div>

      {/* Moments section */}
      <div className="px-6 pb-20">
        <h2 className="text-lg font-bold text-body mb-4">朋友圈</h2>

        {loading ? (
          <div className="text-center py-10 text-muted text-sm">加载中...</div>
        ) : moments.length === 0 ? (
          <div className="text-center py-10 text-muted text-sm">
            <p>暂无动态</p>
          </div>
        ) : (
          <div className="space-y-4">
            {moments.map(moment => (
              <motion.div
                key={moment.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface rounded-xl p-4"
              >
                <div className="flex items-center space-x-3 mb-3">
                  <img src={avatarUrl} alt={name} className="w-8 h-8 rounded-full object-cover" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-body text-sm">{name}</span>
                    <span className="text-muted text-xs ml-2">
                      {moment.created_at ? new Date(moment.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                </div>

                <p className="text-body text-sm leading-relaxed whitespace-pre-wrap mb-2">
                  {moment.content}
                </p>

                {moment.image_url && (
                  <img
                    src={moment.image_url}
                    alt=""
                    className="max-w-[200px] max-h-[200px] rounded-lg object-cover mb-2"
                  />
                )}

                <div className="flex items-center space-x-4 text-muted text-xs mt-2">
                  {moment.likes > 0 && (
                    <div className="flex items-center space-x-1">
                      <Heart size={12} className="text-rose-400 fill-rose-400" />
                      <span>{moment.likes}</span>
                    </div>
                  )}
                  {moment.comments?.length > 0 && (
                    <div className="flex items-center space-x-1">
                      <MessageCircle size={12} />
                      <span>{moment.comments.length}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
