import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const app = express();

const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || "/usr/local/bin/yt-dlp";

// PO Token Provider
const POT_PROVIDER_URL =
  process.env.YT_DLP_POT_PROVIDER_URL || "http://127.0.0.1:4416";

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"]
  })
);

app.use(express.json({ limit: "20kb" }));

// Render proxy के पीछे Express को सही client IP समझाने के लिए
app.set("trust proxy", 1);

// Rate limit
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", limiter);

// Home
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    message: "API is running"
  });
});

// Health
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    ytdlp: YTDLP,
    pot_provider: POT_PROVIDER_URL
  });
});

// URL validation
function validUrl(value) {
  try {
    const u = new URL(value);

    return (
      ["http:", "https:"].includes(u.protocol) &&
      u.hostname.length > 0
    );
  } catch {
    return false;
  }
}

// Run yt-dlp
function runYtdlp(args, cwd) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,

      // PO Token Provider
      YT_DLP_POT_PROVIDER_URL: POT_PROVIDER_URL
    };

    const finalArgs = [
      "--no-warnings",

      // YouTube के JavaScript challenges के लिए Node
      "--js-runtimes",
      "node",

      // EJS remote components
      "--remote-components",
      "ejs:github",

      ...args
    ];

    const p = spawn(YTDLP, finalArgs, {
      cwd,
      env
    });

    let stdout = "";
    let stderr = "";

    p.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    p.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    p.on("error", (error) => {
      reject(error);
    });

    p.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            stderr.slice(-8000) ||
              `yt-dlp exited with code ${code}`
          )
        );
      }
    });
  });
}

// -------------------------
// VIDEO INFORMATION
// -------------------------

app.post("/api/info", async (req, res) => {
  const url = req.body?.url?.trim();

  if (!validUrl(url)) {
    return res.status(400).json({
      error: "Valid HTTP/HTTPS URL डालें।"
    });
  }

  try {
    const out = await runYtdlp(
      [
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",

        // YouTube extractor configuration
        "--extractor-args",
        "youtube:player_client=web,mweb",

        url
      ],
      process.cwd()
    );

    const info = JSON.parse(out);

    return res.json({
      title: info.title || "Video",
      thumbnail: info.thumbnail || "",
      duration: info.duration || 0,
      uploader:
        info.uploader ||
        info.channel ||
        info.uploader_id ||
        "",
      webpage_url: info.webpage_url || url
    });
  } catch (err) {
    console.error("yt-dlp info error:", err.message);

    return res.status(422).json({
      error: "yt-dlp से वीडियो की जानकारी नहीं मिली।",
      detail: err.message
    });
  }
});

// -------------------------
// DOWNLOAD
// -------------------------

app.get("/api/download", async (req, res) => {
  const url = String(req.query.url || "").trim();

  const format =
    req.query.format === "audio"
      ? "audio"
      : "video";

  if (!validUrl(url)) {
    return res.status(400).send("Invalid URL");
  }

  const work = await mkdtemp(
    path.join(tmpdir(), "social-video-")
  );

  let cleaned = false;

  async function cleanup() {
    if (cleaned) return;

    cleaned = true;

    await rm(work, {
      recursive: true,
      force: true
    }).catch(() => {});
  }

  try {
    const output = path.join(
      work,
      "%(title).80s-%(id)s.%(ext)s"
    );

    const args = [
      "--no-playlist",
      "--restrict-filenames",
      "-o",
      output,

      // YouTube client
      "--extractor-args",
      "youtube:player_client=web,mweb"
    ];

    // Audio
    if (format === "audio") {
      args.push(
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "128K"
      );
    }

    // Video
    else {
      args.push(
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format",
        "mp4"
      );
    }

    args.push(url);

    await runYtdlp(args, process.cwd());

    const names = await readdir(work);

    const file = names.find(
      (name) =>
        !name.endsWith(".part") &&
        !name.endsWith(".ytdl") &&
        !name.endsWith(".temp")
    );

    if (!file) {
      throw new Error(
        "yt-dlp ने कोई output file नहीं बनाई।"
      );
    }

    const full = path.join(work, file);

    const ext = path
      .extname(file)
      .toLowerCase();

    const mime =
      ext === ".mp3"
        ? "audio/mpeg"
        : "video/mp4";

    res.setHeader("Content-Type", mime);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.replace(
        /["\\]/g,
        "_"
      )}"`
    );

    const stream = createReadStream(full);

    stream.on("error", async (err) => {
      console.error(
        "File stream error:",
        err.message
      );

      await cleanup();
    });

    stream.on("close", async () => {
      await cleanup();
    });

    stream.pipe(res);
  } catch (err) {
    console.error(
      "Download error:",
      err.message
    );

    await cleanup();

    if (!res.headersSent) {
      return res.status(422).json({
        error: "Download नहीं हो सका।",
        detail: err.message
      });
    }
  }
});

// -------------------------
// START SERVER
// -------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Social Video Downloader API running on port ${PORT}`
  );

  console.log(
    `yt-dlp path: ${YTDLP}`
  );

  console.log(
    `PO Token Provider: ${POT_PROVIDER_URL}`
  );
});