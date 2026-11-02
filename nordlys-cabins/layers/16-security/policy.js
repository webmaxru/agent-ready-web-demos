// The security policy of every MCP tool Nordlys publishes, in one table.
// A tool that is not in this table is not callable, so a tool added by mistake
// (or by a dependency) cannot go live without a reviewer seeing it here.
//
// The three flags are Meta's "Agents Rule of Two" read from the site's side:
//   untrustedInput  the tool's input or output carries text written by strangers
//   sensitiveData   the tool reads or returns a guest's personal data
//   stateChange     the tool changes something (a booking, money, an account)
// The rule is about the agent, not one tool. Our part: no single tool of ours
// combines all three, so an agent never gets all three from one call.
export const TOOL_POLICY = {
  search_cabins:      { untrustedInput: false, sensitiveData: false, stateChange: false, auth: 'none' },
  check_availability: { untrustedInput: false, sensitiveData: false, stateChange: false, auth: 'none' },
  get_cabin_reviews:  { untrustedInput: true,  sensitiveData: false, stateChange: false, auth: 'none' },
  find_booking:       { untrustedInput: false, sensitiveData: true,  stateChange: false, auth: 'ref + email' },
  get_booking:        { untrustedInput: false, sensitiveData: true,  stateChange: false, auth: 'owner' },
  create_booking:     { untrustedInput: false, sensitiveData: true,  stateChange: true,  auth: 'none', confirm: 'terms accepted by the user' },
  cancel_booking:     { untrustedInput: false, sensitiveData: true,  stateChange: true,  auth: 'owner', confirm: 'user confirms the cancellation' },
  list_my_bookings:   { untrustedInput: false, sensitiveData: true,  stateChange: false, auth: 'oauth bookings:read' },
  cancel_my_booking:  { untrustedInput: false, sensitiveData: true,  stateChange: true,  auth: 'oauth bookings:write', confirm: 'user confirms the cancellation' },
  request_booking:    { untrustedInput: false, sensitiveData: true,  stateChange: true,  auth: 'none', confirm: 'guest confirms on nordlys.example' },
  check_booking_request: { untrustedInput: false, sensitiveData: false, stateChange: false, auth: 'holder of the checkout id' },
};

/** Tools that combine all three properties. CI fails if this list is not empty. */
export function ruleOfTwoViolations(policy = TOOL_POLICY) {
  return Object.entries(policy)
    .filter(([, p]) => p.untrustedInput && p.sensitiveData && p.stateChange)
    .map(([name]) => name);
}
