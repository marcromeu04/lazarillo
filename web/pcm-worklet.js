// Lazarillo v2 — AudioWorkletProcessor (P1).
// Recibe Float32 mono @16 kHz del micro, lo convierte a Int16 LE y publica
// trozos de 40 ms (640 muestras) al hilo principal como ArrayBuffer transferible.

const CHUNK = 640; // 40 ms @ 16 kHz

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(CHUNK);
    this._n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      // clamp + escalar Float32 [-1,1] → Int16
      let s = ch[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this._buf[this._n++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this._n === CHUNK) {
        const out = new Int16Array(CHUNK);
        out.set(this._buf);
        this.port.postMessage(out.buffer, [out.buffer]);
        this._n = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
