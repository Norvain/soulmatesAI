/**
 * Soulmate AI — 自动化 API 集成测试
 *
 * 运行方式: node tests/api-test.mjs
 * 前提: 服务器运行在 http://localhost:3000
 */

const BASE = "http://localhost:3000";
const TEST_PHONE = `1${String(Date.now()).slice(-10)}`;
const TEST_PASSWORD = "Test1234";

let token = "";
let userId = "";
let customCharacterId = "";
let chatId = "";
let presetChatId = "";
let momentId = "";
let interactionMomentId = "";
let userMessageId = "";

const results = [];
let passCount = 0;
let failCount = 0;
let skipCount = 0;

// ─── Helpers ────────────────────────────────────────────────────────

async function api(method, path, body, authToken) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function record(id, name, status, detail = "") {
  results.push({ id, name, status, detail });
  if (status === "PASS") passCount++;
  else if (status === "FAIL") failCount++;
  else skipCount++;
}

async function test(id, name, fn) {
  try {
    await fn();
    record(id, name, "PASS");
  } catch (err) {
    record(id, name, "FAIL", err.message || String(err));
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function skip(id, name, reason) {
  record(id, name, "SKIP", reason);
}

// ─── 1. 注册与登录 ─────────────────────────────────────────────────

await test("L-004", "注册：手机号格式校验", async () => {
  const { status, data } = await api("POST", "/api/auth/register", { phone: "123", password: TEST_PASSWORD });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(data.error?.includes("11"), `Error should mention 11 digits: ${data.error}`);
});

await test("L-006", "注册：密码格式校验", async () => {
  const { status, data } = await api("POST", "/api/auth/register", { phone: "13800000001", password: "ab" });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(data.error?.includes("6-10"), `Error should mention 6-10: ${data.error}`);
});

await test("L-007", "注册：密码含特殊字符", async () => {
  const { status } = await api("POST", "/api/auth/register", { phone: "13800000002", password: "abc@#$%" });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test("L-009", "正常注册", async () => {
  const { status, data } = await api("POST", "/api/auth/register", { phone: TEST_PHONE, password: TEST_PASSWORD });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert(data.token, "Should return token");
  assert(data.user?.id, "Should return user id");
  token = data.token;
  userId = data.user.id;
});

await test("L-010", "重复注册", async () => {
  const { status, data } = await api("POST", "/api/auth/register", { phone: TEST_PHONE, password: TEST_PASSWORD });
  assert(status === 409, `Expected 409, got ${status}`);
  assert(data.error?.includes("已注册"), `Error: ${data.error}`);
});

await test("L-011", "正常登录", async () => {
  const { status, data } = await api("POST", "/api/auth/login", { phone: TEST_PHONE, password: TEST_PASSWORD });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.token, "Should return token");
  token = data.token;
});

await test("L-012", "错误密码登录", async () => {
  const { status } = await api("POST", "/api/auth/login", { phone: TEST_PHONE, password: "WrongPass1" });
  assert(status === 401, `Expected 401, got ${status}`);
});

await test("L-013", "未注册手机号登录", async () => {
  const { status } = await api("POST", "/api/auth/login", { phone: "00000000000", password: "abc123" });
  assert(status === 401, `Expected 401, got ${status}`);
});

await test("L-014", "空字段登录", async () => {
  const { status } = await api("POST", "/api/auth/login", { phone: "", password: "" });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test("AUTH-001", "无Token访问受保护接口", async () => {
  const { status } = await api("GET", "/api/profile");
  assert(status === 401, `Expected 401, got ${status}`);
});

await test("AUTH-002", "无效Token", async () => {
  const { status } = await api("GET", "/api/profile", undefined, "invalid-token");
  assert(status === 401, `Expected 401, got ${status}`);
});

// ─── 2. 新手引导 ───────────────────────────────────────────────────

await test("O-001", "新用户需要引导", async () => {
  const { status, data } = await api("GET", "/api/profile", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.needsOnboarding === true, "New user should need onboarding");
});

await test("O-005", "完成引导：设置昵称和风格", async () => {
  const { status, data } = await api("PUT", "/api/profile", { preferredName: "测试用户", comfortStyle: "倾听" }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("O-005b", "引导后获取Profile", async () => {
  const { status, data } = await api("GET", "/api/profile", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.preferred_name === "测试用户", `Name mismatch: ${data.preferred_name}`);
  assert(data.comfort_style === "倾听", `Style mismatch: ${data.comfort_style}`);
  assert(!data.needsOnboarding, "Should not need onboarding");
});

// ─── 3. 角色创建 ───────────────────────────────────────────────────

await test("C-010", "创建角色：必填校验", async () => {
  const { status } = await api("POST", "/api/characters", { name: "", persona: "" }, token);
  assert(status === 400, `Expected 400, got ${status}`);
});

await test("C-014", "创建角色成功", async () => {
  const { status, data } = await api("POST", "/api/characters", {
    name: "测试角色",
    persona: "温柔体贴、善于倾听",
    overview: "一个温暖的AI伴侣",
    greeting: "你好呀，很高兴认识你！",
  }, token);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert(data.id, "Should return character id");
  assert(data.avatarUrl, "Should return avatar url");
  customCharacterId = data.id;
  chatId = data.id;
});

await test("C-014b", "获取自定义角色列表", async () => {
  const { status, data } = await api("GET", "/api/characters", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
  assert(data.length >= 1, "Should have at least 1 character");
  const found = data.find(c => c.id === customCharacterId);
  assert(found, "Created character should be in list");
  assert(found.name === "测试角色", `Name mismatch: ${found.name}`);
});

// ─── 4. 发现与搜索 ─────────────────────────────────────────────────

await test("D-007", "搜索：有结果", async () => {
  const { status, data } = await api("GET", "/api/discover/search?q=测试角色", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
  assert(data.length >= 1, `Should find character, got ${data.length}`);
});

await test("D-008", "搜索：空关键词返回空", async () => {
  const { status, data } = await api("GET", "/api/discover/search?q=", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data) && data.length === 0, "Empty query should return empty array");
});

await test("D-008b", "搜索：无结果", async () => {
  const { status, data } = await api("GET", "/api/discover/search?q=zzzznonexistent", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data) && data.length === 0, "Should return empty array for nonexistent search");
});

await test("D-013", "排行榜", async () => {
  const { status, data } = await api("GET", "/api/discover/ranking", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

// ─── 5. 对话管理 ───────────────────────────────────────────────────

await test("T-001a", "选择预设角色（创建对话）", async () => {
  const { status, data } = await api("POST", "/api/chats/preset_lintang/select", undefined, token);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert(data.chatId, "Should return chatId");
  presetChatId = data.chatId;
});

await test("T-001b", "获取对话列表", async () => {
  const { status, data } = await api("GET", "/api/chats", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
  assert(data.length >= 2, `Should have at least 2 chats (custom + preset), got ${data.length}`);
});

await test("T-001c", "获取对话消息", async () => {
  assert(presetChatId, "presetChatId not set — previous test failed");
  const { status, data } = await api("GET", `/api/chats/${presetChatId}/messages`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

await test("T-001d", "获取对话运行时状态", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("GET", `/api/chats/${presetChatId}/runtime`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert("reply_state" in data, "Should have reply_state");
  assert("pending_turns_count" in data, "Should have pending_turns_count");
  assert("unread_ai_count" in data, "Should have unread_ai_count");
});

await test("T-003", "发送空消息", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status } = await api("POST", `/api/chats/${presetChatId}/messages`, { text: "", imageUrl: "" }, token);
  assert(status === 400, `Expected 400, got ${status}`);
});

await test("T-002", "发送文本消息", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("POST", `/api/chats/${presetChatId}/messages`, { text: "你好！这是一条测试消息。" }, token);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert(data.userMessage, "Should return userMessage");
  assert(data.userMessage.id, "userMessage should have id");
  assert(data.userMessage.role === "user", "Should be user role");
  assert(data.queueState, "Should return queueState");
  userMessageId = data.userMessage.id;
});

await test("T-002b", "发送图片消息", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("POST", `/api/chats/${presetChatId}/messages`, { text: "看看这张图", imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANS" }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.userMessage.image_url, "Should have image_url");
});

await test("T-005", "访问不存在的对话", async () => {
  const { status } = await api("GET", "/api/chats/nonexistent-chat-id/messages", undefined, token);
  assert(status === 404, `Expected 404, got ${status}`);
});

await test("T-009a", "标记已读", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("POST", `/api/chats/${presetChatId}/read`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("T-009b", "未读计数", async () => {
  const { status, data } = await api("GET", "/api/chats/unread-count", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert("count" in data, "Should have count field");
  assert(typeof data.count === "number", "Count should be number");
});

// ─── 6. 对话状态（关系/记忆/快照） ────────────────────────────────

await test("SB-002", "获取关系状态", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("GET", `/api/chats/${presetChatId}/state`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data, "Should return state");
  assert("intimacy_score" in data, "Should have intimacy_score");
  assert("trust_score" in data, "Should have trust_score");
  assert("relation_stage" in data, "Should have relation_stage");
});

await test("SB-002b", "获取记忆列表", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("GET", `/api/chats/${presetChatId}/memories`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

await test("SB-002c", "获取会话快照", async () => {
  const { status } = await api("GET", `/api/chats/${presetChatId}/snapshot`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
});

// ─── 7. 关系事件 ───────────────────────────────────────────────────

await test("R-001", "获取关系事件列表", async () => {
  assert(presetChatId, "presetChatId not set");
  const { status, data } = await api("GET", `/api/chats/${presetChatId}/relationship-events`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

await test("R-006", "自定义角色无关系事件", async () => {
  const { status, data } = await api("GET", `/api/chats/${chatId}/relationship-events`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data) && data.length === 0, "Custom character should have no events");
});

// ─── 8. 朋友圈 ─────────────────────────────────────────────────────

await test("MO-003", "获取朋友圈列表", async () => {
  const { status, data } = await api("GET", "/api/moments", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

await test("MO-007", "获取朋友圈未读数", async () => {
  const { status, data } = await api("GET", "/api/moments/unread-count", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert("count" in data, "Should have count");
});

await test("MO-007b", "标记朋友圈已读", async () => {
  const { status, data } = await api("POST", "/api/moments/mark-read", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("MP-004", "获取可@角色列表", async () => {
  const { status, data } = await api("GET", "/api/moments/connected-characters", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

await test("MP-008", "发布空朋友圈", async () => {
  const { status } = await api("POST", "/api/moments", { content: "" }, token);
  assert(status === 400, `Expected 400, got ${status}`);
});

await test("MP-007", "发布朋友圈", async () => {
  const { status, data } = await api("POST", "/api/moments", { content: "今天天气真好！☀️ 出去走走~" }, token);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)?.slice(0, 200)}`);
  assert(data.id, "Should return moment id");
  assert(data.content === "今天天气真好！☀️ 出去走走~", "Content mismatch");
  assert(data.source_type === "user_post", "Source type should be user_post");
  momentId = data.id;
});

await test("MC-001", "朋友圈点赞", async () => {
  const { status, data } = await api("POST", `/api/moments/${momentId}/like`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.is_liked === 1, "Should be liked");
  assert(data.likes >= 1, `Likes should be >= 1, got ${data.likes}`);
});

await test("MC-002", "朋友圈取消点赞", async () => {
  const { status, data } = await api("POST", `/api/moments/${momentId}/like`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.is_liked === 0, "Should be unliked");
});

await test("MC-007", "用户动态不可评论", async () => {
  const { status } = await api("POST", `/api/moments/${momentId}/comment`, { text: "测试评论" }, token);
  assert(status === 400, `Expected 400, got ${status}`);
});

// ─── 9. Profile 相关 ───────────────────────────────────────────────

await test("PC-003", "上传头像", async () => {
  const { status, data } = await api("PUT", "/api/profile/avatar", { avatar_image: "data:image/png;base64,iVBORw0KGgoAAAANS" }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("PC-003b", "头像数据为空", async () => {
  const { status } = await api("PUT", "/api/profile/avatar", { avatar_image: "" }, token);
  assert(status === 400, `Expected 400, got ${status}`);
});

await test("MO-009", "上传封面", async () => {
  const { status, data } = await api("PUT", "/api/profile/cover", { cover_image: "data:image/png;base64,iVBORw0KGgoAAAANS" }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("MO-009b", "封面数据为空", async () => {
  const { status } = await api("PUT", "/api/profile/cover", { cover_image: "" }, token);
  assert(status === 400, `Expected 400, got ${status}`);
});

// ─── 10. 主动触达设置 ───────────────────────────────────────────────

await test("P-001", "保存主动触达设置", async () => {
  const { status, data } = await api("PUT", "/api/profile/proactive-settings", {
    proactiveEnabled: true,
    proactiveTypes: ["sleep", "greeting"],
    proactiveBedtimeMinutes: 1380,
    proactiveCharacterIds: ["preset_lintang"],
    proactiveTimezone: "Asia/Shanghai",
    resetCharacterIds: [],
  }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("P-001b", "验证主动触达设置已保存", async () => {
  const { status, data } = await api("GET", "/api/profile", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.proactive_enabled === 1, `proactive_enabled should be 1, got ${data.proactive_enabled}`);
  assert(data.proactive_types?.includes("sleep"), "Should include sleep type");
  assert(data.proactive_types?.includes("greeting"), "Should include greeting type");
  assert(data.proactive_bedtime_minutes === 1380, `Bedtime should be 1380, got ${data.proactive_bedtime_minutes}`);
});

await test("P-011", "关闭主动触达", async () => {
  const { status, data } = await api("PUT", "/api/profile/proactive-settings", {
    proactiveEnabled: false,
    proactiveTypes: [],
    proactiveBedtimeMinutes: 1380,
    proactiveCharacterIds: [],
    proactiveTimezone: "Asia/Shanghai",
    resetCharacterIds: [],
  }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("P-001c", "无效触达类型被过滤", async () => {
  const { status } = await api("PUT", "/api/profile/proactive-settings", {
    proactiveEnabled: true,
    proactiveTypes: ["invalid_type", "sleep"],
    proactiveBedtimeMinutes: 1380,
    proactiveCharacterIds: [],
    proactiveTimezone: "Asia/Shanghai",
    resetCharacterIds: [],
  }, token);
  assert(status === 200, `Expected 200, got ${status}`);
  const { data: profile } = await api("GET", "/api/profile", undefined, token);
  assert(profile.proactive_types?.length === 1, `Should filter invalid types, got ${profile.proactive_types?.length}`);
  assert(profile.proactive_types[0] === "sleep", "Only 'sleep' should remain");
});

// ─── 11. 互动瞬间 ──────────────────────────────────────────────────

await test("M-008", "创建互动瞬间：不存在的消息", async () => {
  const { status } = await api("POST", "/api/interaction-moments", { chatId: presetChatId, startMessageId: "fake-msg-id", count: 5 }, token);
  assert(status === 404, `Expected 404, got ${status}`);
});

await test("M-003", "创建互动瞬间", async () => {
  const { status: msgStatus, data: msgs } = await api("GET", `/api/chats/${presetChatId}/messages`, undefined, token);
  assert(msgStatus === 200 && msgs.length > 0, "Need messages to create moment");

  const firstMsgId = msgs[0].id;
  const { status, data } = await api("POST", "/api/interaction-moments", { chatId: presetChatId, startMessageId: firstMsgId, count: 5 }, token);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)?.slice(0, 300)}`);
  assert(data.id, "Should return moment id");
  assert(data.title, "Should have title");
  interactionMomentId = data.id;
});

await test("PC-011", "获取互动瞬间列表", async () => {
  const { status, data } = await api("GET", "/api/interaction-moments", undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
  assert(data.length >= 1, "Should have at least 1 moment");
});

await test("PC-011b", "获取对话互动瞬间", async () => {
  const { status, data } = await api("GET", `/api/chats/${presetChatId}/interaction-moments`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
  assert(data.length >= 1, "Should have at least 1 moment");
});

await test("PC-012", "收藏互动瞬间", async () => {
  const { status, data } = await api("POST", `/api/interaction-moments/${interactionMomentId}/favorite`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.is_favorited === 1, "Should be favorited");
  assert(data.favorited_at, "Should have favorited_at");
});

await test("PC-013", "取消收藏", async () => {
  const { status, data } = await api("POST", `/api/interaction-moments/${interactionMomentId}/favorite`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.is_favorited === 0, "Should be unfavorited");
});

await test("PC-014", "收藏不存在的瞬间", async () => {
  const { status } = await api("POST", "/api/interaction-moments/nonexistent/favorite", undefined, token);
  assert(status === 404, `Expected 404, got ${status}`);
});

await test("PC-015", "删除互动瞬间", async () => {
  const { status, data } = await api("DELETE", `/api/interaction-moments/${interactionMomentId}`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");
});

await test("PC-016", "删除不存在的瞬间", async () => {
  const { status } = await api("DELETE", "/api/interaction-moments/nonexistent", undefined, token);
  assert(status === 404, `Expected 404, got ${status}`);
});

// ─── 12. 角色管理 ──────────────────────────────────────────────────

await test("PC-008a", "删除预设角色（应失败）", async () => {
  const { status } = await api("DELETE", "/api/characters/preset_lintang", undefined, token);
  assert(status === 404, `Expected 404, got ${status}`);
});

await test("PC-008", "删除自定义角色", async () => {
  // Create a second character just for deletion
  const { data: newChar } = await api("POST", "/api/characters", { name: "待删除角色", persona: "测试用" }, token);
  assert(newChar.id, "Should create character");

  const { status, data } = await api("DELETE", `/api/characters/${newChar.id}`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.ok === true, "Should return ok");

  const { data: chars } = await api("GET", "/api/characters", undefined, token);
  const found = chars.find(c => c.id === newChar.id);
  assert(!found, "Deleted character should not exist in list");
});

// ─── 13. 角色详情页 ────────────────────────────────────────────────

await test("MO-002b", "按角色获取朋友圈", async () => {
  const { status, data } = await api("GET", `/api/moments/character/preset_lintang`, undefined, token);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), "Should return array");
});

// ─── 14. 健康检查 ──────────────────────────────────────────────────

await test("HEALTH", "健康检查", async () => {
  const { status, data } = await api("GET", "/api/health");
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.status === "ok", "Should return ok");
});

// ─── 需要外部 AI 服务的测试（标记为 SKIP） ──────────────────────────

skip("C-007", "AI 词条生成角色", "需要 MiniMax M2.7 API 连接");
skip("C-011", "AI 生成头像", "需要 MiniMax image-01 API 连接");
skip("S-009", "灵感建议生成", "需要 MiniMax API 生成建议");
skip("I-001", "对话中意图检测生图", "需要 MiniMax 多模型协同");
skip("V-007", "语音回复 TTS", "需要 MiniMax speech-2.8-hd API");
skip("R-007", "关系事件交互流程", "需要特定角色亲密度阈值+脚本推进");
skip("P-005", "主动触达实际发送", "需要等待定时任务触发（每60秒检查）");

// ─── 前端 UI 测试（标记为 SKIP）──────────────────────────────────────

skip("S-001", "小幽灵静态展示", "需要浏览器渲染，无法 API 自动化");
skip("S-002", "小幽灵 hover 效果", "需要浏览器鼠标事件，无法 API 自动化");
skip("S-003", "小幽灵关闭按钮", "需要浏览器 DOM 交互");
skip("S-007", "关闭小幽灵", "需要浏览器 DOM 交互");
skip("V-001", "麦克风按钮展示", "需要浏览器 SpeechRecognition API");
skip("V-003", "语音录制流程", "需要浏览器麦克风权限");
skip("V-008", "播放语音按钮", "需要浏览器 Audio API");
skip("TO-001", "Toast 错误通知样式", "需要浏览器渲染验证");
skip("TO-006", "Toast 动画效果", "需要浏览器渲染验证");
skip("DM-001", "深色模式切换", "需要浏览器 CSS 渲染验证");
skip("L-001", "登录页 UI 展示", "需要浏览器渲染验证");
skip("MO-005", "图片全屏预览", "需要浏览器 DOM 交互");
skip("M-001", "点击消息选择", "需要浏览器点击事件");

// ─── 最终清理 ──────────────────────────────────────────────────────

await test("CLEANUP", "清理测试数据：删除测试角色", async () => {
  if (customCharacterId) {
    const { status } = await api("DELETE", `/api/characters/${customCharacterId}`, undefined, token);
    assert(status === 200, `Cleanup failed: ${status}`);
  }
});

// ─── 输出报告 ───────────────────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log("  Soulmate AI 自动化测试报告");
console.log("  日期: " + new Date().toLocaleString("zh-CN"));
console.log("═".repeat(72));

console.log(`\n  ✅ 通过: ${passCount}    ❌ 失败: ${failCount}    ⏭️  跳过: ${skipCount}    总计: ${results.length}\n`);

const passed = results.filter(r => r.status === "PASS");
const failed = results.filter(r => r.status === "FAIL");
const skipped = results.filter(r => r.status === "SKIP");

if (passed.length > 0) {
  console.log("─".repeat(72));
  console.log("  ✅ 通过的测试用例");
  console.log("─".repeat(72));
  for (const r of passed) {
    console.log(`  ✅ [${r.id}] ${r.name}`);
  }
}

if (failed.length > 0) {
  console.log("\n" + "─".repeat(72));
  console.log("  ❌ 失败的测试用例");
  console.log("─".repeat(72));
  for (const r of failed) {
    console.log(`  ❌ [${r.id}] ${r.name}`);
    console.log(`     原因: ${r.detail}`);
  }
}

if (skipped.length > 0) {
  console.log("\n" + "─".repeat(72));
  console.log("  ⏭️  无法自动化测试的用例");
  console.log("─".repeat(72));
  for (const r of skipped) {
    console.log(`  ⏭️  [${r.id}] ${r.name}`);
    console.log(`     原因: ${r.detail}`);
  }
}

console.log("\n" + "═".repeat(72));
console.log(`  测试完成。通过率: ${passCount}/${passCount + failCount} (${((passCount / (passCount + failCount || 1)) * 100).toFixed(1)}%)`);
console.log("═".repeat(72) + "\n");

process.exit(failCount > 0 ? 1 : 0);
