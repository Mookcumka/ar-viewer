/* Camera-independent lifecycle. Legacy Hiro cannot identify a sheet: only a validated QR can. */
(function (root) {
  "use strict";
  const VERSION = "camera-compare-1";
  class Journal {
    constructor(storage) {
      this.storage = storage; this.key = "ar-camera-report-v1";
      this.id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      this.events = []; this.previous = [];
      try { this.previous = JSON.parse(storage?.getItem(this.key) || "[]").slice(-2); } catch (_) {}
      this.add("session", { version: VERSION });
    }
    add(type, detail = {}) {
      this.events.push({ at: new Date().toISOString(), type, ...detail });
      this.events = this.events.slice(-250);
      try {
        let saved = [...this.previous, { id: this.id, events: this.events }];
        while (JSON.stringify(saved).length > 180000 && saved.length > 1) saved.shift();
        this.storage?.setItem(this.key, JSON.stringify(saved));
      } catch (_) {}
    }
    report(environment = {}) { return { version: VERSION, environment, sessions: [...this.previous, { id: this.id, events: this.events }] }; }
  }
  class CameraLease {
    constructor() { this.epoch = 0; this.stream = null; }
    async open(acquire) {
      this.cancel(); const epoch = this.epoch;
      let stream;
      try { stream = await acquire(); }
      catch (error) { if (epoch !== this.epoch) return null; throw error; }
      if (epoch !== this.epoch) { stream.getTracks().forEach(t => t.stop()); return null; }
      this.stream = stream; return stream;
    }
    cancel() { this.epoch++; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
    owns(stream) { return stream != null && this.stream === stream; }
  }
  class Session {
    constructor(codec, hooks, journal = new Journal()) {
      this.codec = codec; this.hooks = hooks; this.journal = journal;
      this.generation = 0; this.state = "scanning"; this.parts = []; this.active = null; this.pending = null; this.blocked = null; this.acceptedParts = []; this.blockedParts = new Set();
    }
    set(state, detail = {}) {
      this.state = state; this.journal.add("state", { state, ...detail }); this.hooks.state?.(state, detail);
    }
    clear(reason = "new-sheet", blockPrevious = true) {
      const previous = this.active?.payload || this.pending;
      if (blockPrevious && previous) {
        this.blocked = previous; this.blockedParts = new Set([...this.acceptedParts, ...this.parts.map(p => p.payload)]);
      }
      if (blockPrevious && this.parts.length) this.blockedParts = new Set(this.parts.map(p => p.payload));
      this.generation++; this.parts = []; this.acceptedParts = []; this.active = null; this.pending = null;
      this.hooks.clear?.(); this.set("scanning", { reason });
    }
    async ingest(payload) {
      let value = this.codec.parse(payload); // Invalid QR must not destroy a valid model.
      if (value.payload === this.blocked || this.blockedParts.has(value.payload)) return false;
      if ((this.active || this.pending) && this.acceptedParts.includes(value.payload)) return false;
      let acceptedParts = [];
      if (value.payload === this.active?.payload || value.payload === this.pending) return false;
      if (value.kind === "part") {
        if (this.parts.length && (this.parts[0].id !== value.id || this.parts[0].of !== value.of)) this.clear("different-parts", false);
        if (!this.parts.length) this.clear("parts-start", false);
        const existing = this.parts.find(p => p.part === value.part);
        if (existing && existing.chunk !== value.chunk) {
          this.clear("conflicting-part", false); throw new Error("Часть QR изменилась. Считайте все части заново.");
        }
        if (!existing) this.parts.push(value);
        this.set("collecting", { have: this.parts.length, of: value.of, missing: Array.from({ length: value.of }, (_, i) => i + 1).filter(n => !this.parts.some(p => p.part === n)) });
        let joined;
        try { joined = this.codec.join(this.parts); }
        catch (error) { this.clear("invalid-parts", false); this.set("error"); throw error; }
        if (!joined) return false;
        acceptedParts = this.parts.map(p => p.payload); value = joined;
        if (value.payload === this.blocked) { this.clear("previous-sheet", false); return false; }
      }
      this.clear("identified", false); this.blocked = null; this.blockedParts.clear(); this.acceptedParts = acceptedParts;
      const ticket = this.generation; this.pending = value.payload;
      this.set("loading", { sheet: value.sheet || "", model: this.codec.crc32(value.payload).toString(16) });
      try {
        const prepared = await this.hooks.prepare(value);
        if (ticket !== this.generation) { this.hooks.dispose?.(prepared); return false; }
        this.hooks.commit(prepared, value); this.pending = null; this.active = value;
        this.set("aligning", { sheet: value.sheet || "" }); return true;
      } catch (error) {
        if (ticket === this.generation) { this.pending = null; this.set("error", { message: String(error.message).slice(0, 180) }); }
        throw error;
      }
    }
    tracking(visible) {
      if (!this.active) return;
      const next = visible ? "viewing" : "tracking-lost";
      if (this.state !== next) this.set(next, { sheet: this.active.sheet || "" });
    }
  }
  const api = { Session, Journal, CameraLease, VERSION };
  if (typeof module === "object" && module.exports) module.exports = api; else root.ARSession = api;
})(typeof globalThis === "object" ? globalThis : this);
