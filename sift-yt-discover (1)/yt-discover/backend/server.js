import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieSession from "cookie-session";

import authRoutes from "./routes/auth.js";
import recommendationRoutes from "./routes/recommendations.js";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET || "dev-secret-change-me"],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: "lax",
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/api", recommendationRoutes);

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`yt-discover backend listening on http://localhost:${port}`);
});
