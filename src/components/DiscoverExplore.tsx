import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Moon, Zap, Crown, ChevronRight, RefreshCw } from "lucide-react";
import { searchDiscover, getDiscoverRanking, selectCharacter } from "../lib/api";

interface Character {
  id: string;
  characterId?: string;
  name: string;
  avatar_url?: string;
  avatarUrl?: string;
  overview: string;
  persona: string;
  greeting?: string;
  is_preset?: boolean;
  msg_count?: number;
}

const CATEGORIES = [
  { label: "推荐", value: "recommend" },
  { label: "治愈", value: "healing" },
  { label: "校园", value: "campus" },
  { label: "都市", value: "urban" },
  { label: "古风", value: "ancient" },
  { label: "奇幻", value: "fantasy" },
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  healing: ["温柔", "治愈", "暖", "共情", "陪伴", "柔软"],
  campus: ["学生", "毕业", "插画", "校园", "同学"],
  urban: ["都市", "CEO", "总裁", "总监", "职场", "公司", "品牌"],
  ancient: ["古风", "江湖", "仙", "侠"],
  fantasy: ["奇幻", "魔法", "异世界", "精灵"],
};

const SCENES = [
  {
    icon: Moon,
    title: "睡前陪伴",
    subtitle: "助眠引导",
    gradient: "from-indigo-600/80 to-purple-700/80",
  },
  {
    icon: Zap,
    title: "压力释放",
    subtitle: "情绪急救",
    gradient: "from-rose-500/80 to-orange-500/80",
  },
];

const PRESET_CHARACTERS: Character[] = [
  { id: "preset_lintang", name: "林棠", avatar_url: "/avatars/lintang-avatar.png", persona: "甜、暖、机灵、会撒娇、敏感、容易共情、偶尔嘴硬", overview: "邻家小妹，插画系应届毕业生。清爽、元气、亲近感强。", greeting: "那个……你家有盐吗？我煮汤煮到一半才发现用完了。", is_preset: true },
  { id: "preset_guchengze", name: "顾承泽", avatar_url: "/avatars/guchengze-avatar.png", persona: "强势、果断、占有欲、护短、克制、低情绪外显、高标准", overview: "霸道总裁，科技公司创始人兼 CEO。冷峻、利落、压迫感强。", greeting: "别怕，最多几分钟。", is_preset: true },
  { id: "preset_shenzhiyi", name: "沈知意", avatar_url: "/avatars/shenzhiyi-avatar.png", persona: "清醒、自律、会照顾人、边界感强、慕强、偶尔嘴毒、内里柔软", overview: "都市丽人，品牌策略总监。干练、漂亮、有分寸感。", greeting: "这把伞是我的。不过你要是现在冲出去，大概会淋得很狼狈。", is_preset: true },
];

interface DiscoverExploreProps {
  onSelectCharacter: (character: any) => void;
  onViewProfile?: (character: any) => void;
}

export default function DiscoverExplore({ onSelectCharacter, onViewProfile }: DiscoverExploreProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Character[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeCategory, setActiveCategory] = useState("recommend");
  const [ranking, setRanking] = useState<Character[]>([]);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getDiscoverRanking()
      .then(setRanking)
      .catch(console.error);
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchDiscover(q);
        setSearchResults(results);
      } catch { setSearchResults([]); }
      setIsSearching(false);
    }, 400);
  }, []);

  const handleSelect = async (character: Character) => {
    try {
      const charId = character.id;
      const { chatId } = await selectCharacter(charId);
      onSelectCharacter({
        ...character,
        id: chatId,
        characterId: charId,
        avatarUrl: character.avatar_url || character.avatarUrl,
      });
    } catch (e) {
      console.error("Failed to select character:", e);
    }
  };

  const filteredPresets = activeCategory === "recommend"
    ? PRESET_CHARACTERS
    : PRESET_CHARACTERS.filter(c => {
        const keywords = CATEGORY_KEYWORDS[activeCategory] || [];
        const text = `${c.persona} ${c.overview}`;
        return keywords.some(k => text.includes(k));
      });

  const visibleCategories = showAllCategories ? CATEGORIES : CATEGORIES.slice(0, 4);

  return (
    <div className="flex-1 overflow-y-auto bg-page dark:bg-gradient-to-b dark:from-[#0f0e1a] dark:via-[#151427] dark:to-[#1a1830]">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8 pb-24 md:pb-12">

        {/* Header */}
        <h1 className="text-2xl md:text-3xl font-bold text-heading mb-4 md:mb-6 tracking-tight">角色探索</h1>

        {/* Search Bar */}
        <div className="relative mb-6">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="寻找推荐角色..."
            className="w-full bg-input-bg dark:bg-white/10 backdrop-blur-sm border border-divider dark:border-white/10 rounded-2xl py-3.5 pl-11 pr-4 text-base text-body dark:text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
        </div>

        {/* Search Results */}
        <AnimatePresence>
          {searchQuery.trim() && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              {isSearching ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={20} className="text-indigo-400 animate-spin" />
                  <span className="ml-2 text-muted text-sm">搜索中...</span>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-2">
                  {searchResults.map(char => (
                    <motion.div
                      key={char.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => handleSelect(char)}
                      className="flex items-center space-x-3 p-3 bg-surface-alt dark:bg-white/5 rounded-xl cursor-pointer hover:bg-divider-strong dark:hover:bg-white/10 transition-colors"
                    >
                      <img src={char.avatar_url} alt={char.name} className="w-10 h-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                      <div className="flex-1 min-w-0">
                        <p className="text-body text-sm font-medium">{char.name}</p>
                        <p className="text-muted text-xs truncate">{char.overview}</p>
                      </div>
                      <ChevronRight size={16} className="text-secondary shrink-0" />
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-secondary text-sm">未找到相关角色</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Category Tags */}
        <div className="flex items-center space-x-2 mb-8 flex-wrap gap-y-2">
          {visibleCategories.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeCategory === cat.value
                  ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30"
                  : "bg-surface-alt dark:bg-white/10 text-secondary dark:text-stone-300 hover:bg-divider-strong dark:hover:bg-white/15"
              }`}
            >
              {cat.label}
            </button>
          ))}
          {!showAllCategories && CATEGORIES.length > 4 && (
            <button
              onClick={() => setShowAllCategories(true)}
              className="w-9 h-9 rounded-full bg-surface-alt dark:bg-white/10 text-secondary dark:text-stone-300 hover:bg-divider-strong dark:hover:bg-white/15 flex items-center justify-center text-sm transition-all"
            >
              ···
            </button>
          )}
        </div>

        {/* Category Character Results */}
        {filteredPresets.length > 0 && !searchQuery.trim() && (
          <div className="grid grid-cols-2 gap-3 mb-8">
            {filteredPresets.map(char => (
              <motion.div
                key={char.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleSelect(char)}
                className="relative rounded-2xl overflow-hidden cursor-pointer group aspect-[4/5]"
              >
                <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="text-white font-bold text-lg">{char.name}</h3>
                  <p className="text-stone-300 text-xs mt-1 line-clamp-1">{char.overview}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {filteredPresets.length === 0 && activeCategory !== "recommend" && !searchQuery.trim() && (
          <div className="text-center py-8 mb-8 text-secondary text-sm bg-surface-alt dark:bg-white/5 rounded-2xl">
            该分类下暂无角色，敬请期待
          </div>
        )}

        {/* Scene Entry */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-heading mb-4">场景入口</h2>
          <div className="grid grid-cols-2 gap-3">
            {SCENES.map(scene => (
              <motion.div
                key={scene.title}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`relative bg-gradient-to-br ${scene.gradient} rounded-2xl p-5 cursor-pointer overflow-hidden min-h-[100px]`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
                <scene.icon size={28} className="text-white/90 mb-3" />
                <h3 className="text-white font-bold text-base">{scene.title}</h3>
                <p className="text-white/60 text-xs mt-1">{scene.subtitle}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Character Ranking */}
        <section className="mb-12">
          <div className="flex items-center space-x-2 mb-4">
            <Crown size={18} className="text-amber-400" />
            <h2 className="text-lg font-bold text-heading">本周角色榜</h2>
          </div>

          {ranking.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {ranking.map((char, idx) => (
                <motion.div
                  key={char.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelect(char)}
                  className={`relative rounded-2xl overflow-hidden cursor-pointer group ${idx === 0 ? "col-span-2 aspect-[2/1]" : "aspect-[4/5]"}`}
                >
                  <img
                    src={char.avatar_url}
                    alt={char.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Rank badge */}
                  <div className={`absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? "bg-amber-400 text-amber-900" : idx === 1 ? "bg-stone-300 text-stone-700" : "bg-amber-700 text-amber-200"
                  }`}>
                    {idx + 1}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="text-white font-bold text-lg">{char.name}</h3>
                    <p className="text-stone-300 text-xs mt-1 line-clamp-1">{char.overview}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-secondary text-sm bg-surface-alt dark:bg-white/5 rounded-2xl">
              <Crown size={32} className="mx-auto mb-3 text-subtle" />
              <p>暂无排行数据</p>
              <p className="text-xs mt-1 text-subtle">开始聊天后这里会显示热门角色</p>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
