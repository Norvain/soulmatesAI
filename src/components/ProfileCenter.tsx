import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bell,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Heart,
  LogOut,
  MessageCircle,
  MessageSquare,
  Monitor,
  Moon,
  Phone,
  Settings,
  Sparkles,
  Sun,
  Eye,
  Trash2,
  User,
  Users,
} from "lucide-react";
import {
  deleteCharacter,
  deleteInteractionMoment,
  getCharacters,
  getChats,
  getInteractionMoments,
  logout,
  toggleInteractionMomentFavorite,
  updateAvatarImage,
  updatePreferences,
  updateProfile,
  updateProactiveSettings,
} from "../lib/api";
import { cn, compressImage } from "../lib/utils";
import { useTheme } from "../lib/theme-context";
import { useToast } from "../lib/toast-context";

const THEME_CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABELS = { light: "浅色模式", dark: "深色模式", system: "跟随系统" };

interface ProfileCenterProps {
  profile: any;
  onProfileUpdated?: () => Promise<void> | void;
}

interface InteractionMoment {
  id: string;
  character_id: string;
  character_name: string;
  character_avatar: string;
  summary: string;
  title: string;
  message_count: number;
  created_at: string;
  is_favorited: number;
  favorited_at: string | null;
}

interface DeleteDialogState {
  type: "character" | "moment";
  id: string;
  name: string;
  description: string;
}

type ProfileView = "root" | "characters" | "moments" | "settings" | "editProfile" | "membership";

const SETTINGS_TYPES = [
  { id: "sleep", label: "睡前陪伴" },
  { id: "greeting", label: "日常问候" },
];

const PRESET_CHARACTERS: Record<string, { name: string; avatarUrl: string }> = {
  preset_lintang: { name: "林棠", avatarUrl: "/avatars/lintang-avatar.png" },
  preset_guchengze: { name: "顾承泽", avatarUrl: "/avatars/guchengze-avatar.png" },
  preset_shenzhiyi: { name: "沈知意", avatarUrl: "/avatars/shenzhiyi-avatar.png" },
};

const CONTENT_TAGS = [
  "校园", "都市", "古代", "二次元", "职场", "玄幻",
  "有用知识", "情感陪伴", "奇幻", "拟人", "悬疑惊悚",
  "趣味玩法", "模拟器", "剧本杀&密室", "科幻", "海龟汤", "言情",
];

const CONVERSATION_SETTINGS = [
  { label: "对话模型", icon: Sparkles },
  { label: "对话气泡设置", icon: MessageCircle },
  { label: "对话背景设置", icon: Eye },
  { label: "高级设置", icon: Settings },
];

const VIP_BENEFITS = [
  { title: "畅聊对话模式", desc: "无限畅聊超长对话", highlighted: true },
  { title: "记忆增强", desc: "角色记忆能力提升", highlighted: true },
  { title: "查看角色记忆", desc: "发现Ta眼中的你", highlighted: true },
  { title: "更长通话时间", desc: "每日可通话2小时", highlighted: true },
  { title: "免广告", desc: "无广告沉浸体验", highlighted: false },
  { title: "专属生图风格", desc: "会员专属2种风格", highlighted: false },
];

const VIP_PLANS = [
  { id: "monthly_sub", label: "连续包月", price: 25, originalPrice: 90, unit: "/月", tag: "特惠推荐" },
  { id: "weekly", label: "周卡", price: 15, originalPrice: 30, unit: "", tag: null },
  { id: "monthly", label: "月卡", price: 30, originalPrice: 90, unit: "", tag: null },
];

function getSortTimestamp(value?: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function sortInteractionMoments(items: InteractionMoment[]) {
  return [...items].sort((a, b) => {
    if (a.is_favorited !== b.is_favorited) return b.is_favorited - a.is_favorited;
    if (a.is_favorited && b.is_favorited) {
      const favoriteDelta = getSortTimestamp(b.favorited_at || b.created_at) - getSortTimestamp(a.favorited_at || a.created_at);
      if (favoriteDelta !== 0) return favoriteDelta;
    }
    return getSortTimestamp(b.created_at) - getSortTimestamp(a.created_at);
  });
}

function minutesToTimeValue(minutes: number) {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.min(1439, minutes)) : 1380;
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function timeValueToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 1380;
  return Math.max(0, Math.min(1439, hour * 60 + minute));
}

export default function ProfileCenter({ profile, onProfileUpdated }: ProfileCenterProps) {
  const { showToast } = useToast();
  const { mode, setMode } = useTheme();
  const ThemeIcon = THEME_ICONS[mode];
  const [view, setView] = useState<ProfileView>("root");
  const [characters, setCharacters] = useState<any[]>([]);
  const [moments, setMoments] = useState<InteractionMoment[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  const [expandedChar, setExpandedChar] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingMoment, setDeletingMoment] = useState<string | null>(null);
  const [togglingFavorite, setTogglingFavorite] = useState<string | null>(null);
  const [avatarImage, setAvatarImage] = useState<string | null>(profile?.avatar_image || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [proactiveEnabled, setProactiveEnabled] = useState(Boolean(profile?.proactive_enabled));
  const [proactiveTypes, setProactiveTypes] = useState<string[]>(profile?.proactive_types || []);
  const [proactiveBedtimeMinutes, setProactiveBedtimeMinutes] = useState<number>(profile?.proactive_bedtime_minutes ?? 1380);
  const [proactiveCharacterIds, setProactiveCharacterIds] = useState<string[]>(profile?.proactive_character_ids || []);
  const [resetCharacterIds, setResetCharacterIds] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editNickname, setEditNickname] = useState(profile?.preferred_name || "");
  const [editGender, setEditGender] = useState<string | null>(profile?.gender || null);
  const [editTags, setEditTags] = useState<string[]>(profile?.content_preferences || []);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("monthly_sub");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([getCharacters(), getInteractionMoments(), getChats()])
      .then(([characterRows, momentRows, chatRows]) => {
        setCharacters(characterRows);
        setMoments(sortInteractionMoments(momentRows));
        setChats(chatRows);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    setAvatarImage(profile?.avatar_image || null);
    setProactiveEnabled(Boolean(profile?.proactive_enabled));
    setProactiveTypes(profile?.proactive_types || []);
    setProactiveBedtimeMinutes(profile?.proactive_bedtime_minutes ?? 1380);
    setProactiveCharacterIds(profile?.proactive_character_ids || []);
    setResetCharacterIds([]);
    setEditNickname(profile?.preferred_name || "");
    setEditGender(profile?.gender || null);
    setEditTags(profile?.content_preferences || []);
  }, [
    profile?.avatar_image,
    profile?.proactive_enabled,
    profile?.proactive_types,
    profile?.proactive_bedtime_minutes,
    profile?.proactive_character_ids,
    profile?.preferred_name,
    profile?.gender,
    profile?.content_preferences,
  ]);

  const connectedRoles = useMemo(
    () =>
      chats
        .filter((chat) => chat.is_connected)
        .map((chat) => {
          const preset = PRESET_CHARACTERS[chat.character_id];
          return {
            chatId: chat.id,
            characterId: chat.character_id,
            name: chat.character_name || preset?.name || "AI",
            avatarUrl: chat.character_avatar_url || preset?.avatarUrl || `/avatars/${chat.character_id}.png`,
            isSilenced: Boolean(chat.proactive_silenced),
          };
        }),
    [chats]
  );

  const momentsByCharacter = useMemo(() => {
    return moments.reduce<Record<string, { name: string; avatar: string; items: InteractionMoment[] }>>((acc, moment) => {
      const key = moment.character_id || moment.character_name;
      if (!acc[key]) {
        acc[key] = { name: moment.character_name, avatar: moment.character_avatar, items: [] };
      }
      acc[key].items.push(moment);
      return acc;
    }, {});
  }, [moments]);

  const momentGroups = useMemo(
    () => Object.entries(momentsByCharacter) as Array<[string, { name: string; avatar: string; items: InteractionMoment[] }]>,
    [momentsByCharacter]
  );

  const openDeleteCharacterDialog = (id: string, name: string) => {
    setDeleteDialog({
      type: "character",
      id,
      name,
      description: "相关的聊天记录、记忆和朋友圈内容都将被删除，此操作不可撤销。",
    });
  };

  const openDeleteMomentDialog = (id: string, title: string) => {
    setDeleteDialog({
      type: "moment",
      id,
      name: title,
      description: "删除后不可恢复。",
    });
  };

  const handleDeleteCharacter = async (id: string) => {
    setDeleting(id);
    try {
      await deleteCharacter(id);
      setCharacters((prev) => prev.filter((character) => character.id !== id));
      setMoments((prev) => prev.filter((moment) => moment.character_id !== id));
      setChats((prev) => prev.filter((chat) => chat.character_id !== id));
      setDeleteDialog(null);
    } catch (error) {
      console.error("Failed to delete character:", error);
      showToast("删除失败，请重试。");
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteMoment = async (id: string) => {
    setDeletingMoment(id);
    try {
      await deleteInteractionMoment(id);
      setMoments((prev) => prev.filter((moment) => moment.id !== id));
      setDeleteDialog(null);
    } catch (error) {
      console.error("Failed to delete interaction moment:", error);
      showToast("删除失败，请重试。");
    } finally {
      setDeletingMoment(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    if (deleteDialog.type === "character") {
      await handleDeleteCharacter(deleteDialog.id);
      return;
    }
    await handleDeleteMoment(deleteDialog.id);
  };

  const handleToggleFavorite = async (momentId: string) => {
    if (togglingFavorite === momentId) return;
    setTogglingFavorite(momentId);
    try {
      const result = await toggleInteractionMomentFavorite(momentId);
      setMoments((prev) =>
        sortInteractionMoments(
          prev.map((moment) =>
            moment.id === momentId
              ? { ...moment, is_favorited: result.is_favorited, favorited_at: result.favorited_at }
              : moment
          )
        )
      );
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
      showToast("标记失败，请重试。");
    } finally {
      setTogglingFavorite(null);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || uploadingAvatar) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploadingAvatar(true);
        const base64 = reader.result as string;
        const compressed = await compressImage(base64, 600, 0.8);
        setAvatarImage(compressed);
        await updateAvatarImage(compressed);
        await onProfileUpdated?.();
      } catch (error) {
        console.error("Avatar upload failed:", error);
        showToast("头像上传失败，请重试。");
      } finally {
        setUploadingAvatar(false);
      }
    };
    reader.readAsDataURL(file);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const toggleProactiveType = (type: string) => {
    setProactiveTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
    );
  };

  const toggleProactiveCharacter = (characterId: string, isSilenced: boolean) => {
    setProactiveCharacterIds((prev) => {
      const exists = prev.includes(characterId);
      if (exists) {
        setResetCharacterIds((resetIds) => resetIds.filter((id) => id !== characterId));
        return prev.filter((id) => id !== characterId);
      }
      if (isSilenced) {
        setResetCharacterIds((resetIds) => Array.from(new Set([...resetIds, characterId])));
      }
      return [...prev, characterId];
    });
  };

  const handleSaveSettings = async () => {
    const connectedCharacterIds = connectedRoles.map((role) => role.characterId);
    const nextCharacterIds = proactiveCharacterIds.filter((characterId) => connectedCharacterIds.includes(characterId));
    setSavingSettings(true);
    try {
      await updateProactiveSettings({
        proactiveEnabled,
        proactiveTypes,
        proactiveBedtimeMinutes,
        proactiveCharacterIds: nextCharacterIds,
        proactiveTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        resetCharacterIds,
      });
      setProactiveCharacterIds(nextCharacterIds);
      setResetCharacterIds([]);
      await onProfileUpdated?.();
      const nextChats = await getChats();
      setChats(nextChats);
    } catch (error) {
      console.error("Failed to save proactive settings:", error);
      showToast("设置保存失败，请重试。");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveNickname = async () => {
    const trimmed = editNickname.trim();
    if (!trimmed) { showToast("昵称不能为空"); return; }
    setSavingProfile(true);
    try {
      await updateProfile({ preferredName: trimmed, comfortStyle: profile?.comfort_style || "倾听" });
      await onProfileUpdated?.();
      showToast("昵称已更新");
    } catch {
      showToast("保存失败，请重试");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePreferences = async () => {
    setSavingPreferences(true);
    try {
      await updatePreferences({ gender: editGender, contentPreferences: editTags });
      await onProfileUpdated?.();
      showToast("偏好已保存");
    } catch {
      showToast("保存失败，请重试");
    } finally {
      setSavingPreferences(false);
    }
  };

  const toggleContentTag = (tag: string) => {
    setEditTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const renderHeader = (title: string, description: string, showBack = false) => (
    <div className="flex items-center space-x-4 mb-10">
      {showBack ? (
        <button
          type="button"
          onClick={() => setView("root")}
          className="w-11 h-11 rounded-2xl bg-surface-alt text-secondary hover:text-body transition-colors flex items-center justify-center shrink-0"
        >
          <ChevronLeft size={20} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => avatarInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative w-16 h-16 rounded-full overflow-hidden bg-surface-alt flex items-center justify-center text-secondary group shrink-0 disabled:opacity-80"
          title="更换头像"
        >
          {avatarImage ? (
            <img src={avatarImage} alt={profile?.preferred_name || "用户头像"} className="w-full h-full object-cover" />
          ) : (
            <User size={28} />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
            {uploadingAvatar ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-5 h-5 border-2 border-white/80 border-t-transparent rounded-full"
              />
            ) : (
              <Camera size={18} className="text-white opacity-0 group-hover:opacity-90 transition-opacity" />
            )}
          </div>
        </button>
      )}

      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />

      <div>
        <h1 className="text-2xl font-bold text-heading">{title}</h1>
        <p className="text-sm text-secondary">{description}</p>
      </div>
    </div>
  );

  const isDeleteSubmitting =
    deleteDialog?.type === "character"
      ? deleting === deleteDialog.id
      : deleteDialog?.type === "moment"
        ? deletingMoment === deleteDialog.id
        : false;

  return (
    <div className="flex-1 overflow-y-auto bg-page p-4 md:p-10 pb-24 md:pb-10">
      <div className="max-w-3xl mx-auto">
        {view === "root" && (
          <>
            <div className="flex items-center space-x-4 mb-10">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative w-16 h-16 rounded-full overflow-hidden bg-surface-alt flex items-center justify-center text-secondary group shrink-0 disabled:opacity-80"
                title="更换头像"
              >
                {avatarImage ? (
                  <img src={avatarImage} alt={profile?.preferred_name || "用户头像"} className="w-full h-full object-cover" />
                ) : (
                  <User size={28} />
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                  {uploadingAvatar ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="w-5 h-5 border-2 border-white/80 border-t-transparent rounded-full"
                    />
                  ) : (
                    <Camera size={18} className="text-white opacity-0 group-hover:opacity-90 transition-opacity" />
                  )}
                </div>
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              <div>
                <h1 className="text-2xl font-bold text-heading">{profile?.preferred_name || "用户"}</h1>
                <button
                  type="button"
                  onClick={() => setView("editProfile")}
                  className="text-sm text-secondary hover:text-body transition-colors underline-offset-2 hover:underline"
                >
                  个人中心 · 编辑资料
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setView("characters")}
                className="w-full bg-surface rounded-3xl border border-divider px-6 py-5 text-left shadow-sm hover:border-divider-strong transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-700 flex items-center justify-center shrink-0">
                    <Users size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-body">角色管理</h3>
                    <p className="text-sm text-secondary mt-1">查看和删除自定义角色</p>
                  </div>
                  <div className="flex items-center space-x-3 text-sm text-muted shrink-0">
                    <span>{characters.length} 个</span>
                    <ChevronRight size={18} />
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setView("moments")}
                className="w-full bg-surface rounded-3xl border border-divider px-6 py-5 text-left shadow-sm hover:border-divider-strong transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <Bookmark size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-body">互动瞬间</h3>
                    <p className="text-sm text-secondary mt-1">管理收藏、删除和角色分组查看</p>
                  </div>
                  <div className="flex items-center space-x-3 text-sm text-muted shrink-0">
                    <span>{moments.length} 条</span>
                    <ChevronRight size={18} />
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setView("settings")}
                className="w-full bg-surface rounded-3xl border border-divider px-6 py-5 text-left shadow-sm hover:border-divider-strong transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    <Bell size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-body">应用设置</h3>
                    <p className="text-sm text-secondary mt-1">配置主动消息、睡前陪伴和日常问候</p>
                  </div>
                  <div className="flex items-center space-x-3 text-sm text-muted shrink-0">
                    <span>{proactiveEnabled ? "已开启" : "已关闭"}</span>
                    <ChevronRight size={18} />
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setView("membership")}
                className="w-full bg-gradient-to-r from-amber-50 to-yellow-50 rounded-3xl border border-amber-200 px-6 py-5 text-left shadow-sm hover:border-amber-300 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                    <Crown size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-amber-900">会员中心</h3>
                    <p className="text-sm text-amber-700/70 mt-1">解锁更多专属特权</p>
                  </div>
                  <div className="flex items-center space-x-3 text-sm text-amber-600 shrink-0">
                    <ChevronRight size={18} />
                  </div>
                </div>
              </button>

              <div className="md:hidden space-y-4 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const idx = THEME_CYCLE.indexOf(mode);
                    setMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
                  }}
                  className="w-full bg-surface rounded-3xl border border-divider px-6 py-5 text-left shadow-sm hover:border-divider-strong transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center shrink-0">
                      <ThemeIcon size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-body">外观</h3>
                      <p className="text-sm text-secondary mt-1">{THEME_LABELS[mode]}（点击切换）</p>
                    </div>
                    <ChevronRight size={18} className="text-muted shrink-0" />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="w-full bg-surface rounded-3xl border border-divider px-6 py-5 text-left shadow-sm hover:border-rose-200 transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                      <LogOut size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-rose-500">退出登录</h3>
                      <p className="text-sm text-secondary mt-1">清除本地凭据，返回登录页</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </>
        )}

        {view === "characters" && (
          <>
            {renderHeader("角色管理", "查看和删除自定义角色", true)}

            <div className="space-y-4">
              {characters.length === 0 ? (
                <div className="text-center py-16 text-muted">
                  <User size={48} className="mx-auto mb-4 opacity-50" />
                  <p>还没有创建自定义角色</p>
                </div>
              ) : (
                characters.map((character) => (
                  <motion.div
                    key={character.id}
                    layout
                    className="bg-surface rounded-2xl p-5 border border-divider shadow-sm flex items-center space-x-4"
                  >
                    <img
                      src={character.avatar_url || character.avatarUrl || ""}
                      alt={character.name}
                      className="w-14 h-14 rounded-xl object-cover shrink-0"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-body">{character.name}</h3>
                      <p className="text-sm text-secondary truncate">{character.overview || character.persona}</p>
                    </div>
                    <button
                      onClick={() => openDeleteCharacterDialog(character.id, character.name)}
                      disabled={deleting === character.id}
                      className="p-2.5 rounded-xl text-muted hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="删除角色"
                    >
                      {deleting === character.id ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1 }}
                          className="w-5 h-5 border-2 border-red-300 border-t-transparent rounded-full"
                        />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </>
        )}

        {view === "moments" && (
          <>
            {renderHeader("互动瞬间", "分角色管理你的心动记忆", true)}

            <div className="space-y-6">
              {momentGroups.length === 0 ? (
                <div className="text-center py-16 text-muted">
                  <Bookmark size={48} className="mx-auto mb-4 opacity-50" />
                  <p>还没有保存的互动瞬间</p>
                  <p className="text-xs mt-2">在聊天中点击消息气泡可以保存记忆瞬间</p>
                </div>
              ) : (
                momentGroups.map(([characterId, group]) => (
                  <div key={characterId} className="bg-surface rounded-2xl border border-divider shadow-sm overflow-hidden">
                    <button
                      onClick={() => setExpandedChar((prev) => (prev === characterId ? null : characterId))}
                      className="w-full flex items-center space-x-3 p-5 hover:bg-page transition-colors"
                    >
                      <img
                        src={group.avatar || ""}
                        alt={group.name}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 text-left">
                        <h3 className="font-bold text-body">{group.name}</h3>
                        <p className="text-xs text-muted">{group.items.length} 个互动瞬间</p>
                      </div>
                      {expandedChar === characterId ? <ChevronDown size={18} className="text-muted" /> : <ChevronRight size={18} className="text-muted" />}
                    </button>

                    <AnimatePresence>
                      {expandedChar === characterId && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-4 space-y-3 border-t border-divider">
                            {group.items.map((moment) => (
                              <div key={moment.id} className="flex items-start space-x-3 py-3 border-b border-divider last:border-0">
                                <div className="p-2 bg-violet-50 rounded-lg shrink-0 mt-0.5">
                                  <MessageSquare size={14} className="text-violet-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-3">
                                    <h4 className="text-sm font-medium text-body">{moment.title}</h4>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleFavorite(moment.id)}
                                        disabled={togglingFavorite === moment.id || deletingMoment === moment.id}
                                        className={cn(
                                          "p-1 rounded-full transition-colors disabled:opacity-60",
                                          moment.is_favorited
                                            ? "text-rose-500"
                                            : "text-muted hover:text-rose-400 hover:bg-rose-50"
                                        )}
                                        title={moment.is_favorited ? "取消标记" : "标记置顶"}
                                      >
                                        <Heart size={16} className={cn(moment.is_favorited && "fill-current")} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openDeleteMomentDialog(moment.id, moment.title)}
                                        disabled={deletingMoment === moment.id || togglingFavorite === moment.id}
                                        className="p-1 rounded-full text-muted hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-60"
                                        title="删除互动瞬间"
                                      >
                                        {deletingMoment === moment.id ? (
                                          <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ repeat: Infinity, duration: 1 }}
                                            className="w-4 h-4 border-2 border-red-300 border-t-transparent rounded-full"
                                          />
                                        ) : (
                                          <Trash2 size={16} />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-xs text-secondary mt-1 line-clamp-2">{moment.summary}</p>
                                  <div className="flex items-center space-x-3 mt-2 text-[11px] text-muted">
                                    <span className="flex items-center">
                                      <Clock size={10} className="mr-1" />
                                      {new Date(moment.created_at).toLocaleDateString("zh-CN", {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                    <span>{moment.message_count} 条消息</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {view === "editProfile" && (
          <>
            {renderHeader("编辑资料", "修改个人信息与内容偏好", true)}

            <div className="space-y-6">
              <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                <h3 className="font-bold text-body mb-1">我的ID</h3>
                <p className="text-sm text-muted font-mono">{profile?.display_id || "—"}</p>
              </div>

              <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                <h3 className="font-bold text-body mb-3">昵称</h3>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={editNickname}
                    onChange={(e) => setEditNickname(e.target.value)}
                    maxLength={20}
                    className="flex-1 bg-surface-alt border border-divider rounded-2xl px-4 py-3 text-body focus:ring-2 focus:ring-focus-ring transition-all"
                    placeholder="输入昵称"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNickname}
                    disabled={savingProfile || !editNickname.trim()}
                    className="px-5 py-3 rounded-2xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {savingProfile ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>

              <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                <h3 className="font-bold text-body mb-1">我的对话设定</h3>
                <p className="text-sm text-secondary mb-4">个性化你的对话体验</p>
                <div className="space-y-1">
                  {CONVERSATION_SETTINGS.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center space-x-3 px-4 py-3.5 rounded-2xl text-secondary"
                    >
                      <item.icon size={18} className="shrink-0 opacity-40" />
                      <span className="flex-1 text-sm">{item.label}</span>
                      <span className="text-xs text-muted">即将上线</span>
                      <ChevronRight size={16} className="opacity-30" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-body">内容偏好</h3>
                  <span className="text-xs text-muted">仅自己可见</span>
                </div>

                <div className="mt-4">
                  <p className="text-sm text-secondary mb-3">选择你的性别</p>
                  <div className="flex gap-3">
                    {(["男生", "女生"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setEditGender(g)}
                        className={cn(
                          "px-5 py-2.5 rounded-full text-sm font-medium transition-colors border",
                          editGender === g
                            ? "bg-stone-900 text-white border-stone-900"
                            : "bg-surface-alt text-secondary border-divider hover:text-body"
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <p className="text-sm text-secondary mb-1">选择你的喜好</p>
                  <p className="text-xs text-muted mb-3">至少选4个</p>
                  <div className="flex flex-wrap gap-2.5">
                    {CONTENT_TAGS.map((tag) => {
                      const selected = editTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleContentTag(tag)}
                          className={cn(
                            "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                            selected
                              ? "bg-stone-900 text-white border-stone-900"
                              : "bg-surface-alt text-secondary border-divider hover:text-body"
                          )}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSavePreferences}
                    disabled={savingPreferences || editTags.length < 4}
                    className="min-w-[124px] px-5 py-3 rounded-2xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                  >
                    {savingPreferences ? "保存中..." : "确认"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {view === "membership" && (
          <>
            {renderHeader("会员中心", "解锁更多专属特权", true)}

            <div className="space-y-6">
              <div className="rounded-3xl bg-gradient-to-br from-amber-300 via-yellow-300 to-amber-400 p-6 shadow-lg relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="text-3xl font-black text-amber-900 tracking-wide">VIP</h2>
                  <p className="text-sm text-amber-800/70 mt-1">尊享会员特权</p>
                </div>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-6xl opacity-30 select-none">😎🐱</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {VIP_BENEFITS.map((benefit) => (
                  <div
                    key={benefit.title}
                    className={cn(
                      "rounded-2xl p-4 border",
                      benefit.highlighted
                        ? "bg-amber-50 border-amber-200"
                        : "bg-surface border-divider"
                    )}
                  >
                    <h4 className={cn(
                      "text-sm font-bold",
                      benefit.highlighted ? "text-amber-900" : "text-body"
                    )}>
                      {benefit.title}
                    </h4>
                    <p className={cn(
                      "text-xs mt-1",
                      benefit.highlighted ? "text-amber-700/70" : "text-secondary"
                    )}>
                      {benefit.desc}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                <div className="grid grid-cols-3 gap-3">
                  {VIP_PLANS.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlan(plan.id)}
                      className={cn(
                        "relative rounded-2xl border-2 p-4 text-center transition-colors",
                        selectedPlan === plan.id
                          ? "border-amber-400 bg-amber-50"
                          : "border-divider bg-surface-alt hover:border-divider-strong"
                      )}
                    >
                      {plan.tag && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                          {plan.tag}
                        </span>
                      )}
                      <p className="text-xs text-secondary mt-1">{plan.label}</p>
                      <p className="text-2xl font-black text-heading mt-1">
                        <span className="text-sm align-top">¥</span>{plan.price}
                      </p>
                      <p className="text-xs text-muted line-through mt-0.5">¥{plan.originalPrice}</p>
                    </button>
                  ))}
                </div>

                <p className="text-xs text-muted text-center mt-4">
                  {selectedPlan === "monthly_sub"
                    ? "到期按 ¥25/月 自动续费，可随时取消"
                    : "一次性购买，到期不自动续费"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => showToast("支付功能开发中，敬请期待")}
                className="w-full py-4 rounded-2xl bg-stone-900 text-white text-lg font-bold hover:bg-stone-800 transition-colors"
              >
                立即开通
              </button>

              <p className="text-xs text-muted text-center">
                已阅读同意 猫箱会员协议与续费条款
              </p>
            </div>
          </>
        )}

        {view === "settings" && (
          <>
            {renderHeader("应用设置", "配置主动消息与角色偏好", true)}

            <div className="space-y-6">
              <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-body">主动消息</h3>
                    <p className="text-sm text-secondary mt-1">角色会在设定时间主动找你聊天</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProactiveEnabled((prev) => !prev)}
                    className={cn(
                      "relative w-14 h-8 rounded-full transition-colors",
                      proactiveEnabled ? "bg-stone-900" : "bg-stone-300"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow-sm transition-transform",
                        proactiveEnabled && "translate-x-6"
                      )}
                    />
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {proactiveEnabled && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="space-y-6"
                  >
                    <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                      <h3 className="font-bold text-body">偏好类型</h3>
                      <p className="text-sm text-secondary mt-1 mb-4">可以多选，选中的类型才会触发</p>
                      <div className="flex flex-wrap gap-3">
                        {SETTINGS_TYPES.map((type) => {
                          const selected = proactiveTypes.includes(type.id);
                          return (
                            <button
                              key={type.id}
                              type="button"
                              onClick={() => toggleProactiveType(type.id)}
                              className={cn(
                                "px-4 py-2.5 rounded-2xl text-sm font-medium transition-colors border",
                                selected
                                  ? "bg-stone-900 text-white border-stone-900"
                                  : "bg-surface-alt text-secondary border-divider hover:text-body"
                              )}
                            >
                              {type.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                      <h3 className="font-bold text-body">入睡时间</h3>
                      <p className="text-sm text-secondary mt-1 mb-4">选择“睡前陪伴”时会在这个时间触发</p>
                      <input
                        type="time"
                        value={minutesToTimeValue(proactiveBedtimeMinutes)}
                        onChange={(event) => setProactiveBedtimeMinutes(timeValueToMinutes(event.target.value))}
                        className="w-full max-w-[220px] bg-surface-alt border border-divider rounded-2xl px-4 py-3 text-body focus:ring-2 focus:ring-focus-ring transition-all"
                      />
                    </div>

                    <div className="bg-surface rounded-3xl border border-divider p-6 shadow-sm">
                      <h3 className="font-bold text-body">角色</h3>
                      <p className="text-sm text-secondary mt-1 mb-4">仅显示已建联角色；选中的角色都会参与主动触达</p>

                      {connectedRoles.length === 0 ? (
                        <div className="rounded-2xl bg-surface-alt px-4 py-6 text-sm text-muted text-center">
                          还没有已建联角色，先去和角色真正聊几句吧。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {connectedRoles.map((role) => {
                            const selected = proactiveCharacterIds.includes(role.characterId);
                            return (
                              <button
                                key={role.characterId}
                                type="button"
                                onClick={() => toggleProactiveCharacter(role.characterId, role.isSilenced)}
                                className={cn(
                                  "w-full rounded-2xl border px-4 py-3 flex items-center space-x-3 text-left transition-colors",
                                  selected ? "border-stone-900 bg-stone-50" : "border-divider bg-surface-alt hover:border-divider-strong"
                                )}
                              >
                                <img
                                  src={role.avatarUrl}
                                  alt={role.name}
                                  className="w-11 h-11 rounded-full object-cover shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-body">{role.name}</span>
                                    {role.isSilenced && (
                                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700">
                                        已静默
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-secondary mt-1">
                                    {role.isSilenced ? "取消后重新选中可恢复主动触达" : "已建联，可加入主动消息名单"}
                                  </p>
                                </div>
                                <div
                                  className={cn(
                                    "w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                                    selected ? "bg-stone-900 border-stone-900 text-white" : "border-divider text-transparent"
                                  )}
                                >
                                  <Check size={14} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                  </motion.div>
                )}
              </AnimatePresence>

              {!proactiveEnabled && (
                <div className="rounded-3xl bg-surface-alt border border-divider px-5 py-4 text-sm text-secondary">
                  关闭后不会再收到角色的主动消息；点击下方按钮保存即可生效。
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="min-w-[124px] px-5 py-3 rounded-2xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                >
                  {savingSettings ? "保存中..." : "保存设置"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {deleteDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => {
              if (!isDeleteSubmitting) setDeleteDialog(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-md rounded-3xl bg-surface border border-divider shadow-2xl p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-5">
                <Trash2 size={22} />
              </div>

              <h3 className="text-xl font-bold text-heading mb-2">
                {deleteDialog.type === "character" ? "删除角色" : "删除互动瞬间"}
              </h3>
              <p className="text-body text-sm leading-relaxed">确定删除「{deleteDialog.name}」？</p>
              <p className="text-secondary text-sm leading-relaxed mt-2">{deleteDialog.description}</p>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteDialog(null)}
                  disabled={isDeleteSubmitting}
                  className="px-4 py-2.5 rounded-xl bg-surface-alt text-secondary hover:text-body transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleteSubmitting}
                  className="min-w-[104px] px-4 py-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  {isDeleteSubmitting ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full"
                    />
                  ) : (
                    "确认删除"
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
