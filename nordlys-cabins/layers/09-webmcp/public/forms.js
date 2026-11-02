// Nordlys Cabins: helpers for the declarative WebMCP tools (Chapter 9).

// search_cabins (the search form) submits itself when an agent calls it.
// The agent gets the results as JSON, and the person sees the same results on the page.
const search = document.getElementById('search');
search?.addEventListener('submit', (event) => {
  if (!event.agentInvoked) return; // a person pressed the button: a normal submit
  event.preventDefault();
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(search)) if (value !== '') params.append(key, value);
  const results = fetch(`/_tools/cabins?${params}`, { headers: { accept: 'application/json' } }).then((r) => r.json());
  event.respondWith(results);
  results.then(() => showResults(params)).catch(() => search.submit());
});

// Update the result list in place. Navigating away now would end the tool call
// before the browser hands the answer to the agent.
async function showResults(params) {
  const page = await (await fetch(`/cabins?${params}`)).text();
  const next = new DOMParser().parseFromString(page, 'text/html');
  for (const selector of ['.result-count', '.cabin-grid']) {
    document.querySelector(selector)?.replaceWith(next.querySelector(selector));
  }
  history.replaceState(null, '', `/cabins?${params}`);
}

// Log which tool an agent starts and cancels, for the browser console and for tests.
if ('modelContext' in document) {
  document.modelContext.addEventListener('toolactivated', (event) => console.info('WebMCP tool activated:', event.toolName));
  document.modelContext.addEventListener('toolcancel', (event) => console.info('WebMCP tool cancelled:', event.toolName));
}
