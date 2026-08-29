const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const result = document.querySelector("#result");
const thumb = document.querySelector("#thumb");
const title = document.querySelector("#title");
const meta = document.querySelector("#meta");
const status = document.querySelector("#status");
const videoBtn = document.querySelector("#videoBtn");
const audioBtn = document.querySelector("#audioBtn");

const API = ""; // Same-origin. If frontend is hosted separately, set this to your API URL.

function setStatus(text, error=false) {
  status.textContent = text;
  status.style.color = error ? "#b42318" : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  result.classList.add("hidden");
  setStatus("Video information जाँची जा रही है…");

  try {
    const r = await fetch(`${API}/api/info`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({url})
    });
    const data = await r.json();

    if (!r.ok) throw new Error(data.error || "URL check failed");

    title.textContent = data.title || "Video";
    meta.textContent = [
      data.uploader,
      data.duration ? `${Math.round(data.duration)} sec` : ""
    ].filter(Boolean).join(" • ");

    if (data.thumbnail) {
      thumb.src = data.thumbnail;
      thumb.style.display = "block";
    } else {
      thumb.removeAttribute("src");
      thumb.style.display = "none";
    }

    const encoded = encodeURIComponent(url);
    videoBtn.href = `/api/download?format=video&url=${encoded}`;
    audioBtn.href = `/api/download?format=audio&url=${encoded}`;

    result.classList.remove("hidden");
    setStatus("Ready — format चुनें।");
  } catch (err) {
    setStatus(err.message, true);
  }
});