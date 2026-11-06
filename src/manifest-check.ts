/**
 * Local checks on a ZApp manifest's interaction types, run by `zend apps check` and before
 * `zend apps deploy`. The server validates everything again; this catches the mistakes that
 * would otherwise deploy quietly, above all a misspelt `serverOnly` that leaves a move open to
 * every player.
 */

export interface CheckResult {
  errors: string[];
  /** `type: from → to` for every move only the app's server may make. */
  serverOnly: string[];
}

const TRANSITION_KEYS = new Set(["to", "serverOnly"]);

export function checkManifest(m: unknown): CheckResult {
  const errors: string[] = [];
  const serverOnly: string[] = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    return { errors: ["manifest must be a JSON object"], serverOnly };
  }
  const types = (m as Record<string, unknown>).interactionTypes;
  if (types === undefined) return { errors, serverOnly };
  if (!types || typeof types !== "object" || Array.isArray(types)) {
    return { errors: ["interactionTypes must be an object"], serverOnly };
  }
  for (const [name, raw] of Object.entries(types as Record<string, any>)) {
    const states: unknown[] = Array.isArray(raw?.states) ? raw.states : [];
    const known = new Set(states.filter((s): s is string => typeof s === "string"));
    const terminal = new Set<string>(Array.isArray(raw?.terminal) ? raw.terminal : []);
    if (!known.size) errors.push(`interaction ${name}: states must list at least one state`);
    if (typeof raw?.initial !== "string" || !known.has(raw.initial)) {
      errors.push(`interaction ${name}: initial state not in states`);
    }
    const transitions = raw?.transitions ?? {};
    if (typeof transitions !== "object" || Array.isArray(transitions)) {
      errors.push(`interaction ${name}: transitions must be an object of state → list`);
      continue;
    }
    for (const [from, list] of Object.entries(transitions as Record<string, unknown>)) {
      if (!known.has(from)) errors.push(`interaction ${name}: transition from unknown state ${from}`);
      if (!Array.isArray(list)) {
        errors.push(`interaction ${name}: transitions.${from} must be a list`);
        continue;
      }
      if (terminal.has(from) && list.length) {
        errors.push(`interaction ${name}: terminal ${from} cannot have transitions`);
      }
      const seen = new Set<string>();
      for (const t of list) {
        let to: string | undefined;
        if (typeof t === "string") {
          to = t;
        } else if (t && typeof t === "object" && !Array.isArray(t)) {
          const rule = t as Record<string, unknown>;
          for (const k of Object.keys(rule)) {
            if (!TRANSITION_KEYS.has(k)) {
              const hint = k.toLowerCase() === "serveronly" ? ` (did you mean "serverOnly"?)` : "";
              errors.push(`interaction ${name}: transition from ${from} has unknown key "${k}"${hint}`);
            }
          }
          if (typeof rule.to !== "string") {
            errors.push(`interaction ${name}: a transition from ${from} needs "to"`);
            continue;
          }
          to = rule.to;
          if (rule.serverOnly !== undefined && typeof rule.serverOnly !== "boolean") {
            errors.push(`interaction ${name}: ${from} → ${to}: serverOnly must be true or false`);
          }
          if (rule.serverOnly === true) serverOnly.push(`${name}: ${from} → ${to}`);
        } else {
          errors.push(`interaction ${name}: transitions.${from} entries must be a state name or { to, serverOnly }`);
          continue;
        }
        if (!known.has(to)) errors.push(`interaction ${name}: transition to unknown state ${to}`);
        if (seen.has(to)) errors.push(`interaction ${name}: ${from} → ${to} is listed more than once`);
        seen.add(to);
      }
    }
  }
  return { errors, serverOnly };
}
