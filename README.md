# Merito Slides

Chrome extension that downloads an interactive presentation from Merito Moodle (`moodle2.e-wsb.pl`). It saves the slides and media as a ZIP you can play offline.

Articulate Storyline, iSpring, and SCORM presentations on this site have no direct download. The extension collects the open player's files and packs them so they work without Moodle.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

After changing files, reload the extension, then reload the Moodle tab.

## Use

1. Open the presentation in Moodle so the slides are visible. A new slide window can stay in the background.
2. Click the extension icon on the course tab or the presentation window, then **Download presentation**. Progress stays in a Chrome notification after the popup closes. The extension icon shows the file count.
3. Unzip the archive.
4. Run `Open_Presentation.bat`.

The `.bat` file starts a local server on port 8765 and opens the presentation in the browser. Python must be on `PATH` (`python`). Close the console window to stop the server.

If the package contains `lms/Configuration.js`, the extension switches it to run without an LMS. The player then does not look for Moodle.

## Files

- `popup.html`, `popup.js`, `popup.css` — extension popup
- `exporter.js` — finds files, builds the ZIP, and starts the download
- `content.js` — forwards progress from the page to the popup
- `background.js` — switches to the slide window and keeps the download notification
