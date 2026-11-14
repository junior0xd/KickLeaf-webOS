'use strict';
class Metrics {
  constructor() { this.phases = {}; this.http = []; this.network = {}; }
  add(phase, key, amount = 1) {
    const p = this.phases[phase] || (this.phases[phase] = {});
    p[key] = (p[key] || 0) + amount;
  }
  snapshot() { return JSON.parse(JSON.stringify({ phases: this.phases, http: this.http, network: this.network })); }
}
module.exports = { Metrics };
