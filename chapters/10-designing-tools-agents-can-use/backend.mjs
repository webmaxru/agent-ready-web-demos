// A fresh Nordlys backend for every eval episode: the real store and booking
// service of the demo site, with the clock frozen at the book's demo date.
import { EventEmitter } from 'node:events';
import { createStore } from '../../nordlys-cabins/src/store.js';
import { bookingService } from '../../nordlys-cabins/layers/07-public-api/service.js';

export const TODAY = '2026-11-10';

export function createBackend({ timeoutFirstBooking = false } = {}) {
  const store = createStore({ now: () => new Date(`${TODAY}T09:00:00Z`) });
  const events = new EventEmitter();
  const service = bookingService({ store, events });
  const created = [];
  const cancelled = [];
  events.on('booking.created', (b) => created.push(b.ref));
  events.on('booking.cancelled', (b) => cancelled.push(b.ref));
  // A network failure after the booking was made: the first create call books,
  // but the agent only hears that the request timed out.
  let timeoutPending = timeoutFirstBooking;
  const takeTimeout = () => {
    const t = timeoutPending;
    timeoutPending = false;
    return t;
  };
  return { store, service, created, cancelled, takeTimeout };
}
