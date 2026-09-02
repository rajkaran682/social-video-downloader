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

/*
 * Render is behind a reverse proxy.
 * This prevents express-rate-limit from rejecting
 * the X-Forwarded-For header.
 */
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

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------

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

function runYtdlp(args, cwd = os.tmpdir()) {
  return new Promise((resolve, reject) => {
    console.log("Running yt-dlp:");
    console.log(YTDLP, args.join(" "));

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

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
      } else {
        const error = new Error(
          stderr.slice(-6000) ||
            `yt-dlp exited with code ${code}`
        );

        error.code = code;

        reject(error);
      }
    });
  });
}

// ----------------------------------------------------
// YouTube / yt-dlp arguments
// ----------------------------------------------------

function youtubeArgs() {
  return [
    "--no-warnings",

    /*
     * Current yt-dlp recommended approach:
     * mweb + PO Token Provider
     */
    "--extractor-args",
    "youtube:player_client=mweb",

    /*
     * Tell bgutil plugin where its local HTTP
     * PO Token provider is running.
     */
    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${POT_PROVIDER_URL}`,
  ];
}

// ----------------------------------------------------
// Health
// ----------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    message: "API is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    ytdlp: YTDLP,
    poTokenProvider: POT_PROVIDER_URL,
  });
});

// ----------------------------------------------------
// INFO
// ----------------------------------------------------

app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || !validUrl(url)) {
    return res.status(400).json({
      ok: false,
      error: "कृपया एक सही public URL डालें।",
    });
  }

  try {
    const args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",

      ...youtubeArgs(),

      url,
    ];

    const result = await runYtdlp(args);

    const data = JSON.parse(result.stdout);

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
    });
  } catch (error) {
    console.error("INFO ERROR:");
    console.error(error);

    return res.status(500).json({
      ok: false,
      error:
        "वीडियो की जानकारी प्राप्त नहीं हो सकी।",
      details:
        process.env.NODE_ENV === "development"
          ? String(error.message || error)
          : undefined,
    });
  }
});

// ----------------------------------------------------
// DOWNLOAD
// ----------------------------------------------------

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

  const tempDir = path.join(
    os.tmpdir(),
    `social-${crypto.randomUUID()}`
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  try {
    let args = [
      "--no-warnings",
      "--no-playlist",
      "--restrict-filenames",

      ...youtubeArgs(),
    ];

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

    await runYtdlp(args, tempDir);

    const files = fs
      .readdirSync(tempDir)
      .filter(
        (file) =>
          file !== "." &&
          file !== ".."
      );

    if (!files.length) {
      throw new Error(
        "yt-dlp ने कोई output file नहीं बनाई।"
      );
    }

    const file = path.join(
      tempDir,
      files[0]
    );

    const stat = fs.statSync(file);

    if (!stat.isFile()) {
      throw new Error(
        "Output file invalid है।"
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

    stream.on("error", (err) => {
      console.error(
        "STREAM ERROR:",
        err
      );

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: "Download stream failed",
        });
      } else {
        res.destroy(err);
      }
    });

    stream.pipe(res);

    stream.on("close", () => {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    });

    return;
  } catch (error) {
    console.error("DOWNLOAD ERROR:");
    console.error(error);

    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error:
          "वीडियो डाउनलोड नहीं हो सका।",
        details:
          process.env.NODE_ENV === "development"
            ? String(error.message || error)
            : undefined,
      });
    }
  }
});

// ----------------------------------------------------
// 404
// ----------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// ----------------------------------------------------
// Start
// ----------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server running on port ${PORT}`
  );

  console.log(
    `PO Token Provider: ${POT_PROVIDER_URL}`
  );
});
