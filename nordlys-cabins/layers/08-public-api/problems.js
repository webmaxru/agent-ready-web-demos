// Problem details (RFC 9457) for the Nordlys public API.
// Every error has a stable "type" URI that resolves to a short explanation,
// a human "title", the HTTP "status", and the field errors as an extension.

/** Store and service error codes, mapped to a problem type and an HTTP status. */
const PROBLEMS = {
  'invalid-request': { status: 422, title: 'The request has invalid fields' },
  'unknown-cabin': { status: 404, title: 'There is no cabin with that name' },
  'not-available': { status: 409, title: 'The cabin is not available for those dates' },
  'not-found': { status: 404, title: 'No booking matches that reference and email address' },
  'already-cancelled': { status: 409, title: 'The booking is already cancelled' },
  'stay-started': { status: 409, title: 'A stay that has started cannot be cancelled online' },
  'idempotency-key-missing': { status: 400, title: 'Idempotency-Key is missing' },
  'idempotency-key-reused': { status: 422, title: 'Idempotency-Key is already used for a different request' },
  'idempotency-key-in-flight': { status: 409, title: 'A request is outstanding for this Idempotency-Key' },
};

const CODE_TO_TYPE = {
  unknown_cabin: 'unknown-cabin',
  not_available: 'not-available',
  not_found: 'not-found',
  already_cancelled: 'already-cancelled',
  stay_started: 'stay-started',
  idempotency_key_missing: 'idempotency-key-missing',
  idempotency_key_reused: 'idempotency-key-reused',
  idempotency_key_in_flight: 'idempotency-key-in-flight',
};

/** Pick the problem type for a list of field errors: the first special code wins, else a validation problem. */
export function problemTypeFor(errors) {
  for (const e of errors) if (CODE_TO_TYPE[e.code]) return CODE_TO_TYPE[e.code];
  return 'invalid-request';
}

/** Build an application/problem+json response. */
export function problem(c, ctx, type, { detail, errors, status, extra = {} } = {}) {
  const p = PROBLEMS[type];
  const body = {
    type: ctx.absoluteUrl(c, `/problems/${type}`),
    title: p.title,
    status: status ?? p.status,
    ...(detail ? { detail } : {}),
    instance: c.req.path,
    ...(errors ? { errors: errors.map(({ field, code, message }) => ({ field, code, detail: message })) } : {}),
    ...extra,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json', 'content-language': 'en' },
  });
}

/** Turn a failed service result into a problem response. */
export function problemFromErrors(c, ctx, errors) {
  const type = problemTypeFor(errors);
  const detail = errors.length === 1 ? errors[0].message : `${errors.length} fields need attention.`;
  return problem(c, ctx, type, { detail, errors });
}

/** The page each problem type URI resolves to (text/markdown). */
export function problemPage(type) {
  const p = PROBLEMS[type];
  if (!p) return null;
  return `# ${p.title}\n\nProblem type \`${type}\`, HTTP status ${p.status}.\n\n` +
    'The response body is `application/problem+json` (RFC 9457). The `errors` array, when present, ' +
    'lists each field with a stable `code` and a `detail` you can show to a person.\n\n' +
    'API reference: [/openapi.json](/openapi.json)\n';
}

export const PROBLEM_TYPES = Object.keys(PROBLEMS);
