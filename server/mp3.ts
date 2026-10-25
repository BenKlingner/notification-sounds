/// <reference types="node" />
// Lossless MP3 volume: every Layer III granule stores a `global_gain` (one step = 1.5 dB),
// so lowering it scales the decoded audio without decoding or re-encoding, like mp3gain.

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = [44100, 48000, 32000];

interface FrameInfo {
  length: number;
  mpeg1: boolean;
  mono: boolean;
  crc: boolean;
}

function parseHeader(buf: Buffer, at: number): FrameInfo | null {
  if (at + 4 > buf.length || buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[at + 1] >> 3) & 3; // 0 = 2.5, 2 = 2, 3 = 1
  const layer = (buf[at + 1] >> 1) & 3; // 1 = Layer III
  const bitrateIndex = buf[at + 2] >> 4;
  const rateIndex = (buf[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const sampleRate = SAMPLE_RATES[rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const bitrate = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
  const padding = (buf[at + 2] >> 1) & 1;
  return {
    length: Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding,
    mpeg1,
    mono: buf[at + 3] >> 6 === 3,
    crc: (buf[at + 1] & 1) === 0,
  };
}

function readBits(buf: Buffer, bitOffset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const bit = bitOffset + i;
    value = (value << 1) | ((buf[bit >> 3] >> (7 - (bit & 7))) & 1);
  }
  return value;
}

function writeBits(buf: Buffer, bitOffset: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) {
    const bit = bitOffset + i;
    const mask = 1 << (7 - (bit & 7));
    if ((value >> (count - 1 - i)) & 1) buf[bit >> 3] |= mask;
    else buf[bit >> 3] &= ~mask;
  }
}

/** Skips an ID3v2 tag at the start of the file, if present. */
function audioStart(buf: Buffer): number {
  if (buf.length >= 10 && buf.toString("latin1", 0, 3) === "ID3") {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  return 0;
}

/**
 * Returns a copy of an MP3 file whose decoded audio is scaled by about `gain` (0 to 1).
 * Files that are not MPEG Layer III, or whose frames carry CRCs, are returned unchanged.
 */
export function scaleMp3(input: Buffer, gain: number): Buffer {
  if (gain >= 0.999) return input;
  const steps = gain <= 0 ? 255 : Math.round((-20 * Math.log10(gain)) / 1.5);
  if (steps <= 0) return input;

  const out = Buffer.from(input);
  let changed = false;
  let at = audioStart(out);
  while (at + 4 <= out.length) {
    const frame = parseHeader(out, at);
    if (!frame || frame.length < 4) {
      at++; // Resynchronize past junk or a trailing tag.
      continue;
    }
    if (frame.crc) return input; // Editing side info would invalidate the CRC.
    const channels = frame.mono ? 1 : 2;
    const granules = frame.mpeg1 ? 2 : 1;
    const sideInfo = (at + 4) * 8;
    // Bits before the first granule: main_data_begin, private bits, and (MPEG-1) scfsi.
    const lead = frame.mpeg1 ? 9 + (frame.mono ? 5 : 3) + 4 * channels : 8 + (frame.mono ? 1 : 2);
    const blockBits = frame.mpeg1 ? 59 : 63;
    if (at + 4 + Math.ceil((lead + granules * channels * blockBits) / 8) > out.length) break;
    for (let block = 0; block < granules * channels; block++) {
      // global_gain follows part2_3_length (12 bits) and big_values (9 bits).
      const offset = sideInfo + lead + block * blockBits + 21;
      const current = readBits(out, offset, 8);
      const next = Math.max(0, current - steps);
      if (next !== current) {
        writeBits(out, offset, 8, next);
        changed = true;
      }
    }
    at += frame.length;
  }
  return changed ? out : input;
}
