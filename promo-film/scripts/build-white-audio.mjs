import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_OUT_DIR = join(PROMO_ROOT, "assets", "audio");
mkdirSync(AUDIO_OUT_DIR, { recursive: true });

// 28.0s = 14 bars exact @ 120.0 BPM (clean modern Apple/Linear minimal tech-pop groove)
const SR = 48000;
const DURATION = 28.0;
const BPM = 120.0;
const BEAT = 60 / BPM; // 0.50s
const TOTAL_SAMPLES = Math.round(DURATION * SR);

const left = new Float32Array(TOTAL_SAMPLES);
const right = new Float32Array(TOTAL_SAMPLES);

let rngState = 0x2468ace1;
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

function makeKick(punch = 1.0) {
    const n = Math.round(0.24 * SR);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 50 + 125 * Math.exp(-t * 38);
        phase += (2 * Math.PI * f) / SR;
        const body = Math.sin(phase) * Math.exp(-t * 10.5);
        const click = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 160) * 0.22;
        out[i] = Math.tanh((body + click) * 1.35) * 0.7 * punch;
    }
    return out;
}

function makeSnapClap() {
    const n = Math.round(0.13 * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        const snap = Math.sin(2 * Math.PI * (240 * Math.exp(-t * 25) + 130) * t) * Math.exp(-t * 34) * 0.4;
        const nz = rand() * Math.exp(-t * 28) * 0.42;
        out[i] = snap + nz;
    }
    return out;
}

function makeHat(open = false) {
    const d = open ? 0.13 : 0.038;
    const n = Math.round(d * SR);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        const raw = rand();
        const hp = raw - prev * 0.9;
        prev = raw;
        out[i] = hp * Math.exp(-t * (open ? 18 : 75)) * (open ? 0.18 : 0.12);
    }
    return out;
}

function addWarmBass(startSec, durSec, midi, cutoff = 0.5, sidechain = true) {
    const n = Math.round(durSec * SR);
    const startIdx = Math.round(startSec * SR);
    const f = midiToHz(midi);
    let ph = 0;
    let lp = 0;
    const alpha = 0.05 + cutoff * 0.14;
    for (let i = 0; i < n && startIdx + i < TOTAL_SAMPLES; i++) {
        const t = i / SR;
        ph += f / SR;
        if (ph >= 1) ph -= 1;
        const tri = 1 - 4 * Math.abs(Math.round(ph - 0.25) - (ph - 0.25));
        const sub = Math.sin(2 * Math.PI * (f * 0.5) * t) * 0.65;
        const duck = sidechain ? Math.min(1, 0.22 + Math.pow(Math.min(1, t / 0.13), 1.5) * 0.78) : 1.0;
        const env = Math.min(1, t / 0.008) * Math.min(1, (durSec - t) / 0.025);
        lp += alpha * (tri * 0.5 + sub - lp);
        const s = lp * duck * env * 0.34;
        left[startIdx + i] += s;
        right[startIdx + i] += s;
    }
}

function addGlassPluck(startSec, durSec, midi, pan = 0, vel = 0.2) {
    const n = Math.round(durSec * SR);
    const startIdx = Math.round(startSec * SR);
    const f = midiToHz(midi);
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < n && startIdx + i < TOTAL_SAMPLES; i++) {
        const t = i / SR;
        const mod = Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 26) * 1.1;
        const s =
            (Math.sin(2 * Math.PI * f * t + mod) + 0.2 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 30)) *
            Math.min(1, t / 0.003) *
            Math.exp(-t * 8.2) *
            vel;
        left[startIdx + i] += s * panL;
        right[startIdx + i] += s * panR;
    }
}

function addAirChord(startSec, durSec, midis, gain = 0.065) {
    const n = Math.round(durSec * SR);
    const startIdx = Math.round(startSec * SR);
    for (const m of midis) {
        const fL = midiToHz(m) * 0.9985;
        const fR = midiToHz(m) * 1.0015;
        for (let i = 0; i < n && startIdx + i < TOTAL_SAMPLES; i++) {
            const t = i / SR;
            const env = Math.min(1, t / 0.14) * Math.min(1, (durSec - t) / 0.3);
            left[startIdx + i] += Math.sin(2 * Math.PI * fL * t) * env * gain;
            right[startIdx + i] += Math.sin(2 * Math.PI * fR * t) * env * gain;
        }
    }
}

// Bright uplifting-cool modern tech progression (Fmaj9 -> G6 -> Am9 -> Em7): warm, clean, editorial!
const BAR_ROOTS = [41, 43, 45, 40];
const BAR_CHORDS = [
    [53, 57, 60, 64, 67], // Fmaj9
    [55, 59, 62, 64, 67], // G6
    [57, 60, 64, 67, 71], // Am9
    [52, 55, 59, 62, 67], // Em7
];
const ARP = [12, 16, 19, 24, 19, 16, 23, 19];

const kick = makeKick(1.0);
const kickPunch = makeKick(1.12);
const clap = makeSnapClap();
const hat = makeHat(false);
const hatOpen = makeHat(true);

const TOTAL_BEATS = 56; // 28.0s * 2 beats/s
for (let b = 0; b < TOTAL_BEATS; b++) {
    const t = b * BEAT;
    const bar = Math.floor(b / 4);
    const beatInBar = b % 4;
    const root = BAR_ROOTS[bar % 4];
    const chord = BAR_CHORDS[bar % 4];

    // 0.0s - 4.5s (Beats 0..8): Crisp Minimal Intro + Character Trio Plucks
    if (t < 4.5) {
        if (beatInBar === 0) addAirChord(t, BEAT * 4, chord, 0.06);
        addMono(t, hat, 0.55, 0.45);
        addMono(t + BEAT * 0.5, hat, 0.45, 0.6);
        addGlassPluck(t, 0.3, root + ARP[(b * 2) % 8] + 12, ((b % 3) - 1) * 0.35, 0.16);
        addGlassPluck(t + BEAT * 0.5, 0.25, root + ARP[(b * 2 + 1) % 8] + 12, 0.25, 0.12);
        if (b === 7) {
            for (let s = 0; s < 4; s++) addMono(t + s * (BEAT / 4), clap, 0.35 + s * 0.14, 0.35 + s * 0.14);
        }
        if (b === 8) addMono(t, kickPunch, 0.95, 0.95);
        continue;
    }

    // 4.5s - 13.0s (Beats 9..25): Clean Bounce Groove (Home + Provider + Canvas Prompt)
    if (t >= 4.5 && t < 13.0) {
        addMono(t, kick, 0.9, 0.9);
        if (beatInBar === 1 || beatInBar === 3) addMono(t, clap, 0.72, 0.72);
        for (let s = 0; s < 4; s++) {
            addMono(t + s * (BEAT / 4), hat, s % 2 ? 0.5 : 0.65, s % 2 ? 0.65 : 0.5);
        }
        addWarmBass(t, BEAT * 0.92, root, 0.48, true);
        if (beatInBar === 0) addAirChord(t, BEAT * 4, chord, 0.055);
        addGlassPluck(t + BEAT * 0.5, 0.28, root + ARP[b % 8] + 12, (b % 2 ? 1 : -1) * 0.35, 0.15);
        if (b === 25) {
            for (let s = 0; s < 4; s++) addMono(t + s * (BEAT / 4), clap, 0.5 + s * 0.12, 0.5 + s * 0.12);
        }
        continue;
    }

    // 13.0s - 18.5s (Beats 26..36): PAYOFF DROP — Midjourney Character Storyboard Full Reveal!
    if (t >= 13.0 && t < 18.5) {
        addMono(t, kickPunch, 1.0, 1.0);
        if (beatInBar === 1 || beatInBar === 3) addMono(t, clap, 0.85, 0.85);
        addMono(t + BEAT * 0.5, hatOpen, 0.75, 0.8);
        for (let s = 0; s < 4; s++) {
            addMono(t + s * (BEAT / 4), hat, 0.6, 0.6);
            addGlassPluck(
                t + s * (BEAT / 4),
                0.24,
                root + ARP[(b * 4 + s) % 8] + 12,
                s % 2 === 0 ? -0.42 : 0.42,
                0.18,
            );
        }
        addWarmBass(t, BEAT * 0.94, root, 0.72, true);
        if (beatInBar === 0) addAirChord(t, BEAT * 4, chord, 0.08);
        continue;
    }

    // 18.5s - 23.5s (Beats 37..46): Clean Studio & 1,740+ Prompts Drive
    if (t >= 18.5 && t < 23.5) {
        addMono(t, kick, 0.92, 0.92);
        if (beatInBar === 1 || beatInBar === 3) addMono(t, clap, 0.78, 0.78);
        addMono(t + BEAT * 0.5, hatOpen, 0.65, 0.65);
        addWarmBass(t, BEAT * 0.9, root, 0.6, true);
        addGlassPluck(t, 0.26, root + 24, -0.3, 0.15);
        addGlassPluck(t + BEAT * 0.5, 0.26, root + 28, 0.3, 0.15);
        continue;
    }

    // 23.5s - 28.0s (Beats 47..55): Pure White End Card Resolution & Clean Hold
    if (t >= 23.5) {
        if (b === 47) {
            addMono(t, kickPunch, 0.98, 0.98);
            addAirChord(t, 4.3, [41, 53, 57, 60, 64, 67], 0.085);
            addWarmBass(t, 2.8, 41, 0.42, true);
        }
        if (b >= 48 && b <= 52 && b % 2 === 0) {
            addGlassPluck(t, 0.5, 65 + ARP[(b - 48) % 4], ((b % 4) - 1.5) * 0.25, 0.12);
        }
    }
}

const rawInterleaved = new Float32Array(TOTAL_SAMPLES * 2);
for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const t = i / SR;
    const fadeIn = Math.min(1, t / 0.06);
    const fadeOut = t > 26.6 ? Math.max(0, 1 - (t - 26.6) / 1.35) : 1.0;
    const g = fadeIn * fadeOut;
    rawInterleaved[i * 2] = Math.tanh(left[i] * 1.12) * 0.85 * g;
    rawInterleaved[i * 2 + 1] = Math.tanh(right[i] * 1.12) * 0.85 * g;
}

const rawPath = join(AUDIO_OUT_DIR, "bgm-white.f32");
const outMp3 = join(AUDIO_OUT_DIR, "bgm-white-28s.mp3");
writeFileSync(rawPath, Buffer.from(rawInterleaved.buffer));

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
        rawPath,
        "-af",
        "loudnorm=I=-15.5:TP=-1.5:LRA=8",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outMp3,
    ],
    { stdio: "pipe" },
);
unlinkSync(rawPath);
console.log(`Generated 28.0s White Minimal BGM: ${outMp3}`);
