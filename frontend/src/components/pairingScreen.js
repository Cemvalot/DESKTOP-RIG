// frontend/src/components/pairingScreen.js
// Pairing screen (architecture-security.md §2.2): manual 6-char code entry
// is the primary path; browser-native BarcodeDetector QR scanning is
// attempted opportunistically where available (feature-detected — no
// external QR library). Shown when no token is stored or a request 401s.

import { el, getLayer } from "./dom.js";
import { iconMarkup } from "./icons.js";
import { hapticPress, hapticSuccess, hapticFailure } from "./feedback.js";
import { showToast } from "./toast.js";

const CODE_LEN = 6;

export function createPairingScreen({ provider, onPaired }) {
  const inputs = [];
  const inputRow = el("div", { class: "pairing-code-input" });
  for (let i = 0; i < CODE_LEN; i++) {
    const input = el("input", {
      type: "text",
      maxlength: "1",
      inputmode: "text",
      autocapitalize: "characters",
      "data-idx": String(i),
    });
    inputs.push(input);
    inputRow.appendChild(input);
  }

  const statusEl = el("div", { class: "pairing-status" }, "Enter the 6-character code shown on the PC.");
  const submitBtn = el("button", { class: "btn-secondary press-scale" }, "Pair Device");
  const wolBtn = el("button", { class: "btn-secondary press-scale", html: `${iconMarkup("power")} Wake PC` });
  const video = el("video", { class: "pairing-video", autoplay: true, muted: true, playsinline: true });
  video.style.display = "none";

  const screen = el("div", { class: "pairing-screen" }, [
    el("h1", {}, "Pair with your PC"),
    video,
    inputRow,
    submitBtn,
    statusEl,
    el("div", { style: "display:flex; gap:16px;" }, [wolBtn]),
  ]);
  getLayer("overlay-root").appendChild(screen);

  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().slice(-1);
      if (input.value && i < CODE_LEN - 1) inputs[i + 1].focus();
      if (inputs.every((inp) => inp.value)) attemptPair();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
    });
  });

  function getCode() {
    return inputs.map((i) => i.value).join("");
  }
  function setCode(code) {
    code
      .toUpperCase()
      .slice(0, CODE_LEN)
      .split("")
      .forEach((ch, i) => (inputs[i].value = ch));
  }

  async function attemptPair() {
    const code = getCode();
    if (code.length !== CODE_LEN) return;
    hapticPress();
    statusEl.textContent = "Pairing…";
    try {
      await provider.pair(code, deviceNameGuess());
      hapticSuccess();
      statusEl.textContent = "Paired!";
      stopCamera();
      screen.remove();
      if (onPaired) onPaired();
    } catch (err) {
      hapticFailure();
      statusEl.textContent = err && err.code === "PROVIDER_ERROR" ? err.message : describePairError(err);
      inputs.forEach((i) => (i.value = ""));
      inputs[0].focus();
    }
  }

  function describePairError(err) {
    if (!err) return "Pairing failed.";
    if (err.status === 410) return "That code expired — ask the PC owner to generate a new one.";
    if (err.status === 401) return "Incorrect code. Try again.";
    if (err.status === 429) return "Too many attempts — wait a moment and try again.";
    return err.message || "Pairing failed.";
  }

  submitBtn.addEventListener("click", attemptPair);
  wolBtn.addEventListener("click", async () => {
    hapticPress();
    try {
      await provider.wol();
      showToast({ type: "success", message: "Wake-on-LAN packet sent." });
    } catch (err) {
      showToast({ type: "error", message: "Could not send Wake-on-LAN packet." });
    }
  });

  // ── Opportunistic BarcodeDetector-based QR scan (feature-detected) ─────
  let stream = null;
  let scanTimer = null;

  function stopCamera() {
    clearInterval(scanTimer);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.style.display = "none";
  }

  async function tryStartScanner() {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (formats && !formats.includes("qr_code")) return;
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      video.style.display = "block";
      scanTimer = setInterval(async () => {
        try {
          const codes = await detector.detect(video);
          if (codes.length) handleScannedText(codes[0].rawValue);
        } catch (_) {
          /* transient decode errors are expected between frames */
        }
      }, 400);
    } catch (_) {
      // No camera permission/hardware — manual entry remains the path.
      stopCamera();
    }
  }

  function handleScannedText(text) {
    try {
      let code = null;
      if (text.startsWith("launchpad://")) {
        code = new URL(text.replace("launchpad://", "https://placeholder/")).searchParams.get("code");
      } else if (text.startsWith("http")) {
        code = new URL(text).searchParams.get("code");
      }
      if (code && code.length === CODE_LEN) {
        setCode(code);
        stopCamera();
        attemptPair();
      }
    } catch (_) {
      /* ignore unparsable scans */
    }
  }

  function deviceNameGuess() {
    const ua = navigator.userAgent || "";
    if (/SM-X20|Galaxy Tab A8/.test(ua)) return "Galaxy Tab A8";
    return "Launchpad Tablet";
  }

  tryStartScanner();
  inputs[0].focus();

  return {
    el: screen,
    destroy() {
      stopCamera();
      screen.remove();
    },
  };
}
