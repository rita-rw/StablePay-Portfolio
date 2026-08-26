import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import projectsRouter from "./routes/projects";
import adminRouter from "./routes/admin";
import usersRouter from "./routes/users";
import { getListenerStatus } from "./listener";

export const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
  })
);
app.use(express.json());
app.set("trust proxy", 1); // Required for correct IP detection behind Railway's load balancer

// Strict limit for write/auth endpoints
const writeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Lenient limit for read endpoints (GET)
const readLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

app.use((req, res, next) => {
  if (req.method === "GET") return readLimit(req, res, next);
  return writeLimit(req, res, next);
});

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  const listener = getListenerStatus();
  res.json({
    status: "ok",
    listener: listener.healthy,
    listenerState: listener.state,
    startupComplete: listener.startupComplete,
    watchersActive: listener.watchersActive,
    restartCount: listener.restartCount,
    lastWatcherSuccessAt: listener.lastWatcherSuccessAt,
    lastWatcherErrorAt: listener.lastWatcherErrorAt,
    restartScheduled: listener.restartScheduled,
    reason: listener.reason,
  });
});

app.get("/ready", (_req, res) => {
  const listener = getListenerStatus();
  if (!listener.healthy) {
    res.status(503).json({ status: "degraded", ...listener });
    return;
  }

  res.json({ status: "ready", ...listener });
});

app.use("/projects", projectsRouter);
app.use("/admin", adminRouter);
app.use("/users", usersRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Internal server error" });
});
