# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Segway Navimow robotic mowers through the Navimow cloud, signed in with the
  account of the Navimow app: a **Connect** button (the OAuth2 flow of
  Segway's Home Assistant integration), or the address of the sign-in page
  pasted by hand. The session is kept in Gladys and renewed by itself; an
  ended session asks to connect again.
- One device per mower: operational state (Gladys vacuum-cleaner states:
  running, paused, returning to dock, charging, docked, error, stopped),
  battery, activity, error code and text, online, mowing progress (%) and
  area mowed in the session (m²); a mow / pause select and a return to the
  station button.
- Live updates over MQTT (secure WebSocket) while the mower works, and the
  state read every 5 minutes (configurable, every 2 minutes while the live
  updates are down).
- Scene triggers "error", "activity changed", "mowing finished" (complete,
  interrupted or unknown, session length, progress, area) and "back in its
  station".
- Scene actions "start mowing", "pause", "resume" and "back to the station",
  for one mower or all of them.
- A "Robotic mower" dashboard widget: battery, progress, activity, error,
  online, live updates, and Start / Pause / Resume / Station buttons.
- A "Test Navimow" button.
- Feature names and texts in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-navimow/commits/main
