# Segway Navimow

**Unofficial connector, not affiliated with Segway or Navimow.** It brings
your Segway Navimow robotic mowers (the models without a perimeter wire) into
Gladys through the Navimow cloud, the one of the Navimow app, with the same
sign-in Segway offers to Home Assistant. Navimow and Segway are trademarks of
their owners.

> **Development version (0.1).** Built from Segway's own documentation and
> integrations, and tested against simulated answers: it has not run with a
> real mower yet. Feedback is welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-navimow/issues).

## What you get

| Surface              | Content                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One device per mower | operational state, battery, activity, error code and error text, online, mowing progress (%) and area mowed in the session (m²), a **mow / pause** select and a **return to the station** button |
| Live updates         | the state, battery and progress arrive within seconds while the mower works (MQTT over a secure WebSocket); the state is also read every 5 minutes                                               |
| Scene triggers       | **error**, **activity changed**, **mowing finished** (complete, interrupted or unknown), **back in its station**                                                                                 |
| Scene actions        | **start mowing**, **pause**, **resume**, **back to the station**, for one mower or every mower                                                                                                   |
| Dashboard widget     | **Robotic mower**: battery, progress, activity, error, online, live updates, and Start / Pause / Resume / Station buttons                                                                        |
| Configuration screen | a **Test Navimow** button listing your mowers                                                                                                                                                    |

## Setup

1. Install the integration from the Gladys store, then open its
   **Configuration** screen.
2. Next to **Navimow account**, click **Connect**. Segway's sign-in page
   opens: sign in with the e-mail and password of the Navimow app (it may ask
   for a captcha). The browser then comes back to Gladys by itself, and the
   connection status turns green.
3. Open **Discovery** and add your mowers.
4. Put the **Robotic mower** widget on a dashboard.

Your password stays with Segway: Gladys only receives a session token, which
the integration renews by itself (about every hour). If Segway ends the
session, the status says so: click **Connect** again.

### If Connect does not come back to Gladys

Sign in by hand instead, the way the ioBroker adapter does:

1. Open the **Navimow sign-in page** link of the Configuration screen (in
   the "Connect does not come back to Gladys?" block) and sign in.
2. The browser then shows an error page whose address starts with
   `http://localhost:1/callback?code=`: this is expected.
3. Copy that **whole address** into the **Sign in with the copied address**
   action at the bottom of the Configuration screen, and run it within a few
   minutes (a code works once, for a short time).

## The device

Gladys has no robotic mower category yet: like the Husqvarna Automower
integration, the state and the two commands use the **robot vacuum**
category, the only one describing a robot that runs, docks and charges. The
device card therefore shows:

- **State**: Running (mowing or mapping), Paused, Returning to Dock,
  Charging, Docked, Error (lifted or an error), Stopped (idle, updating,
  self-check, offline);
- **Mowing (idle: pause)**: a select whose **Mow** choice ("Clean") starts
  mowing (or resumes a paused mowing) and **Pause** ("Idle") pauses the
  mower;
- **Return to the station**: the "Return to Dock" button.

The other features are the battery (%), the activity (text in the language
chosen in the configuration), the error code (0: none, -1: an error without a
numeric code) and its text, online, the mowing progress (%) and the area
mowed in the current session (m²). The progress and the area come with the
mower's position messages: Segway only sends them while the mower mows a
whole lawn (a zone task reports none).

**Start** runs the task set in the Navimow app; the public API offers no
"end the task": **pause** stops the mower where it is, **back to the
station** sends it home.

## Scenes

- **Navimow error**: once per error (lifted, stuck, a motor or sensor
  error...). Variables: the code, the text in English and in French, the
  activity, the battery.
- **Navimow activity changed**: optionally for one activity (mowing,
  mapping, paused, returning, in the station, charging, idle, lifted, error,
  software update, self-check, offline). Variables: the new and the previous
  activity, the battery.
- **Navimow mowing finished**: a session (it starts when the mower mows)
  ended in the station or idle. Its **outcome** can filter the trigger:
  **complete** (the progress reached 100 %), **interrupted** (below 100 %: a
  stop, or a charging break before it goes on) or **unknown** (no progress
  was reported, e.g. a zone task). Variables: the outcome, where it ended,
  the session length in minutes (empty when the session began before Gladys
  saw it), the progress, the area, the battery, the end time.
- **Navimow back in its station**: the mower arrived in its station, whatever
  the reason (end of mowing, charging break, sent back). A mower the cloud
  sees again (offline before) does not count.

The actions **start mowing**, **pause**, **resume** and **back to the
station** act on the chosen mower, or on every mower when the field is empty.
They give `mower_name` and `count` to the following actions of the scene,
which find them in their variable list (written `{{<step>.<action>.<key>}}`,
for instance `{{0.0.count}}` when this action is the first of the scene).

## How often Navimow is called

At start: the list of mowers and their state (one call for all). While the
mower works, the live updates bring the changes. The state is read again
every 5 minutes (option **Status refresh interval**, 1 to 60), every 2
minutes while the live updates are down, and 10 seconds after a command; the
list of mowers every 12 hours and on a Discovery scan. A docked mower sends
nothing live, so its battery follows the 5-minute reading.

## Troubleshooting

- **"Not connected"**: click **Connect** (setup, step 2).
- **"The Navimow session expired or was refused"**: Segway ended the session
  (password changed, account signed out): click **Connect** again.
- **The sign-in page does not come back to Gladys**: use the manual sign-in
  above.
- **"Live updates down"**: the integration keeps reading the state every 2
  minutes and reconnects by itself; the logs say why.
- **The state lags a minute behind the app**: the cloud status the
  integration reads is a cache; the live updates, when on, are immediate.
- Logs: the integration's log level is set with the `LOG_LEVEL` variable
  (`debug` also logs the event and attribute messages of the mowers).

## Privacy

The integration uses the state of your mowers only: the positions Segway
sends with the progress are dropped at once, never stored nor shown. The
session token goes to Segway only and never appears in a log, a status or a
scene.
