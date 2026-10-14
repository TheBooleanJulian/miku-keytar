// Test helper: a fake AudioContext that records oscillators and swallows every other call.

export class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

export interface FakeNode {
  stopCalls: number;
  startCalls: number;
  [key: string]: unknown;
}

export function fakeNode(): FakeNode {
  const target: Record<string, unknown> = {
    stopCalls: 0,
    startCalls: 0,
    connect: (n: unknown) => n,
    disconnect: () => {},
    start() {
      (this as FakeNode).startCalls++;
    },
    stop() {
      (this as FakeNode).stopCalls++;
    },
  };
  // Any other property read is treated as an AudioParam.
  return new Proxy(target, {
    get(t, p) {
      if (typeof p === "string" && !(p in t)) t[p] = new FakeParam();
      return t[p as string];
    },
  }) as FakeNode;
}

export function makeFakeContext() {
  const oscs: FakeNode[] = [];
  const ctx = {
    state: "suspended",
    currentTime: 0,
    sampleRate: 8000,
    destination: fakeNode(),
    onstatechange: null as null | (() => void),
    createGain: fakeNode,
    createBiquadFilter: fakeNode,
    createDelay: fakeNode,
    createConvolver: fakeNode,
    createBufferSource: fakeNode,
    createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createDynamicsCompressor: fakeNode,
    createAnalyser: () => Object.assign(fakeNode(), { fftSize: 256 }),
    createOscillator: () => {
      const o = fakeNode();
      oscs.push(o);
      return o;
    },
    async resume() {
      ctx.state = "running";
      ctx.onstatechange?.();
    },
    async close() {},
  };
  return { ctx, oscs, asContext: () => ctx as unknown as AudioContext };
}
