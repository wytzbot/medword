// MedWord Sound Manager
// - Soft synthesized piano ambience
// - Successful-word sound
// - Immediate level-completion voice
// - Independent volume controls
// - Stops audio when the app is backgrounded
// - No copyrighted audio files

let ctx = null;
let enabled = true;
let unlocked = false;

let ambientNodes = [];
let ambientMaster = null;

let successfulWordVolume = 0.07;
let pianoVolume = 0.055;
let voiceVolume = 0.8;

const LEVEL_PHRASES = [
  "Good!",
  "Perfect!",
  "Genius!",
  "You killed it!",
  "Excellent!",
  "Brilliant!",
  "Amazing!"
];

let lastPhraseIndex = -1;

// Five soft piano-style melodies.
// These are synthesized locally, so no copyrighted audio is used.
const PIANO_MELODIES = [
  [
    [261.63, 0.35],
    [329.63, 0.35],
    [392.00, 0.45],
    [329.63, 0.35],
    [293.66, 0.35]
  ],
  [
    [220.00, 0.35],
    [261.63, 0.35],
    [329.63, 0.45],
    [293.66, 0.35],
    [261.63, 0.45]
  ],
  [
    [196.00, 0.35],
    [246.94, 0.35],
    [293.66, 0.45],
    [246.94, 0.35],
    [220.00, 0.45]
  ],
  [
    [293.66, 0.35],
    [349.23, 0.35],
    [440.00, 0.45],
    [349.23, 0.35],
    [329.63, 0.45]
  ],
  [
    [174.61, 0.35],
    [220.00, 0.35],
    [261.63, 0.45],
    [220.00, 0.35],
    [196.00, 0.45]
  ]
];

let currentMelodyIndex = null;

function getStoredNumber(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));

    if (Number.isFinite(value)) {
      return Math.max(0, Math.min(1, value));
    }
  } catch {}

  return fallback;
}

function loadSettings() {
  try {
    enabled = localStorage.getItem("sound") !== "off";

    successfulWordVolume = getStoredNumber(
      "successful_word_volume",
      0.07
    );

    pianoVolume = getStoredNumber(
      "piano_ambient_volume",
      0.055
    );

    voiceVolume = getStoredNumber(
      "level_voice_volume",
      0.8
    );
  } catch {
    enabled = true;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function getAudioContext() {
  if (!ctx) {
    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContext) return null;

    ctx = new AudioContext();
  }

  if (ctx.state === "suspended") {
    try {
      const promise = ctx.resume();

      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
    } catch {}
  }

  return ctx;
}

function unlockAudio() {
  if (!enabled) return;

  const c = getAudioContext();

  if (!c) return;

  unlocked = true;

  try {
    if (c.state === "suspended") {
      c.resume().catch(() => {});
    }
  } catch {}

  // Do NOT automatically start the piano here.
  // It will start only when the app explicitly requests it.
}

function randomMelodyIndex() {
  if (PIANO_MELODIES.length <= 1) return 0;

  let index;

  do {
    index = Math.floor(
      Math.random() * PIANO_MELODIES.length
    );
  } while (index === currentMelodyIndex);

  return index;
}

function getVisitMelody() {
  try {
    const saved = Number(
      sessionStorage.getItem("medword_piano_melody")
    );

    if (
      Number.isInteger(saved) &&
      saved >= 0 &&
      saved < PIANO_MELODIES.length
    ) {
      currentMelodyIndex = saved;
      return saved;
    }
  } catch {}

  const index = randomMelodyIndex();

  currentMelodyIndex = index;

  try {
    sessionStorage.setItem(
      "medword_piano_melody",
      String(index)
    );
  } catch {}

  return index;
}

function playPianoNote(
  frequency,
  startTime,
  duration,
  volume
) {
  const c = getAudioContext();

  if (!c || !enabled || pianoVolume <= 0) {
    return;
  }

  try {
    const oscillator = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;

    filter.type = "lowpass";
    filter.frequency.value = 2200;
    filter.Q.value = 0.5;

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);

    const peak = Math.max(
      0.0001,
      volume * pianoVolume
    );

    gain.gain.setValueAtTime(
      0.0001,
      startTime
    );

    gain.gain.exponentialRampToValueAtTime(
      peak,
      startTime + 0.015
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + duration
    );

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
  } catch {}
}

function startAmbient() {
  if (
    !enabled ||
    pianoVolume <= 0 ||
    ambientNodes.length
  ) {
    return;
  }

  const c = getAudioContext();

  if (!c) return;

  try {
    const melodyIndex = getVisitMelody();
    const melody = PIANO_MELODIES[melodyIndex];

    const master = c.createGain();

    master.gain.value = 0;

    master.connect(c.destination);

    const now = c.currentTime;

    master.gain.linearRampToValueAtTime(
      pianoVolume,
      now + 0.8
    );

    ambientMaster = master;

    // Keep a silent oscillator alive so the ambient system
    // remains easy to stop cleanly.
    const keeper = c.createOscillator();
    const keeperGain = c.createGain();

    keeperGain.gain.value = 0;

    keeper.connect(keeperGain);
    keeperGain.connect(master);

    keeper.start();

    ambientNodes.push(keeper);

    // Play the selected five-note piano phrase.
    melody.forEach((note, index) => {
      const frequency = note[0];
      const duration = note[1];

      playPianoNote(
        frequency,
        now + index * 0.72,
        duration,
        0.65
      );
    });

    // Repeat the melody softly.
    const loopTimer = setTimeout(() => {
      if (
        enabled &&
        ambientMaster &&
        document.visibilityState === "visible"
      ) {
        ambientNodes = ambientNodes.filter(
          node => node !== loopTimer
        );

        startAmbient();
      }
    }, 4200);

    ambientNodes.push(loopTimer);
  } catch {}
}

function stopAmbient() {
  const nodes = ambientNodes;

  ambientNodes = [];

  const master = ambientMaster;

  ambientMaster = null;

  if (!master || !ctx) {
    nodes.forEach(node => {
      if (typeof node === "number") {
        clearTimeout(node);
      } else {
        try {
          node.stop();
        } catch {}
      }
    });

    return;
  }

  try {
    const now = ctx.currentTime;

    master.gain.cancelScheduledValues(now);

    master.gain.setValueAtTime(
      Math.max(0, master.gain.value),
      now
    );

    master.gain.linearRampToValueAtTime(
      0,
      now + 0.15
    );
  } catch {}

  nodes.forEach(node => {
    if (typeof node === "number") {
      clearTimeout(node);
    } else {
      try {
        node.stop();
      } catch {}
    }
  });
}

// ---------------------------------------------------------
// Successful word sound
// ---------------------------------------------------------

function successfulWordSound() {
  if (
    !enabled ||
    successfulWordVolume <= 0
  ) {
    return;
  }

  const c = getAudioContext();

  if (!c) return;

  try {
    const oscillator = c.createOscillator();
    const gain = c.createGain();

    oscillator.type = "sine";

    oscillator.frequency.setValueAtTime(
      740,
      c.currentTime
    );

    oscillator.frequency.exponentialRampToValueAtTime(
      987.77,
      c.currentTime + 0.08
    );

    oscillator.connect(gain);
    gain.connect(c.destination);

    const volume = Math.max(
      0.0001,
      successfulWordVolume
    );

    gain.gain.setValueAtTime(
      0.0001,
      c.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      volume,
      c.currentTime + 0.015
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      c.currentTime + 0.16
    );

    oscillator.start();

    oscillator.stop(
      c.currentTime + 0.2
    );
  } catch {}
}

// ---------------------------------------------------------
// Immediate level completion voice
// ---------------------------------------------------------

function chooseLevelPhrase() {
  if (LEVEL_PHRASES.length === 1) {
    return LEVEL_PHRASES[0];
  }

  let index;

  do {
    index = Math.floor(
      Math.random() * LEVEL_PHRASES.length
    );
  } while (index === lastPhraseIndex);

  lastPhraseIndex = index;

  return LEVEL_PHRASES[index];
}

function speakLevelComplete() {
  if (
    !enabled ||
    voiceVolume <= 0 ||
    !("speechSynthesis" in window)
  ) {
    return;
  }

  try {
    // Cancel anything currently being spoken.
    // This prevents the new phrase from being queued behind
    // an older phrase.
    window.speechSynthesis.cancel();

    const phrase = chooseLevelPhrase();

    const utterance =
      new SpeechSynthesisUtterance(phrase);

    utterance.volume = Math.max(
      0,
      Math.min(1, voiceVolume)
    );

    utterance.rate = 1.08;
    utterance.pitch = 1.0;

    // Do NOT wait for voiceschanged.
    // getVoices() is used immediately so the speech
    // can start as soon as the level completes.
    const voices =
      window.speechSynthesis.getVoices();

    const preferredVoice =
      voices.find(voice =>
        /^en(-|_)/i.test(voice.lang) &&
        /Google|Microsoft|Samantha|Daniel|Karen|Alex/i.test(
          voice.name
        )
      ) ||
      voices.find(voice =>
        /^en(-|_)/i.test(voice.lang)
      );

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    // Start immediately.
    window.speechSynthesis.speak(
      utterance
    );
  } catch {}
}

// ---------------------------------------------------------
// Speech initialization
// ---------------------------------------------------------

function initializeSpeech() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  try {
    // Warm up the browser speech engine.
    window.speechSynthesis.getVoices();

    // Some Android browsers populate their voice list later.
    // We listen for it only to warm the cache.
    // We DO NOT wait for this event before speaking.
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        try {
          window.speechSynthesis.getVoices();
        } catch {}
      },
      { once: true }
    );
  } catch {}
}

// ---------------------------------------------------------
// Visibility / background handling
// ---------------------------------------------------------

function handleVisibilityChange() {
  if (
    document.visibilityState === "hidden"
  ) {
    stopAmbient();

    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    return;
  }

  if (
    document.visibilityState === "visible" &&
    enabled &&
    unlocked
  ) {
    // Do not automatically restart the ambient piano
    // if the user has not enabled/started sound again.
  }
}

function handlePageHide() {
  stopAmbient();

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

// ---------------------------------------------------------
// User gesture unlock
// ---------------------------------------------------------

[
  "pointerdown",
  "touchend",
  "mousedown",
  "keydown"
].forEach(eventName => {
  try {
    document.addEventListener(
      eventName,
      () => {
        if (!unlocked) {
          unlockAudio();
        }
      },
      {
        passive: true
      }
    );
  } catch {}
});

document.addEventListener(
  "visibilitychange",
  handleVisibilityChange
);

window.addEventListener(
  "pagehide",
  handlePageHide
);

// ---------------------------------------------------------
// Public sound API
// ---------------------------------------------------------

export const sound = {
  get enabled() {
    return enabled;
  },

  init() {
    loadSettings();
    initializeSpeech();
  },

  unlock() {
    unlockAudio();
  },

  setEnabled(value) {
    enabled = !!value;

    saveSetting(
      "sound",
      enabled ? "on" : "off"
    );

    if (!enabled) {
      stopAmbient();

      if ("speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }

      return;
    }

    unlockAudio();
  },

  start() {
    if (!enabled) return;

    unlockAudio();

    if (
      document.visibilityState === "visible"
    ) {
      startAmbient();
    }
  },

  stop() {
    stopAmbient();

    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  },

  found() {
    successfulWordSound();
  },

  // Call this immediately when the final word of a level
  // has been successfully completed.
  complete() {
    // Keep the completion sound extremely subtle.
    successfulWordSound();

    // Voice starts immediately after the level completes.
    speakLevelComplete();
  },

  // -------------------------------------------------------
  // Volume controls
  // -------------------------------------------------------

  setSuccessfulWordVolume(value) {
    successfulWordVolume = Math.max(
      0,
      Math.min(1, Number(value) || 0)
    );

    saveSetting(
      "successful_word_volume",
      successfulWordVolume
    );
  },

  setPianoVolume(value) {
    pianoVolume = Math.max(
      0,
      Math.min(1, Number(value) || 0)
    );

    saveSetting(
      "piano_ambient_volume",
      pianoVolume
    );

    if (ambientMaster && ctx) {
      try {
        ambientMaster.gain.setTargetAtTime(
          pianoVolume,
          ctx.currentTime,
          0.05
        );
      } catch {}
    }
  },

  setVoiceVolume(value) {
    voiceVolume = Math.max(
      0,
      Math.min(1, Number(value) || 0)
    );

    saveSetting(
      "level_voice_volume",
      voiceVolume
    );
  },

  getVolumes() {
    return {
      successfulWord:
        successfulWordVolume,

      piano:
        pianoVolume,

      voice:
        voiceVolume
    };
  },

  // Useful for testing the three individual sounds
  testWord() {
    successfulWordSound();
  },

  testVoice() {
    speakLevelComplete();
  },

  testPiano() {
    if (!enabled) return;

    unlockAudio();
    startAmbient();
  }
};

// Initialize settings immediately.
sound.init();
