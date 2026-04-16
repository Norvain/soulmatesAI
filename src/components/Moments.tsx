import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, MessageCircle, Camera, AtSign, X } from "lucide-react";
import { cn } from "../lib/utils";
import { compressImage } from "../lib/utils";
import {
  createMoment,
  getMomentConnectedCharacters,
  getMoments,
  likeMoment,
  commentMoment,
  updateCoverImage,
  getProfile,
  markMomentsRead,
} from "../lib/api";

interface Comment {
  id: string;
  author: string;
  text: string;
  isAI?: boolean;
  created_at?: string;
  timestamp?: string;
}

interface Moment {
  id: string;
  character_id: string;
  character_name: string;
  character_avatar: string;
  content: string;
  image_url?: string;
  source_type?: string;
  created_at: string;
  likes: number;
  is_liked: number;
  comments: Comment[];
}

interface ConnectedCharacter {
  id: string;
  name: string;
  avatar_url?: string;
}

const POLL_INTERVAL = 30_000;

interface MomentsProps {
  onOpenProfile?: () => void;
}

export default function Moments({ onOpenProfile }: MomentsProps) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentingOn, setCommentingOn] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [userName, setUserName] = useState("我");
  const [connectedCharacters, setConnectedCharacters] = useState<ConnectedCharacter[]>([]);
  const [postContent, setPostContent] = useState("");
  const [postImage, setPostImage] = useState<string | null>(null);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [isPublishingMoment, setIsPublishingMoment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const postImageInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mentionMatch = postContent.match(/(^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[2]?.trim() || "";
  const filteredMentionCharacters = connectedCharacters.filter(
    (character) =>
      !selectedMentionIds.includes(character.id) &&
      (mentionQuery ? character.name.includes(mentionQuery) : true)
  );
  const selectedMentionCharacters = selectedMentionIds
    .map((id) => connectedCharacters.find((character) => character.id === id))
    .filter((character): character is ConnectedCharacter => Boolean(character));

  const fetchMoments = useCallback(async () => {
    try {
      const data = await getMoments();
      setMoments(data);
    } catch (e) {
      console.error("Fetch moments failed:", e);
    }
  }, []);

  useEffect(() => {
    getProfile()
      .then((p: any) => {
        if (p?.cover_image) setCoverImage(p.cover_image);
        if (p?.avatar_image) setAvatarImage(p.avatar_image);
        if (p?.preferred_name) setUserName(p.preferred_name);
      })
      .catch(() => {});

    getMomentConnectedCharacters()
      .then(setConnectedCharacters)
      .catch(console.error);

    fetchMoments().finally(() => setLoading(false));
    markMomentsRead().catch(() => {});

    const timer = setInterval(fetchMoments, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchMoments]);

  const handleLike = async (moment: Moment) => {
    try {
      const result = await likeMoment(moment.id);
      setMoments(prev =>
        prev.map(m =>
          m.id === moment.id ? { ...m, is_liked: result.is_liked, likes: result.likes } : m
        )
      );
    } catch (e) {
      console.error("Like failed:", e);
    }
  };

  const handleComment = async (moment: Moment) => {
    if (!commentInput.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { userComment } = await commentMoment(moment.id, commentInput.trim());
      setMoments(prev =>
        prev.map(m => {
          if (m.id !== moment.id) return m;
          return { ...m, comments: [...m.comments, userComment] };
        })
      );
      setCommentInput("");
      setCommentingOn(null);
    } catch (e) {
      console.error("Comment failed:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const compressed = await compressImage(base64, 1200, 0.8);
        setCoverImage(compressed);
        await updateCoverImage(compressed);
      } catch (err) {
        console.error("Cover upload failed:", err);
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePostImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const compressed = await compressImage(base64, 1200, 0.82);
        setPostImage(compressed);
      } catch (err) {
        console.error("Moment image upload failed:", err);
      }
    };
    reader.readAsDataURL(file);
    if (postImageInputRef.current) postImageInputRef.current.value = "";
  };

  const handleComposerChange = (value: string) => {
    setPostContent(value);
    setShowMentionMenu(Boolean(value.match(/(^|\s)@([^\s@]*)$/)) && connectedCharacters.length > 0);
  };

  const handleMentionCharacter = (character: ConnectedCharacter) => {
    setPostContent((prev) => {
      if (prev.match(/(^|\s)@([^\s@]*)$/)) {
        return prev.replace(/(^|\s)@([^\s@]*)$/, `$1@${character.name} `);
      }
      return `${prev.trimEnd()} @${character.name} `.trimStart();
    });
    setSelectedMentionIds((prev) => (prev.includes(character.id) ? prev : [...prev, character.id]));
    setShowMentionMenu(false);
  };

  const removeMentionCharacter = (character: ConnectedCharacter) => {
    const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setSelectedMentionIds((prev) => prev.filter((id) => id !== character.id));
    setPostContent((prev) =>
      prev.replace(new RegExp(`(^|\\s)@${escapedName}(?=\\s|$)`, "g"), "$1").replace(/\s{2,}/g, " ").trim()
    );
  };

  const handlePublishMoment = async () => {
    if ((!postContent.trim() && !postImage) || isPublishingMoment) return;
    setIsPublishingMoment(true);
    try {
      const createdMoment = await createMoment({
        content: postContent.trim(),
        imageUrl: postImage || undefined,
        mentionedCharacterIds: selectedMentionIds,
      });
      setMoments((prev) => [createdMoment, ...prev]);
      setPostContent("");
      setPostImage(null);
      setSelectedMentionIds([]);
      setShowMentionMenu(false);
    } catch (error) {
      console.error("Create moment failed:", error);
    } finally {
      setIsPublishingMoment(false);
    }
  };

  const getCommentAuthorName = (c: Comment, moment: Moment) => {
    if (c.author && c.author !== "user" && c.author !== "model") return c.author;
    if (c.isAI) return moment.character_name;
    if (c.author === "user" || c.author === "model") {
      return c.author === "user" ? userName : moment.character_name;
    }
    return c.author || userName;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-alt">
      {/* Cover section */}
      <div
        className="h-64 bg-stone-800 relative cursor-pointer group"
        onClick={() => fileInputRef.current?.click()}
      >
        <img
          src={coverImage || "https://picsum.photos/seed/moments_cover/800/400"}
          alt="Cover"
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Camera
            size={32}
            className="text-white opacity-0 group-hover:opacity-70 transition-opacity"
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUpload}
        />
        <button
          type="button"
          className="absolute -bottom-8 right-6 flex items-end space-x-4 group"
          onClick={(e) => {
            e.stopPropagation();
            onOpenProfile?.();
          }}
        >
          <span className="text-white font-bold text-xl mb-2 drop-shadow-md">
            {userName}
          </span>
          <div className="w-16 h-16 rounded-xl bg-surface-alt border-2 border-surface shadow-sm overflow-hidden flex items-center justify-center text-secondary font-bold text-xl transition-transform group-hover:scale-[1.03]">
            {avatarImage ? (
              <img src={avatarImage} alt={userName} className="w-full h-full object-cover" />
            ) : (
              userName.charAt(0)
            )}
          </div>
        </button>
      </div>

      {/* Moments list */}
      <div className="max-w-2xl mx-auto -mt-10 pb-20 px-4">
        <div className="relative rounded-[28px] border border-divider bg-surface shadow-sm px-5 py-5 mb-8">
          <div className="flex items-start space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-surface-alt overflow-hidden flex items-center justify-center text-secondary font-bold shrink-0">
              {avatarImage ? (
                <img src={avatarImage} alt={userName} className="w-full h-full object-cover" />
              ) : (
                userName.charAt(0)
              )}
            </div>
            <div className="flex-1 min-w-0 relative">
              <textarea
                value={postContent}
                onChange={(event) => handleComposerChange(event.target.value)}
                placeholder="分享这一刻吧，输入 @ 可以艾特已建联角色"
                rows={4}
                className="w-full resize-none rounded-2xl bg-surface-alt border border-divider px-4 py-3 text-sm text-body focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all"
              />

              <AnimatePresence>
                {showMentionMenu && filteredMentionCharacters.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-divider bg-surface shadow-xl overflow-hidden z-20"
                  >
                    {filteredMentionCharacters.map((character) => (
                      <button
                        key={character.id}
                        type="button"
                        onClick={() => handleMentionCharacter(character)}
                        className="w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-surface-alt transition-colors border-b border-divider last:border-0"
                      >
                        <div className="w-9 h-9 rounded-xl bg-surface-alt overflow-hidden flex items-center justify-center text-secondary font-medium shrink-0">
                          {character.avatar_url ? (
                            <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                          ) : (
                            character.name.charAt(0)
                          )}
                        </div>
                        <span className="text-sm font-medium text-body">{character.name}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {selectedMentionCharacters.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedMentionCharacters.map((character) => (
                    <span
                      key={character.id}
                      className="inline-flex items-center space-x-1 rounded-full bg-indigo-50 text-indigo-600 px-3 py-1 text-xs font-medium"
                    >
                      <span>@{character.name}</span>
                      <button type="button" onClick={() => removeMentionCharacter(character)} className="hover:text-indigo-800">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {postImage && (
                <div className="mt-3 relative inline-block">
                  <img src={postImage} alt="Moment preview" className="h-28 rounded-2xl object-cover" />
                  <button
                    type="button"
                    onClick={() => setPostImage(null)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPostContent((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}@`);
                      setShowMentionMenu(connectedCharacters.length > 0);
                    }}
                    className="w-10 h-10 rounded-full text-secondary hover:text-body hover:bg-surface-alt transition-colors flex items-center justify-center"
                    title="艾特角色"
                  >
                    <AtSign size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => postImageInputRef.current?.click()}
                    className="w-10 h-10 rounded-full text-secondary hover:text-body hover:bg-surface-alt transition-colors flex items-center justify-center"
                    title="上传图片"
                  >
                    <Camera size={18} />
                  </button>
                  <input
                    ref={postImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePostImageUpload}
                  />
                </div>

                <button
                  type="button"
                  onClick={handlePublishMoment}
                  disabled={(!postContent.trim() && !postImage) || isPublishingMoment}
                  className="min-w-[96px] px-5 py-2.5 rounded-full bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                >
                  {isPublishingMoment ? "发布中..." : "发布"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
        {moments.length === 0 ? (
          <div className="text-center py-20 text-muted">
            <p>和角色建立联系后，TA 会在这里分享日常</p>
          </div>
        ) : (
          moments.map(moment => (
            <div key={moment.id} className="flex space-x-3">
              {moment.character_avatar ? (
                <img
                  src={moment.character_avatar}
                  alt={moment.character_name}
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center text-secondary font-bold shrink-0">
                  {(moment.character_name || "我").charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[#576b95] text-[15px] mb-1">
                  {moment.character_name}
                </h3>
                <p className="text-body text-[15px] leading-relaxed mb-2 whitespace-pre-wrap">
                  {moment.content}
                </p>
                {moment.image_url && (
                  <img
                    src={moment.image_url}
                    alt="Moment"
                    className="max-w-[200px] max-h-[200px] object-cover rounded-sm mb-2 cursor-pointer"
                    onClick={() => setPreviewUrl(moment.image_url!)}
                  />
                )}

                <div className="flex items-center justify-between mt-2">
                  <span className="text-muted text-xs">
                    {moment.created_at
                      ? new Date(moment.created_at).toLocaleString()
                      : "刚刚"}
                  </span>
                  {moment.source_type !== "user_post" && (
                    <div className="flex items-center space-x-4 text-muted">
                      <button
                        onClick={() => handleLike(moment)}
                        className={cn(
                          "flex items-center space-x-1 transition-colors",
                          moment.is_liked ? "text-rose-500" : "hover:text-secondary"
                        )}
                      >
                        <Heart
                          size={16}
                          className={cn(moment.is_liked && "fill-current")}
                        />
                      </button>
                      <button
                        onClick={() =>
                          setCommentingOn(
                            commentingOn === moment.id ? null : moment.id
                          )
                        }
                        className="flex items-center space-x-1 hover:text-secondary transition-colors"
                      >
                        <MessageCircle size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {(moment.likes > 0 || moment.comments.length > 0) && (
                  <div className="mt-3 bg-page rounded-sm p-2 text-[13px]">
                    {moment.likes > 0 && (
                      <div className="flex items-center text-[#576b95] font-medium mb-1 border-b border-divider-strong/50 pb-1">
                        <Heart size={12} className="mr-1.5 shrink-0" />
                        <span>
                          {moment.is_liked ? userName : ""}
                          {moment.likes > (moment.is_liked ? 1 : 0)
                            ? ` 等${moment.likes}人`
                            : ""}{" "}
                          觉得很赞
                        </span>
                      </div>
                    )}
                    {moment.comments.length > 0 && (
                      <div className="space-y-1 mt-1">
                        {moment.comments.map((c, idx) => (
                          <div key={c.id || idx} className="leading-relaxed">
                            <span className="font-medium text-[#576b95]">
                              {getCommentAuthorName(c, moment)}
                            </span>
                            <span className="text-body">：{c.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <AnimatePresence>
                  {commentingOn === moment.id && moment.source_type !== "user_post" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 flex items-center space-x-2 overflow-hidden"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={commentInput}
                        onChange={e => setCommentInput(e.target.value)}
                        placeholder="评论..."
                        className="flex-1 bg-surface border border-divider-strong rounded-md px-3 py-1.5 text-sm text-body focus:outline-none focus:border-subtle"
                        onKeyDown={e => {
                          if (e.key === "Enter") handleComment(moment);
                        }}
                      />
                      <button
                        onClick={() => handleComment(moment)}
                        disabled={!commentInput.trim() || isSubmitting}
                        className="bg-[#07c160] text-white px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
                      >
                        发送
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ))
        )}
        </div>
      </div>

      {/* Image preview overlay */}
      <AnimatePresence>
        {previewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
            onClick={() => setPreviewUrl(null)}
          >
            <img
              src={previewUrl}
              alt="Preview"
              className="max-w-[90vw] max-h-[90vh] object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
