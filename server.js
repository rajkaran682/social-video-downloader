import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const app = express();

const PORT = Number(process.env.PORT || 10000);
const YTDLP = process.env.YTDLP_PATH || "/usr/local/bin/yt-dlp";
const POT_PROVIDER_URL =
  process.env.POT_PROVIDER_URL || "http://127.0.0.1:4416";

// --------------------------------------------------
// CORS
// --------------------------------------------------

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"]
  })
);

// --------------------------------------------------
// JSON
// --------------------------------------------------

app.use(express.json({ limit: "20kb" }));

// Render reverse proxy
app.set("trust proxy", 1);

// --------------------------------------------------
// RATE LIMIT
// --------------------------------------------------

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", limiter);

// --------------------------------------------------
// HOME
// --------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    message: "API is running"
  });
});

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    yt_dlp: YTDLP,
    po_token_provider: POT_PROVIDER_URL
  });
});

// --------------------------------------------------
// URL VALIDATION
// --------------------------------------------------

function validUrl(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  try {
    const u = new URL(value.trim());

    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      !!u.hostname
    );
  } catch {
    return false;
  }
}

// --------------------------------------------------
// RUN YT-DLP
// --------------------------------------------------

function runYtdlp(args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const finalArgs = [
      "--no-warnings",

      // YouTube JavaScript challenge support
      "--js-runtimes",
      "node",

      // yt-dlp EJS components
      "--remote-components",
      "ejs:github",

      // IMPORTANT:
      // bgutil PO Token HTTP provider
      "--extractor-args",
      `youtubepot-bgutilhttp:base_url=${POT_PROVIDER_URL}`,

      ...args
    ];

    console.log("Running yt-dlp:");
    console.log(YTDLP, finalArgs.join(" "));

    const child = spawn(YTDLP, finalArgs, {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const errorText =
        stderr.trim() ||
        stdout.trim() ||
        `yt-dlp exited with code ${code}`;

      reject(new Error(errorText));
    });
  });
}

// --------------------------------------------------
// VIDEO INFO
// --------------------------------------------------

app.post("/api/info", async (req, res) => {
  const url = req.body?.url?.trim();

  if (!validUrl(url)) {
    return res.status(400).json({
      error: "Valid HTTP/HTTPS URL डालें।"
    });
  }

  try {
    const output = await runYtdlp([
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",

      // mweb is the client recommended by current
      // yt-dlp PO Token guidance
      "--extractor-args",
      "youtube:player_client=mweb",

      url
    ]);

    const info = JSON.parse(output);

    return res.json({
      title: info.title || "Video",
      thumbnail: info.thumbnail || "",
      duration: Number(info.duration || 0),
      uploader:
        info.uploader ||
        info.channel ||
        "",
      webpage_url:
        info.webpage_url ||
        url
    });
  } catch (error) {
    console.error("INFO ERROR:");
    console.error(error.message);

    return res.status(422).json({
      error: "yt-dlp से वीडियो की जानकारी नहीं मिली।",
      detail: error.message
    });
  }
});

// --------------------------------------------------
// DOWNLOAD
// --------------------------------------------------

app.get("/api/download", async (req, res) => {
  const url = String(req.query.url || "").trim();

  const format =
    req.query.format === "audio"
      ? "audio"
      : "video";

  if (!validUrl(url)) {
    return res.status(400).json({
      error: "Invalid URL"
    });
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

      // Current YouTube client
      "--extractor-args",
      "youtube:player_client=mweb"
    ];

    // ----------------------------------------------
    // AUDIO
    // ----------------------------------------------

    if (format === "audio") {
      args.push(
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "128K"
      );
    }

    // ----------------------------------------------
    // VIDEO
    // ----------------------------------------------

    else {
      args.push(
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format",
        "mp4"
      );
    }

    args.push(url);

    await runYtdlp(args);

    const files = await readdir(work);

    const file = files.find((name) => {
      return (
        !name.endsWith(".part") &&
        !name.endsWith(".ytdl") &&
        !name.endsWith(".temp") &&
        !name.endsWith(".json")
      );
    });

    if (!file) {
      throw new Error(
        "yt-dlp ने कोई output file नहीं बनाई।"
      );
    }

    const fullPath = path.join(work, file);

    const extension =
      path.extname(file).toLowerCase();

    let mime = "video/mp4";

    if (extension === ".mp3") {
      mime = "audio/mpeg";
    } else if (extension === ".m4a") {
      mime = "audio/mp4";
    } else if (extension === ".webm") {
      mime = "video/webm";
    }

    res.setHeader("Content-Type", mime);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.replace(
        /["\\]/g,
        "_"
      )}"`
    );

    const stream = createReadStream(fullPath);

    stream.on("error", async (error) => {
      console.error(
        "STREAM ERROR:",
        error.message
      );

      await cleanup();
    });

    stream.on("close", async () => {
      await cleanup();
    });

    stream.pipe(res);
  } catch (error) {
    console.error("DOWNLOAD ERROR:");
    console.error(error.message);

    await cleanup();

    if (!res.headersSent) {
      return res.status(422).json({
        error: "Download नहीं हो सका।",
        detail: error.message
      });
    }
  }
});

// --------------------------------------------------
// START
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Social Video Downloader API running on port ${PORT}`
  );

  console.log(
    `yt-dlp: ${YTDLP}`
  );

  console.log(
    `PO Token Provider: ${POT_PROVIDER_URL}`
  );
});