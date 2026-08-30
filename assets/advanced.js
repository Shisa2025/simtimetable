(function () {
  'use strict';

  var STORAGE_KEY = 'sim-timetable-payload';
  var snippet = document.getElementById('snippet');
  var bookmarklet = document.getElementById('bookmarklet');
  var bookmarkletStatus = document.getElementById('bookmarkletStatus');
  var copyStatus = document.getElementById('copyStatus');
  var source = null;

  function validate(raw) {
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) parsed = { rows: parsed };
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) {
      throw new Error('Expected timetable JSON with a non-empty rows array.');
    }
    return parsed;
  }

  function saveAndOpen(raw) {
    try {
      var payload = validate(raw);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      location.href = '/#free-access';
    } catch (error) {
      document.getElementById('advancedImportError').textContent = 'Could not load that file: ' + error.message;
    }
  }

  fetch('/scraper/scrape.js')
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    })
    .then(function (text) {
      source = text.replace('__VIEWER_ORIGIN__', location.origin);
      snippet.textContent = source;
      bookmarklet.href = 'javascript:' + encodeURIComponent(source);
      bookmarkletStatus.textContent = 'Ready — drag the button to your bookmarks bar.';
    })
    .catch(function (error) {
      snippet.textContent = 'Could not load the scraper source: ' + error.message;
      bookmarkletStatus.textContent = 'Scraper unavailable.';
      bookmarkletStatus.className = 'err';
    });

  bookmarklet.addEventListener('click', function (event) {
    event.preventDefault();
    bookmarkletStatus.textContent = 'Drag this button to your bookmarks bar instead of clicking it here.';
  });

  document.getElementById('copyBtn').addEventListener('click', function () {
    if (!source) { copyStatus.textContent = 'The scraper is still loading.'; return; }
    navigator.clipboard.writeText(source).then(function () {
      copyStatus.textContent = 'Copied. Paste it into DevTools on the scheduling page.';
    }, function () {
      var range = document.createRange();
      range.selectNodeContents(snippet);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = 'Clipboard blocked. The source is selected; press Ctrl+C.';
    });
  });

  var fileInput = document.getElementById('advancedFile');
  document.getElementById('advancedPickBtn').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (file) file.text().then(saveAndOpen);
  });
  document.getElementById('advancedLoadPasteBtn').addEventListener('click', function () {
    var text = document.getElementById('advancedPaste').value.trim();
    if (!text) {
      document.getElementById('advancedImportError').textContent = 'Paste schedule JSON first.';
      return;
    }
    saveAndOpen(text);
  });
})();
