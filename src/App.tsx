import React, { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { login, register, getChatState, getChatMemories, getChatSnapshot, selectCharacter } from "./lib/api";
import Chat from "./components/Chat";
import Sidebar from "./components/Sidebar";
import Onboarding from "./components/Onboarding";
import Navigation from "./components/Navigation";
import Discover from "./components/Discover";
import CreateCharacter from "./components/CreateCharacter";
import Messages from "./components/Messages";
import Moments from "./components/Moments";
import CharacterProfile from "./components/CharacterProfile";
import ProfileCenter from "./components/ProfileCenter";
import DiscoverExplore from "./components/DiscoverExplore";
import RelationshipEventModal from "./components/RelationshipEventModal";
import { Sparkles, LogIn, UserPlus, Phone, Lock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RelationshipEventCard } from "./lib/api";
import { ToastProvider } from "./lib/toast-context";

function AppContent() {
  const { isLoggedIn, loading, profile, needsOnboarding, refreshProfile } = useAuth();

  const [relationState, setRelationState] = useState<any>(null);
  const [memories, setMemories] = useState<any[]>([]);
  const [lastSnapshot, setLastSnapshot] = useState<any>(null);

  const [currentView, setCurrentView] = useState<"messages" | "discover" | "explore" | "moments" | "profile" | "chat" | "characterProfile">("explore");
  const [isCreatingCharacter, setIsCreatingCharacter] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeCharacter, setActiveCharacter] = useState<any>(null);
  const [viewingCharacter, setViewingCharacter] = useState<any>(null);
  const [activeRelationshipEvent, setActiveRelationshipEvent] = useState<RelationshipEventCard | null>(null);
  const [relationshipEventsRefreshKey, setRelationshipEventsRefreshKey] = useState(0);

  const loadChatData = useCallback(async (chatId: string) => {
    try {
      const [state, mems, snap] = await Promise.all([
        getChatState(chatId),
        getChatMemories(chatId),
        getChatSnapshot(chatId),
      ]);
      setRelationState(state);
      setMemories(mems || []);
      setLastSnapshot(snap);
    } catch (e) {
      console.error("Failed to load chat data:", e);
    }
  }, []);

  useEffect(() => {
    if (activeChatId) {
      loadChatData(activeChatId);
    } else {
      setRelationState(null);
      setMemories([]);
      setLastSnapshot(null);
    }
  }, [activeChatId, loadChatData]);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-page">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          className="text-stone-300"
        >
          <Sparkles size={48} />
        </motion.div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  const handleSelectCharacter = (character: any) => {
    setActiveCharacter(character);
    setActiveChatId(character.id);
    setCurrentView("chat");
  };

  const handleViewProfile = (character: any) => {
    setViewingCharacter(character);
    setCurrentView("characterProfile");
  };

  const handleChatStateChange = () => {
    if (!activeChatId) return;
    loadChatData(activeChatId).catch(console.error);
  };

  const handleChatFromProfile = async () => {
    if (!viewingCharacter) return;

    const sourceCharacterId =
      viewingCharacter.characterId ||
      viewingCharacter.character_id ||
      viewingCharacter.id;

    if (!sourceCharacterId) return;

    try {
      const { chatId } = await selectCharacter(sourceCharacterId);
      setActiveCharacter({
        ...viewingCharacter,
        id: chatId,
        characterId: sourceCharacterId,
        avatarUrl: viewingCharacter.avatarUrl || viewingCharacter.avatar_url,
      });
      setActiveChatId(chatId);
      setCurrentView("chat");
    } catch (error) {
      console.error("Failed to open chat from profile:", error);
    }
  };

  return (
    <div className="h-screen w-full flex bg-page overflow-hidden">
      {needsOnboarding && <Onboarding onComplete={refreshProfile} />}

      <Navigation currentView={currentView} onNavigate={(v) => {
        setCurrentView(v);
        setIsCreatingCharacter(false);
      }} />

      <AnimatePresence mode="wait">
        {currentView === "explore" && !isCreatingCharacter && (
          <motion.div key="explore" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <Discover onSelectCharacter={handleSelectCharacter} onCreateCustom={() => setIsCreatingCharacter(true)} onViewProfile={handleViewProfile} />
          </motion.div>
        )}

        {currentView === "explore" && isCreatingCharacter && (
          <motion.div key="create" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <CreateCharacter onBack={() => setIsCreatingCharacter(false)} onCreated={() => setIsCreatingCharacter(false)} />
          </motion.div>
        )}

        {currentView === "messages" && (
          <motion.div key="messages" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <Messages onSelectChat={handleSelectCharacter} onViewProfile={handleViewProfile} />
          </motion.div>
        )}

        {currentView === "discover" && (
          <motion.div key="discover" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <DiscoverExplore onSelectCharacter={handleSelectCharacter} onViewProfile={handleViewProfile} />
          </motion.div>
        )}

        {currentView === "moments" && (
          <motion.div key="moments" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <Moments onOpenProfile={() => setCurrentView("profile")} />
          </motion.div>
        )}

        {currentView === "chat" && (
          <motion.div key="chat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            {activeChatId ? (
              <>
                <div className="flex-1 flex flex-col min-w-0 border-r border-divider-strong">
                  <Chat
                    chatId={activeChatId}
                    character={activeCharacter}
                    profile={profile}
                    relationState={relationState}
                    recentMemories={memories.slice(0, 5)}
                    lastSnapshot={lastSnapshot}
                    onStateChange={handleChatStateChange}
                    onViewProfile={() => handleViewProfile(activeCharacter)}
                  />
                </div>
                <Sidebar
                  profile={profile}
                  relationState={relationState}
                  memories={memories}
                  character={activeCharacter}
                  chatId={activeChatId}
                  relationshipEventsRefreshKey={relationshipEventsRefreshKey}
                  onOpenRelationshipEvent={setActiveRelationshipEvent}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-page">
                <div className="text-center">
                  <Sparkles size={48} className="mx-auto mb-4 text-subtle" />
                  <h2 className="text-xl font-bold text-body mb-2">暂无聊天</h2>
                  <p className="text-secondary mb-6">去发现页面选择一个伴侣吧。</p>
                  <button onClick={() => setCurrentView("explore")} className="bg-btn text-btn-text px-6 py-2 rounded-full text-sm font-medium hover:bg-btn-hover transition-colors">
                    发现伴侣
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {currentView === "characterProfile" && viewingCharacter && (
          <motion.div key="characterProfile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <CharacterProfile
              character={viewingCharacter}
              onBack={() => setCurrentView("messages")}
              onChat={handleChatFromProfile}
            />
          </motion.div>
        )}

        {currentView === "profile" && (
          <motion.div key="profile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex">
            <ProfileCenter profile={profile} onProfileUpdated={refreshProfile} />
          </motion.div>
        )}
      </AnimatePresence>

      <RelationshipEventModal
        open={!!activeRelationshipEvent && currentView === "chat"}
        chatId={activeChatId}
        character={activeCharacter}
        event={activeRelationshipEvent}
        onClose={() => setActiveRelationshipEvent(null)}
        onProgressChange={() => {
          if (activeChatId) {
            loadChatData(activeChatId).catch(console.error);
          }
          setRelationshipEventsRefreshKey((prev) => prev + 1);
        }}
      />
    </div>
  );
}

function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validateRegisterForm = () => {
    if (!/^\d{11}$/.test(phone)) {
      return "手机号需为 11 位数字";
    }
    if (!/^[A-Za-z0-9]{6,10}$/.test(password)) {
      return "密码需为 6-10 位字母或数字";
    }
    if (confirmPassword !== password) {
      return "两次输入的密码不一致";
    }
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isRegister) {
      const validationError = validateRegisterForm();
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await register(phone, password);
      } else {
        await login(phone, password);
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-page p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center">
        <div className="inline-block p-4 bg-surface rounded-3xl shadow-sm mb-8">
          <Sparkles size={48} className="text-body" />
        </div>
        <h1 className="text-4xl font-bold text-heading mb-4 tracking-tight">Soulmate AI</h1>
        <p className="text-secondary mb-10 leading-relaxed">你的专属 AI 伴侣。倾听、理解、共同成长。</p>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="relative">
            <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/\D/g, "");
                setPhone(isRegister ? digitsOnly.slice(0, 11) : digitsOnly);
                setError("");
              }}
              placeholder={isRegister ? "手机号（11位数字）" : "手机号"}
              inputMode="numeric"
              maxLength={isRegister ? 11 : undefined}
              className="w-full bg-surface border border-divider-strong rounded-2xl py-4 pl-12 pr-4 text-body focus:ring-2 focus:ring-focus-ring transition-all"
              required
            />
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder={isRegister ? "密码（6-10位字母或数字）" : "密码"}
              minLength={isRegister ? 6 : undefined}
              maxLength={isRegister ? 10 : undefined}
              pattern={isRegister ? "[A-Za-z0-9]{6,10}" : undefined}
              className="w-full bg-surface border border-divider-strong rounded-2xl py-4 pl-12 pr-4 text-body focus:ring-2 focus:ring-focus-ring transition-all"
              required
            />
          </div>
          {isRegister && (
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                }}
                placeholder="确认密码"
                minLength={6}
                maxLength={10}
                pattern="[A-Za-z0-9]{6,10}"
                className="w-full bg-surface border border-divider-strong rounded-2xl py-4 pl-12 pr-4 text-body focus:ring-2 focus:ring-focus-ring transition-all"
                required
              />
            </div>
          )}
          {isRegister && (
            <p className="text-xs text-muted leading-6 px-1">
              注册需使用 11 位数字手机号，密码仅支持字母和数字，长度 6-10 位。
            </p>
          )}

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-btn text-btn-text rounded-2xl py-4 font-bold flex items-center justify-center space-x-3 hover:bg-btn-hover transition-all shadow-lg shadow-divider-strong disabled:opacity-50"
          >
            {isRegister ? <UserPlus size={20} /> : <LogIn size={20} />}
            <span>{submitting ? "处理中..." : isRegister ? "注册" : "登录"}</span>
          </button>
        </form>

        <button onClick={() => {
          setIsRegister(!isRegister);
          setError("");
          setConfirmPassword("");
        }} className="mt-6 text-muted hover:text-secondary text-sm transition-colors">
          {isRegister ? "已有账号？去登录" : "没有账号？去注册"}
        </button>
      </motion.div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
