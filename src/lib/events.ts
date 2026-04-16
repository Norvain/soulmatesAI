export interface CharacterEvent {
  id: string;
  title: string;
  description: string;
  requiredIntimacy: number;
  imageUrl: string;
  triggerPrompt: string;
}

export const CHARACTER_EVENTS: Record<string, CharacterEvent[]> = {
  preset_lintang: [
    {
      id: "lintang_300",
      title: "雨里的纸箱小猫",
      description: "雨天便利店屋檐下，她第一次愿意把狼狈留给你看。",
      requiredIntimacy: 300,
      imageUrl: "https://picsum.photos/seed/relationship_lintang_300/400/300?blur=2",
      triggerPrompt: "（触发事件：雨里的纸箱小猫）林棠，外面下好大的雨，你怎么一个人在便利店门口？"
    },
    {
      id: "lintang_600",
      title: "改稿夜的双人灯",
      description: "深夜工作室的暖黄灯下，她开始习惯和你并肩解决难题。",
      requiredIntimacy: 600,
      imageUrl: "https://picsum.photos/seed/relationship_lintang_600/400/300?blur=2",
      triggerPrompt: "（触发事件：改稿夜的双人灯）林棠，工作室的灯还亮着，你还在改稿吗？"
    },
    {
      id: "lintang_900",
      title: "把未来画成同一页",
      description: "她终于把那句绕着说的话，认真留给了你。",
      requiredIntimacy: 900,
      imageUrl: "https://picsum.photos/seed/relationship_lintang_900/400/300?blur=2",
      triggerPrompt: "（触发事件：把未来画成同一页）林棠，毕业展结束了，你怎么一个人在天台？"
    }
  ],
  preset_guchengze: [
    {
      id: "guchengze_300",
      title: "雨夜边界",
      description: "他第一次把「以后先找我」说成规则。",
      requiredIntimacy: 300,
      imageUrl: "https://picsum.photos/seed/relationship_guchengze_300/400/300?blur=2",
      triggerPrompt: "（触发事件：雨夜边界）顾总，我准备叫车回去了，这雨太大了。"
    },
    {
      id: "guchengze_600",
      title: "只准站在我这边",
      description: "他第一次把偏心做成了明目张胆的原则。",
      requiredIntimacy: 600,
      imageUrl: "https://picsum.photos/seed/relationship_guchengze_600/400/300?blur=2",
      triggerPrompt: "（触发事件：只准站在我这边）顾承泽，今天会议上的事……谢谢你。"
    },
    {
      id: "guchengze_900",
      title: "把未来交给你",
      description: "这一次，他不再只说保护，而是把选择权交给你。",
      requiredIntimacy: 900,
      imageUrl: "https://picsum.photos/seed/relationship_guchengze_900/400/300?blur=2",
      triggerPrompt: "（触发事件：把未来交给你）顾承泽，你让我来办公室，有什么事吗？"
    }
  ],
  preset_shenzhiyi: [
    {
      id: "shenzhiyi_300",
      title: "雨夜边界线",
      description: "她把热茶和边界一起递给你，也把第一次偏袒留给了你。",
      requiredIntimacy: 300,
      imageUrl: "https://picsum.photos/seed/relationship_shenzhiyi_300/400/300?blur=2",
      triggerPrompt: "（触发事件：雨夜边界线）知意，你怎么还没走？"
    },
    {
      id: "shenzhiyi_600",
      title: "只给你留的例外",
      description: "她把你拉进真正的作战核心，也把偏爱放到了台面上。",
      requiredIntimacy: 600,
      imageUrl: "https://picsum.photos/seed/relationship_shenzhiyi_600/400/300?blur=2",
      triggerPrompt: "（触发事件：只给你留的例外）知意，你说你需要我，发生什么了？"
    },
    {
      id: "shenzhiyi_900",
      title: "把你写进未来",
      description: "她第一次不再只给你照顾，而是给出长期的答案。",
      requiredIntimacy: 900,
      imageUrl: "https://picsum.photos/seed/relationship_shenzhiyi_900/400/300?blur=2",
      triggerPrompt: "（触发事件：把你写进未来）知意，发布会结束了，你找我来后台做什么？"
    }
  ],
  default: [
    {
      id: "def_300",
      title: "初次交心",
      description: "打破陌生的隔阂，分享彼此的故事。",
      requiredIntimacy: 300,
      imageUrl: "https://picsum.photos/seed/def_event1/400/300?blur=2",
      triggerPrompt: "（触发事件：初次交心）我们认识有一阵子了，能跟我讲讲你最难忘的一段经历吗？"
    },
    {
      id: "def_600",
      title: "特别的陪伴",
      description: "共同度过一个难忘的时刻。",
      requiredIntimacy: 600,
      imageUrl: "https://picsum.photos/seed/def_event2/400/300?blur=2",
      triggerPrompt: "（触发事件：特别的陪伴）今天对我来说是个特别的日子，你能陪我一起度过吗？"
    },
    {
      id: "def_900",
      title: "灵魂契合",
      description: "无需多言，便能懂你的心意。",
      requiredIntimacy: 900,
      imageUrl: "https://picsum.photos/seed/def_event3/400/300?blur=2",
      triggerPrompt: "（触发事件：灵魂契合）我觉得我们现在有一种默契，你觉得我们之间的关系现在是什么样的？"
    }
  ]
};
