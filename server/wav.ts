/// <reference types="node" />
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Returns a copy of a RIFF WAV file with its samples multiplied by `gain`.
 * Supports 8, 16, 24, and 32-bit PCM and 32-bit float. Anything else is returned unchanged.
 */
export function scaleWav(input: Buffer, gain: number): Buffer {
  if (gain >= 0.999) return input;
  if (input.length < 12 || input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WAVE") {
    return input;
  }

  let format = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataEnd = -1;
  for (let offset = 12; offset + 8 <= input.length; ) {
    const id = input.toString("ascii", offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= input.length) {
      format = input.readUInt16LE(body);
      bitsPerSample = input.readUInt16LE(body + 14);
      if (format === WAVE_FORMAT_EXTENSIBLE && size >= 26 && body + 26 <= input.length) {
        format = input.readUInt16LE(body + 24);
      }
    } else if (id === "data") {
      dataStart = body;
      dataEnd = Math.min(input.length, body + size);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (dataStart < 0) return input;

  const out = Buffer.from(input);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

  if (format === WAVE_FORMAT_PCM && bitsPerSample === 8) {
    for (let i = dataStart; i < dataEnd; i++) out[i] = clamp((out[i] - 128) * gain + 128, 0, 255);
  } else if (format === WAVE_FORMAT_PCM && bitsPerSample === 16) {
    for (let i = dataStart; i + 2 <= dataEnd; i += 2) {
      out.writeInt16LE(clamp(out.readInt16LE(i) * gain, -32768, 32767), i);
    }
  } else if (format === WAVE_FORMAT_PCM && bitsPerSample === 24) {
    for (let i = dataStart; i + 3 <= dataEnd; i += 3) {
      out.writeIntLE(clamp(out.readIntLE(i, 3) * gain, -8388608, 8388607), i, 3);
    }
  } else if (format === WAVE_FORMAT_PCM && bitsPerSample === 32) {
    for (let i = dataStart; i + 4 <= dataEnd; i += 4) {
      out.writeInt32LE(clamp(out.readInt32LE(i) * gain, -2147483648, 2147483647), i);
    }
  } else if (format === WAVE_FORMAT_IEEE_FLOAT && bitsPerSample === 32) {
    for (let i = dataStart; i + 4 <= dataEnd; i += 4) out.writeFloatLE(out.readFloatLE(i) * gain, i);
  } else {
    return input;
  }
  return out;
}
