/** Browser voice helpers: speech-to-text (Chromium) and text-to-speech (everywhere). */

type RecognitionResult = { 0: { transcript: string }; isFinal: boolean };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

const SR = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechSupported = (): boolean => !!SR();
export const ttsSupported = (): boolean => "speechSynthesis" in window;

export function listVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en") || v.default);
}

/** Some browsers populate voices asynchronously; resolve once they arrive. */
export function onVoicesReady(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!ttsSupported()) return () => undefined;
  const fire = () => cb(listVoices());
  fire();
  window.speechSynthesis.addEventListener("voiceschanged", fire);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", fire);
}

const speechText = (text: string) =>
  text
    .replace(/[*_`#>]/g, "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

export function speak(text: string, opts: { rate?: number; voiceURI?: string } = {}): void {
  if (!ttsSupported() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speechText(text));
  u.rate = Math.max(0.6, Math.min(1.6, opts.rate ?? 1));
  u.pitch = 1.06;
  if (opts.voiceURI) {
    const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === opts.voiceURI);
    if (v) u.voice = v;
  }
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

export interface ListenHandlers {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** Start one dictation. Returns a stop function. */
export function listen(h: ListenHandlers): () => void {
  const Ctor = SR();
  if (!Ctor) {
    h.onError?.("Voice input needs Chrome or Edge");
    return () => undefined;
  }
  const rec = new Ctor();
  rec.lang = navigator.language || "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) h.onInterim?.(interim);
  };
  rec.onerror = (e) => {
    const map: Record<string, string> = {
      "not-allowed": "Microphone permission was blocked",
      "no-speech": "I didn't hear anything",
      "audio-capture": "No microphone found",
      network: "Voice input is offline",
    };
    h.onError?.(map[e.error ?? ""] ?? "Voice input failed");
  };
  rec.onend = () => {
    if (finalText.trim()) h.onFinal(finalText.trim());
    h.onEnd?.();
  };
  try {
    rec.start();
  } catch {
    h.onError?.("Voice input is already running");
  }
  return () => {
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
  };
}
