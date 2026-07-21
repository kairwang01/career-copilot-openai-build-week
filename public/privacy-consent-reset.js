(function () {
  var resetButton = document.getElementById('reset-consent');
  var resetStatus = document.getElementById('reset-consent-status');

  if (!resetButton || !resetStatus) return;

  resetButton.addEventListener('click', function () {
    var resetCookie = resetButton.getAttribute('data-reset-cookie');
    if (!resetCookie) return;

    document.cookie = resetCookie;
    try {
      localStorage.setItem('career-copilot:consent-sync', String(Date.now()));
    } catch (_) {
      // The cookie reset still works when browser storage is unavailable.
    }

    resetStatus.textContent =
      'Your choice was reset. Reload any open Career CoPilot tabs, then choose again from the banner.';
  });
})();
