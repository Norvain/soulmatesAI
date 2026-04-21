import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Plus, Sparkles, Brain } from "lucide-react";
import { getCharacters, selectCharacter } from "../lib/api";

interface Character {
  id: string;
  characterId?: string;
  name: string;
  avatarUrl?: string;
  avatar_url?: string;
  persona: string;
  overview: string;
  greeting: string;
  openingStory?: string;
  opening_story?: string;
  isCustom?: boolean;
  is_custom?: number;
}

const PRESET_CHARACTERS: Character[] = [
  {
    id: "preset_lintang",
    name: "林棠",
    avatarUrl: "/avatars/lintang-avatar.png",
    persona: "甜、暖、机灵、会撒娇、敏感、容易共情、偶尔嘴硬",
    overview: "邻家小妹，插画系应届毕业生。清爽、元气、亲近感强。",
    greeting: "那个……你家有盐吗？我煮汤煮到一半才发现用完了。",
    openingStory: "你搬进这栋旧公寓的第三天，隔壁总在夜里亮起一盏暖黄小灯。有人把外卖袋上的猫画成表情包，把雨伞借给楼下迷路的小孩，也会在凌晨为毕业展赶稿。那晚厨房飘出半锅番茄汤的香气，门铃响了，林棠站在门外，指尖还沾着颜料。打开门前，你们只隔着一堵墙和几次电梯里的点头；打开门后，故事从一勺盐开始。",
  },
  {
    id: "preset_guchengze",
    name: "顾承泽",
    avatarUrl: "/avatars/guchengze-avatar.png",
    persona: "强势、果断、占有欲、护短、克制、低情绪外显、高标准",
    overview: "霸道总裁，科技公司创始人兼 CEO。冷峻、利落、压迫感强。",
    greeting: "别怕，最多几分钟。",
    openingStory: "深夜的写字楼只剩顶层还亮着灯。你被困在故障电梯里，手机电量一点点见底，外面是刚结束融资谈判的顾承泽。他一向冷静到近乎不近人情，却在监控里看见你发白的脸色后，亲自停下会议、扯松领带走向维修间。钢索轻微震动的几分钟里，他的声音比所有警报都稳。那是你第一次知道，这个高高在上的人，护短时会把全世界都挡在门外。",
  },
  {
    id: "preset_shenzhiyi",
    name: "沈知意",
    avatarUrl: "/avatars/shenzhiyi-avatar.png",
    persona: "清醒、自律、会照顾人、边界感强、慕强、偶尔嘴毒、内里柔软",
    overview: "都市丽人，品牌策略总监。干练、漂亮、有分寸感。",
    greeting: "这把伞是我的。不过你要是现在冲出去，大概会淋得很狼狈。",
    openingStory: "暴雨把城市玻璃幕墙洗得发亮，你在品牌发布会后台临时救场，却被突如其来的断电困在一楼门厅。所有人都忙着撤场，只有沈知意撑着一把黑伞站在台阶上，白衬衫袖口一尘不染，眼神清醒得像能看穿所有逞强。她原本最讨厌计划外的麻烦，可那晚，她把伞柄偏向了你。雨声把她的声音压得很低，也让那句提醒显得格外像邀请。",
  }
];

interface DiscoverProps {
  onSelectCharacter: (character: Character) => void;
  onCreateCustom: () => void;
  onViewProfile?: (character: Character) => void;
}

export default function Discover({ onSelectCharacter, onCreateCustom, onViewProfile }: DiscoverProps) {
  const [customCharacters, setCustomCharacters] = useState<Character[]>([]);

  useEffect(() => {
    getCharacters()
      .then((chars) => setCustomCharacters(chars.map(c => ({ ...c, avatarUrl: c.avatar_url || c.avatarUrl }))))
      .catch(console.error);
  }, []);

  const handleSelect = async (character: Character) => {
    try {
      const { chatId } = await selectCharacter(character.id);
      onSelectCharacter({
        ...character,
        id: chatId,
        characterId: character.id,
        avatarUrl: character.avatarUrl || character.avatar_url,
      });
    } catch (e) {
      console.error("Failed to select character:", e);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-page p-4 md:p-10 pb-24 md:pb-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 md:mb-12">
          <h1 className="text-2xl md:text-4xl font-bold text-heading mb-2 md:mb-4 tracking-tight">发现伴侣</h1>
          <p className="text-secondary text-sm md:text-lg">寻找最适合你当前心境的 AI 伴侣。</p>
        </header>

        <section className="mb-10 md:mb-16">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <h2 className="text-lg md:text-xl font-bold text-body">你的专属角色</h2>
            <button
              onClick={onCreateCustom}
              className="flex items-center space-x-2 bg-btn text-btn-text px-3 md:px-4 py-2 rounded-full text-sm font-medium hover:bg-btn-hover transition-colors"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">创建新角色</span>
              <span className="sm:hidden">新建</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {customCharacters.map(char => (
              <CharacterCard key={char.id} character={char} onSelect={() => handleSelect(char)} onViewProfile={onViewProfile ? () => onViewProfile(char) : undefined} />
            ))}
            {customCharacters.length === 0 && (
              <div
                onClick={onCreateCustom}
                className="border-2 border-dashed border-divider-strong rounded-3xl p-6 md:p-8 flex flex-col items-center justify-center text-muted hover:text-secondary hover:border-subtle transition-colors cursor-pointer min-h-[200px] md:min-h-[280px]"
              >
                <Sparkles size={32} className="mb-4" />
                <p className="font-medium">创建你的第一个专属伴侣</p>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg md:text-xl font-bold text-body mb-4 md:mb-6">推荐预设</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {PRESET_CHARACTERS.map(char => (
              <CharacterCard key={char.id} character={char} onSelect={() => handleSelect(char)} onViewProfile={onViewProfile ? () => onViewProfile(char) : undefined} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CharacterCard({ character, onSelect, onViewProfile }: { character: Character; onSelect: () => void | Promise<void>; onViewProfile?: () => void; key?: React.Key }) {
  const avatar = character.avatarUrl || character.avatar_url;
  return (
    <motion.div
      whileHover={{ y: -4 }}
      onClick={onSelect}
      className="bg-surface rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all cursor-pointer border border-divider group"
    >
      <div className="h-40 md:h-48 overflow-hidden relative">
        <img src={avatar} alt={character.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <h3 className="absolute bottom-3 left-4 text-xl md:text-2xl font-bold text-white">{character.name}</h3>
      </div>
      <div className="p-4 md:p-6">
        <div className="flex items-center space-x-3 mb-3">
          <img
            src={avatar}
            alt={character.name}
            className="w-10 h-10 rounded-full object-cover shrink-0 cursor-pointer hover:ring-2 hover:ring-subtle transition-all"
            onClick={(e) => { e.stopPropagation(); onViewProfile?.(); }}
            referrerPolicy="no-referrer"
          />
          <div className="min-w-0">
            <p className="text-secondary text-sm line-clamp-2">{character.overview}</p>
          </div>
        </div>
        <div className="flex items-center text-xs text-muted font-medium uppercase tracking-wider">
          <Brain size={14} className="mr-1.5" />
          <span className="truncate">{character.persona}</span>
        </div>
      </div>
    </motion.div>
  );
}
