// 「状態機械」の部分: 小さく明示的な有限状態機械。
// Mastra本体はここをXStateに任せているが、ここでは同じ考え方を自前で
// 実装し、遷移がライブラリの裏に隠れず全部見えるようにしている。

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
