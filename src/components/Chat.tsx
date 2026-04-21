import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, Camera, Mic, Volume2, Square, Bookmark, Loader2, X, ArrowLeft, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, compressImage } from "../lib/utils";
import {
  getChatInteractionMoments,
  getChatRuntime,
  getMessages,
  getSuggestions,
  markChatRead,
  saveInteractionMoment,
  sendMessage,
  transcribeAudio,
} from "../lib/api";
import { useSwipeBack } from "../lib/use-swipe-back";
import { useToast } from "../lib/toast-context";

interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

const SpeechRecognitionAPI: ISpeechRecognitionConstructor | null =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel with touch support
  return (
    navigator.platform === "MacIntel" &&
    typeof (navigator as any).maxTouchPoints === "number" &&
    (navigator as any).maxTouchPoints > 1
  );
}

function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

// Web Speech API in mainland-China mobile browsers (WeChat, UC, in-app webviews,
// Android Chrome without Google services) routinely fails — `onresult` never
// fires. We route those clients to the server-side FunASR endpoint instead.
function shouldUseServerAsr(): boolean {
  if (!SpeechRecognitionAPI) return true;
  return isMobileUA();
}

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* ignore */ }
  }
  return "";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

interface Message {
  id: string;
  text: string;
  role: "user" | "model";
  created_at: string;
  image_url?: string;
  audio_url?: string;
}

interface ChatRuntimeState {
  reply_state: "idle" | "processing";
  pending_turns_count: number;
  unread_ai_count: number;
  proactive_silenced: number;
}

interface InteractionMoment {
  id: string;
  title: string;
  summary: string;
  messages_json: string;
  message_count: number;
  created_at: string;
}

interface ChatProps {
  chatId: string;
  character: any;
  profile: any;
  relationState: any;
  recentMemories: any[];
  lastSnapshot: any;
  onStateChange?: () => void;
  onViewProfile?: () => void;
  onOpenSidebar?: () => void;
  onBack?: () => void;
}

const EMPTY_RUNTIME: ChatRuntimeState = {
  reply_state: "idle",
  pending_turns_count: 0,
  unread_ai_count: 0,
  proactive_silenced: 0,
};

const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;

function isNearBottom(element: HTMLDivElement, threshold = 96) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMessageGroupTimestamp(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const timeLabel = `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  if (isSameLocalDay(date, now)) {
    return timeLabel;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) {
    return `昨天 ${timeLabel}`;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${timeLabel}`;
}

function shouldShowMessageGroupTimestamp(previousMessage: Message | undefined, currentMessage: Message) {
  if (!previousMessage) return false;

  const previousDate = new Date(previousMessage.created_at);
  const currentDate = new Date(currentMessage.created_at);
  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(currentDate.getTime())) {
    return false;
  }

  return currentDate.getTime() - previousDate.getTime() > MESSAGE_GROUP_GAP_MS;
}

function getCharacterOpeningStory(character: any) {
  const story = character?.openingStory || character?.opening_story;
  return typeof story === "string" ? story.trim() : "";
}

export default function Chat({
  chatId,
  character,
  onStateChange,
  onViewProfile,
  onOpenSidebar,
  onBack,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [runtime, setRuntime] = useState<ChatRuntimeState>(EMPTY_RUNTIME);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [savingMoment, setSavingMoment] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useSwipeBack({
    enabled: Boolean(onBack),
    onBack: () => onBack?.(),
  });
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [chatMoments, setChatMoments] = useState<InteractionMoment[]>([]);
  const [selectedMomentContext, setSelectedMomentContext] = useState<string | null>(null);
  const [selectedMomentTitle, setSelectedMomentTitle] = useState<string | null>(null);
  const [ghostHovered, setGhostHovered] = useState(false);
  const [ghostDismissed, setGhostDismissed] = useState(false);

  const { showToast } = useToast();

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  const recognitionStartingRef = useRef(false);
  const recognitionGotResultRef = useRef(false);
  const recognitionSilenceTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaAutoStopTimerRef = useRef<number | null>(null);
  const mediaCancelledRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastModelMessageIdRef = useRef<string | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const shouldStickToBottomRef = useRef(true);

  const isTyping = runtime.reply_state === "processing" || runtime.pending_turns_count > 0;

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const syncChatState = useCallback(
    async (shouldMarkRead = true) => {
      if (!chatId) return;

      const [messagesResult, runtimeResult] = await Promise.allSettled([
        getMessages(chatId),
        getChatRuntime(chatId),
      ]);

      if (messagesResult.status === "fulfilled") {
        const nextMessages = messagesResult.value;
        setMessages(nextMessages);

        const latestModelMessage = [...nextMessages].reverse().find((message) => message.role === "model");
        if (latestModelMessage?.id && latestModelMessage.id !== lastModelMessageIdRef.current) {
          lastModelMessageIdRef.current = latestModelMessage.id;
          onStateChangeRef.current?.();
        }
      } else {
        console.error("Failed to load messages:", messagesResult.reason);
      }

      if (runtimeResult.status === "fulfilled") {
        const nextRuntime = runtimeResult.value || EMPTY_RUNTIME;
        setRuntime(nextRuntime);

        if (shouldMarkRead) {
          markChatRead(chatId).catch(() => {});
          if ((nextRuntime?.unread_ai_count || 0) > 0) {
            setRuntime((prev) => ({ ...prev, unread_ai_count: 0 }));
          }
        }
      } else {
        console.error("Failed to load chat runtime:", runtimeResult.reason);
      }
    },
    [chatId]
  );

  useEffect(() => {
    if (!chatId) return;

    lastModelMessageIdRef.current = null;
    shouldStickToBottomRef.current = true;
    setMessages([]);
    setRuntime(EMPTY_RUNTIME);
    setSuggestions([]);
    setShowSuggestions(false);
    setShowAtMenu(false);
    setSelectedMsgId(null);
    setGhostDismissed(false);
    setGhostHovered(false);

    syncChatState().catch(console.error);
    getChatInteractionMoments(chatId).then(setChatMoments).catch(console.error);

    const timer = setInterval(() => {
      syncChatState().catch(console.error);
    }, 1000);

    return () => clearInterval(timer);
  }, [chatId, syncChatState]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      shouldStickToBottomRef.current = isNearBottom(element);
    };

    handleScroll();
    element.addEventListener("scroll", handleScroll);
    return () => element.removeEventListener("scroll", handleScroll);
  }, [chatId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [chatId, messages.length, messages[messages.length - 1]?.id, isTyping]);

  useEffect(() => {
    if (!selectedMsgId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-moment-select-root='true']")) return;
      setSelectedMsgId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [selectedMsgId]);

  useEffect(() => {
    if (!showSuggestions) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-suggestions-root='true']")) return;
      setShowSuggestions(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showSuggestions]);

  // Audio auto-play removed — users click to play

  const playAudio = useCallback(
    (messageId: string, audioUrl: string) => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (playingAudioId === messageId) {
        setPlayingAudioId(null);
        return;
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setPlayingAudioId(messageId);
      audio.onended = () => {
        setPlayingAudioId(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingAudioId(null);
        audioRef.current = null;
      };
      audio.play().catch(() => {
        setPlayingAudioId(null);
        audioRef.current = null;
      });
    },
    [playingAudioId]
  );

  const generateSuggestionsHandler = async () => {
    if (suggestions.length > 0) {
      setShowSuggestions((prev) => !prev);
      return;
    }
    setIsLoadingSuggestions(true);
    try {
      const result = await getSuggestions(chatId);
      setSuggestions(result);
      setShowSuggestions(true);
    } catch (error) {
      console.error("Failed to generate suggestions", error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        const compressed = await compressImage(base64, 800, 0.7);
        setUploadedImage(compressed);
      } catch {
        setUploadedImage(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearSilenceTimer = () => {
    if (recognitionSilenceTimerRef.current != null) {
      window.clearTimeout(recognitionSilenceTimerRef.current);
      recognitionSilenceTimerRef.current = null;
    }
  };

  const armSilenceTimer = (ms: number) => {
    clearSilenceTimer();
    recognitionSilenceTimerRef.current = window.setTimeout(() => {
      // No audio/result for a while — stop cleanly so the user isn't stuck on
      // "正在聆听..." forever (common on Android WebView and embedded browsers
      // where the API exists but never fires `onresult`).
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    }, ms);
  };

  const clearMediaAutoStopTimer = () => {
    if (mediaAutoStopTimerRef.current != null) {
      window.clearTimeout(mediaAutoStopTimerRef.current);
      mediaAutoStopTimerRef.current = null;
    }
  };

  const releaseMediaStream = () => {
    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* ignore */ }
      });
    }
  };

  const startServerAsrRecording = async () => {
    if (isRecording || isTranscribing) return;
    if (typeof MediaRecorder === "undefined") {
      showToast("当前浏览器不支持录音，请升级或更换浏览器", "warning");
      return;
    }
    const mimeType = pickRecorderMimeType();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error: any) {
      const name = error?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
        showToast("麦克风权限被拒绝，请在浏览器/系统设置中允许后重试", "warning");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        showToast("未检测到可用的麦克风设备", "error");
      } else if (name === "NotReadableError") {
        showToast("麦克风被其他应用占用，请关闭后重试", "error");
      } else {
        showToast("无法访问麦克风：" + (error?.message || name || "未知错误"), "error");
      }
      return;
    }

    mediaStreamRef.current = stream;
    mediaChunksRef.current = [];
    mediaCancelledRef.current = false;

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error: any) {
      releaseMediaStream();
      showToast("启动录音失败：" + (error?.message || "未知错误"), "error");
      return;
    }
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) mediaChunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      showToast("录音出错，请重试", "error");
      mediaCancelledRef.current = true;
      try { recorder.stop(); } catch { /* ignore */ }
    };

    recorder.onstop = async () => {
      clearMediaAutoStopTimer();
      const chunks = mediaChunksRef.current;
      const actualMime = recorder.mimeType || mimeType || "audio/webm";
      mediaChunksRef.current = [];
      mediaRecorderRef.current = null;
      releaseMediaStream();
      setIsRecording(false);

      if (mediaCancelledRef.current) {
        mediaCancelledRef.current = false;
        setInterimText("");
        return;
      }

      if (!chunks.length) {
        setInterimText("");
        showToast("没有录到音频，请再试一次", "info");
        return;
      }

      const blob = new Blob(chunks, { type: actualMime });
      if (blob.size < 1000) {
        setInterimText("");
        showToast("录音太短，请再说一次", "info");
        return;
      }

      setIsTranscribing(true);
      setInterimText("识别中...");
      try {
        const base64 = await blobToBase64(blob);
        const result = await transcribeAudio(base64, actualMime);
        const text = (result.text || "").trim();
        if (!text) {
          showToast(result.error || "没有识别到语音，请靠近麦克风再试一次", "info");
          return;
        }
        finalTranscriptRef.current = text;
        setInput(text);
        handleSendVoice(text);
      } catch (error: any) {
        showToast(error?.message || "语音识别失败，请稍后再试", "error");
      } finally {
        setIsTranscribing(false);
        setInterimText("");
      }
    };

    try {
      recorder.start();
      setIsRecording(true);
      setInterimText("");
      // Auto-stop after 60s to protect against users forgetting to tap stop.
      mediaAutoStopTimerRef.current = window.setTimeout(() => {
        try { recorder.stop(); } catch { /* ignore */ }
      }, 60_000);
    } catch (error: any) {
      releaseMediaStream();
      mediaRecorderRef.current = null;
      showToast("启动录音失败：" + (error?.message || "未知错误"), "error");
    }
  };

  const stopServerAsrRecording = (cancel = false) => {
    clearMediaAutoStopTimer();
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      releaseMediaStream();
      setIsRecording(false);
      return;
    }
    mediaCancelledRef.current = cancel;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      releaseMediaStream();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  };

  const startRecording = async () => {
    if (shouldUseServerAsr()) {
      return startServerAsrRecording();
    }
    if (!SpeechRecognitionAPI) {
      showToast("当前浏览器不支持语音识别，请使用系统自带的 Safari 或 Chrome", "warning");
      return;
    }
    if (recognitionStartingRef.current || recognitionRef.current) {
      // Guard against double-taps that can lead to InvalidStateError on iOS.
      return;
    }
    recognitionStartingRef.current = true;

    // Step 1: request microphone permission up-front via getUserMedia. This is
    // the most reliable prompt on mobile (the prompt fired by the speech API
    // alone is silently dismissed by some iOS/Android browsers). We release
    // the stream immediately so SpeechRecognition can open its own.
    try {
      const md = (navigator as any).mediaDevices;
      if (md && typeof md.getUserMedia === "function") {
        const stream = await md.getUserMedia({ audio: true });
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
    } catch (error: any) {
      recognitionStartingRef.current = false;
      const name = error?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
        showToast("麦克风权限被拒绝，请在浏览器/系统设置中允许后重试", "warning");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        showToast("未检测到可用的麦克风设备", "error");
      } else if (name === "NotReadableError") {
        showToast("麦克风被其他应用占用，请关闭后重试", "error");
      } else {
        showToast("无法访问麦克风：" + (error?.message || name || "未知错误"), "error");
      }
      return;
    }

    // Step 2: create recognition. iOS Safari is unreliable with
    // `continuous: true` — it often never fires `onresult`. Use single-shot on
    // iOS and on other mobile UAs that commonly misbehave.
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "zh-CN";
    recognition.continuous = !isMobileUA();
    recognition.interimResults = true;
    try {
      recognition.maxAlternatives = 1;
    } catch {
      /* not all implementations support this */
    }

    finalTranscriptRef.current = "";
    recognitionGotResultRef.current = false;
    setInterimText("");

    recognition.onstart = () => {
      // Arm a fallback timeout in case the engine never talks back.
      armSilenceTimer(8000);
    };

    recognition.onaudiostart = () => {
      armSilenceTimer(8000);
    };

    recognition.onspeechstart = () => {
      // User actually started speaking — extend the silence window.
      armSilenceTimer(6000);
    };

    recognition.onresult = (event: any) => {
      recognitionGotResultRef.current = true;
      armSilenceTimer(isIOS() ? 2500 : 4000);
      let interim = "";
      let final = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) finalTranscriptRef.current += final;
      setInterimText(finalTranscriptRef.current + interim);
    };

    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      const err = event?.error || "unknown";
      if (err === "not-allowed" || err === "service-not-allowed") {
        showToast("麦克风权限未授予，请在浏览器设置中允许", "warning");
      } else if (err === "no-speech") {
        showToast("没听清，请再说一次", "info");
      } else if (err === "audio-capture") {
        showToast("无法获取音频，请检查麦克风", "error");
      } else if (err === "network") {
        showToast("语音识别需要网络连接，请检查网络", "error");
      } else if (err === "aborted") {
        /* user-initiated stop, no toast */
      } else {
        showToast("语音识别出错，请稍后再试", "error");
      }
      setIsRecording(false);
      setInterimText("");
    };

    recognition.onend = () => {
      clearSilenceTimer();
      recognitionRef.current = null;
      recognitionStartingRef.current = false;
      setIsRecording(false);
      const text = finalTranscriptRef.current.trim();
      setInterimText("");
      if (text) {
        setInput(text);
        handleSendVoice(text);
      } else if (!recognitionGotResultRef.current) {
        // Only warn when we truly got nothing — avoids double toasts with onerror.
        showToast("没有识别到语音，请靠近麦克风再试一次", "info");
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
      armSilenceTimer(8000);
    } catch (error: any) {
      recognitionStartingRef.current = false;
      const name = error?.name || "";
      if (name === "InvalidStateError") {
        // Already running — force-stop and let the user retry.
        try { recognition.abort(); } catch { /* ignore */ }
        showToast("请稍候再试", "info");
      } else {
        showToast("语音识别启动失败：" + (error?.message || name || "未知错误"), "error");
      }
      setIsRecording(false);
    } finally {
      // Clear the starting guard after a short delay regardless — `onstart`
      // may or may not fire, and we don't want it stuck forever.
      window.setTimeout(() => {
        recognitionStartingRef.current = false;
      }, 500);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      stopServerAsrRecording(false);
      return;
    }
    clearSilenceTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) {
      setIsRecording(false);
      setInterimText("");
      return;
    }
    try {
      recognition.stop();
    } catch {
      try { recognition.abort(); } catch { /* ignore */ }
      setIsRecording(false);
      setInterimText("");
    }
  };

  const toggleRecording = () => {
    if (isTranscribing) return;
    if (isRecording) stopRecording();
    else void startRecording();
  };

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      clearMediaAutoStopTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      if (mediaRecorderRef.current) {
        mediaCancelledRef.current = true;
        try {
          if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
        } catch { /* ignore */ }
        mediaRecorderRef.current = null;
      }
      releaseMediaStream();
    };
  }, []);

  const handleMessageClick = (messageId: string) => {
    if (messageId.startsWith("temp-")) return;
    setSelectedMsgId((prev) => (prev === messageId ? null : messageId));
  };

  const handleSaveMoment = async (count: number) => {
    if (!selectedMsgId || !chatId) return;
    setSavingMoment(true);
    try {
      const result = await saveInteractionMoment(chatId, selectedMsgId, count);
      setChatMoments((prev) => [result, ...prev]);
      setSelectedMsgId(null);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch (error) {
      console.error("Failed to save moment:", error);
      showToast("保存失败，请重试。");
    } finally {
      setSavingMoment(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInput(value);
    if (value.endsWith("@") && chatMoments.length > 0) {
      setShowAtMenu(true);
    } else if (!value.includes("@")) {
      setShowAtMenu(false);
    }
  };

  const handleSelectMoment = (moment: InteractionMoment) => {
    setSelectedMomentContext(moment.summary);
    setSelectedMomentTitle(moment.title);
    setInput((prev) => prev.replace(/@$/, ""));
    setShowAtMenu(false);
  };

  const clearMomentContext = () => {
    setSelectedMomentContext(null);
    setSelectedMomentTitle(null);
  };

  const replaceTempMessage = (tempId: string, nextMessage: Message) => {
    setMessages((prev) => [...prev.filter((message) => message.id !== tempId), nextMessage]);
  };

  const handleSendVoice = async (voiceText: string) => {
    if (!voiceText || !chatId) return;
    setInput("");
    setShowSuggestions(false);
    setShowAtMenu(false);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tempUserMessage: Message = {
      id: tempId,
      text: voiceText,
      role: "user",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMessage]);

    try {
      const { userMessage, queueState } = await sendMessage(chatId, {
        text: voiceText,
        voiceInput: true,
        momentContext: selectedMomentContext || undefined,
      });
      replaceTempMessage(tempId, userMessage);
      setRuntime((prev) => ({ ...prev, ...queueState }));
      clearMomentContext();
    } catch (error) {
      console.error("Failed to send voice message:", error);
      setMessages((prev) => prev.filter((message) => message.id !== tempId));
    } finally {
      setSuggestions([]);
    }
  };

  const handleSend = async (event?: React.FormEvent, overrideText?: string) => {
    if (event) event.preventDefault();

    const textToSend = overrideText || input.trim();
    if ((!textToSend && !uploadedImage) || !chatId) return;

    const userImage = uploadedImage;
    if (!overrideText) setInput("");
    setUploadedImage(null);
    setShowSuggestions(false);
    setShowAtMenu(false);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tempUserMessage: Message = {
      id: tempId,
      text: textToSend,
      role: "user",
      created_at: new Date().toISOString(),
      image_url: userImage || undefined,
    };
    setMessages((prev) => [...prev, tempUserMessage]);

    try {
      const { userMessage, queueState } = await sendMessage(chatId, {
        text: textToSend,
        imageUrl: userImage || undefined,
        momentContext: selectedMomentContext || undefined,
      });
      replaceTempMessage(tempId, userMessage);
      setRuntime((prev) => ({ ...prev, ...queueState }));
      clearMomentContext();
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => prev.filter((message) => message.id !== tempId));
    } finally {
      setSuggestions([]);
    }
  };

  if (!chatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-page text-muted">
        <div className="text-center">
          <Sparkles size={48} className="mx-auto mb-4 opacity-50" />
          <p>选择或创建一个伴侣开始聊天。</p>
        </div>
      </div>
    );
  }

  const renderNow = new Date();
  const openingStory = getCharacterOpeningStory(character);

  return (
    <div className="flex flex-col h-full min-h-0 bg-page/50">
      <div className="px-4 md:px-6 py-3 md:py-4 bg-surface border-b border-divider flex items-center space-x-3 md:space-x-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="md:hidden shrink-0 p-2 -ml-2 rounded-full hover:bg-surface-alt text-body"
            aria-label="返回"
          >
            <ArrowLeft size={22} />
          </button>
        )}
        <img
          src={character?.avatarUrl || character?.avatar_url || ""}
          alt={character?.name}
          className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-80 transition-opacity shrink-0"
          onClick={onViewProfile}
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-body truncate">{character?.name || "伴侣"}</h2>
          <p className="text-xs text-secondary truncate max-w-md">{character?.overview}</p>
        </div>
        {onOpenSidebar && (
          <button
            type="button"
            onClick={onOpenSidebar}
            className="md:hidden shrink-0 p-2 -mr-2 rounded-full hover:bg-surface-alt text-body"
            aria-label="查看关系信息"
          >
            <Info size={22} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {savedToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-violet-600 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-lg flex items-center space-x-2"
          >
            <Bookmark size={14} />
            <span>互动瞬间已保存</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 relative">
        <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-4 md:p-6 space-y-6 scrollbar-hide">
          {openingStory && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">
              <div className="max-w-[92%] md:max-w-[76%] rounded-2xl px-5 py-3 text-sm leading-relaxed bg-surface-alt text-secondary border border-divider-strong shadow-sm">
                <p>（{openingStory}）</p>
              </div>
            </motion.div>
          )}

          {messages.map((message, index) => {
            const showTimestamp = shouldShowMessageGroupTimestamp(messages[index - 1], message);

            return (
              <div key={message.id} className="space-y-2">
                {showTimestamp && (
                  <div className="flex justify-center">
                    <span className="text-[11px] text-muted">{formatMessageGroupTimestamp(message.created_at, renderNow)}</span>
                  </div>
                )}

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("flex w-full relative", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "flex items-end space-x-2 max-w-[80%]",
                      message.role === "user" ? "flex-row-reverse space-x-reverse" : "flex-row"
                    )}
                  >
                    {message.role === "model" && (
                      <img
                        src={character?.avatarUrl || character?.avatar_url || ""}
                        alt={character?.name}
                        className="w-8 h-8 rounded-full object-cover shrink-0 mb-1"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {message.role === "user" && (
                      <div className="w-8 h-8 rounded-full bg-surface-alt shrink-0 mb-1 flex items-center justify-center text-secondary font-bold text-xs">
                        我
                      </div>
                    )}

                    <div className="relative">
                      <motion.div
                        data-moment-select-root="true"
                        onClick={() => handleMessageClick(message.id)}
                        whileTap={{ scale: 0.95 }}
                        animate={selectedMsgId === message.id ? { y: [0, -6, 0] } : {}}
                        transition={selectedMsgId === message.id ? { duration: 0.3 } : {}}
                        className={cn(
                          "rounded-2xl px-5 py-3 text-sm shadow-sm leading-relaxed cursor-pointer select-none",
                          message.role === "user"
                            ? "bg-stone-800 text-white rounded-br-none"
                            : "bg-surface text-body rounded-bl-none border border-divider",
                          selectedMsgId === message.id && "ring-2 ring-violet-400"
                        )}
                      >
                        {message.image_url && (
                          <img
                            src={message.image_url}
                            alt={message.role === "model" ? "AI 生成图片" : "用户上传图片"}
                            className="max-w-[280px] w-full rounded-xl mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                            loading="lazy"
                            onClick={(event) => {
                              event.stopPropagation();
                              window.open(message.image_url, "_blank");
                            }}
                          />
                        )}
                        {message.text && <p>{message.text}</p>}
                        {message.audio_url && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              playAudio(message.id, message.audio_url!);
                            }}
                            className={cn(
                              "mt-2 flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-full transition-colors",
                              playingAudioId === message.id
                                ? "bg-indigo-100 text-indigo-600"
                                : "bg-surface-alt text-secondary hover:bg-divider-strong"
                            )}
                          >
                            {playingAudioId === message.id ? (
                              <>
                                <Square size={12} className="fill-current" />
                                <span>停止</span>
                                <motion.span
                                  animate={{ opacity: [1, 0.3, 1] }}
                                  transition={{ repeat: Infinity, duration: 1.2 }}
                                  className="inline-flex space-x-0.5"
                                >
                                  <span className="w-1 h-3 bg-indigo-400 rounded-full inline-block" />
                                  <span className="w-1 h-2 bg-indigo-400 rounded-full inline-block" />
                                  <span className="w-1 h-3.5 bg-indigo-400 rounded-full inline-block" />
                                </motion.span>
                              </>
                            ) : (
                              <>
                                <Volume2 size={12} />
                                <span>播放语音</span>
                              </>
                            )}
                          </button>
                        )}
                      </motion.div>

                      <AnimatePresence>
                        {selectedMsgId === message.id && (
                          <motion.div
                            data-moment-select-root="true"
                            initial={{ opacity: 0, y: 8, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.9 }}
                            className={cn(
                              "absolute z-20 bottom-full mb-2 flex flex-col gap-1.5",
                              message.role === "user" ? "right-0 items-end" : "left-0 items-start"
                            )}
                          >
                            <span className="px-2 text-[11px] font-medium text-violet-500">形成心动瞬间</span>
                            <div className="flex items-center space-x-1.5 bg-surface border border-violet-200 rounded-xl px-3 py-2 shadow-lg">
                              {savingMoment ? (
                                <div className="flex items-center space-x-2 px-2 py-1 text-violet-600">
                                  <Loader2 size={14} className="animate-spin" />
                                  <span className="text-xs">保存中...</span>
                                </div>
                              ) : (
                                <>
                                  <Bookmark size={12} className="text-violet-500 shrink-0" />
                                  {[5, 10, 15].map((count) => (
                                    <button
                                      key={count}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleSaveMoment(count);
                                      }}
                                      className="px-2.5 py-1 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors whitespace-nowrap"
                                    >
                                      {count}条
                                    </button>
                                  ))}
                                </>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              </div>
            );
          })}

          {messages.length === 0 && !isTyping && !openingStory && (
            <div className="h-full flex items-center justify-center text-center text-muted text-sm">
              <div>
                <p>这段对话暂时还没有可显示的消息。</p>
                <p className="mt-1 text-xs">如果你是从角色详情页进入，重新点击“发消息”后会自动进入正确会话。</p>
              </div>
            </div>
          )}

          {isTyping && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="flex items-end space-x-2 max-w-[80%]">
                <img
                  src={character?.avatarUrl || character?.avatar_url || ""}
                  alt={character?.name}
                  className="w-8 h-8 rounded-full object-cover shrink-0 mb-1"
                  referrerPolicy="no-referrer"
                />
                <div className="bg-surface border border-divider rounded-2xl rounded-bl-none px-5 py-4 flex space-x-1.5 shadow-sm">
                  <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-subtle rounded-full" />
                  <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-subtle rounded-full" />
                  <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-subtle rounded-full" />
                </div>
              </div>
            </motion.div>
          )}
      </div>

        {/* ─── Floating Ghost Helper ─── */}
        {!ghostDismissed && !isRecording && (
          <div
            data-suggestions-root="true"
            className="absolute bottom-4 right-6 z-30 flex items-end gap-2 pointer-events-auto"
            onMouseEnter={() => setGhostHovered(true)}
            onMouseLeave={() => setGhostHovered(false)}
          >
            <AnimatePresence>
              {ghostHovered && (
                <motion.div
                  initial={{ opacity: 0, x: 12, scale: 0.85 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 12, scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 400, damping: 24 }}
                  className="bg-white rounded-2xl px-4 py-2.5 shadow-lg border border-stone-100 mb-2 cursor-pointer select-none whitespace-nowrap"
                  onClick={generateSuggestionsHandler}
                >
                  <span className="text-sm font-medium text-stone-700">要帮忙？</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative">
              {ghostHovered && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGhostDismissed(true);
                    setGhostHovered(false);
                  }}
                  className="absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full bg-stone-600 text-white flex items-center justify-center hover:bg-stone-800 transition-colors shadow-sm"
                >
                  <X size={10} />
                </button>
              )}

              <motion.div
                className="cursor-pointer select-none"
                animate={ghostHovered ? { y: 0 } : { y: 14 }}
                transition={{ type: "spring", stiffness: 320, damping: 22 }}
                onClick={generateSuggestionsHandler}
              >
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <radialGradient id="ghostBody" cx="0.5" cy="0.4" r="0.6">
                      <stop offset="0%" stopColor="#FBCAB8" />
                      <stop offset="100%" stopColor="#F4977A" />
                    </radialGradient>
                    <radialGradient id="ghostCheek" cx="0.5" cy="0.5" r="0.5">
                      <stop offset="0%" stopColor="#F9A08C" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#F9A08C" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <ellipse cx="24" cy="28" rx="16" ry="17" fill="url(#ghostBody)" />
                  <ellipse cx="24" cy="43" rx="13" ry="4" fill="#F4977A" opacity="0.25" />
                  {ghostHovered ? (
                    <>
                      <circle cx="19" cy="25" r="2" fill="#44403C" />
                      <circle cx="29" cy="25" r="2" fill="#44403C" />
                      <path d="M20 31 Q24 34 28 31" stroke="#44403C" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                    </>
                  ) : (
                    <>
                      <circle cx="19" cy="26" r="2" fill="#44403C" />
                      <circle cx="29" cy="26" r="2" fill="#44403C" />
                    </>
                  )}
                  <ellipse cx="14" cy="30" rx="4" ry="3" fill="url(#ghostCheek)" />
                  <ellipse cx="34" cy="30" rx="4" ry="3" fill="url(#ghostCheek)" />
                </svg>
              </motion.div>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 md:px-4 pt-3 md:pt-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:pb-4 bg-surface border-t border-divider relative">
        <AnimatePresence>
          {showSuggestions && suggestions.length > 0 && !isRecording && (
            <motion.div
              data-suggestions-root="true"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-4 mb-4 flex space-x-2 overflow-x-auto max-w-[calc(100%-2rem)] pb-2 scrollbar-hide"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setInput(suggestion);
                    setShowSuggestions(false);
                  }}
                  className="whitespace-nowrap px-4 py-2 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-xs font-medium hover:bg-indigo-100 transition-colors flex items-center"
                >
                  <Sparkles size={12} className="mr-1.5" />
                  {suggestion}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showAtMenu && chatMoments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-4 right-4 mb-2 bg-surface border border-violet-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto"
            >
              <div className="px-4 py-2.5 border-b border-violet-100 flex items-center space-x-2">
                <Bookmark size={14} className="text-violet-500" />
                <span className="text-xs font-medium text-violet-600">选择互动记忆</span>
              </div>
              {chatMoments.map((moment) => (
                <button
                  key={moment.id}
                  onClick={() => handleSelectMoment(moment)}
                  className="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors border-b border-divider last:border-0"
                >
                  <p className="text-sm font-medium text-body">{moment.title}</p>
                  <p className="text-xs text-secondary mt-0.5 line-clamp-1">{moment.summary}</p>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(isRecording || isTranscribing) && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="absolute bottom-full left-0 right-0 mb-2 mx-4 bg-red-50 border border-red-200 rounded-2xl px-4 md:px-5 py-3 flex items-center space-x-3 z-40 shadow-lg"
            >
              <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-3 h-3 bg-red-500 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-red-600 font-medium">
                  {isTranscribing ? "识别中..." : (mediaRecorderRef.current ? "正在录音..." : "正在聆听...")}
                </p>
                {interimText && !isTranscribing && <p className="text-sm text-red-800 truncate mt-0.5">{interimText}</p>}
              </div>
              {isRecording && (
                <button
                  type="button"
                  onClick={stopRecording}
                  aria-label="停止录音"
                  className="shrink-0 bg-red-500 text-white text-xs font-medium rounded-full px-4 py-2 md:px-3 md:py-1.5 hover:bg-red-600 active:bg-red-700 transition-colors"
                >
                  完成
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedMomentTitle && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 flex items-center space-x-2 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2"
            >
              <Bookmark size={14} className="text-violet-500 shrink-0" />
              <span className="text-xs text-violet-700 flex-1 truncate">引用记忆：{selectedMomentTitle}</span>
              <button onClick={clearMomentContext} className="text-violet-400 hover:text-violet-600 text-xs shrink-0">
                取消
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {uploadedImage && (
          <div className="mb-3 relative inline-block">
            <img src={uploadedImage} alt="Preview" className="h-20 rounded-xl" />
            <button
              type="button"
              onClick={() => setUploadedImage(null)}
              className="absolute -top-2 -right-2 bg-stone-800 text-white rounded-full p-1 w-6 h-6 flex items-center justify-center text-xs"
            >
              ×
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="relative flex items-center max-w-4xl mx-auto space-x-2">
          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-3 text-muted hover:text-secondary hover:bg-page rounded-full transition-colors shrink-0"
            title="上传图片"
          >
            <Camera size={20} />
          </button>

          <button
            type="button"
            onClick={toggleRecording}
            disabled={isTranscribing}
            className={cn(
              "p-3 rounded-full transition-colors shrink-0",
              isRecording ? "bg-red-100 text-red-500 animate-pulse" : "text-muted hover:text-secondary hover:bg-page",
              isTranscribing && "opacity-50 cursor-not-allowed"
            )}
            title={isTranscribing ? "识别中..." : (isRecording ? "停止录音" : "语音输入")}
          >
            <Mic size={20} />
          </button>

          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={isRecording || isTranscribing ? interimText : input}
              onChange={handleInputChange}
              readOnly={isRecording || isTranscribing}
              placeholder={
                isTranscribing ? "识别中..." :
                isRecording ? (mediaRecorderRef.current ? "正在录音..." : "正在聆听...") :
                `发消息给 ${character?.name || "..."}  (输入 @ 引用记忆)`
              }
              className={cn(
                "w-full border-none rounded-full py-3 pl-5 md:pl-6 pr-14 text-base md:text-sm focus:ring-2 transition-all",
                (isRecording || isTranscribing) ? "bg-red-50 focus:ring-red-200 text-red-800" : "bg-input-bg focus:ring-focus-ring"
              )}
            />
            <button
              type="submit"
              disabled={(!input.trim() && !uploadedImage) || isRecording || isTranscribing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-btn text-btn-text rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-btn-hover transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
