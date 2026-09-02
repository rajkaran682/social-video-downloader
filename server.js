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


// =====================================================
// URL
// =====================================================

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


// =====================================================
// YOUTUBE DETECTION
// =====================================================

function isYouTubeUrl(url) {
  try {
    const hostname = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}


// =====================================================
// RUN YT-DLP
// =====================================================

function runYtdlp(args, cwd = os.tmpdir()) {
  return new Promise((resolve, reject) => {
    console.log("");
    console.log("========================================");
    console.log("YT-DLP");
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

      const error = new Error(
        stderr.slice(-8000) ||
          `yt-dlp exited with code ${code}`
      );

      error.code = code;

      reject(error);
    });
  });
}


// =====================================================
// YOUTUBE CONFIG
// =====================================================

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


// =====================================================
// COMMON
// =====================================================

function commonArgs() {
  return [
    "--no-warnings",
    "--no-playlist",
    "--restrict-filenames",
  ];
}


// =====================================================
// DETERMINE FALLBACK
// =====================================================

function canFallback(error) {
  const msg = String(
    error?.message || ""
  ).toLowerCase();

  return (
    msg.includes("sign in to confirm") ||
    msg.includes("you're not a bot") ||
    msg.includes("you’re not a bot") ||
    msg.includes("login_required") ||
    msg.includes("http error 429")
  );
}


// =====================================================
// INFO - YOUTUBE
// =====================================================

async function getYouTubeInfo(url) {
  const common = [
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
  ];

  // First attempt: mweb + PO token
  try {
    console.log("YouTube INFO: mweb");

    const result = await runYtdlp([
      ...common,
      ...youtubeArgs("mweb"),
      url,
    ]);

    return JSON.parse(result.stdout);
  } catch (error) {
    console.error(
      "YouTube mweb INFO failed:",
      error.message
    );

    // Second attempt only for known YouTube blocking
    if (!canFallback(error)) {
      throw error;
    }

    console.log(
      "YouTube INFO fallback: tv"
    );

    const result = await runYtdlp([
      ...common,
      ...youtubeArgs("tv"),
      url,
    ]);

    return JSON.parse(result.stdout);
  }
}


// =====================================================
// INFO - OTHER SITES
// =====================================================

async function getOtherInfo(url) {
  const result = await runYtdlp([
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    url,
  ]);

  return JSON.parse(result.stdout);
}


// =====================================================
// ROOT
// =====================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    message: "API is running",
  });
});


// =====================================================
// HEALTH
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "social-video-downloader",
    ytdlp: YTDLP,
    poTokenProvider: POT_PROVIDER_URL,
    node: process.version,
  });
});


// =====================================================
// INFO API
// =====================================================

app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url || !validUrl(url)) {
    return res.status(400).json({
      ok: false,
      error: "कृपया एक सही public URL डालें।",
    });
  }

  try {
    console.log("");
    console.log("========================================");
    console.log("INFO REQUEST");
    console.log("URL:", url);
    console.log("========================================");

    const data = isYouTubeUrl(url)
      ? await getYouTubeInfo(url)
      : await getOtherInfo(url);

    return res.json({
      ok: true,

      title: data.title || "",

      thumbnail:
        data.thumbnail ||
        data.thumbnails?.at?.(-1)?.url ||
        "",

      duration:
        data.duration || 0,

      uploader:
        data.uploader ||
        data.channel ||
        data.creator ||
        "",

      webpage_url:
        data.webpage_url ||
        url,
    });
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("INFO ERROR");
    console.error("========================================");
    console.error(error);

    return res.status(500).json({
      ok: false,

      error:
        "वीडियो की जानकारी प्राप्त नहीं हो सकी।",

      details:
        process.env.NODE_ENV === "development"
          ? String(
              error.message || error
            )
          : undefined,
    });
  }
});


// =====================================================
// DOWNLOAD
// =====================================================

app.get("/api/download", async (req, res) => {
  const { format, url } = req.query;

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

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  try {
    console.log("");
    console.log("========================================");
    console.log("DOWNLOAD");
    console.log("FORMAT:", format);
    console.log("URL:", url);
    console.log("========================================");

    const isYT = isYouTubeUrl(url);

    // -------------------------------------------------
    // AUDIO
    // -------------------------------------------------

    if (format === "audio") {
      const outputTemplate = path.join(
        tempDir,
        "audio.%(ext)s"
      );

      const args = [
        ...commonArgs(),
      ];

      if (isYT) {
        args.push(
          ...youtubeArgs("mweb")
        );
      }

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

      try {
        await runYtdlp(
          args,
          tempDir
        );
      } catch (error) {
        console.error(
          "Audio first attempt failed:",
          error.message
        );

        if (
          isYT &&
          canFallback(error)
        ) {
          console.log(
            "Audio fallback: YouTube tv"
          );

          const fallbackArgs = [
            ...commonArgs(),

            ...youtubeArgs("tv"),

            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "128K",
            "-o",
            outputTemplate,
            url,
          ];

          await runYtdlp(
            fallbackArgs,
            tempDir
          );
        } else {
          throw error;
        }
      }

      const files = fs
        .readdirSync(tempDir)
        .filter(
          (file) =>
            file
              .toLowerCase()
              .endsWith(".mp3")
        );

      if (!files.length) {
        throw new Error(
          "MP3 output file नहीं मिली।"
        );
      }

      const filePath = path.join(
        tempDir,
        files[0]
      );

      return sendFile(
        req,
        res,
        filePath,
        tempDir,
        "download.mp3",
        "audio/mpeg"
      );
    }


    // -------------------------------------------------
    // VIDEO
    // -------------------------------------------------

    const outputTemplate = path.join(
      tempDir,
      "video.%(ext)s"
    );

    const args = [
      ...commonArgs(),
    ];

    if (isYT) {
      args.push(
        ...youtubeArgs("mweb")
      );
    }

    args.push(
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",

      "--merge-output-format",
      "mp4",

      "-o",
      outputTemplate,

      url
    );

    try {
      await runYtdlp(
        args,
        tempDir
      );
    } catch (error) {
      console.error(
        "Video first attempt failed:",
        error.message
      );

      if (
        isYT &&
        canFallback(error)
      ) {
        console.log(
          "Video fallback: YouTube tv"
        );

        const fallbackArgs = [
          ...commonArgs(),

          ...youtubeArgs("tv"),

          "-f",
          "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",

          "--merge-output-format",
          "mp4",

          "-o",
          outputTemplate,

          url,
        ];

        await runYtdlp(
          fallbackArgs,
          tempDir
        );
      } else {
        throw error;
      }
    }

    const files = fs
      .readdirSync(tempDir)
      .filter(
        (file) =>
          file
            .toLowerCase()
            .endsWith(".mp4")
      );

    if (!files.length) {
      throw new Error(
        "MP4 output file नहीं मिली।"
      );
    }

    const filePath = path.join(
      tempDir,
      files[0]
    );

    return sendFile(
      req,
      res,
      filePath,
      tempDir,
      "download.mp4",
      "video/mp4"
    );
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("DOWNLOAD ERROR");
    console.error("========================================");

    console.error(error);

    try {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch {}

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,

        error:
          "वीडियो डाउनलोड नहीं हो सका।",

        details:
          process.env.NODE_ENV === "development"
            ? String(
                error.message || error
              )
            : undefined,
      });
    }
  }
});


// =====================================================
// SEND FILE
// =====================================================

function sendFile(
  req,
  res,
  filePath,
  tempDir,
  filename,
  contentType
) {
  if (
    !filePath ||
    !fs.existsSync(filePath)
  ) {
    throw new Error(
      "Output file नहीं मिली।"
    );
  }

  const stat =
    fs.statSync(filePath);

  if (!stat.isFile()) {
    throw new Error(
      "Output file invalid है।"
    );
  }

  if (stat.size <= 0) {
    throw new Error(
      "Output file खाली है।"
    );
  }

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
    contentType
  );

  const stream =
    fs.createReadStream(filePath);

  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;

    cleaned = true;

    try {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch (error) {
      console.error(
        "Cleanup error:",
        error
      );
    }
  };

  stream.on(
    "error",
    (error) => {
      console.error(
        "STREAM ERROR:",
        error
      );

      cleanup();

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error:
            "Download stream failed",
        });
      } else {
        res.destroy(error);
      }
    }
  );

  stream.on(
    "close",
    cleanup
  );

  res.on(
    "close",
    cleanup
  );

  stream.pipe(res);
}


// =====================================================
// 404
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});


// =====================================================
// START
// =====================================================

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
  }
);