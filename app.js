const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const result = document.querySelector("#result");
const thumb = document.querySelector("#thumb");
const title = document.querySelector("#title");
const meta = document.querySelector("#meta");
const status = document.querySelector("#status");
const videoBtn = document.querySelector("#videoBtn");
const audioBtn = document.querySelector("#audioBtn");
const checkBtn = document.querySelector("#checkBtn");

// Render Backend
const API = "https://social-video-downloader-1qsa.onrender.com";


function setStatus(text, error = false) {
  status.textContent = text;
  status.style.color = error ? "#b42318" : "";
}


function setLoading(loading) {

  checkBtn.disabled = loading;

  if (loading) {

    checkBtn.textContent = "Checking...";
    checkBtn.style.opacity = "0.7";
    checkBtn.style.cursor = "wait";

  } else {

    checkBtn.textContent = "Check Video";
    checkBtn.style.opacity = "";
    checkBtn.style.cursor = "";

  }
}


function isValidHttpUrl(value) {

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


function resetResult() {

  result.classList.add("hidden");

  title.textContent = "Video";
  meta.textContent = "";

  thumb.removeAttribute("src");
  thumb.style.display = "none";

  videoBtn.removeAttribute("href");
  audioBtn.removeAttribute("href");

}


function buildDownloadUrl(format, url) {

  return (
    `${API}/api/download?format=${format}&url=` +
    encodeURIComponent(url)
  );

}


form.addEventListener("submit", async (e) => {

  e.preventDefault();

  const url = urlInput.value.trim();

  resetResult();

  if (!url) {

    setStatus(
      "कृपया वीडियो URL डालें।",
      true
    );

    return;
  }


  if (!isValidHttpUrl(url)) {

    setStatus(
      "कृपया सही HTTP/HTTPS वीडियो URL डालें।",
      true
    );

    return;
  }


  setLoading(true);

  setStatus(
    "Video information जाँची जा रही है…"
  );


  try {

    const response = await fetch(
      `${API}/api/info`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          url: url
        })
      }
    );


    const raw = await response.text();

    let data;

    try {

      data = JSON.parse(raw);

    } catch {

      throw new Error(
        "Server से सही response नहीं मिला। कृपया थोड़ी देर बाद फिर कोशिश करें।"
      );

    }


    if (!response.ok) {

      let message =
        data.error ||
        "इस URL की जानकारी प्राप्त नहीं हो सकी।";

      if (data.detail) {

        console.error(
          "Backend detail:",
          data.detail
        );

      }

      throw new Error(message);

    }


    title.textContent =
      data.title || "Video";


    const information = [];


    if (data.uploader) {

      information.push(
        data.uploader
      );

    }


    if (data.duration) {

      const seconds =
        Math.round(
          Number(data.duration)
        );

      information.push(
        `${seconds} sec`
      );

    }


    meta.textContent =
      information.join(" • ");


    if (data.thumbnail) {

      thumb.src = data.thumbnail;

      thumb.alt =
        data.title ||
        "Video thumbnail";

      thumb.style.display =
        "block";

    } else {

      thumb.removeAttribute("src");

      thumb.style.display =
        "none";

    }


    videoBtn.href =
      buildDownloadUrl(
        "video",
        url
      );


    audioBtn.href =
      buildDownloadUrl(
        "audio",
        url
      );


    result.classList.remove(
      "hidden"
    );


    setStatus(
      "Ready — नीचे अपना format चुनें।"
    );


  } catch (error) {

    console.error(
      "API ERROR:",
      error
    );

    resetResult();

    setStatus(
      error.message ||
      "Video information प्राप्त नहीं हो सकी।",
      true
    );

  } finally {

    setLoading(false);

  }

});


videoBtn.addEventListener(
  "click",
  () => {

    setStatus(
      "MP4 download तैयार किया जा रहा है…"
    );

  }
);


audioBtn.addEventListener(
  "click",
  () => {

    setStatus(
      "MP3 download तैयार किया जा रहा है…"
    );

  }
);