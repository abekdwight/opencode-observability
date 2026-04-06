// ---------------------------------------------------------------------------
// oh-my-openagent (OMO) message filter
//
// Detects and filters auto-inserted content from the oh-my-openagent plugin.
// Two categories:
//   A) Fully synthetic user messages (promptAsync) → hide entire message
//   B) Content prepended to user messages → strip prefix, keep user text
// ---------------------------------------------------------------------------
import type { SessionMessageContract } from "../../../../src/contracts/session.js";

// ---------------------------------------------------------------------------
// Category A: patterns that indicate a fully synthetic message (no user text)
//
// OMO always inserts content at the beginning of messages. We anchor all
// patterns to the start so that user-pasted text containing OMO patterns
// mid-message is never mistakenly filtered.
// ---------------------------------------------------------------------------
const SYNTHETIC_PATTERNS = [
  // promptAsync directives (TODO continuation, Ralph loop, Boulder, etc.)
  /^\s*\[SYSTEM DIRECTIVE: OH-MY-OPENCODE -/,
  // Background task notifications wrapped in <system-reminder> with OMO marker
  /^\s*<system-reminder>[\s\S]*?<!-- OMO_INTERNAL_INITIATOR -->/,
] as const;

function isSyntheticOmoMessage(text: string): boolean {
  return SYNTHETIC_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Category B: prefixes prepended before the user's actual text
// Structured as: {injected block}\n---\n{user text}
// ---------------------------------------------------------------------------
const PREPEND_PATTERNS = [
  /^\[search-mode\]\n[\s\S]*?\n---\n/,
  /^\[analyze-mode\]\n[\s\S]*?\n---\n/,
  /^<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>\n+---\n/,
  // "MANDATORY delegate_task params:" block appended by keyword detectors
  /^MANDATORY delegate_task params:[\s\S]*?\n---\n/,
] as const;

/**
 * Attempt to strip all known OMO prefixes from the user's message text.
 * Handles multiple prefixes stacked in a single message (e.g.
 * [search-mode]...\n---\n[analyze-mode]...\n---\nuser text).
 * Returns the cleaned text, or the original text if no prefix matched.
 */
function stripOmoPrefix(text: string): string {
  let current = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of PREPEND_PATTERNS) {
      const match = current.match(re);
      if (match) {
        current = current.slice(match[0].length).trimStart();
        changed = true;
        break; // restart pattern scan from the beginning
      }
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Detection: does this session contain any OMO content?
// ---------------------------------------------------------------------------
export function detectOmoContent(
  messages: SessionMessageContract[],
): boolean {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (isSyntheticOmoMessage(msg.text)) return true;
    if (stripOmoPrefix(msg.text) !== msg.text) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Filter: apply OMO filtering to a message list
// Returns a new array. Messages are either:
//   - removed (category A: synthetic)
//   - text-replaced (category B: prefix stripped)
//   - passed through unchanged
// ---------------------------------------------------------------------------
export function applyOmoFilter(
  messages: SessionMessageContract[],
): SessionMessageContract[] {
  const result: SessionMessageContract[] = [];

  for (const msg of messages) {
    // Only filter user messages
    if (msg.role !== "user") {
      result.push(msg);
      continue;
    }

    // Category A: fully synthetic → skip
    if (isSyntheticOmoMessage(msg.text)) {
      continue;
    }

    // Category B: strip prefix
    const cleaned = stripOmoPrefix(msg.text);
    if (cleaned !== msg.text) {
      result.push({ ...msg, text: cleaned });
    } else {
      result.push(msg);
    }
  }

  return result;
}
