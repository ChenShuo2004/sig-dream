import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PROMO_ROOT, "..");
const SFX_SRC_DIR =
    "/Users/chenshuo/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/config/skills/media-use/audio/assets/sfx";

const BRAND_DIR = join(PROMO_ROOT, "assets", "brand");
const CARDS_DIR = join(PROMO_ROOT, "assets", "cards");
const SFX_OUT_DIR = join(PROMO_ROOT, "assets", "sfx");
const AUDIO_OUT_DIR = join(PROMO_ROOT, "assets", "audio");

for (const dir of [BRAND_DIR, CARDS_DIR, SFX_OUT_DIR, AUDIO_OUT_DIR]) {
    mkdirSync(dir, { recursive: true });
}

// 1. Copy official brand assets & real story-style artworks
copyFileSync(join(REPO_ROOT, "desktop", "assets", "icon.png"), join(BRAND_DIR, "icon.png"));
copyFileSync(join(REPO_ROOT, "public", "logo.svg"), join(BRAND_DIR, "logo.svg"));

const STORY_CARDS = [
    "3d-fantasy-rpg.webp",
    "3d-cartoon-miniature.webp",
    "american-game-concept-art.webp",
    "anime-concept-art.webp",
    "black-white-ink.webp",
    "american-classic-hollywood.webp",
];
for (const name of STORY_CARDS) {
    copyFileSync(join(REPO_ROOT, "public", "images", "story-styles", name), join(CARDS_DIR, name));
}

// 2. Copy bundled studio SFX + CREDITS.md
const SFX_FILES = [
    "CREDITS.md",
    "click.mp3",
    "click-soft.mp3",
    "pop.mp3",
    "typing.mp3",
    "whoosh.mp3",
    "whoosh-short.mp3",
    "riser.mp3",
    "impact-bass-1.mp3",
    "impact-bass-2.mp3",
    "error.mp3",
];
for (const file of SFX_FILES) {
    copyFileSync(join(SFX_SRC_DIR, file), join(SFX_OUT_DIR, file));
}

// 3. Synthesize 120.0 BPM Raycast/Linear-style Dark Electronic Launch Bed (38.0s = 19 bars)
const SR = 48000;
const DURATION = 38.0;
const BPM = 120.0;
const BEAT = 60 / BPM; // 0.50s exact
const TOTAL_SAMPLES = Math.round(DURATION * SR);

const left = new Float32Array(TOTAL_SAMPLES);
const right = new Float32Array(TOTAL_SAMPLES);

// Deterministic PRNG for clean crisp hi-hat / clap transients
let rngState = 0x516d7265;
function rand() {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) / 0xffffffff) * 2 - 1;
}

function midiToHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
}

function addMono(startSec, buf, gainL = 1, gainR = gainL) {
    const startIdx = Math.max(0, Math.round(startSec * SR));
    const endIdx = Math.min(TOTAL_SAMPLES, startIdx + buf.length);
    for (let i = startIdx; i < endIdx; i++) {
        const s = buf[i - startIdx];
        left[i] += s * gainL;
        right[i] += s * gainR;
    }
}

function makeKick(dur = 0.28, punch = 1.0) {
    const n = Math.round(dur * SR);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 46 + 135 * Math.exp(-t * 34);
        phase += (2 * Math.PI * f) / SR;
        const body = Math.sin(phase) * Math.exp(-t * 9.5);
        const click = Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 140) * 0.28;
        out[i] = Math.tanh((body + click) * 1.45) * 0.72 * punch;
    }
    return out;
}

function makeSnareClap(dur = 0.16, bright = 1.0) {
    const n = Math.round(dur * SR);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 190 * Math.exp(-t * 18) + 110;
        phase += (2 * Math.PI * f) / SR;
        const snap = Math.sin(phase) * Math.exp(-t * 28) * 0.42;
        const pre = t < 0.018 ? Math.sin(t * 900) * 0.2 : 1.0;
        const nz = rand() * Math.exp(-t * 22) * 0.48 * bright * pre;
        out[i] = snap + nz;
    }
    return out;
}

function makeHat(dur = 0.045, open = false) {
    const d = open ? 0.16 : dur;
    const n = Math.round(d * SR);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        const raw = rand();
        const hp = raw - prev * 0.88; // crisp high-pass metallic texture
        prev = raw;
        const decay = open ? 16 : 68;
        out[i] = hp * Math.exp(-t * decay) * (open ? 0.22 : 0.14);
    }
    return out;
}

function makeRimTick(dur = 0.03) {
    const n = Math.round(dur * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        out[i] =
            (Math.sin(2 * Math.PI * 1480 * t) * 0.55 + Math.sin(2 * Math.PI * 2920 * t) * 0.3) *
            Math.exp(-t * 110) *
            0.35;
    }
    return out;
}

// Rich filtered saw-sub bass note with sidechain ducking on the beat
function addBassNote(startSec, durSec, midi, cutoffBrightness = 0.5, sidechain = true) {
    const n = Math.round(durSec * SR);
    const startIdx = Math.round(startSec * SR);
    const f = midiToHz(midi);
    let ph1 = 0;
    let ph2 = 0;
    let lpL = 0;
    let lpR = 0;
    const alpha = 0.04 + cutoffBrightness * 0.16;
    for (let i = 0; i < n && startIdx + i < TOTAL_SAMPLES; i++) {
        const t = i / SR;
        ph1 += f / SR;
        ph2 += (f * 1.004) / SR;
        if (ph1 >= 1) ph1 -= 1;
        if (ph2 >= 1) ph2 -= 1;
        const saw1 = 2 * ph1 - 1;
        const saw2 = 2 * ph2 - 1;
        const sub = Math.sin(2 * Math.PI * (f * 0.5) * t) * 0.75;
        const duck = sidechain ? Math.min(1, 0.18 + Math.pow(Math.min(1, t / 0.14), 1.6) * 0.82) : 1.0;
        const env = Math.min(1, t / 0.008) * Math.min(1, (durSec - t) / 0.025);
        lpL += alpha * (saw1 * 0.45 + sub - lpL);
        lpR += alpha * (saw2 * 0.45 + sub - lpR);
        left[startIdx + i] += lpL * duck * env * 0.34;
        right[startIdx + i] += lpR * duck * env * 0.34;
    }
}

// Glassy precision pluck arpeggio (Raycast / Linear signature motif)
function addPluck(startSec, durSec, midi, pan = 0, vel = 0.22) {
    const n = Math.round(durSec * SR);
    const startIdx = Math.round(startSec * SR);
    const f = midiToHz(midi);
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < n && startIdx + i < TOTAL_SAMPLES; i++) {
        const t = i / SR;
        const mod = Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 22) * 1.4;
        const carrier = Math.sin(2 * Math.PI * f * t + mod);
        const fifth = Math.sin(2 * Math.PI * f * 1.5 * t) * 0.18 * Math.exp(-t * 16);
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 7.5);
        const s = (carrier + fifth) * env * vel;
        left[startIdx + i] += s * panL;
        right[startIdx + i] += s * panR;
    }
}

// Warm stereo synth pad chord
function addPadChord(startSec, durSec, midis, gain = 0.08) {
    const n = Math.round(durSec * SR);
    const startIdx = Math.round(startSec * SR);
    for (const m of midis) {
        const fL = midiToHz(m) * 0.998;
        const fR = midiToHz(m) * 1.002;
        for (let i = 0; i < n && startIdx + i < TOTAL_SAMPLES; i++) {
            const t = i / SR;
            const attack = Math.min(1, t / 0.18);
            const release = Math.min(1, (durSec - t) / 0.35);
            const env = attack * release;
            const sL = (Math.sin(2 * Math.PI * fL * t) + 0.25 * Math.sin(4 * Math.PI * fL * t)) * env * gain;
            const sR = (Math.sin(2 * Math.PI * fR * t) + 0.25 * Math.sin(4 * Math.PI * fR * t)) * env * gain;
            left[startIdx + i] += sL;
            right[startIdx + i] += sR;
        }
    }
}

// Progression in F minor / Dorian-modern tech: Fm9 -> DbMaj7 -> AbMaj7 -> Eb6 (MIDI roots: F2=41, Db2=37, Ab2=44, Eb2=39)
const BAR_ROOTS = [41, 37, 44, 39];
const BAR_CHORDS = [
    [53, 56, 60, 63, 67], // Fm9
    [49, 53, 56, 60, 63], // DbMaj9
    [56, 60, 63, 67, 70], // AbMaj9
    [51, 55, 58, 63, 67], // Ebadd9
];
const ARP_OFFSETS = [12, 15, 19, 24, 19, 15, 22, 19];

const kickTight = makeKick(0.26, 0.95);
const kickHeavy = makeKick(0.3, 1.12);
const clap = makeSnareClap(0.15, 1.0);
const hatClosed = makeHat(0.04, false);
const hatOpen = makeHat(0.15, true);
const rim = makeRimTick();

const TOTAL_BEATS = 76; // 38.0s * 2 beats/s
for (let b = 0; b < TOTAL_BEATS; b++) {
    const t = b * BEAT;
    const bar = Math.floor(b / 4);
    const beatInBar = b % 4;
    const root = BAR_ROOTS[bar % 4];
    const chord = BAR_CHORDS[bar % 4];

    // SECTION 1: Tension Hook (0.0s - 4.0s, Beats 0..7)
    if (t < 4.0) {
        addMono(t, rim, 0.55, 0.45);
        addMono(t + BEAT * 0.5, hatClosed, 0.35, 0.5);
        if (beatInBar === 0 || beatInBar === 2) {
            addBassNote(t, BEAT * 0.9, 41, 0.18, false);
        }
        if (b === 7) {
            // Snare fill at 3.5s -> 4.0s shatter!
            for (let sub = 0; sub < 4; sub++) {
                addMono(t + sub * (BEAT / 4), clap, 0.35 + sub * 0.15, 0.35 + sub * 0.15);
            }
        }
        continue;
    }

    // Transition Drop Bar (4.0s - 5.0s, Beats 8..9)
    if (t >= 4.0 && t < 5.0) {
        if (b === 8) {
            addMono(t, kickHeavy, 1.0, 1.0);
            addPadChord(t, 1.0, BAR_CHORDS[0], 0.09);
            addBassNote(t, 0.95, 41, 0.55, true);
        }
        if (b === 9) {
            addMono(t + BEAT * 0.5, clap, 0.7, 0.7);
        }
        continue;
    }

    // SECTION 2: Zero-DB Reveal Groove (5.0s - 12.0s, Beats 10..23)
    if (t >= 5.0 && t < 12.0) {
        addMono(t, kickTight, 0.92, 0.92);
        if (beatInBar === 1 || beatInBar === 3) addMono(t, clap, 0.72, 0.72);
        for (let s = 0; s < 4; s++) {
            const pan = s % 2 === 0 ? 0.65 : 0.45;
            addMono(t + s * (BEAT / 4), hatClosed, pan * 0.7, (1.1 - pan) * 0.7);
        }
        addBassNote(t, BEAT * 0.92, root, 0.45, true);
        if (beatInBar === 0) addPadChord(t, BEAT * 4, chord, 0.055);
        addPluck(t + BEAT * 0.5, 0.28, root + ARP_OFFSETS[(b * 2) % 8], ((b % 3) - 1) * 0.35, 0.14);
        continue;
    }

    // SECTION 3A: Canvas Focus & Build to Payoff (12.0s - 16.0s, Beats 24..31)
    if (t >= 12.0 && t < 16.0) {
        if (b < 30) {
            addMono(t, kickTight, 0.78, 0.78);
            addMono(t + BEAT * 0.5, rim, 0.5, 0.6);
            addBassNote(t, BEAT * 0.88, root, 0.32 + (b - 24) * 0.06, true);
            addPluck(t, 0.24, root + 24, -0.3, 0.13);
            addPluck(t + BEAT * 0.5, 0.24, root + 27, 0.3, 0.15);
        } else {
            // Beats 30-31 (15.0s - 16.0s): Pre-payoff drum build!
            for (let sub = 0; sub < 4; sub++) {
                const g = 0.45 + ((b - 30) * 4 + sub) * 0.07;
                addMono(t + sub * (BEAT / 4), kickTight, g * 0.7, g * 0.7);
                addMono(t + sub * (BEAT / 4), clap, g * 0.65, g * 0.65);
            }
        }
        continue;
    }

    // SECTION 3B: PAYOFF DROP — Full Infinite Canvas (16.0s - 23.0s, Beats 32..45)
    if (t >= 16.0 && t < 23.0) {
        addMono(t, kickHeavy, 1.0, 1.0);
        if (beatInBar === 1 || beatInBar === 3) addMono(t, clap, 0.88, 0.88);
        addMono(t + BEAT * 0.5, hatOpen, 0.75, 0.85);
        for (let s = 0; s < 4; s++) {
            addMono(t + s * (BEAT / 4), hatClosed, 0.65, 0.65);
            const note = root + ARP_OFFSETS[(b * 4 + s) % 8] + 12;
            addPluck(t + s * (BEAT / 4), 0.22, note, s % 2 === 0 ? -0.45 : 0.45, 0.18);
        }
        addBassNote(t, BEAT * 0.94, root, 0.78, true);
        if (beatInBar === 0) addPadChord(t, BEAT * 4, chord, 0.085);
        continue;
    }

    // SECTION 4: Rapid 3-Studio Trilogy Drive (23.0s - 32.0s, Beats 46..63)
    if (t >= 23.0 && t < 32.0) {
        addMono(t, kickHeavy, 0.95, 0.95);
        if (beatInBar === 1 || beatInBar === 3) addMono(t, clap, 0.82, 0.82);
        addMono(t + BEAT * 0.25, rim, 0.4, 0.55);
        addMono(t + BEAT * 0.5, hatOpen, 0.65, 0.65);
        addMono(t + BEAT * 0.75, hatClosed, 0.6, 0.5);
        addBassNote(t, BEAT * 0.45, root, 0.65, true);
        addBassNote(t + BEAT * 0.5, BEAT * 0.45, root + 12, 0.7, false);
        if (beatInBar === 0) addPadChord(t, BEAT * 4, chord, 0.07);
        addPluck(t, 0.25, root + ARP_OFFSETS[b % 8] + 12, (b % 2 ? 1 : -1) * 0.4, 0.16);
        continue;
    }

    // SECTION 5: End Card Resolution & Clean Hold (32.0s - 38.0s, Beats 64..75)
    if (t >= 32.0) {
        if (b === 64) {
            // Final downbeat hit + lush sustained Fm9 chord
            addMono(t, kickHeavy, 1.0, 1.0);
            addPadChord(t, 5.6, [41, 53, 56, 60, 63, 67], 0.095);
            addBassNote(t, 3.2, 41, 0.4, true);
        }
        if (b >= 64 && b < 72 && b % 2 === 0) {
            addPluck(t, 0.55, 65 + ARP_OFFSETS[(b - 64) % 4], ((b % 4) - 1.5) * 0.25, 0.12 * (1 - (b - 64) / 10));
        }
    }
}

// Soft master limiter + smooth final 1.2s fade-out to zero at 38.0s
const rawInterleaved = new Float32Array(TOTAL_SAMPLES * 2);
for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const t = i / SR;
    const fadeIn = Math.min(1, t / 0.08);
    const fadeOut = t > 36.4 ? Math.max(0, 1 - (t - 36.4) / 1.55) : 1.0;
    const g = fadeIn * fadeOut;
    rawInterleaved[i * 2] = Math.tanh(left[i] * 1.15) * 0.85 * g;
    rawInterleaved[i * 2 + 1] = Math.tanh(right[i] * 1.15) * 0.85 * g;
}

const rawPcmPath = join(AUDIO_OUT_DIR, "bgm-raw.f32");
const outMp3Path = join(AUDIO_OUT_DIR, "bgm-120bpm.mp3");
writeFileSync(rawPcmPath, Buffer.from(rawInterleaved.buffer));

execFileSync(
    "ffmpeg",
    [
        "-y",
        "-f",
        "f32le",
        "-ar",
        String(SR),
        "-ac",
        "2",
        "-i",
        rawPcmPath,
        "-af",
        "loudnorm=I=-15.5:TP=-1.5:LRA=9",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outMp3Path,
    ],
    { stdio: "pipe" },
);

console.log(`Generated mastered BGM at ${outMp3Path}`);
