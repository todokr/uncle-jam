// The "state machine" piece: a tiny, explicit finite state machine.
// Mastra uses XState for this; here we hand-roll the same idea so every
// transition is visible instead of hidden inside a library.

export type State = "pending" | "running" | "suspended" | "completed" | "failed";
export type Event = "start" | "step" | "suspend" | "complete" | "fail" | "resume";

const TRANSITIONS: Partial<Record<State, Partial<Record<Event, State>>>> = {
  pending: { start: "running" },
  running: { suspend: "suspended", complete: "completed", fail: "failed", step: "running" },
  suspended: { resume: "running" },
  completed: {},
  failed: {},
};

export class StateMachine {
  state: State;

  constructor(initial: State = "pending") {
    this.state = initial;
  }

  can(event: Event): boolean {
    return Boolean(TRANSITIONS[this.state]?.[event]);
  }

  send(event: Event): State {
    const next = TRANSITIONS[this.state]?.[event];
    if (!next) {
      throw new Error(`invalid transition: ${event} from state "${this.state}"`);
    }
    this.state = next;
    return this.state;
  }
}
