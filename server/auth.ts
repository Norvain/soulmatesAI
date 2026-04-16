import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import db, { generateDisplayId } from "./db.js";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV !== "production" ? "soulmate-dev-secret-change-me" : "");

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production");
}
const TOKEN_EXPIRY = "7d";
const PHONE_REGEX = /^\d{11}$/;
const PASSWORD_REGEX = /^[A-Za-z0-9]{6,10}$/;

export interface AuthRequest extends Request {
  userId?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "未登录" });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

const authRouter = Router();

authRouter.post("/register", (req: Request, res: Response) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!phone || !password) {
    res.status(400).json({ error: "手机号和密码不能为空" });
    return;
  }
  if (!PHONE_REGEX.test(phone)) {
    res.status(400).json({ error: "手机号需为 11 位数字" });
    return;
  }
  if (!PASSWORD_REGEX.test(password)) {
    res.status(400).json({ error: "密码需为 6-10 位字母或数字" });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  if (existing) {
    res.status(409).json({ error: "该手机号已注册" });
    return;
  }

  const id = crypto.randomUUID();
  const displayId = generateDisplayId();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare("INSERT INTO users (id, phone, password_hash, display_id) VALUES (?, ?, ?, ?)").run(id, phone, passwordHash, displayId);

  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  res.json({ token, user: { id, phone, display_id: displayId } });
});

authRouter.post("/login", (req: Request, res: Response) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!phone || !password) {
    res.status(400).json({ error: "手机号和密码不能为空" });
    return;
  }

  const user = db.prepare("SELECT id, phone, password_hash FROM users WHERE phone = ?").get(phone) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "手机号或密码错误" });
    return;
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  res.json({ token, user: { id: user.id, phone: user.phone } });
});

export { authRouter };
