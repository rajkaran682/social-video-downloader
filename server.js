import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const app = express();

const PORT = process.env.PORT || 10000;
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const POT_PROVIDER_URL =
  process.env.POT_PROVIDER_URL || "http://127.0.0.1:4416";

app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
  })
);

app.use(express.json({ limit: "20kb" }));

// ------------------------------------
// RATE LIMITING
// ------------------------------------

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "बहुत ज्यादा requests भेजी गई हैं। कृपया थोड़ी देर बाद दोबारा प्रयास करें।",
  },
});

app.use("/api/", apiLimiter);

// ------------------------------------
// HELPERS
// ------------------------------------

function validUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();

    return (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

function is429Error(error) {
  const text = String(error?.message || error || "").toLowerCase();

  return (
    text.includes("http error 429") ||
    text.includes("too many requests") ||
    text.includes("sign in to confirm you're not a bot")
  );
}

function isLoginRequired(error) {
  const text = String(error?.message || error || "").toLowerCase();

  return (
    text.includes("login_required") ||
    text.includes("sign in to confirm you're not a bot") ||
    text.includes("sign in to confirm you’re not a bot")
  );
}

function friendlyError(error) {
  if (is429Error(error)) {
    return {
      status: 429,
      message:
        "YouTube ने इस server की requests को फिलहाल सीमित कर दिया है। कृपया कुछ समय बाद दोबारा प्रयास करें।",
    };
  }

  if (isLoginRequired(error)) {
    return {
      status: 429,
      message:
        "YouTube ने इस server से वीडियो access करने के लिए verification मांगा है। अभी यह वीडियो प्राप्त नहीं हो सका।",
    };
  }

  return {
    status: 500,
    message: "वीडियो की जानकारी प्राप्त नहीं हो सकी।",
  };
}

// ------------------------------------
// YT-DLP RUNNER
// ------------------------------------

function runYtdlp(args, cwd = os.tmpdir()) {
  return new Promise((resolve, reject) => {
    console.log("");
    console.log("========================================");
    console.log("RUNNING YT-DLP");
    console.log("========================================");
    console.log(YTDLP, args.join(" "));
    console.log("");

    const child = spawn(YTDLP, args, {
      cwd,
      env: {
        ...process.env,
        HOME: "/tmp",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();

      stdout += text;

      if (stdout.length > 50000) {
        stdout = stdout.slice(-50000);
      }

      process.stdout.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();

      stderr += text;

      if (stderr.length > 10000) {
        stderr = stderr.slice(-10000);
      }

      process.stderr.write(text);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
        return;
      }

      const error = new Error(
        stderr.slice(-8000) ||
          `yt-dlp exited with code ${code}`
      );

      error.code = code;
      error.stderr = stderr;
      error.stdout = stdout;

      reject(error);
    });
  });
}

// ------------------------------------
// YOUTUBE ARGUMENTS
// ------------------------------------

function youtubeArgs() {
  return [
    "--no-warnings",

    // Node is already installed in the Docker image.
    "--js-runtimes",
    "node",

    // Current yt-dlp EJS support.
    "--remote-components",
    "ejs:github",

    // Recommended YouTube client for PO-token setup.
    "--extractor-args",
    "youtube:player_client=mweb",

    // Local bgutil HTTP provider.
    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${POT_PROVIDER_URL}`,
  ];
}

// ------------------------------------
// ROOT
// ------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    message: "API is running",
  });
});

// ------------------------------------
// HEALTH
// ------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    ytdlp: YTDLP,
    poTokenProvider: POT_PROVIDER_URL,
    node: process.version,
  });
});

// ------------------------------------
// VIDEO INFO
// ------------------------------------

app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || !validUrl(url)) {
    return res.status(400).json({
      ok: false,
      error: "कृपया एक सही public URL डालें।",
    });
  }

  const youtube = isYouTubeUrl(url);

  console.log("");
  console.log("========================================");
  console.log("INFO REQUEST");
  console.log("YouTube:", youtube);
  console.log("URL:", url);
  console.log("========================================");

  try {
    let args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
    ];

    // केवल YouTube पर YouTube-specific settings लगाएँ।
    if (youtube) {
      args.push(...youtubeArgs());
    }

    args.push(url);

    const result = await runYtdlp(args);

    let data;

    try {
      data = JSON.parse(result.stdout);
    } catch (parseError) {
      console.error("JSON PARSE ERROR:");
      console.error(parseError);

      throw new Error(
        "yt-dlp ने valid JSON response नहीं दिया।"
      );
    }

    return res.json({
      ok: true,
      title: data.title || "",
      thumbnail: data.thumbnail || "",
      duration: data.duration || 0,
      uploader:
        data.uploader ||
        data.channel ||
        data.creator ||
        "",
      webpage_url: data.webpage_url || url,
      extractor: data.extractor || "",
    });
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("INFO ERROR");
    console.error("========================================");
    console.error(error);
    console.error("");

    const friendly = friendlyError(error);

    return res.status(friendly.status).json({
      ok: false,
      error: friendly.message,
    });
  }
});

// ------------------------------------
// DOWNLOAD
// ------------------------------------

app.get("/api/download", async (req, res) => {
  const { format, url } = req.query;

  if (!url || !validUrl(url)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid URL",
    });
  }

  if (!["video", "audio"].includes(format)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid format",
    });
  }

  const youtube = isYouTubeUrl(url);

  const tempDir = path.join(
    os.tmpdir(),
    `social-${crypto.randomUUID()}`
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  console.log("");
  console.log("========================================");
  console.log("DOWNLOAD REQUEST");
  console.log("Format:", format);
  console.log("YouTube:", youtube);
  console.log("URL:", url);
  console.log("Temp:", tempDir);
  console.log("========================================");

  try {
    let args = [
      "--no-warnings",
      "--no-playlist",
      "--restrict-filenames",
    ];

    // YouTube-specific configuration
    if (youtube) {
      args.push(...youtubeArgs());
    }

    let outputTemplate;

    if (format === "audio") {
      outputTemplate = path.join(
        tempDir,
        "download.%(ext)s"
      );

      args.push(
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "128K",
        "-o",
        outputTemplate,
        url
      );
    } else {
      outputTemplate = path.join(
        tempDir,
        "download.%(ext)s"
      );

      args.push(
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        outputTemplate,
        url
      );
    }

    await runYtdlp(args, tempDir);

    let expectedFile;

    if (format === "audio") {
      expectedFile = path.join(
        tempDir,
        "download.mp3"
      );
    } else {
      expectedFile = path.join(
        tempDir,
        "download.mp4"
      );
    }

    // Normally this should be the exact output.
    // If yt-dlp/FFmpeg produced a slightly different
    // extension, look for the appropriate media file.
    let file = expectedFile;

    if (!fs.existsSync(file)) {
      const candidates = fs
        .readdirSync(tempDir)
        .filter((name) => {
          const lower = name.toLowerCase();

          if (format === "audio") {
            return [".mp3", ".m4a", ".opus", ".webm"]
              .some((ext) => lower.endsWith(ext));
          }

          return [".mp4", ".mkv", ".webm", ".mov"]
            .some((ext) => lower.endsWith(ext));
        });

      if (!candidates.length) {
        throw new Error(
          "yt-dlp ने कोई usable output file नहीं बनाई।"
        );
      }

      file = path.join(
        tempDir,
        candidates[0]
      );
    }

    const stat = fs.statSync(file);

    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(
        "Output media file invalid है।"
      );
    }

    const filename =
      format === "audio"
        ? "download.mp3"
        : "download.mp4";

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    res.setHeader(
      "Content-Length",
      stat.size
    );

    res.setHeader(
      "Content-Type",
      format === "audio"
        ? "audio/mpeg"
        : "video/mp4"
    );

    const stream = fs.createReadStream(file);

    stream.on("error", (error) => {
      console.error("STREAM ERROR:");
      console.error(error);

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: "Download stream failed",
        });
      } else {
        res.destroy(error);
      }
    });

    stream.on("close", () => {
      try {
        fs.rmSync(tempDir, {
          recursive: true,
          force: true,
        });
      } catch (cleanupError) {
        console.error(
          "Cleanup error:",
          cleanupError
        );
      }
    });

    stream.pipe(res);

    return;
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("DOWNLOAD ERROR");
    console.error("========================================");
    console.error(error);
    console.error("");

    try {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    } catch {}

    const friendly = friendlyError(error);

    if (!res.headersSent) {
      return res.status(friendly.status).json({
        ok: false,
        error:
          format === "audio"
            ? friendly.message.replace(
                "वीडियो",
                "ऑडियो"
              )
            : friendly.message,
      });
    }
  }
});

// ------------------------------------
// 404
// ------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// ------------------------------------
// SERVER
// ------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("========================================");
  console.log("SOCIAL VIDEO DOWNLOADER");
  console.log("========================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`yt-dlp: ${YTDLP}`);
  console.log(
    `PO Token Provider: ${POT_PROVIDER_URL}`
  );
  console.log(`Node: ${process.version}`);
  console.log("========================================");
});