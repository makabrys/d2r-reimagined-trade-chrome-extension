// Runs in the page itself (MAIN world) before the site's scripts.
// The site keeps one WebSocket to wss://api.d2r-reimagined.com/ws/trades for live trade events
// (new offer, new message, listing changes). Instead of opening a second connection, this
// listens to the site's own socket and forwards each event to the extension (trade.js).
// It also reports whether that socket is open, so the extension can check the server less often.
(() => {
  const Native = window.WebSocket;
  if (!Native || Native.__d2rbtHooked) return;
  let socketState = 'none';
  const post = (message) => window.postMessage(message, location.origin);

  function Hooked(url, protocols) {
    const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
    try {
      if (String(url).includes('/ws/trades')) {
        socket.addEventListener('message', (event) => post({ __d2rbt: 'trade-event', data: String(event.data) }));
        socket.addEventListener('open', () => { socketState = 'open'; post({ __d2rbt: 'trade-socket', state: 'open' }); });
        socket.addEventListener('close', () => { socketState = 'closed'; post({ __d2rbt: 'trade-socket', state: 'closed' }); });
      }
    } catch { /* never break the site */ }
    return socket;
  }
  Hooked.prototype = Native.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Hooked[key] = Native[key];
  Hooked.__d2rbtHooked = true;
  window.WebSocket = Hooked;

  // The extension may start after the socket opened: it asks, this answers.
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.__d2rbt === 'socket-query') post({ __d2rbt: 'trade-socket', state: socketState });
  });
})();
