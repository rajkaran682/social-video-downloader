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

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);


// ===============================
// URL VALIDATION
// ===============================

function validUrl(value) {
  try {
    const u = new URL(value);

    return (
      u.protocol === "http:" ||
      u.protocol === "https:"
    );
  } catch {
    return false;
  }
}


// ===============================
// YT-DLP RUNNER
// ===============================

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

      process.stdout.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();

      stderr += text;

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

      const message =
        stderr.slice(-6000) ||
        `yt-dlp exited with code ${code}`;

      const error = new Error(message);

      error.code = code;

      reject(error);
    });
  });
}


// ===============================
// YOUTUBE DETECTION
// ===============================

function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();

    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtu.be" ||
      hostname === "www.youtu.be"
    );
  } catch {
    return false;
  }
}


// ===============================
// YOUTUBE ARGUMENTS
// ===============================

function youtubeArgs(client = "mweb") {
  return [
    "--js-runtimes",
    "node",

    "--remote-components",
    "ejs:github",

    "--extractor-args",
    `youtube:player_client=${client}`,

    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${POT_PROVIDER_URL}`,
  ];
}


// ===============================
// FRIENDLY ERROR
// ===============================

function friendlyError(error) {
  const message = String(
    error?.message ||
    error ||
    ""
  );

  if (
    message.includes("Sign in to confirm") ||
    message.includes("LOGIN_REQUIRED") ||
    message.includes("HTTP Error 429") ||
    message.includes("Too Many Requests")
  ) {
    return (
      "इस समय YouTube ने इस server से request को अस्थायी रूप से रोक दिया है। " +
      "कुछ समय बाद दोबारा प्रयास करें या किसी दूसरे supported public URL को आज़माएँ।"
    );
  }

  if (
    message.includes("Private video") ||
    message.includes("This video is private")
  ) {
    return "यह वीडियो private है और डाउनलोड नहीं किया जा सकता।";
  }

  if (
    message.includes("Video unavailable") ||
    message.includes("is unavailable")
  ) {
    return "यह वीडियो उपलब्ध नहीं है या इस region में उपलब्ध नहीं है।";
  }

  if (
    message.includes("age-restricted") ||
    message.includes("Sign in to confirm your age")
  ) {
    return "यह वीडियो age-restricted है और इस server से उपलब्ध नहीं हो सका।";
  }

  return "वीडियो की जानकारी प्राप्त नहीं हो सकी।";
}


// ===============================
// ROOT
// ===============================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    message: "API is running",
  });
});


// ===============================
// HEALTH
// ===============================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    ytdlp: YTDLP,
    poTokenProvider: POT_PROVIDER_URL,
    node: process.version,
  });
});


// ===============================
// VIDEO INFO
// ===============================

app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || !validUrl(url)) {
    return res.status(400).json({
      ok: false,
      error: "कृपया एक सही public URL डालें।",
    });
  }

  try {
    let args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
    ];

    if (isYouTubeUrl(url)) {
      args.push(
        ...youtubeArgs("mweb")
      );
    }

    args.push(url);

    const result = await runYtdlp(args);

    let data;

    try {
      data = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        "yt-dlp ने valid JSON नहीं लौटाया।"
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
        "",

      webpage_url:
        data.webpage_url ||
        url,

      extractor:
        data.extractor ||
        "",

      platform:
        data.extractor_key ||
        data.extractor ||
        "",
    });

  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("INFO ERROR");
    console.error("========================================");
    console.error(error);
    console.error("");

    return res.status(500).json({
      ok: false,

      error: friendlyError(error),

      details:
        process.env.NODE_ENV === "development"
          ? String(
              error?.message ||
              error
            )
          : undefined,
    });
  }
});


// ===============================
// DOWNLOAD
// ===============================

app.get("/api/download", async (req, res) => {
  const {
    format,
    url,
  } = req.query;

  if (!url || !validUrl(url)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid URL",
    });
  }

  if (
    !["video", "audio"].includes(format)
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid format",
    });
  }

  const tempDir = path.join(
    os.tmpdir(),
    `social-${crypto.randomUUID()}`
  );

  fs.mkdirSync(
    tempDir,
    {
      recursive: true,
    }
  );

  try {
    let args = [
      "--no-warnings",
      "--no-playlist",
      "--restrict-filenames",
    ];

    if (isYouTubeUrl(url)) {
      args.push(
        ...youtubeArgs("mweb")
      );
    }

    let outputTemplate;

    if (format === "audio") {
      outputTemplate = path.join(
        tempDir,
        "audio.%(ext)s"
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
        "video.%(ext)s"
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

    await runYtdlp(
      args,
      tempDir
    );

    const files =
      fs.readdirSync(tempDir);

    let fileName;

    if (format === "audio") {
      fileName = files.find(
        (file) =>
          file.toLowerCase().endsWith(".mp3")
      );
    } else {
      fileName = files.find(
        (file) =>
          file.toLowerCase().endsWith(".mp4")
      );
    }

    if (!fileName) {
      throw new Error(
        "yt-dlp ने requested output file नहीं बनाई।"
      );
    }

    const file = path.join(
      tempDir,
      fileName
    );

    const stat =
      fs.statSync(file);

    if (!stat.isFile()) {
      throw new Error(
        "Output file invalid है।"
      );
    }

    const downloadName =
      format === "audio"
        ? "download.mp3"
        : "download.mp4";

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName}"`
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

    const stream =
      fs.createReadStream(file);

    stream.on(
      "error",
      (error) => {
        console.error(
          "STREAM ERROR:",
          error
        );

        if (!res.headersSent) {
          res.status(500).json({
            ok: false,
            error: "Download stream failed",
          });
        } else {
          res.destroy(error);
        }
      }
    );

    stream.pipe(res);

    stream.on(
      "close",
      () => {
        fs.rmSync(
          tempDir,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    return;

  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("DOWNLOAD ERROR");
    console.error("========================================");
    console.error(error);
    console.error("");

    fs.rmSync(
      tempDir,
      {
        recursive: true,
        force: true,
      }
    );

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,

        error:
          friendlyError(error),

        details:
          process.env.NODE_ENV === "development"
            ? String(
                error?.message ||
                error
              )
            : undefined,
      });
    }
  }
});


// ===============================
// 404
// ===============================

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});


// ===============================
// SERVER
// ===============================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log("========================================");
    console.log("SOCIAL VIDEO DOWNLOADER");
    console.log("========================================");
    console.log(
      `Server running on port ${PORT}`
    );
    console.log(
      `yt-dlp: ${YTDLP}`
    );
    console.log(
      `PO Token Provider: ${POT_PROVIDER_URL}`
    );
    console.log(
      `Node: ${process.version}`
    );
    console.log("========================================");
    console.log("");
  }
);