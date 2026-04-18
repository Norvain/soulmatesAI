const TOKEN_KEY = "soulmate_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("未登录");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${res.status})`);
  }

  return res.json();
}

export interface RelationshipEventCard {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  required_intimacy: number;
  status: "locked" | "available" | "in_progress" | "completed" | "not_started";
  locked_reason: string | null;
  progress_percent: number;
  current_act: number;
  total_acts: number;
  completion_count: number;
  last_saved_at: string | null;
  completed_at: string | null;
  last_summary: string | null;
  last_cg_image_url: string | null;
}

export interface RelationshipEventTranscriptEntry {
  id: string;
  speaker: "character" | "user";
  text: string;
  created_at: string;
  kind: "dialogue" | "choice" | "ending";
  act: number;
  node_id: string;
}

export interface RelationshipEventChoicePathEntry {
  node_id: string;
  choice_id: string;
  label: string;
  emotion_tags: string[];
  selected_at: string;
  act: number;
}

export interface RelationshipEventSession {
  event: RelationshipEventCard;
  session_status: "locked" | "available" | "in_progress" | "completed" | "not_started";
  transcript: RelationshipEventTranscriptEntry[];
  current_choices: { id: string; label: string }[];
  current_node_id: string | null;
  choice_path: RelationshipEventChoicePathEntry[];
  emotion_tags: string[];
  started_at: string | null;
  last_saved_at: string | null;
  completed_at: string | null;
  cg_image_url: string | null;
  cg_status: "idle" | "generating" | "ready" | "failed";
  summary_text: string | null;
}

export interface RelationshipEventHistory {
  event: RelationshipEventCard;
  status: "in_progress" | "completed" | "abandoned";
  transcript: RelationshipEventTranscriptEntry[];
  choice_path: RelationshipEventChoicePathEntry[];
  emotion_tags: string[];
  started_at: string;
  ended_at: string | null;
  cg_image_url: string | null;
  cg_status: "idle" | "generating" | "ready" | "failed";
  summary_text: string | null;
}

// ─── Auth ────────────────────────────────────────────────────────────

export async function login(phone: string, password: string) {
  const data = await request<{ token: string; user: any }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
  setToken(data.token);
  return data;
}

export async function register(phone: string, password: string) {
  const data = await request<{ token: string; user: any }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
  setToken(data.token);
  return data;
}

export function logout() {
  clearToken();
  window.location.reload();
}

// ─── Profile ─────────────────────────────────────────────────────────

export function getProfile() {
  return request<any>("/api/profile");
}

export function updateProfile(data: { preferredName: string; comfortStyle: string }) {
  return request("/api/profile", { method: "PUT", body: JSON.stringify(data) });
}

export function updatePreferences(data: { gender: string | null; contentPreferences: string[] }) {
  return request("/api/profile/preferences", { method: "PUT", body: JSON.stringify(data) });
}

export function getMembership() {
  return request<{ membership_level: string; membership_expires_at: string | null }>("/api/membership");
}

// ─── Characters ──────────────────────────────────────────────────────

export function getCharacters() {
  return request<any[]>("/api/characters");
}

export function createCharacter(data: any) {
  return request<{ id: string; avatarUrl: string }>("/api/characters", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function generateAvatar(data: { name: string; persona: string; overview: string }) {
  return request<{ url: string }>("/api/characters/generate-avatar", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function generateCharacterFromTags(tags: string[]) {
  return request<{ name: string; overview: string; persona: string; greeting: string }>("/api/characters/generate-from-tags", {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

export function deleteCharacter(id: string) {
  return request<{ ok: boolean }>(`/api/characters/${id}`, { method: "DELETE" });
}

// ─── Interaction Moments ─────────────────────────────────────────────

export function saveInteractionMoment(chatId: string, startMessageId: string, count: number) {
  return request<any>("/api/interaction-moments", {
    method: "POST",
    body: JSON.stringify({ chatId, startMessageId, count }),
  });
}

export function getInteractionMoments() {
  return request<any[]>("/api/interaction-moments");
}

export function getChatInteractionMoments(chatId: string) {
  return request<any[]>(`/api/chats/${chatId}/interaction-moments`);
}

export function toggleInteractionMomentFavorite(id: string) {
  return request<{ ok: boolean; is_favorited: number; favorited_at: string | null }>(
    `/api/interaction-moments/${id}/favorite`,
    { method: "POST" }
  );
}

export function deleteInteractionMoment(id: string) {
  return request<{ ok: boolean }>(`/api/interaction-moments/${id}`, { method: "DELETE" });
}

// ─── Discover ─────────────────────────────────────────────────────────

export function searchDiscover(q: string) {
  return request<any[]>(`/api/discover/search?q=${encodeURIComponent(q)}`);
}

export function getDiscoverRanking() {
  return request<any[]>("/api/discover/ranking");
}

// ─── Chats ───────────────────────────────────────────────────────────

export function getChats() {
  return request<any[]>("/api/chats");
}

export function selectCharacter(characterId: string) {
  return request<{ chatId: string }>(`/api/chats/${characterId}/select`, { method: "POST" });
}

export function getMessages(chatId: string) {
  return request<any[]>(`/api/chats/${chatId}/messages`);
}

export function sendMessage(chatId: string, data: { text: string; imageUrl?: string; voiceInput?: boolean; momentContext?: string }) {
  return request<{ userMessage: any; queueState: any }>(`/api/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getChatRuntime(chatId: string) {
  return request<any>(`/api/chats/${chatId}/runtime`);
}

export function markChatRead(chatId: string) {
  return request<{ ok: boolean }>(`/api/chats/${chatId}/read`, {
    method: "POST",
  });
}

export function getChatsUnreadCount() {
  return request<{ count: number }>("/api/chats/unread-count");
}

export function getSuggestions(chatId: string) {
  return request<string[]>(`/api/chats/${chatId}/suggestions`, { method: "POST" });
}

export function getChatState(chatId: string) {
  return request<any>(`/api/chats/${chatId}/state`);
}

export function getChatMemories(chatId: string) {
  return request<any[]>(`/api/chats/${chatId}/memories`);
}

export function getChatSnapshot(chatId: string) {
  return request<any>(`/api/chats/${chatId}/snapshot`);
}

export function getRelationshipEvents(chatId: string) {
  return request<RelationshipEventCard[]>(`/api/chats/${chatId}/relationship-events`);
}

export function startRelationshipEvent(chatId: string, eventId: string, mode: "start" | "replay" = "start") {
  return request<RelationshipEventSession>(`/api/chats/${chatId}/relationship-events/${eventId}/start`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function getRelationshipEventSession(chatId: string, eventId: string) {
  return request<RelationshipEventSession>(`/api/chats/${chatId}/relationship-events/${eventId}/session`);
}

export function chooseRelationshipEvent(chatId: string, eventId: string, choiceId: string) {
  return request<RelationshipEventSession>(`/api/chats/${chatId}/relationship-events/${eventId}/choose`, {
    method: "POST",
    body: JSON.stringify({ choiceId }),
  });
}

export function getRelationshipEventHistory(chatId: string, eventId: string) {
  return request<RelationshipEventHistory>(`/api/chats/${chatId}/relationship-events/${eventId}/history`);
}

// ─── Moments ─────────────────────────────────────────────────────────

export function getMoments() {
  return request<any[]>("/api/moments");
}

export function getMomentConnectedCharacters() {
  return request<any[]>("/api/moments/connected-characters");
}

export function createMoment(data: { content: string; imageUrl?: string; mentionedCharacterIds: string[] }) {
  return request<any>("/api/moments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getCharacterMoments(characterId: string) {
  return request<any[]>(`/api/moments/character/${characterId}`);
}

export function likeMoment(id: string) {
  return request<{ is_liked: number; likes: number }>(`/api/moments/${id}/like`, { method: "POST" });
}

export function commentMoment(id: string, text: string) {
  return request<{ userComment: any }>(`/api/moments/${id}/comment`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function updateCoverImage(cover_image: string) {
  return request<{ ok: boolean }>("/api/profile/cover", {
    method: "PUT",
    body: JSON.stringify({ cover_image }),
  });
}

export function updateAvatarImage(avatar_image: string) {
  return request<{ ok: boolean }>("/api/profile/avatar", {
    method: "PUT",
    body: JSON.stringify({ avatar_image }),
  });
}

export function updateProactiveSettings(data: {
  proactiveEnabled: boolean;
  proactiveTypes: string[];
  proactiveBedtimeMinutes: number;
  proactiveCharacterIds: string[];
  proactiveTimezone: string;
  resetCharacterIds?: string[];
}) {
  return request<{ ok: boolean }>("/api/profile/proactive-settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function getMomentsUnreadCount() {
  return request<{ count: number }>("/api/moments/unread-count");
}

export function markMomentsRead() {
  return request<{ ok: boolean }>("/api/moments/mark-read", { method: "POST" });
}

export interface TranscribeResult {
  text: string;
  durationMs?: number;
  error?: string;
}

export function transcribeAudio(audioBase64: string, mimeType: string) {
  return request<TranscribeResult>("/api/asr/transcribe", {
    method: "POST",
    body: JSON.stringify({ audio: audioBase64, mimeType }),
  });
}
