import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CheckCircle2, Loader2, RotateCcw, ScrollText, X } from "lucide-react";
import {
  chooseRelationshipEvent,
  getRelationshipEventHistory,
  getRelationshipEventSession,
  RelationshipEventCard,
  RelationshipEventHistory,
  RelationshipEventSession,
  startRelationshipEvent,
} from "../lib/api";
import { cn } from "../lib/utils";

interface RelationshipEventModalProps {
  open: boolean;
  chatId: string | null;
  character?: any;
  event: RelationshipEventCard | null;
  onClose: () => void;
  onProgressChange?: () => void;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "未保存";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未保存";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isNarrationText(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("（") && trimmed.endsWith("）");
}

type RelationshipTranscriptEntry =
  | RelationshipEventSession["transcript"][number]
  | RelationshipEventHistory["transcript"][number];

interface RenderedTranscriptEntry extends RelationshipTranscriptEntry {
  displayText: string;
  isNarration: boolean;
}

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className="flex justify-start"
    >
      <div className="rounded-3xl rounded-bl-md bg-surface-alt border border-divider px-5 py-3 shadow-sm flex items-center space-x-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-[7px] h-[7px] rounded-full bg-stone-400"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function TranscriptBlock({
  transcript,
  showTyping,
}: {
  transcript: RenderedTranscriptEntry[];
  showTyping?: boolean;
}) {
  return (
    <div className="space-y-4">
      {transcript.map((entry) => (
        <motion.div
          key={entry.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className={cn(
            "flex",
            entry.isNarration ? "justify-center" : entry.speaker === "user" ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              entry.isNarration
                ? "max-w-[92%] rounded-[28px] border border-amber-200/70 bg-amber-50/80 px-5 py-4 text-[15px] leading-8 text-stone-700 shadow-sm"
                : "max-w-[86%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm",
              !entry.isNarration && entry.speaker === "user"
                ? "bg-stone-900 text-white rounded-br-md"
                : !entry.isNarration && entry.kind === "ending"
                  ? "bg-amber-50 text-stone-800 border border-amber-200 rounded-bl-md"
                  : !entry.isNarration
                    ? "bg-surface-alt text-body border border-divider rounded-bl-md"
                    : ""
            )}
          >
            <p>{entry.displayText}</p>
          </div>
        </motion.div>
      ))}
      <AnimatePresence>{showTyping && <TypingIndicator />}</AnimatePresence>
    </div>
  );
}

export default function RelationshipEventModal({
  open,
  chatId,
  character,
  event,
  onClose,
  onProgressChange,
}: RelationshipEventModalProps) {
  const [mode, setMode] = useState<"loading" | "decision" | "session" | "history" | "error">("loading");
  const [session, setSession] = useState<RelationshipEventSession | null>(null);
  const [history, setHistory] = useState<RelationshipEventHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [renderedTranscript, setRenderedTranscript] = useState<RenderedTranscriptEntry[]>([]);
  const [isTranscriptAnimating, setIsTranscriptAnimating] = useState(false);
  const [showTypingDots, setShowTypingDots] = useState(false);
  const transcriptRef = useRef<RenderedTranscriptEntry[]>([]);
  const animationRunRef = useRef(0);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  const activeCard = session?.event || history?.event || event;
  const sourceTranscript = useMemo(
    () =>
      mode === "session"
        ? session?.transcript || []
        : mode === "history"
          ? history?.transcript || []
          : [],
    [history?.transcript, mode, session?.transcript]
  );

  const loadPlayableSession = async (startMode: "start" | "replay" = "start") => {
    if (!chatId || !event) return;
    setMode("loading");
    setError(null);
    try {
      const nextSession = await startRelationshipEvent(chatId, event.id, startMode);
      setSession(nextSession);
      setHistory(null);
      setMode("session");
      onProgressChange?.();
    } catch (err: any) {
      setError(err.message || "进入剧情失败");
      setMode("error");
    }
  };

  const loadHistory = async () => {
    if (!chatId || !event) return;
    setMode("loading");
    setError(null);
    try {
      const nextHistory = await getRelationshipEventHistory(chatId, event.id);
      setHistory(nextHistory);
      setSession(null);
      setMode("history");
    } catch (err: any) {
      setError(err.message || "加载剧情记录失败");
      setMode("error");
    }
  };

  useEffect(() => {
    if (!open || !event || !chatId) return;

    setSession(null);
    setHistory(null);
    setError(null);
    setSubmitting(false);

    if (event.status === "completed") {
      setMode("decision");
      return;
    }

    loadPlayableSession().catch(() => {});
  }, [open, event, chatId]);

  useEffect(() => {
    if (!open) {
      animationRunRef.current += 1;
      transcriptRef.current = [];
      setRenderedTranscript([]);
      setIsTranscriptAnimating(false);
      setShowTypingDots(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const nextEntries = sourceTranscript;
    const runId = animationRunRef.current + 1;
    animationRunRef.current = runId;

    const currentEntries = transcriptRef.current;
    const isPrefix = currentEntries.every((entry, index) => nextEntries[index]?.id === entry.id);
    let baseEntries = currentEntries;

    if (!isPrefix || mode !== "session") {
      baseEntries = [];
      transcriptRef.current = [];
      setRenderedTranscript([]);
    }

    if (mode !== "session") {
      const staticTranscript = nextEntries.map((entry) => ({
        ...entry,
        displayText: entry.text,
        isNarration: isNarrationText(entry.text),
      }));
      transcriptRef.current = staticTranscript;
      setRenderedTranscript(staticTranscript);
      setIsTranscriptAnimating(false);
      return;
    }

    const animate = async () => {
      if (nextEntries.length <= baseEntries.length) {
        setIsTranscriptAnimating(false);
        return;
      }

      setIsTranscriptAnimating(true);
      let workingEntries = [...baseEntries];

      for (let index = baseEntries.length; index < nextEntries.length; index += 1) {
        if (animationRunRef.current !== runId) return;
        const entry = nextEntries[index];
        const narration = isNarrationText(entry.text);

        if (narration) {
          const initialEntry = { ...entry, displayText: "", isNarration: true };
          workingEntries = [...workingEntries, initialEntry];
          transcriptRef.current = workingEntries;
          setRenderedTranscript([...workingEntries]);
          await wait(120);

          for (let cursor = 1; cursor <= entry.text.length; cursor += 1) {
            if (animationRunRef.current !== runId) return;
            const typedEntry = { ...entry, displayText: entry.text.slice(0, cursor), isNarration: true };
            workingEntries = [...workingEntries.slice(0, -1), typedEntry];
            transcriptRef.current = workingEntries;
            setRenderedTranscript([...workingEntries]);
            await wait(18);
          }

          await wait(320);
          continue;
        }

        if (entry.speaker === "user") {
          await wait(80);
        } else {
          setShowTypingDots(true);
          await wait(entry.kind === "ending" ? 1200 : 1000);
          if (animationRunRef.current !== runId) { setShowTypingDots(false); return; }
          setShowTypingDots(false);
          await wait(60);
        }
        if (animationRunRef.current !== runId) return;

        workingEntries = [
          ...workingEntries,
          {
            ...entry,
            displayText: entry.text,
            isNarration: false,
          },
        ];
        transcriptRef.current = workingEntries;
        setRenderedTranscript([...workingEntries]);
      }

      if (animationRunRef.current === runId) {
        setIsTranscriptAnimating(false);
      }
    };

    animate().catch(() => {
      if (animationRunRef.current === runId) {
        setIsTranscriptAnimating(false);
      }
    });
  }, [open, mode, sourceTranscript]);

  useEffect(() => {
    if (!transcriptScrollRef.current) return;
    transcriptScrollRef.current.scrollTo({
      top: transcriptScrollRef.current.scrollHeight,
      behavior: renderedTranscript.length > 1 ? "smooth" : "auto",
    });
  }, [renderedTranscript.length]);

  const emotionTags = useMemo(
    () => session?.emotion_tags || history?.emotion_tags || [],
    [history?.emotion_tags, session?.emotion_tags]
  );

  const hasFullyRenderedTranscript = renderedTranscript.length >= sourceTranscript.length && !isTranscriptAnimating;
  const canShowChoices =
    mode === "session" &&
    !!session &&
    session.current_choices.length > 0 &&
    hasFullyRenderedTranscript &&
    !submitting;
  const shouldShowCompletionPanel =
    mode === "session" &&
    !!session &&
    session.session_status === "completed" &&
    hasFullyRenderedTranscript;

  const handleChoose = async (choiceId: string) => {
    if (!chatId || !event || !session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const nextSession = await chooseRelationshipEvent(chatId, event.id, choiceId);
      setSession(nextSession);
      setHistory(null);
      setMode("session");
      onProgressChange?.();
    } catch (err: any) {
      setError(err.message || "推进剧情失败");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      !open ||
      mode !== "session" ||
      !chatId ||
      !event ||
      !session ||
      session.session_status !== "completed" ||
      session.cg_status !== "generating"
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const nextSession = await getRelationshipEventSession(chatId, event.id);
        if (cancelled) return;
        setSession(nextSession);
        if (nextSession.cg_status === "generating") {
          timer = window.setTimeout(poll, 2200);
        } else {
          onProgressChange?.();
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(poll, 3200);
        }
      }
    };

    timer = window.setTimeout(poll, 1400);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [chatId, event, mode, onProgressChange, open, session]);

  useEffect(() => {
    if (
      !open ||
      mode !== "history" ||
      !chatId ||
      !event ||
      !history ||
      history.status !== "completed" ||
      history.cg_status !== "generating"
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const nextHistory = await getRelationshipEventHistory(chatId, event.id);
        if (cancelled) return;
        setHistory(nextHistory);
        if (nextHistory.cg_status === "generating") {
          timer = window.setTimeout(poll, 2200);
        } else {
          onProgressChange?.();
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(poll, 3200);
        }
      }
    };

    timer = window.setTimeout(poll, 1400);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [chatId, event, history, mode, onProgressChange, open]);

  const closeIfAllowed = (nativeEvent?: React.MouseEvent | React.KeyboardEvent) => {
    nativeEvent?.preventDefault();
    nativeEvent?.stopPropagation();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && event && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm flex items-center justify-center md:p-6"
          onClick={(event) => closeIfAllowed(event)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(currentEvent) => currentEvent.stopPropagation()}
            className="w-full h-[100dvh] md:h-[88vh] md:max-w-5xl md:rounded-[32px] rounded-none overflow-hidden bg-page shadow-2xl border border-white/10 flex flex-col"
          >
            <div className="relative h-36 md:h-44 shrink-0 pt-[env(safe-area-inset-top)]">
              <img
                src={activeCard?.cover_image_url || event.cover_image_url}
                alt={activeCard?.title || event.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/35 to-black/10" />
              <div className="absolute inset-x-0 top-0 mt-[env(safe-area-inset-top)] p-4 md:p-5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={(event) => closeIfAllowed(event)}
                  className="w-11 h-11 rounded-2xl bg-black/30 text-white hover:bg-black/45 transition-colors flex items-center justify-center"
                >
                  <X size={20} />
                </button>

                {mode === "history" && (
                  <button
                    type="button"
                    onClick={() => setMode("decision")}
                    className="inline-flex items-center space-x-2 rounded-2xl bg-black/30 px-4 py-2 text-sm text-white hover:bg-black/45 transition-colors"
                  >
                    <ArrowLeft size={16} />
                    <span>返回</span>
                  </button>
                )}
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 md:p-7 text-white">
                <p className="text-[10px] md:text-[11px] uppercase tracking-[0.28em] text-white/65 mb-1.5 md:mb-2">
                  {character?.name || "关系剧情"}
                </p>
                <div className="flex items-end justify-between gap-3 md:gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl md:text-3xl font-bold truncate">{activeCard?.title || event.title}</h2>
                    <p className="text-xs md:text-sm text-white/78 mt-1.5 md:mt-2 max-w-2xl line-clamp-2">
                      {activeCard?.description || event.description}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] md:text-xs text-white/70">进度</div>
                    <div className="text-xs md:text-sm font-semibold">
                      第 {Math.max(activeCard?.current_act || 1, 1)} 幕 / 共 {activeCard?.total_acts || 1} 幕
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div ref={transcriptScrollRef} className="min-h-0 overflow-y-auto p-4 md:p-7 bg-page pb-[max(env(safe-area-inset-bottom),1rem)]">
                {mode === "loading" && (
                  <div className="h-full flex flex-col items-center justify-center text-secondary">
                    <Loader2 size={28} className="animate-spin mb-3" />
                    <p className="text-sm">{submitting ? "剧情收束中…" : "正在载入剧情…"}</p>
                    {submitting && <p className="text-xs text-muted mt-2">会先完成剧情，再单独生成贺图。</p>}
                  </div>
                )}

                {mode === "decision" && (
                  <div className="max-w-xl mx-auto h-full flex flex-col justify-center">
                    <div className="rounded-[28px] border border-divider bg-surface px-6 py-7 shadow-sm">
                      <div className="inline-flex items-center space-x-2 rounded-full bg-rose-50 text-rose-600 px-3 py-1 text-xs font-semibold mb-4">
                        <CheckCircle2 size={14} />
                        <span>剧情已完成</span>
                      </div>
                      <h3 className="text-2xl font-bold text-heading mb-3">{event.title}</h3>
                      <p className="text-secondary leading-relaxed mb-6">
                        这段剧情已经体验完成。你可以重新体验一次，也可以直接查看上次的完整剧情记录和贺图。
                      </p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          type="button"
                          onClick={() => loadPlayableSession("replay")}
                          className="flex-1 rounded-2xl bg-stone-900 text-white px-5 py-3 text-sm font-semibold hover:bg-stone-800 transition-colors"
                        >
                          重新体验
                        </button>
                        <button
                          type="button"
                          onClick={loadHistory}
                          className="flex-1 rounded-2xl border border-divider bg-surface-alt text-body px-5 py-3 text-sm font-semibold hover:border-divider-strong transition-colors"
                        >
                          查看完整剧情记录
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {mode === "session" && session && (
                  <div>
                    <TranscriptBlock transcript={renderedTranscript} showTyping={showTypingDots} />

                    {shouldShowCompletionPanel && (
                      <div className="mt-8 rounded-[28px] border border-amber-200 bg-amber-50 px-5 py-5 shadow-sm">
                        <div className="inline-flex items-center space-x-2 rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-xs font-semibold mb-4">
                          <CheckCircle2 size={14} />
                          <span>剧情完成</span>
                        </div>
                        {session.cg_image_url && (
                          <img
                            src={session.cg_image_url}
                            alt={`${session.event.title} 剧情贺图`}
                            className="w-full rounded-3xl object-cover mb-4 border border-amber-200"
                          />
                        )}
                        <p className="text-sm text-stone-700 leading-relaxed">{session.summary_text}</p>
                        {session.cg_status === "generating" && (
                          <div className="mt-4 rounded-2xl border border-amber-200 bg-white/70 px-4 py-3 text-sm text-amber-800 flex items-center">
                            <Loader2 size={16} className="animate-spin mr-2" />
                            剧情贺图生成中，完成后会自动出现。
                          </div>
                        )}
                        {session.cg_status === "failed" && (
                          <div className="mt-4 rounded-2xl border border-rose-200 bg-white/70 px-4 py-3 text-sm text-rose-600">
                            剧情贺图生成失败了，稍后可重新体验剧情再次生成。
                          </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-3 mt-5">
                          <button
                            type="button"
                            onClick={loadHistory}
                            className="rounded-2xl bg-stone-900 text-white px-4 py-3 text-sm font-semibold hover:bg-stone-800 transition-colors"
                          >
                            查看完整剧情记录
                          </button>
                          <button
                            type="button"
                            onClick={() => loadPlayableSession("replay")}
                            className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:border-amber-300 transition-colors"
                          >
                            重新体验
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {mode === "history" && history && (
                  <div>
                    <TranscriptBlock transcript={renderedTranscript} />

                    <div className="mt-8 rounded-[28px] border border-divider bg-surface px-5 py-5 shadow-sm">
                      {history.cg_image_url && (
                        <img
                          src={history.cg_image_url}
                          alt={`${history.event.title} 剧情贺图`}
                          className="w-full rounded-3xl object-cover mb-4 border border-divider"
                        />
                      )}
                      <div className="flex items-center justify-between gap-4 mb-3">
                        <div>
                          <h3 className="font-bold text-body">剧情摘要</h3>
                          <p className="text-xs text-muted mt-1">完成于 {formatTime(history.ended_at || history.started_at)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => loadPlayableSession("replay")}
                          className="inline-flex items-center space-x-2 rounded-2xl bg-stone-900 text-white px-4 py-2.5 text-sm font-semibold hover:bg-stone-800 transition-colors"
                        >
                          <RotateCcw size={15} />
                          <span>重新体验</span>
                        </button>
                      </div>
                      <p className="text-sm text-secondary leading-relaxed">{history.summary_text || "暂无摘要"}</p>
                      {history.cg_status === "generating" && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center">
                          <Loader2 size={16} className="animate-spin mr-2" />
                          剧情贺图仍在生成，完成后这里会自动更新。
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {mode === "error" && (
                  <div className="max-w-xl mx-auto h-full flex flex-col justify-center">
                    <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-6 py-7 shadow-sm">
                      <h3 className="text-xl font-bold text-rose-700 mb-3">剧情加载失败</h3>
                      <p className="text-sm text-rose-600 leading-relaxed">{error || "请稍后重试。"}</p>
                      <div className="flex gap-3 mt-6">
                        <button
                          type="button"
                          onClick={() => {
                            if (event.status === "completed") setMode("decision");
                            else loadPlayableSession().catch(() => {});
                          }}
                          className="rounded-2xl bg-rose-600 text-white px-5 py-3 text-sm font-semibold hover:bg-rose-500 transition-colors"
                        >
                          重试
                        </button>
                        <button
                          type="button"
                          onClick={(event) => closeIfAllowed(event)}
                          className="rounded-2xl border border-rose-200 bg-white px-5 py-3 text-sm font-semibold text-rose-600"
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t lg:border-t-0 lg:border-l border-divider bg-surface p-5 md:p-6 overflow-y-auto">
                <div className="rounded-[28px] bg-page px-4 py-4 border border-divider mb-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted mb-3">剧情状态</div>
                  <div className="flex items-center justify-between text-sm text-body mb-2">
                    <span>当前状态</span>
                    <span className="font-semibold">
                      {activeCard?.status === "completed"
                        ? "已完成"
                        : activeCard?.status === "in_progress"
                          ? "进行中"
                          : activeCard?.status === "available"
                            ? "可进入"
                            : "未解锁"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-body">
                    <span>最近保存</span>
                    <span className="text-secondary">{formatTime(session?.last_saved_at || activeCard?.last_saved_at)}</span>
                  </div>
                </div>

                {emotionTags.length > 0 && (
                  <div className="rounded-[28px] bg-page px-4 py-4 border border-divider mb-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted mb-3">情绪标签</div>
                    <div className="flex flex-wrap gap-2">
                      {emotionTags.map((tag) => (
                        <span key={tag} className="px-3 py-1.5 rounded-full bg-surface-alt text-xs font-medium text-body border border-divider">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {canShowChoices && session && (
                  <div className="rounded-[28px] bg-page px-4 py-4 border border-divider">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted mb-3">选择对话</div>
                    <div className="space-y-2.5">
                      {session.current_choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          disabled={submitting}
                          onClick={() => handleChoose(choice.id)}
                          className="w-full text-left rounded-2xl border border-divider bg-surface px-4 py-3 text-sm text-body hover:border-divider-strong hover:bg-surface-alt transition-colors disabled:opacity-60"
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                    {submitting && (
                      <div className="mt-3 flex items-center text-xs text-secondary">
                        <Loader2 size={14} className="animate-spin mr-2" />
                        剧情推进中…
                      </div>
                    )}
                  </div>
                )}

                {mode === "session" && session && session.current_choices.length > 0 && !canShowChoices && (
                  <div className="rounded-[28px] bg-page px-4 py-4 border border-divider text-sm text-secondary">
                    当前演出尚未结束，稍后会出现可选对话。
                  </div>
                )}

                {mode === "history" && history && (
                  <div className="rounded-[28px] bg-page px-4 py-4 border border-divider">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted mb-3">本次记录</div>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-secondary">开始时间</span>
                        <span className="text-body">{formatTime(history.started_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-secondary">结束时间</span>
                        <span className="text-body">{formatTime(history.ended_at)}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-secondary shrink-0">选择次数</span>
                        <span className="text-body">{history.choice_path.length}</span>
                      </div>
                    </div>
                  </div>
                )}

                {(mode === "decision" || mode === "history") && (
                  <div className="mt-4 rounded-[28px] border border-divider bg-page px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted mb-3">后续操作</div>
                    <div className="space-y-2.5">
                      <button
                        type="button"
                        onClick={() => loadPlayableSession("replay")}
                        className="w-full inline-flex items-center justify-center space-x-2 rounded-2xl bg-stone-900 text-white px-4 py-3 text-sm font-semibold hover:bg-stone-800 transition-colors"
                      >
                        <RotateCcw size={15} />
                        <span>重新体验</span>
                      </button>
                      {mode === "decision" && (
                        <button
                          type="button"
                          onClick={loadHistory}
                          className="w-full inline-flex items-center justify-center space-x-2 rounded-2xl border border-divider bg-surface px-4 py-3 text-sm font-semibold text-body hover:border-divider-strong transition-colors"
                        >
                          <ScrollText size={15} />
                          <span>查看完整剧情记录</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
