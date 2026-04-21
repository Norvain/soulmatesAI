/**
 * One-off script to regenerate preset character avatars using each character's
 * appearance card as the prompt. Run via:
 *   npx tsx --env-file=.env.local scripts/generate-canonical-avatars.ts
 *
 * The generated image is downloaded and written to public/avatars/<key>-avatar.png,
 * overwriting the existing avatar so the displayed face stays consistent with
 * future in-chat generations that share the same appearance card.
 */

import { writeFile, mkdir, copyFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { generateImage } from "../server/minimax.js";
import { PRESET_MAP } from "../server/preset-characters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const AVATAR_DIR = path.join(REPO_ROOT, "public", "avatars");
const GENERATED_MEDIA_DIR = path.join(REPO_ROOT, "generated-media");

function portraitPromptFor(name: string, appearance: string) {
  return [
    appearance,
    `画面主体是${name}本人正脸半身肖像，表情自然放松，眼神看向镜头`,
    "构图居中、背景干净柔和、浅景深、柔和自然光、高清写实细节、电影感、1:1",
  ].join("。");
}

async function downloadAndPersist(url: string, targetPath: string) {
  // generateImage() already persists to /generated-media and returns
  // "/generated-media/<uuid>.<ext>". Resolve and copy to the avatars dir.
  if (url.startsWith("/generated-media/")) {
    const fileName = url.replace(/^\/generated-media\//, "");
    const sourcePath = path.join(GENERATED_MEDIA_DIR, fileName);
    await copyFile(sourcePath, targetPath);
    return;
  }
  // Fallback: treat as absolute remote URL.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(targetPath, buffer);
}

async function main() {
  await mkdir(AVATAR_DIR, { recursive: true });

  const entries = Object.entries(PRESET_MAP);
  console.log(`[canonical-avatars] Generating ${entries.length} avatars...`);

  for (const [presetId, preset] of entries) {
    const prompt = portraitPromptFor(preset.name, preset.appearance);
    const targetFile = path.join(
      AVATAR_DIR,
      `${presetId.replace(/^preset_/, "")}-avatar.png`
    );

    console.log(`\n[${preset.name}] generating -> ${path.relative(REPO_ROOT, targetFile)}`);
    console.log(`[${preset.name}] prompt head: ${prompt.slice(0, 80)}...`);

    try {
      const url = await generateImage(prompt);
      await downloadAndPersist(url, targetFile);
      console.log(`[${preset.name}] ✓ saved`);
    } catch (err: any) {
      console.error(`[${preset.name}] ✗ failed:`, err.message);
    }
  }

  console.log("\n[canonical-avatars] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
