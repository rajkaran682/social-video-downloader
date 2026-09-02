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

const YTDLP =
  process.env.YTDLP_PATH || "yt-dlp";

const POT_PROVIDER_URL =
  process.env.POT_PROVIDER_URL ||
  "http://127.0.0.1:4416";

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
// URL VALIDATION
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
      hostname === "m.youtube.com" ||
      hostname === "youtu.be" ||
      hostname.endsWith(".youtube.com")
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
    console.log("Running yt-dlp");
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
          stderr.slice(-8000) ||
            `yt-dlp exited with code ${code}`
        );

        error.code = code;

        reject(error);
      }
    });
  });
}


// =====================================================
// YOUTUBE ARGUMENTS
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
// GENERIC YT-DLP ARGUMENTS
// =====================================================

function baseArgs() {
  return [
    "--no-warnings",
    "--no-playlist",
    "--restrict-filenames",
  ];
}


// =====================================================
// ERROR CHECK
// =====================================================

function shouldTryFallback(error) {
  const message = String(
    error?.message || ""
  ).toLowerCase();

  return (
    message.includes("login_required") ||
    message.includes("sign in to confirm") ||
    message.includes("not a bot") ||
    message.includes("confirm you're not a bot") ||
    message.includes("confirm you’re not a bot") ||
    message.includes("video unavailable") ||
    message.includes("http error 403") ||
    message.includes("forbidden")
  );
}


// =====================================================
// GET INFO
// =====================================================

async function getVideoInfo(url) {
  const common = [
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
  ];

  // ---------------------------------------------------
  // YouTube
  // ---------------------------------------------------

  if (isYouTubeUrl(url)) {
    try {
      console.log("YouTube detected: trying mweb");

      const args = [
        ...common,
        ...youtubeArgs("mweb"),
        url,
      ];

      const result = await runYtdlp(args);

      return JSON.parse(result.stdout);
    } catch (firstError) {
      console.error("");
      console.error("YouTube mweb failed:");
      console.error(firstError.message);

      if (!shouldTryFallback(firstError)) {
        throw firstError;
      }

      // -----------------------------------------------
      // Fallback: TV client
      // -----------------------------------------------

      console.log("");
      console.log("Trying YouTube TV fallback...");

      const args = [
        ...common,
        ...youtubeArgs("tv"),
        url,
      ];

      const result = await runYtdlp(args);

      return JSON.parse(result.stdout);
    }
  }

  // ---------------------------------------------------
  // Other supported sites
  // ---------------------------------------------------

  const args = [
    ...common,
    url,
  ];

  const result = await runYtdlp(args);

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

    const data = await getVideoInfo(url);

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
// DOWNLOAD API
// =====================================================

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
    console.log("");
    console.log("========================================");
    console.log("DOWNLOAD REQUEST");
    console.log("FORMAT:", format);
    console.log("URL:", url);
    console.log("TEMP:", tempDir);
    console.log("========================================");

    let args = [
      ...baseArgs(),
    ];

    // -------------------------------------------------
    // YouTube
    // -------------------------------------------------

    if (isYouTubeUrl(url)) {
      args.push(
        ...youtubeArgs("mweb")
      );
    }

    // -------------------------------------------------
    // Output
    // -------------------------------------------------

    let outputFile;

    if (format === "audio") {
      const outputTemplate = path.join(
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

      await runYtdlp(
        args,
        tempDir
      );

      const mp3Files = fs
        .readdirSync(tempDir)
        .filter(
          (file) =>
            file.toLowerCase().endsWith(".mp3")
        );

      if (!mp3Files.length) {
        throw new Error(
          "MP3 output file नहीं मिली।"
        );
      }

      outputFile = path.join(
        tempDir,
        mp3Files[0]
      );
    } else {
      const outputTemplate = path.join(
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

      try {
        await runYtdlp(
          args,
          tempDir
        );
      } catch (firstError) {
        console.error("");
        console.error(
          "Video mweb download failed:"
        );

        console.error(
          firstError.message
        );

        // ---------------------------------------------
        // YouTube TV fallback
        // ---------------------------------------------

        if (
          isYouTubeUrl(url) &&
          shouldTryFallback(firstError)
        ) {
          console.log("");
          console.log(
            "Trying YouTube TV download fallback..."
          );

          args = [
            ...baseArgs(),

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
            args,
            tempDir
          );
        } else {
          throw firstError;
        }
      }

      const mp4Files = fs
        .readdirSync(tempDir)
        .filter(
          (file) =>
            file.toLowerCase().endsWith(".mp4")
        );

      if (!mp4Files.length) {
        throw new Error(
          "MP4 output file नहीं मिली।"
        );
      }

      outputFile = path.join(
        tempDir,
        mp4Files[0]
      );
    }

    // -------------------------------------------------
    // Validate output
    // -------------------------------------------------

    if (
      !outputFile ||
      !fs.existsSync(outputFile)
    ) {
      throw new Error(
        "Output file नहीं मिली।"
      );
    }

    const stat =
      fs.statSync(outputFile);

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

    // -------------------------------------------------
    // Response headers
    // -------------------------------------------------

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

    // -------------------------------------------------
    // Stream
    // -------------------------------------------------

    const stream =
      fs.createReadStream(
        outputFile
      );

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
      } catch (cleanupError) {
        console.error(
          "Cleanup error:",
          cleanupError
        );
      }
    };

    stream.on(
      "error",
      (err) => {
        console.error(
          "STREAM ERROR:",
          err
        );

        cleanup();

        if (!res.headersSent) {
          res.status(500).json({
            ok: false,
            error:
              "Download stream failed",
          });
        } else {
          res.destroy(err);
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

    return;
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
// SERVER
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log("========================================");
    console.log("SOCIAL VIDEO DOWNLOADER API");
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