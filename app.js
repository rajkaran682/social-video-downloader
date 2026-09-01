const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const result = document.querySelector("#result");
const thumb = document.querySelector("#thumb");
const title = document.querySelector("#title");
const meta = document.querySelector("#meta");
const status = document.querySelector("#status");
const videoBtn = document.querySelector("#videoBtn");
const audioBtn = document.querySelector("#audioBtn");

// Same-origin API
const API = "";

function setStatus(text, error = false) {
  status.textContent = text;
  status.style.color = error ? "#b42318" : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const url = urlInput.value.trim();

  if (!url) {
    setStatus("कृपया वीडियो URL डालें।", true);
    return;
  }

  result.classList.add("hidden");
  setStatus("Video information जाँची जा रही है…");

  try {
    const r = await fetch(`${API}/api/info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });

    // पहले response को text के रूप में पढ़ेंगे
    // ताकि HTML/error आने पर Unexpected token '<' न आए
    const raw = await r.text();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Server ने JSON के बजाय यह response दिया:\n\n${raw.slice(0, 1000)}`
      );
    }

    if (!r.ok) {
      let message = data.error || "URL check failed";

      if (data.detail) {
        message += `\n\nअसली yt-dlp error:\n${data.detail}`;
      }

      throw new Error(message);
    }

    title.textContent = data.title || "Video";

    meta.textContent = [
      data.uploader,
      data.duration
        ? `${Math.round(data.duration)} sec`
        : ""
    ]
      .filter(Boolean)
      .join(" • ");

    if (data.thumbnail) {
      thumb.src = data.thumbnail;
      thumb.style.display = "block";
    } else {
      thumb.removeAttribute("src");
      thumb.style.display = "none";
    }

    const encoded = encodeURIComponent(url);

    videoBtn.href =
      `/api/download?format=video&url=${encoded}`;

    audioBtn.href =
      `/api/download?format=audio&url=${encoded}`;

    result.classList.remove("hidden");

    setStatus("Ready — format चुनें।");

  } catch (err) {
    console.error(err);

    setStatus(
      err.message || "Video information प्राप्त नहीं हो सकी।",
      true
    );
  }
});
