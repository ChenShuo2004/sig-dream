import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_OUT_DIR = join(PROMO_ROOT, "assets", "audio");
mkdirSync(AUDIO_OUT_DIR, { recursive: true });

const SR = 48000;

function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return ((s >>> 0) / 0xffffffff) * 2 - 1;
    };
}

function midiToHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
}

function encodeWavAndMp3(left, right, outMp3Path) {
    const total = left.length;
    let peak = 0;
    for (let i = 0; i < total; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    const norm = peak > 0 ? 0.89 / peak : 1;

    const pcm = Buffer.alloc(total * 4);
    for (let i = 0; i < total; i++) {
        const l = Math.max(-1, Math.min(1, Math.tanh(left[i] * norm * 1.12)));
        const r = Math.max(-1, Math.min(1, Math.tanh(right[i] * norm * 1.12)));
        pcm.writeInt16LE(Math.round(l * 32767), i * 4);
        pcm.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
    }

    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(SR, 24);
    wav.writeUInt32LE(SR * 4, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);

    const tmpWav = `${outMp3Path}.tmp.wav`;
    writeFileSync(tmpWav, wav);
    execFileSync(
        "ffmpeg",
        ["-y", "-i", tmpWav, "-c:a", "libmp3lame", "-b:a", "192k", outMp3Path],
        { stdio: "ignore" },
    );
    unlinkSync(tmpWav);
    console.log(`Generated ${outMp3Path}`);
}

function buildTrack({ duration, bpm, seed, style, outName }) {
    const rand = makeRng(seed);
    const beat = 60 / bpm;
    const total = Math.round(duration * SR);
    const left = new Float32Array(total);
    const right = new Float32Array(total);

    const addMono = (startSec, buf, gL = 1, gR = gL) => {
        const idx = Math.max(0, Math.round(startSec * SR));
        const end = Math.min(total, idx + buf.length);
        for (let i = idx; i < end; i++) {
            const v = buf[i - idx];
            left[i] += v * gL;
            right[i] += v * gR;
        }
    };

    const makeKick = (punch = 1.0) => {
        const n = Math.round(0.24 * SR);
        const out = new Float32Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            const f = (style === "fast" ? 54 : 48) + 135 * Math.exp(-t * 40);
            ph += (2 * Math.PI * f) / SR;
            const body = Math.sin(ph) * Math.exp(-t * (style === "fast" ? 9.5 : 11));
            const click = Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 170) * 0.25;
            out[i] = Math.tanh((body + click) * 1.45) * 0.72 * punch;
        }
        return out;
    };

    const makeClap = () => {
        const n = Math.round(0.14 * SR);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            const snap = Math.sin(2 * Math.PI * (260 * Math.exp(-t * 28) + 140) * t) * Math.exp(-t * 32) * 0.42;
            const nz = rand() * Math.exp(-t * 26) * 0.48;
            out[i] = snap + nz;
        }
        return out;
    };

    const makeHat = (open = false) => {
        const n = Math.round((open ? 0.14 : 0.036) * SR);
        const out = new Float32Array(n);
        let prev = 0;
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            const r = rand();
            const hp = r - prev * 0.91;
            prev = r;
            out[i] = hp * Math.exp(-t * (open ? 16 : 78)) * (open ? 0.19 : 0.12);
        }
        return out;
    };

    const addBass = (startSec, durSec, midi, drive = 1.0, sidechain = true) => {
        const n = Math.round(durSec * SR);
        const idx = Math.round(startSec * SR);
        const f = midiToHz(midi);
        let ph = 0;
        let lp = 0;
        const alpha = style === "fast" ? 0.16 : 0.09;
        for (let i = 0; i < n && idx + i < total; i++) {
            const t = i / SR;
            ph += f / SR;
            if (ph >= 1) ph -= 1;
            const saw = 2 * ph - 1;
            const sub = Math.sin(2 * Math.PI * (f * 0.5) * t) * 0.72;
            const duck = sidechain ? Math.min(1, 0.18 + Math.pow(Math.min(1, t / 0.12), 1.4) * 0.82) : 1;
            const env = Math.min(1, t / 0.008) * Math.min(1, (durSec - t) / 0.025);
            lp += alpha * (saw * 0.45 + sub - lp);
            const s = Math.tanh(lp * drive) * duck * env * 0.34;
            left[idx + i] += s;
            right[idx + i] += s;
        }
    };

    const addPluck = (startSec, durSec, midi, pan = 0, vel = 0.22) => {
        const n = Math.round(durSec * SR);
        const idx = Math.round(startSec * SR);
        const f = midiToHz(midi);
        const pL = Math.cos(((pan + 1) * Math.PI) / 4);
        const pR = Math.sin(((pan + 1) * Math.PI) / 4);
        for (let i = 0; i < n && idx + i < total; i++) {
            const t = i / SR;
            const mod = Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 24) * 1.25;
            const s =
                (Math.sin(2 * Math.PI * f * t + mod) + 0.22 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 28)) *
                Math.min(1, t / 0.003) *
                Math.exp(-t * (style === "fast" ? 9.5 : 6.8)) *
                vel;
            left[idx + i] += s * pL;
            right[idx + i] += s * pR;
        }
    };

    const addPad = (startSec, durSec, midis, vel = 0.08) => {
        const n = Math.round(durSec * SR);
        const idx = Math.round(startSec * SR);
        const freqs = midis.map(midiToHz);
        for (let i = 0; i < n && idx + i < total; i++) {
            const t = i / SR;
            const env = Math.min(1, t / 0.35) * Math.min(1, (durSec - t) / 0.45);
            let sumL = 0;
            let sumR = 0;
            for (let k = 0; k < freqs.length; k++) {
                const f = freqs[k];
                sumL += Math.sin(2 * Math.PI * f * (1 + k * 0.0012) * t);
                sumR += Math.sin(2 * Math.PI * f * (1 - k * 0.0012) * t);
            }
            left[idx + i] += (sumL / freqs.length) * env * vel;
            right[idx + i] += (sumR / freqs.length) * env * vel;
        }
    };

    const kickHard = makeKick(1.05);
    const kickSoft = makeKick(0.75);
    const clap = makeClap();
    const hatC = makeHat(false);
    const hatO = makeHat(true);

    const numBars = Math.ceil(duration / (beat * 4));
    const fastChords = [
        { bass: 45, chord: [57, 60, 64, 67], arp: [69, 72, 76, 79, 76, 72, 74, 72] }, // Am7
        { bass: 41, chord: [53, 57, 60, 64], arp: [65, 69, 72, 76, 72, 69, 72, 74] }, // Fmaj7
        { bass: 48, chord: [60, 64, 67, 71], arp: [72, 76, 79, 83, 79, 76, 79, 76] }, // Cmaj7
        { bass: 43, chord: [55, 59, 62, 67], arp: [67, 71, 74, 79, 74, 71, 74, 76] }, // G6
    ];

    const fullChords = [
        { bass: 48, chord: [60, 64, 67, 71], arp: [72, 76, 79, 76, 74, 72, 76, 79] }, // Cmaj7
        { bass: 45, chord: [57, 60, 64, 67], arp: [69, 72, 76, 72, 74, 76, 79, 76] }, // Am7
        { bass: 41, chord: [53, 57, 60, 64], arp: [65, 69, 72, 76, 72, 69, 72, 74] }, // Fmaj7
        { bass: 43, chord: [55, 59, 62, 67], arp: [67, 71, 74, 79, 74, 71, 74, 72] }, // G
    ];

    const prog = style === "fast" ? fastChords : fullChords;

    for (let bar = 0; bar < numBars; bar++) {
        const tBar = bar * beat * 4;
        const c = prog[bar % prog.length];
        const isIntro = bar < 2;
        const isOutro = tBar >= duration - beat * 8;
        const isDrop = style === "fast" ? bar >= 3 && !isOutro : bar >= 4 && !isOutro;

        // Warm chord pad
        addPad(tBar, beat * 4, c.chord, style === "fast" ? 0.065 : 0.095);

        // Bassline
        if (!isOutro) {
            if (style === "fast" && isDrop) {
                for (let b = 0; b < 4; b++) {
                    addBass(tBar + b * beat, beat * 0.92, c.bass, 1.35, true);
                }
            } else {
                addBass(tBar, beat * 2, c.bass, 1.0, !isIntro);
                addBass(tBar + beat * 2, beat * 2, c.bass, 1.0, !isIntro);
            }
        } else if (bar === numBars - 2) {
            addBass(tBar, beat * 4, c.bass, 0.85, false);
        }

        // Drums
        if (!isOutro) {
            for (let b = 0; b < 4; b++) {
                const tb = tBar + b * beat;
                if (isDrop || (style === "fast" && bar >= 1)) {
                    addMono(tb, style === "fast" ? kickHard : kickSoft, 0.9, 0.9);
                } else if (b === 0 || b === 2) {
                    addMono(tb, kickSoft, 0.65, 0.65);
                }
                if ((b === 1 || b === 3) && (isDrop || bar >= 2)) {
                    addMono(tb, clap, 0.55, 0.55);
                }
                if (isDrop) {
                    addMono(tb + beat * 0.5, hatO, 0.55, 0.65);
                    if (style === "fast") {
                        addMono(tb + beat * 0.25, hatC, 0.45, 0.35);
                        addMono(tb + beat * 0.75, hatC, 0.35, 0.45);
                    }
                } else if (bar >= 1) {
                    addMono(tb + beat * 0.5, hatC, 0.4, 0.45);
                }
            }
        }

        // Arpeggio plucks
        for (let step = 0; step < 8; step++) {
            const ts = tBar + step * (beat * 0.5);
            if (ts >= duration - 0.5) break;
            if (isOutro && step % 2 === 1) continue;
            const note = c.arp[step % c.arp.length];
            const pan = step % 2 === 0 ? -0.35 : 0.35;
            const vel = isOutro ? 0.14 : style === "fast" ? 0.22 : 0.17;
            addPluck(ts, beat * 0.6, note, pan, vel);
        }
    }

    // Smooth fade out last 1.4s
    const fadeSamples = Math.round(1.4 * SR);
    for (let i = 0; i < fadeSamples; i++) {
        const idx = total - 1 - i;
        if (idx >= 0) {
            const g = i / fadeSamples;
            left[idx] *= g;
            right[idx] *= g;
        }
    }

    encodeWavAndMp3(left, right, join(AUDIO_OUT_DIR, outName));
}

buildTrack({
    duration: 30.0,
    bpm: 128.0,
    seed: 0x1280abcd,
    style: "fast",
    outName: "bgm-fast-30s.mp3",
});

buildTrack({
    duration: 68.0,
    bpm: 116.0,
    seed: 0x1160ef12,
    style: "full",
    outName: "bgm-full-68s.mp3",
});
