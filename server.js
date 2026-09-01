import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const app = express();

// Render proxy के पीछे Express चल रहा है
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "*",
  methods: ["GET", "POST"]
}));

app.use(express.json({ limit: "20kb" }));

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

// URL validation
function validUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
}

// yt-dlp runner
function runYtdlp(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args, {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    p.stdout.on("data", d => {
      stdout += d.toString();
    });

    p.stderr.on("data", d => {
      stderr += d.toString();
    });

    p.on("error", err => {
      reject(err);
    });

    p.on("close", code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            stderr.slice(-6000) ||
            `yt-dlp exited with code ${code}`
          )
        );
      }
    });
  });
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader"
  });
});

// Video information
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
        "--no-warnings",
        "--skip-download",
        "--no-playlist",

        // YouTube JavaScript challenge support
        "--js-runtimes",
        "deno",

        // Download EJS challenge scripts from npm
        "--remote-components",
        "ejs:npm",

        url
      ],
      process.cwd()
    );

    const info = JSON.parse(out);

    res.json({
      title: info.title || "Video",
      thumbnail: info.thumbnail || "",
      duration: info.duration || 0,
      uploader: info.uploader || info.channel || "",
      webpage_url: info.webpage_url || url
    });

  } catch (err) {
    console.error("YTDLP INFO ERROR:");
    console.error(err);

    // असली error frontend को दिखाएँ
    res.status(422).json({
      error: "yt-dlp से वीडियो की जानकारी नहीं मिली।",
      detail: err.message || "Unknown yt-dlp error"
    });
  }
});

// Download
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
    path.join(tmpdir(), "svd-")
  );

  let finished = false;

  try {
    const output = path.join(
      work,
      "%(title).80s-%(id)s.%(ext)s"
    );

    const args = [
      "--no-playlist",
      "--no-warnings",
      "--restrict-filenames",

      // YouTube JavaScript challenge support
      "--js-runtimes",
      "deno",

      // EJS challenge scripts
      "--remote-components",
      "ejs:npm",

      "-o",
      output
    ];

    if (format === "audio") {
      args.push(
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "128K"
      );
    } else {
      args.push(
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"
      );

      args.push(
        "--merge-output-format",
        "mp4"
      );
    }

    args.push(url);

    await runYtdlp(args, process.cwd());

    const names = await readdir(work);

    const file = names.find(
      name =>
        !name.endsWith(".part") &&
        !name.endsWith(".ytdl")
    );

    if (!file) {
      throw new Error("No output file was created");
    }

    const full = path.join(work, file);

    const ext = path.extname(file).toLowerCase();

    const mime =
      ext === ".mp3"
        ? "audio/mpeg"
        : "video/mp4";

    res.setHeader(
      "Content-Type",
      mime
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.replace(
        /["\\]/g,
        "_"
      )}"`
    );

    const stream = createReadStream(full);

    stream.on("close", async () => {
      if (!finished) {
        finished = true;

        await rm(work, {
          recursive: true,
          force: true
        }).catch(() => {});
      }
    });

    stream.pipe(res);

  } catch (err) {
    console.error("YTDLP DOWNLOAD ERROR:");
    console.error(err);

    await rm(work, {
      recursive: true,
      force: true
    }).catch(() => {});

    if (!res.headersSent) {
      res.status(422).json({
        error: "Download failed",
        detail: err.message || "Unknown yt-dlp error"
      });
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(
    `Social Video Downloader API running on port ${PORT}`
  );
});
