// Nordlys Cabins, legacy front end.
// Deliberately agent-hostile: see src/views/legacy.js for the list of sins.
// Everything is rendered from JSON after a delay, controls are <div>s.
(function () {
  'use strict';

  var app = document.getElementById('app');

  // Navigation: every "link" is a div with data-href.
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-href]');
    if (el) window.location.href = el.getAttribute('data-href');
  });

  var hero = document.querySelector('.cabin-hero[data-img]');
  if (hero) hero.style.backgroundImage = 'url(' + hero.getAttribute('data-img') + ')';

  if (!app) return;
  var view = app.getAttribute('data-view');
  var delay = Number(app.getAttribute('data-delay') || 0);
  var today = app.getAttribute('data-today');

  function later(fn) { setTimeout(fn, delay); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function money(n) { return 'NOK ' + Number(n).toLocaleString('en-GB'); }
  function getJSON(url) { return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }); }
  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { j.httpStatus = r.status; return j; }); });
  }

  function card(c) {
    var d = el('div', 'card');
    d.setAttribute('data-href', '/cabins/' + c.slug);
    var img = el('div', 'card-img');
    img.style.backgroundImage = 'url(' + c.image + ')';
    d.appendChild(img);
    d.appendChild(el('div', 'card-title', c.name));
    d.appendChild(el('div', 'card-text', c.summary));
    d.appendChild(el('div', 'card-price', money(c.nightlyRate) + ' / night'));
    return d;
  }

  // ---------- list with "chips" as filters ----------
  function renderList(all, features) {
    app.innerHTML = '';
    var filters = el('div', 'filters');
    var active = {};
    var grid = el('div', 'grid');
    Object.keys(features).forEach(function (key) {
      var chip = el('div', 'chip', features[key]);
      chip.setAttribute('data-feature', key);
      chip.addEventListener('click', function () {
        active[key] = !active[key];
        chip.classList.toggle('on', active[key]);
        draw();
      });
      filters.appendChild(chip);
    });
    function draw() {
      grid.innerHTML = '';
      all.filter(function (c) {
        return Object.keys(active).every(function (k) { return !active[k] || c.features.indexOf(k) >= 0; });
      }).forEach(function (c) { grid.appendChild(card(c)); });
    }
    app.appendChild(filters);
    app.appendChild(grid);
    draw();
  }

  // ---------- custom date picker ----------
  function datePicker(input, onPick) {
    var pop = el('div', 'cal');
    var cursor = new Date(today + 'T00:00:00Z');
    cursor.setUTCDate(1);
    function draw() {
      pop.innerHTML = '';
      var head = el('div', 'cal-head');
      var prev = el('div', 'cal-prev', '‹');
      var next = el('div', 'cal-next', '›');
      var title = el('div', 'cal-title', cursor.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
      prev.addEventListener('click', function (e) { e.stopPropagation(); cursor.setUTCMonth(cursor.getUTCMonth() - 1); draw(); });
      next.addEventListener('click', function (e) { e.stopPropagation(); cursor.setUTCMonth(cursor.getUTCMonth() + 1); draw(); });
      head.appendChild(prev); head.appendChild(title); head.appendChild(next);
      pop.appendChild(head);
      var days = el('div', 'cal-days');
      var first = (cursor.getUTCDay() + 6) % 7; // Monday first
      for (var i = 0; i < first; i++) days.appendChild(el('div', 'cal-day empty'));
      var d = new Date(cursor);
      while (d.getUTCMonth() === cursor.getUTCMonth()) {
        var iso = d.toISOString().slice(0, 10);
        var cell = el('div', 'cal-day' + (iso < today ? ' past' : ''), String(d.getUTCDate()));
        cell.setAttribute('data-date', iso);
        if (iso >= today) cell.addEventListener('click', (function (v) {
          return function (e) { e.stopPropagation(); input.value = v; pop.remove(); onPick(v); };
        })(iso));
        days.appendChild(cell);
        d.setUTCDate(d.getUTCDate() + 1);
      }
      pop.appendChild(days);
    }
    input.addEventListener('click', function () {
      draw();
      input.parentNode.appendChild(pop);
    });
  }

  // ---------- cabin detail: description, price and booking all injected ----------
  function renderDetail(c) {
    app.innerHTML = '';
    c.description.forEach(function (p) { app.appendChild(el('div', 'text', p)); });
    var widget = el('div', 'widget');
    var dates = el('div', 'dates');
    var inWrap = el('div', 'date-wrap');
    var outWrap = el('div', 'date-wrap');
    var inInput = el('input', 'date-input'); inInput.placeholder = 'Check-in'; inInput.readOnly = true;
    var outInput = el('input', 'date-input'); outInput.placeholder = 'Check-out'; outInput.readOnly = true;
    inWrap.appendChild(inInput); outWrap.appendChild(outInput);
    dates.appendChild(inWrap); dates.appendChild(outWrap);
    var guests = 2;
    var stepper = el('div', 'stepper');
    var minus = el('div', 'step minus', '−');
    var count = el('span', 'count', String(guests));
    var plus = el('div', 'step plus', '+');
    minus.addEventListener('click', function () { guests = Math.max(1, guests - 1); count.textContent = guests; });
    plus.addEventListener('click', function () { guests = Math.min(c.maxGuests, guests + 1); count.textContent = guests; });
    stepper.appendChild(minus); stepper.appendChild(count); stepper.appendChild(plus);
    var check = el('div', 'btn btn-primary', 'Check');
    var result = el('div', 'result');
    var book = el('div', 'btn btn-book hidden', 'Book now');
    datePicker(inInput, function () {});
    datePicker(outInput, function () {});
    check.addEventListener('click', function () {
      result.textContent = '';
      book.classList.add('hidden');
      if (!inInput.value || !outInput.value) { result.textContent = 'Select dates'; return; }
      getJSON('/_app/quote?cabin=' + c.slug + '&checkIn=' + inInput.value + '&checkOut=' + outInput.value + '&guests=' + guests)
        .then(function (q) {
          if (q.errors && q.errors.length) { result.textContent = q.errors[0].message; return; }
          if (!q.available) { result.textContent = 'Not available'; return; }
          setTimeout(function () {
            result.textContent = 'Total ' + money(q.quote.total) + ' for ' + q.quote.nights + ' nights';
            book.classList.remove('hidden');
          }, delay);
        });
    });
    book.addEventListener('click', function () { openModal(c, inInput.value, outInput.value, guests); });
    widget.appendChild(dates); widget.appendChild(stepper); widget.appendChild(check); widget.appendChild(result); widget.appendChild(book);
    app.appendChild(widget);
  }

  function openModal(c, checkIn, checkOut, guests) {
    var overlay = el('div', 'overlay');
    var modal = el('div', 'modal');
    var close = el('div', 'modal-close', '×');
    close.addEventListener('click', function () { overlay.remove(); });
    modal.appendChild(close);
    modal.appendChild(el('div', 'modal-title', c.name));
    var name = el('input', 'inp'); name.placeholder = 'Name';
    var email = el('input', 'inp'); email.placeholder = 'Email';
    var phone = el('input', 'inp'); phone.placeholder = 'Phone';
    var terms = el('div', 'fake-check', 'I accept the terms');
    var accepted = false;
    terms.addEventListener('click', function () { accepted = !accepted; terms.classList.toggle('on', accepted); });
    var msg = el('div', 'modal-msg');
    var confirm = el('div', 'btn btn-primary', 'Confirm');
    confirm.addEventListener('click', function () {
      postJSON('/_app/bookings', { cabin: c.slug, checkIn: checkIn, checkOut: checkOut, guests: guests, name: name.value, email: email.value, phone: phone.value, acceptTerms: accepted })
        .then(function (r) {
          if (!r.ok) { msg.textContent = r.errors[0].message; return; }
          var toast = el('div', 'toast', 'Booked! Ref ' + r.booking.ref);
          document.body.appendChild(toast);
          setTimeout(function () { window.location.href = r.manageUrl; }, 800);
        });
    });
    [name, email, phone, terms, msg, confirm].forEach(function (n) { modal.appendChild(n); });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ---------- manage booking ----------
  function renderBooking(b) {
    app.innerHTML = '';
    var box = el('div', 'booking-box');
    box.appendChild(el('div', 'big', b.ref));
    box.appendChild(el('div', 'line', b.cabinName));
    box.appendChild(el('div', 'line', b.checkIn + ' → ' + b.checkOut + ' · ' + b.guests + ' pax'));
    box.appendChild(el('div', 'line', money(b.total)));
    box.appendChild(el('div', 'status ' + b.status, b.status.toUpperCase()));
    if (b.status === 'confirmed') {
      var cancel = el('div', 'link danger', 'Cancel');
      cancel.addEventListener('click', function () {
        var overlay = el('div', 'overlay');
        var modal = el('div', 'modal');
        modal.appendChild(el('div', 'modal-title', 'Are you sure?'));
        var yes = el('div', 'btn btn-danger', 'Yes');
        var no = el('div', 'btn', 'No');
        no.addEventListener('click', function () { overlay.remove(); });
        yes.addEventListener('click', function () {
          postJSON('/_app/bookings/' + b.ref + '/cancel', { token: app.getAttribute('data-token') }).then(function (r) {
            overlay.remove();
            if (r.ok) renderBooking(r.booking);
          });
        });
        modal.appendChild(yes); modal.appendChild(no);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      });
      box.appendChild(cancel);
    }
    app.appendChild(box);
  }

  later(function () {
    if (view === 'list' || view === 'featured') {
      getJSON('/_app/cabins').then(function (r) {
        if (view === 'list') return renderList(r.cabins, r.features);
        app.innerHTML = '';
        var grid = el('div', 'grid');
        r.cabins.slice(0, 3).forEach(function (c) { grid.appendChild(card(c)); });
        app.appendChild(grid);
      });
    } else if (view === 'detail') {
      getJSON('/_app/cabins/' + app.getAttribute('data-slug')).then(renderDetail);
    } else if (view === 'booking') {
      getJSON('/_app/bookings/' + app.getAttribute('data-ref') + '?token=' + encodeURIComponent(app.getAttribute('data-token'))).then(renderBooking);
    }
  });
})();
