// The "state machine" piece: a tiny, explicit finite state machine.
// Mastra uses XState for this; here we hand-roll the same idea so every
// transition is visible instead of hidden inside a library.

const TRANSITIONS = {
  pending: { start: "running" },
  running: { suspend: "suspended", complete: "completed", fail: "failed", step: "running" },
  suspended: { resume: "running" },
  completed: {},
  failed: {},
};

export class StateMachine {
  constructor(initial = "pending") {
    this.state = initial;
  }

  can(event) {
    return Boolean(TRANSITIONS[this.state]?.[event]);
  }

  send(event) {
    const next = TRANSITIONS[this.state]?.[event];
    if (!next) {
      throw new Error(`invalid transition: ${event} from state "${this.state}"`);
    }
    this.state = next;
    return this.state;
  }
}
