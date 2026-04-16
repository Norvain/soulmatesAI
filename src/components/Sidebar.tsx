import React, { useEffect, useState } from "react";
import { Brain, CheckCircle2, Heart, Lock, Play, RotateCcw, Sparkles, Star, X } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { getRelationshipEvents, RelationshipEventCard } from "../lib/api";

interface SidebarProps {
  profile: any;
  relationState: any;
  memories: any[];
  character?: any;
  chatId?: string;
  relationshipEventsRefreshKey?: number;
  onOpenRelationshipEvent?: (event: RelationshipEventCard) => void;
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({
  profile,
  relationState,
  character,
  chatId,
  relationshipEventsRefreshKey = 0,
  onOpenRelationshipEvent,
  open = false,
  onClose,
}: SidebarProps) {
  const intimacy = relationState?.intimacyScore || relationState?.intimacy_score || 0;
  const trust = relationState?.trustScore || relationState?.trust_score || 0;
  const [events, setEvents] = useState<RelationshipEventCard[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const isCustomCharacter = character?.is_custom === 1 || character?.is_custom === true || character?.is_preset === false;
  const shouldShowRelationshipEvents = !isCustomCharacter && (loadingEvents || events.length > 0);

  const currentStageBase = Math.floor(intimacy / 300) * 300;
  const progressInStage = intimacy - currentStageBase;
  const progressPercent = Math.min(100, Math.max(0, (progressInStage / 300) * 100));

  let displayStage = "陌生";
  if (intimacy >= 900) displayStage = "知己/爱人";
  else if (intimacy >= 600) displayStage = "熟悉";
  else if (intimacy >= 300) displayStage = "了解";

  useEffect(() => {
    if (!chatId) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    setLoadingEvents(true);
    getRelationshipEvents(chatId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch((error) => {
        console.error("Failed to load relationship events:", error);
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId, relationshipEventsRefreshKey]);

  const renderEventState = (event: RelationshipEventCard) => {
    if (event.status === "locked") {
      return (
        <span className="inline-flex items-center space-x-1 rounded-full bg-white/12 px-2 py-1 text-[10px] font-semibold text-white/80">
          <Lock size={11} />
          <span>未解锁</span>
        </span>
      );
    }
    if (event.status === "available") {
      return (
        <span className="inline-flex items-center space-x-1 rounded-full bg-emerald-500/85 px-2 py-1 text-[10px] font-semibold text-white">
          <Play size={11} />
          <span>进入剧情</span>
        </span>
      );
    }
    if (event.status === "in_progress") {
      return (
        <span className="inline-flex items-center space-x-1 rounded-full bg-amber-500/90 px-2 py-1 text-[10px] font-semibold text-white">
          <RotateCcw size={11} />
          <span>继续剧情</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 rounded-full bg-rose-500/90 px-2 py-1 text-[10px] font-semibold text-white">
        <CheckCircle2 size={11} />
        <span>已完成</span>
      </span>
    );
  };

  const getEventFooter = (event: RelationshipEventCard) => {
    if (event.status === "locked") {
      return event.locked_reason || `亲密度达到 ${event.required_intimacy} 解锁`;
    }
    if (event.status === "in_progress") {
      return `已进行 ${event.progress_percent}% · 第 ${Math.max(1, event.current_act)} 幕`;
    }
    if (event.status === "completed") {
      return event.last_summary || "已完成，可重新体验或查看记录";
    }
    return event.description;
  };

  return (
    <>
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "bg-surface border-l border-divider flex flex-col p-6 overflow-y-auto scrollbar-hide",
          "md:static md:w-80 md:h-full md:shrink-0 md:translate-x-0 md:shadow-none",
          "fixed inset-y-0 right-0 w-[88vw] max-w-sm z-40 shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full md:translate-x-0"
        )}
        aria-hidden={!open}
      >
        <button
          type="button"
          onClick={onClose}
          className="md:hidden absolute top-4 right-4 p-2 rounded-full hover:bg-surface-alt text-muted"
          aria-label="关闭"
        >
          <X size={20} />
        </button>
      <div className="flex items-center space-x-4 mb-8 pr-10 md:pr-0">
        {character ? (
          <img src={character.avatarUrl || character.avatar_url} alt={character.name} className="w-12 h-12 rounded-full object-cover" />
        ) : (
          <div className="w-12 h-12 bg-surface-alt rounded-full flex items-center justify-center text-muted">
            <Sparkles size={22} />
          </div>
        )}
        <div>
          <h2 className="font-medium text-body">{character?.name || profile?.preferredName || "用户"}</h2>
          <p className="text-xs text-muted uppercase tracking-wider font-semibold">{displayStage}</p>
        </div>
      </div>

      <div className="space-y-6 mb-10">
        <div>
          <div className="flex justify-between items-end mb-2">
            <span className="text-xs font-semibold text-secondary uppercase tracking-tight flex items-center">
              <Heart size={12} className="mr-1 text-rose-400" /> 亲密度
            </span>
            <span className="text-xs font-mono text-muted">
              {intimacy} <span className="text-[10px] text-subtle">(下一阶段还需 {300 - progressInStage})</span>
            </span>
          </div>
          <div className="h-1.5 w-full bg-page rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${progressPercent}%` }} className="h-full bg-rose-400" />
          </div>
        </div>

        <div>
          <div className="flex justify-between items-end mb-2">
            <span className="text-xs font-semibold text-secondary uppercase tracking-tight flex items-center">
              <Brain size={12} className="mr-1 text-blue-400" /> 信任度
            </span>
            <span className="text-xs font-mono text-muted">{trust}</span>
          </div>
          <div className="h-1.5 w-full bg-page rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (trust / 1200) * 100)}%` }}
              className="h-full bg-blue-400"
            />
          </div>
        </div>
      </div>

      {shouldShowRelationshipEvents && (
        <div className="mb-10">
          <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-4 flex items-center">
            <Star size={14} className="mr-2" /> 关系事件
          </h3>

          {loadingEvents && (
            <div className="rounded-3xl border border-divider bg-page/60 px-4 py-5 text-sm text-secondary">
              正在加载剧情事件…
            </div>
          )}

          {!loadingEvents && events.length > 0 && (
            <div className="space-y-3">
              {events.map((event) => {
                const clickable = event.status !== "locked";
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => clickable && onOpenRelationshipEvent?.(event)}
                    className={cn(
                      "relative w-full rounded-3xl overflow-hidden h-28 text-left group",
                      clickable ? "cursor-pointer" : "cursor-not-allowed"
                    )}
                  >
                    <img
                      src={event.cover_image_url}
                      alt={event.title}
                      className={cn(
                        "w-full h-full object-cover transition-all duration-500",
                        clickable ? "group-hover:scale-105" : "blur-md scale-110 opacity-60"
                      )}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent p-4 flex flex-col justify-end">
                      <div className="flex items-start justify-between space-x-3 mb-2">
                        <div className="min-w-0">
                          <h4 className="text-white font-bold text-sm drop-shadow-md truncate">{event.title}</h4>
                          <p className="text-white/70 text-[10px] mt-1">
                            第 {event.total_acts > 0 ? Math.max(event.current_act || 1, 1) : 1} 幕 / 共 {event.total_acts || 1} 幕
                          </p>
                        </div>
                        {renderEventState(event)}
                      </div>

                      {event.status === "in_progress" && (
                        <div className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden mb-2">
                          <div className="h-full bg-white/90 rounded-full" style={{ width: `${event.progress_percent}%` }} />
                        </div>
                      )}

                      <p className="text-white/85 text-xs line-clamp-2 drop-shadow-md">{getEventFooter(event)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      </aside>
    </>
  );
}
