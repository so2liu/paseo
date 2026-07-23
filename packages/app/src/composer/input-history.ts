import type { StreamItem } from "@/types/stream";

export type InputHistoryDirection = "older" | "newer";

export interface InputHistoryNavigationState {
  index: number | null;
  draft: string;
}

export interface InputHistoryNavigationResult extends InputHistoryNavigationState {
  handled: boolean;
  text: string;
}

export function collectUserInputHistory(
  tail: readonly StreamItem[],
  head: readonly StreamItem[],
): string[] {
  const history: string[] = [];
  for (const item of [...tail, ...head]) {
    if (item.kind !== "user_message") continue;
    const text = item.text.trim();
    if (!text) continue;
    history.push(text);
  }
  return history;
}

export function navigateInputHistory(input: {
  direction: InputHistoryDirection;
  history: readonly string[];
  currentText: string;
  state: InputHistoryNavigationState;
}): InputHistoryNavigationResult {
  if (input.history.length === 0) {
    return { ...input.state, handled: false, text: input.currentText };
  }

  if (input.direction === "older") {
    const draft = input.state.index === null ? input.currentText : input.state.draft;
    const index =
      input.state.index === null ? input.history.length - 1 : Math.max(0, input.state.index - 1);
    return { handled: true, index, draft, text: input.history[index] };
  }

  if (input.state.index === null) {
    return { ...input.state, handled: false, text: input.currentText };
  }
  if (input.state.index < input.history.length - 1) {
    const index = input.state.index + 1;
    return {
      handled: true,
      index,
      draft: input.state.draft,
      text: input.history[index],
    };
  }
  return {
    handled: true,
    index: null,
    draft: input.state.draft,
    text: input.state.draft,
  };
}
