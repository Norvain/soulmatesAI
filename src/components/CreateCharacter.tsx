import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, ArrowLeft, Image as ImageIcon, Loader2, RefreshCw, X, Wand2 } from "lucide-react";
import { createCharacter, generateAvatar, generateCharacterFromTags } from "../lib/api";
import { cn } from "../lib/utils";
import { useToast } from "../lib/toast-context";

// ─── Tag Library ────────────────────────────────────────────────────

interface TagCategory {
  label: string;
  color: string;
  tags: string[];
}

const TAG_CATEGORIES: TagCategory[] = [
  {
    label: "性别",
    color: "bg-pink-100 text-pink-700 border-pink-200",
    tags: [
      "男生", "女生", "中性", "少年", "少女",
      "大叔", "大姐姐", "弟弟", "妹妹", "姐姐",
      "哥哥", "小奶狗", "小狼狗",
    ],
  },
  {
    label: "性格",
    color: "bg-violet-100 text-violet-700 border-violet-200",
    tags: [
      "温柔", "冷酷", "高冷", "活泼", "傲娇",
      "毒舌", "腹黑", "呆萌", "病娇", "暴躁",
      "沉稳", "体贴", "霸道", "害羞", "忠犬",
      "话少", "话痨", "浪漫", "理智", "感性",
      "调皮", "正经", "闷骚", "洒脱", "占有欲强",
    ],
  },
  {
    label: "背景",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    tags: [
      "校园", "都市", "古风", "末日", "奇幻",
      "豪门", "青梅竹马", "邻家", "异国",
      "同事", "网恋", "暗恋", "破镜重圆",
      "师生", "竹马竹马", "平行世界", "星际",
    ],
  },
  {
    label: "职业",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    tags: [
      "医生", "老师", "CEO", "画师", "音乐家",
      "作家", "程序员", "厨师", "侦探", "军人",
      "模特", "律师", "记者", "花店老板",
      "咖啡师", "摄影师", "心理咨询师", "练习生",
      "科学家", "剑客", "魔法师",
    ],
  },
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ─── Jar SVG Icon ───────────────────────────────────────────────────

function JarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="20" width="36" height="36" rx="8" fill="currentColor" opacity="0.15" />
      <rect x="14" y="20" width="36" height="36" rx="8" stroke="currentColor" strokeWidth="2.5" />
      <rect x="20" y="12" width="24" height="10" rx="4" fill="currentColor" opacity="0.25" />
      <rect x="20" y="12" width="24" height="10" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="26" cy="36" r="3" fill="currentColor" opacity="0.4" />
      <circle cx="38" cy="32" r="2.5" fill="currentColor" opacity="0.35" />
      <circle cx="32" cy="42" r="3.5" fill="currentColor" opacity="0.3" />
      <path d="M28 28l2-4M36 26l1-3M32 29l0-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

// ─── Component ──────────────────────────────────────────────────────

interface CreateCharacterProps {
  onBack: () => void;
  onCreated: (characterId: string) => void;
}

export default function CreateCharacter({ onBack, onCreated }: CreateCharacterProps) {
  const { showToast } = useToast();
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isGeneratingFromTags, setIsGeneratingFromTags] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    overview: "",
    persona: "",
    greeting: "",
    avatarUrl: "",
  });

  // Jar state
  const [jarTags, setJarTags] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const displayedTags = useMemo(() => {
    return TAG_CATEGORIES.map((cat) => ({
      ...cat,
      picked: pickRandom(cat.tags, 1)[0],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  const handleAddToJar = (tag: string) => {
    if (jarTags.includes(tag)) return;
    if (jarTags.length >= 6) return;
    setJarTags((prev) => [...prev, tag]);
  };

  const handleRemoveFromJar = (tag: string) => {
    setJarTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleGenerateFromJar = async () => {
    if (jarTags.length === 0) return;
    setIsGeneratingFromTags(true);
    try {
      const result = await generateCharacterFromTags(jarTags);
      setFormData((prev) => ({
        ...prev,
        name: result.name || prev.name,
        overview: result.overview || prev.overview,
        persona: result.persona || prev.persona,
        greeting: result.greeting || prev.greeting,
      }));
    } catch (error) {
      console.error("Failed to generate from tags:", error);
      showToast("AI 生成失败，请重试。");
    } finally {
      setIsGeneratingFromTags(false);
    }
  };

  const handleGenerateAvatar = async () => {
    if (!formData.persona && !formData.overview) {
      showToast("请先输入角色设定或简介，以便指导头像生成。", "warning");
      return;
    }
    setIsGeneratingAvatar(true);
    try {
      const { url } = await generateAvatar({
        name: formData.name,
        persona: formData.persona,
        overview: formData.overview,
      });
      setFormData((prev) => ({ ...prev, avatarUrl: url }));
    } catch (error) {
      console.error("Failed to generate avatar:", error);
      showToast("生成头像失败，请重试。");
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.persona) return;
    setIsSaving(true);
    try {
      const { id } = await createCharacter(formData);
      onCreated(id);
    } catch (error) {
      console.error("Failed to save character:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-page p-10">
      <div className="max-w-4xl mx-auto">
        <button onClick={onBack} className="flex items-center text-secondary hover:text-body transition-colors mb-8">
          <ArrowLeft size={20} className="mr-2" />
          返回发现
        </button>

        {/* ─── Idea Jar Section ─── */}
        <div className="bg-surface rounded-3xl p-8 shadow-sm border border-divider mb-8">
          <div className="flex items-center space-x-3 mb-6">
            <JarIcon className="w-8 h-8 text-violet-500" />
            <h2 className="text-xl font-bold text-heading">想法储存罐</h2>
            <span className="text-xs text-muted ml-2">选择词条，让 AI 帮你生成角色</span>
          </div>

          {/* Tag display area */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {displayedTags.map((cat) => (
              <motion.button
                key={cat.label + "-" + cat.picked}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleAddToJar(cat.picked)}
                disabled={jarTags.includes(cat.picked) || jarTags.length >= 6}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium border transition-all cursor-pointer",
                  cat.color,
                  jarTags.includes(cat.picked) && "opacity-40 cursor-not-allowed",
                  jarTags.length >= 6 && !jarTags.includes(cat.picked) && "opacity-40 cursor-not-allowed"
                )}
              >
                #{cat.picked}
                <span className="ml-1.5 text-[10px] opacity-60">{cat.label}</span>
              </motion.button>
            ))}
            <button
              onClick={handleRefresh}
              className="p-2.5 rounded-full bg-surface-alt text-secondary hover:bg-divider-strong hover:text-body transition-colors"
              title="换一批"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Jar area */}
          <div className="relative bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border-2 border-dashed border-violet-200 p-5 min-h-[100px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <JarIcon className="w-5 h-5 text-violet-400" />
                <span className="text-xs font-medium text-violet-500">
                  储存罐 ({jarTags.length}/6)
                </span>
              </div>
              {jarTags.length > 0 && (
                <button
                  onClick={() => setJarTags([])}
                  className="text-xs text-violet-400 hover:text-violet-600 transition-colors"
                >
                  清空
                </button>
              )}
            </div>

            <AnimatePresence>
              {jarTags.length === 0 ? (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm text-violet-300 text-center py-3"
                >
                  点击上方词条添加到储存罐中...
                </motion.p>
              ) : (
                <motion.div className="flex flex-wrap gap-2" layout>
                  {jarTags.map((tag) => {
                    const cat = TAG_CATEGORIES.find((c) => c.tags.includes(tag));
                    return (
                      <motion.span
                        key={tag}
                        layout
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        className={cn(
                          "inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border",
                          cat?.color || "bg-violet-100 text-violet-700 border-violet-200"
                        )}
                      >
                        #{tag}
                        <button
                          onClick={() => handleRemoveFromJar(tag)}
                          className="ml-1.5 hover:opacity-70 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </motion.span>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {jarTags.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex justify-center"
              >
                <button
                  onClick={handleGenerateFromJar}
                  disabled={isGeneratingFromTags}
                  className="flex items-center space-x-2 px-6 py-2.5 bg-violet-600 text-white rounded-full text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-50 shadow-lg shadow-violet-200"
                >
                  {isGeneratingFromTags ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Wand2 size={16} />
                  )}
                  <span>{isGeneratingFromTags ? "AI 生成中..." : "AI 自动补全角色"}</span>
                </button>
              </motion.div>
            )}
          </div>
        </div>

        {/* ─── Character Form ─── */}
        <div className="bg-surface rounded-3xl p-10 shadow-sm border border-divider">
          <h1 className="text-3xl font-bold text-heading mb-2">创建专属伴侣</h1>
          <p className="text-secondary mb-10">定义你新 AI 伴侣的性格、外貌和行为方式。</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="col-span-1 flex flex-col items-center space-y-4">
              <div className="w-48 h-48 rounded-3xl overflow-hidden bg-surface-alt border-2 border-dashed border-divider-strong flex items-center justify-center relative">
                {formData.avatarUrl ? (
                  <img src={formData.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={48} className="text-subtle" />
                )}
                {isGeneratingAvatar && (
                  <div className="absolute inset-0 bg-surface/80 flex items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-body" />
                  </div>
                )}
              </div>
              <button
                onClick={handleGenerateAvatar}
                disabled={isGeneratingAvatar}
                className="flex items-center justify-center w-full py-3 px-4 bg-surface-alt hover:bg-divider-strong text-body rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Sparkles size={16} className="mr-2" />
                AI 生成头像
              </button>
              <p className="text-xs text-muted text-center px-4">先填写角色设定，可以获得更好的头像生成效果。</p>
            </div>

            <div className="col-span-2 space-y-6">
              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">角色名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：林星"
                  className="w-full bg-input-bg border border-input-border rounded-xl py-3 px-4 text-body focus:ring-2 focus:ring-focus-ring transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">简介 (一句话概括)</label>
                <input
                  type="text"
                  value={formData.overview}
                  onChange={(e) => setFormData({ ...formData, overview: e.target.value })}
                  placeholder="例如：一个机智幽默、热爱科幻的朋友。"
                  className="w-full bg-input-bg border border-input-border rounded-xl py-3 px-4 text-body focus:ring-2 focus:ring-focus-ring transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">详细性格与规则</label>
                <textarea
                  value={formData.persona}
                  onChange={(e) => setFormData({ ...formData, persona: e.target.value })}
                  placeholder="描述他们的说话方式、关心什么，以及应该如何对待你..."
                  rows={4}
                  className="w-full bg-input-bg border border-input-border rounded-xl py-3 px-4 text-body focus:ring-2 focus:ring-focus-ring transition-all resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">开场白 (第一句话)</label>
                <input
                  type="text"
                  value={formData.greeting}
                  onChange={(e) => setFormData({ ...formData, greeting: e.target.value })}
                  placeholder="例如：你终于来了，等你好久了。"
                  className="w-full bg-input-bg border border-input-border rounded-xl py-3 px-4 text-body focus:ring-2 focus:ring-focus-ring transition-all"
                />
              </div>
              <div className="pt-6 border-t border-divider flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !formData.name || !formData.persona}
                  className="bg-btn text-btn-text px-8 py-3 rounded-xl font-bold hover:bg-btn-hover transition-colors disabled:opacity-50 flex items-center"
                >
                  {isSaving ? <Loader2 size={20} className="animate-spin mr-2" /> : null}
                  创建伴侣
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
