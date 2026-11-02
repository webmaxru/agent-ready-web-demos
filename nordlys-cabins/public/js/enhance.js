// Nordlys Cabins, clean front end: small progressive enhancements.
// Every page works without this script.

// 1. Keep check-out after check-in in any form that has both fields.
for (const form of document.querySelectorAll('form')) {
  const checkIn = form.querySelector('input[name="checkIn"]');
  const checkOut = form.querySelector('input[name="checkOut"]');
  if (!checkIn || !checkOut) continue;
  checkIn.addEventListener('change', () => {
    if (!checkIn.value) return;
    const next = new Date(`${checkIn.value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    checkOut.min = next.toISOString().slice(0, 10);
    if (checkOut.value && checkOut.value <= checkIn.value) checkOut.value = checkOut.min;
  });
}

// 2. Open the cancel confirmation in a native <dialog> instead of a new page.
const cancelLink = document.getElementById('cancel-link');
const dialog = document.getElementById('cancel-dialog');
if (cancelLink && dialog && typeof dialog.showModal === 'function') {
  cancelLink.addEventListener('click', (event) => {
    event.preventDefault();
    dialog.showModal();
  });
  dialog.querySelector('[data-close-dialog]')?.addEventListener('click', (event) => {
    event.preventDefault();
    dialog.close();
    cancelLink.focus();
  });
}

// 3. Move focus to an error summary so screen reader users hear it first.
document.querySelector('.error-summary')?.focus();
