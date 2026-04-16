import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { authRouter } from "./server/auth.js";
import apiRoutes from "./server/routes.js";
import { cleanupIsolatedUserData } from "./server/db.js";
import { startMomentsScheduler } from "./server/moments-scheduler.js";
import { startEventQueue } from "./server/event-queue.js";
import { startChatRuntime } from "./server/chat-runtime.js";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const generatedMediaPath = path.join(process.cwd(), "generated-media");

  app.use(express.json({ limit: "10mb" }));
  app.use("/generated-media", express.static(generatedMediaPath));

  // Auth routes (no JWT required)
  app.use("/api/auth", authRouter);

  // Protected API routes
  app.use("/api", apiRoutes);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const cleanup = cleanupIsolatedUserData();
  console.log(
    `[DB Cleanup] invalid chats=${cleanup.invalidChatsRemoved}, chat turns=${cleanup.deletedChatTurns}, messages=${cleanup.deletedMessages}, memories=${cleanup.deletedMemories}, relation states=${cleanup.deletedRelationStates}, snapshots=${cleanup.deletedSnapshots}, interaction moments=${cleanup.deletedInteractionMoments}, relationship progress=${cleanup.deletedRelationshipProgress}, relationship playthroughs=${cleanup.deletedRelationshipPlaythroughs}, relationship recaps=${cleanup.deletedRelationshipRecaps}, moments=${cleanup.deletedMoments}, event queue=${cleanup.deletedEventQueueItems}, proactive refs pruned=${cleanup.prunedProactiveCharacterRefs}`
  );

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startChatRuntime();
    startMomentsScheduler();
    startEventQueue();
  });
}

startServer();
