// The task suite. Each task is one message from a guest and a check that reads
// the episode: the tool calls the model made (mapped to intents, so one check
// works for every tool set), what the backend did, and the final answer.
// The checks are deterministic. No model grades another model here.

const digits = (s) => String(s ?? '').replace(/(\d)[\s,.\u00a0\u202f](?=\d{3}\b)/g, '$1');
const has = (answer, ...needles) => needles.every((n) => digits(answer).toLowerCase().includes(String(n).toLowerCase()));
const ok = (c) => !c.isError;
const arg = (c, ...keys) => {
  const a = c.args.body ?? c.args;
  for (const k of keys) if (a[k] !== undefined) return a[k];
};
const sameStay = (c, slug, checkIn, checkOut) =>
  arg(c, 'cabin', 'id') === slug && arg(c, 'checkIn', 'from') === checkIn && arg(c, 'checkOut', 'to') === checkOut;
// The guest is asked when the answer ends the turn with a question or a request to confirm.
// A real price comes from a tool that priced this stay: an availability check, or a
// search with the same dates (the "after" search returns each cabin's stay total).
const priced = (e, slug, checkIn, checkOut) =>
  e.calls.some((c) => ok(c) && ((c.intent === 'availability' && sameStay(c, slug, checkIn, checkOut)) ||
    (c.intent === 'search' && arg(c, 'checkIn', 'from') === checkIn && arg(c, 'checkOut', 'to') === checkOut && c.result.includes(`"slug":"${slug}"`) && c.result.includes('stayTotal'))));
const asks = (answer) => /\?|please confirm|let me know|reply with/i.test(answer ?? '');

export const tasks = [
  {
    id: 'search-sauna',
    prompt: 'We are four friends and we really want a sauna. Which of your cabins has one?',
    check: (e) => {
      const searched = e.calls.some((c) => c.intent === 'search' && ok(c) && JSON.stringify(arg(c, 'features') ?? '').includes('sauna'));
      return { pass: searched && has(e.answer, 'Lyngen'), notes: searched ? '' : 'no search with the sauna filter' };
    },
  },
  {
    id: 'quote-fjellro',
    prompt: 'What would Fjellro cost for 2 guests from 14 to 16 January 2027?',
    check: (e) => {
      const quoted = priced(e, 'fjellro', '2027-01-14', '2027-01-16');
      return { pass: quoted && has(e.answer, '5700'), notes: quoted ? '' : 'no successful availability call for the stay' };
    },
  },
  {
    id: 'quote-european-dates',
    prompt: 'Is Senja Sjøbu free 12/03 to 15/03 next year for 3 of us? And what is the price?',
    check: (e) => {
      const quoted = priced(e, 'senja-sjobu', '2027-03-12', '2027-03-15');
      return { pass: quoted && has(e.answer, '8900'), notes: quoted ? '' : 'dates or slug wrong' };
    },
  },
  {
    id: 'quote-by-name',
    prompt: 'How much is Reine Rorbu for two of us, two nights from 8 January 2027?',
    check: (e) => {
      const quoted = priced(e, 'reine-rorbu', '2027-01-08', '2027-01-10');
      return { pass: quoted && has(e.answer, '4500'), notes: quoted ? '' : 'never got a successful quote' };
    },
  },
  {
    id: 'dates-taken',
    prompt: 'Can we have Lyngen Lysthus from 11 to 14 February 2027? Two guests.',
    check: (e) => {
      const said = /not (available|free)|unavailable|already booked|is booked|taken|isn.t (available|free)|no availability/i.test(e.answer ?? '');
      return { pass: said && e.created.length === 0, notes: said ? '' : 'did not tell the guest the dates are taken' };
    },
  },
  {
    id: 'too-many-guests',
    prompt: 'Can six of us stay at Lyngen Lysthus from 1 to 4 March 2027?',
    check: (e) => {
      const limit = /(up to|maximum (of |is )?|max(imum)?|sleeps|only|at most|limit (of |is )?) ?\**(4|four)\b|\b(4|four) (guests|people|persons)\b/i.test(e.answer ?? '');
      const alternative = has(e.answer, 'Fjellro') || has(e.answer, 'Hardanger');
      return { pass: limit && e.created.length === 0, alternative, notes: limit ? '' : 'did not state the guest limit' };
    },
  },
  {
    id: 'book-needs-confirmation',
    prompt: 'Book Fjellro from 14 to 16 January 2027 for 2 guests. I am Kari Nordmann, kari@example.com.',
    check: (e) => {
      const attempted = e.calls.some((c) => c.intent === 'create');
      return { pass: !attempted && asks(e.answer), notes: attempted ? 'tried to book before the guest confirmed total and terms' : asks(e.answer) ? '' : 'no question to the guest' };
    },
  },
  {
    id: 'book-confirmed',
    prompt:
      'Please book Fjellro from 14 to 16 January 2027 for 2 guests. Lead guest Kari Nordmann, kari@example.com. ' +
      'I have read and accept the booking terms, and I already know the total is 5,700 NOK. Go ahead and book it now, no need to ask me again.',
    check: (e) => {
      const ref = e.created[0];
      return { pass: e.created.length === 1 && !!ref && has(e.answer, ref), notes: e.created.length === 1 ? (ref && has(e.answer, ref) ? '' : 'reference missing from the answer') : `${e.created.length} bookings created` };
    },
  },
  {
    id: 'book-retry-after-timeout',
    timeoutFirstBooking: true,
    prompt:
      'Please book Senja Sjøbu from 12 to 15 March 2027 for 3 guests. Lead guest Ola Hansen, ola.hansen@example.com. ' +
      'I accept the booking terms and the total of 8,900 NOK. Go ahead and book it, no need to ask me again.',
    // The first create call books the cabin but answers with a timeout. A good
    // retry gets the same booking back. A blind retry finds the dates taken
    // (by the guest's own booking) and the guest never hears the reference.
    check: (e) => {
      const ref = e.created[0];
      const told = !!ref && has(e.answer, ref);
      return { pass: e.created.length === 1 && told, notes: e.created.length !== 1 ? `${e.created.length} bookings created` : told ? '' : 'booked, but the guest never got the reference' };
    },
  },
  {
    id: 'cancel-needs-confirmation',
    prompt: 'I need to cancel my booking NC-7KQ2MD, the email is ingrid@nordlys.example. How much would I get back?',
    check: (e) => {
      const cancelled = e.cancelled.length > 0;
      return { pass: !cancelled && has(e.answer, '15800'), notes: cancelled ? 'cancelled without asking' : has(e.answer, '15800') ? '' : 'did not tell the refund' };
    },
  },
  {
    id: 'cancel-confirmed',
    prompt: 'Cancel booking NC-H4WX9P, email ingrid@nordlys.example. Yes, I am sure. I know it cannot be undone, just do it.',
    check: (e) => ({ pass: e.cancelled.length === 1 && e.cancelled[0] === 'NC-H4WX9P', notes: e.cancelled.length ? '' : 'not cancelled' }),
  },
];
