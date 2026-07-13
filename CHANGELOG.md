# Change Log

All notable changes to the "pomodoro" extension will be documented in this file.

## [2.0.1]

### Added
- Independent status bar visibility toggles:
  - `pomodoro.showStatusDot` (default `true`) — the 🟢 / 🔴 / ⏸️ status icon.
  - `pomodoro.showStatusLabel` (default `true`) — the Work / Break / Paused text label.
- `pomodoro.pomodoroClock` now controls the clock in every state (including while paused); turning all three pieces off keeps the icon so the item stays clickable.

### Fixed
- On Windows, playing a notification sound no longer pops open the default media player app. Audio now plays silently in the background (via the Win32 MCI API) for both `.wav` and `.mp3` files.

## [2.0.0]

### Added
- Configurable, per-event sounds selectable from a dropdown in settings:
  - `pomodoro.sounds.shortBreakStart` (default `sound1.wav`)
  - `pomodoro.sounds.longBreakStart` (default `sound2.wav`)
  - `pomodoro.sounds.workStart` (default `sound4.mp3`)
- Each sound event can be silenced with `none`, or pointed at your own file via an absolute path.

### Changed
- Sound files now ship from the top-level `sounds/` folder (previously under `src/`, which was excluded from the package).
- The first work session at launch is now silent.

### Fixed
- Sounds failed to play because the packaged path did not resolve to a bundled file.

## [1.0.1]

- Initial release
