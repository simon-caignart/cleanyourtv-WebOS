# Screen saver

CleanYourTV replaces LG's screen saver with its own page: the same pictures as behind Home (the theme's scenes, your photos from the
[wallpaper library](wallpapers.md) or the theme's wallpaper), cross-faded, with the clock and date in the corner. It appears when the
TV is idle, when LG's screen saver would have (see [When it appears](#when-it-appears)).

**It is off until you switch it on**: in the manager app, **Features → Screen saver** (the TV restarts). A new install and an update
keep LG's screen saver.

It is applied the same way as Home (**RAM only**): a reboot without the boot scripts, or the Homebrew Channel's failsafe mode, brings
LG's screen saver back.

## What it shows

- **What Home has behind it**, worked out in Home's own order, changed every 16 seconds with Ken Burns and every 25 with Classic (see
  [Photo styles](#photo-styles); a new photo starts when the page opens):
    1. the theme's **scenes**: the five landscapes of the couch scenes (or an add-on's scenes in their place, such as Seasons, with
       their credit line), or a theme's own scenes; a theme whose scenes give way to Wallpapers (`effects.scenesYield`) shows
       them only while Wallpapers is off or has no photos, as Home does;
    2. else, with [Wallpapers](wallpapers.md) on, the **wallpaper library**: uploads from the phone, the photos of a source add-on
       (Immich), and a live source (Unsplash: the photo Home shows now, with the photographer's name; the saver does not ask the
       source for another, which would make Home skip one; right after the service starts, the photo the saver fetched first is
       the one Home gets next; with only a live source the page looks again every 25 seconds and follows
       Home when its photo changes);
    3. else the **theme's wallpaper**.
- **The clock and the date**, bottom right, solid white over the photo: no transparency, so it stays readable on a bright picture.
  They are in Home's language and clock format: the manager's **Language**, or while it follows the TV, the TV's menu language (which
  can differ from the TV's own locale), and Customise > **Clock** (automatic, 12 or 24 hour).
  It sits in the same corner all the time, which is the one thing to watch on a panel that retains static content.
- **Nothing behind Home** (a plain theme, Wallpapers off): the clock and date alone, on black.

The first key, click or touch closes it and the app that was on screen comes back. Nothing is saved or uploaded.

## Photo styles

As on the Apple TV, the photos have a style, chosen in the manager: **Features** > **Screen saver** > **Photo style**.

- **Ken Burns** (the default): each photo slowly zooms in or out (between 1 and 1.12 times) and drifts toward or from a point, over the 16 seconds it stays and its fade, and the next one fades in over it.
- **Classic**: the photos stay still and cross-fade, every 25 seconds.

In both styles a photo in portrait (less than 1.2 times as wide as tall, see [Wallpapers](wallpapers.md#landscape-and-portrait)) is not cut to its middle band.
Two portrait photos share the screen, side by side with a thin line between them, and drift a little less; a portrait photo left over at the end of the round is shown whole over a blurred, darker copy of itself.
The order is shuffled each time the screen saver opens; a portrait photo is paired with the next portrait one in that order.

To spare the TV's graphics, each photo is drawn once into a picture of 1920 x 1080 that the screen scales, only that picture moves and fades, and there are never more than two of them; the next photo is loaded and decoded while one shows.

## Films (the Aerials add-on)

With the **Aerials** add-on installed (manager > Add-ons > Get more), the screen saver plays Apple's Aerial films instead of the pictures above: slow drone films of cities, landscapes and the sea, a few minutes each, as on the Apple TV.
**Features** > **Screen saver** > **Show** chooses, as the Apple TV's screen saver type does: **Aerials** (the default with the add-on), **Photos**, or **Aerials and photos**: a film, then three photos, then the next film, in turn (each change goes through black, as between films).
One film plays at a time: over its last second the screen fades to black, the next film starts behind the black, and the black fades away once that film shows its first pictures.
The place's name shows in the bottom left corner for a few seconds at the start of each film; the clock and the date stay where they are.
The black is drawn by the page above the film because webOS shows a video on a plane of its own under the page, through a hole in it: fading the video itself does nothing there, and while a video has no picture the hole shows the window underneath (Home).
So the page is black from its start until the first film plays, during every change, and when a film fails.
The order is shuffled each time the screen saver opens.

- The films are streamed from Apple's server (`sylvan.apple.com`) as they play; nothing is saved on the TV but the list of films.
  The add-on reads Apple's public list (`resources-16.tar`, the one the open-source Aerial screen saver for macOS uses for tvOS, about 2 MB) a quarter of a minute after it starts and then once a week, and keeps the short list it needs in `addon-data/aerials/films.json`.
- The films come over plain http: Apple's server answers the same files over https only with a certificate from Apple's own root, which neither the service nor the TV's browser trusts.
- **1080p H.264** (about 12 Mbit/s) is the default, the format every TV plays.
  **4K HEVC** (SDR) is chosen with `curl -X POST localhost:8765/api/addons/aerials/quality -d '{"quality":"4k"}'` on the TV (`"1080"` goes back); `GET /api/addons/aerials/status` says how many films there are, the quality, and when the list was last read.
- A film that does not play is passed over, and so is one that stops for half a minute (the network); after three films in a row that do not play, the screen saver shows the pictures again until it opens the next time.
- Switched off or removed, the screen saver shows the pictures again.

Any add-on can provide films the same way (`"provides": ["videos"]`, see [Add-ons](development/addons.md#providing-something-to-the-service-films)).

## How it replaces LG's screen saver

The same idea as for [Home](tv-changes.md#at-boot), on the app the TV starts when it is idle: `com.webos.app.screensaver`. Nothing
happens while the switch is off (no `SCREENSAVER-ON`).

1. At boot, `10-cleanyourtv-home` takes over Home with its folder mount and restarts the app manager so that it reads it. Just before
   that restart, it calls `20-cleanyourtv-screensaver prepare`, which mounts the screen saver's folder over
   `/usr/palm/applications/com.webos.app.screensaver`: the one restart reads both.
2. The folder holds the page and an `appinfo.json` derived from **this TV's own** screen saver (saved in
   `backup/screensaver-appinfo.orig.json` the first time), switched to the web type while it keeps **this TV's own window type**
   (`screenSaver`, which is the only one `tvpowerd` counts, see [When it appears](#when-it-appears)). The app id stays LG's, which is
   why the TV keeps asking for it. The folder is built on every run, also while it is already mounted, so a setup over a running
   install puts the new page in place (as `10-cleanyourtv-home` does for Home).
3. The page runs as LG's screen saver app, so the TV treats it as its screen saver, and closing it gives the app that was underneath back
   instead of going to Home (that was seen with the earlier `overlay` manifest, see [Limits](#limits)).

### Which TVs

This version replaces the screen saver only in the way that was tried on a TV (an LG 65UR91006LB, webOS 25, whose Home and screen
saver are Flutter apps): where the Home takeover is the folder mount, with its app manager restart. In the manager, **Screen saver**
reads "not available on this TV yet" elsewhere, and those TVs keep LG's screen saver:

- **LG's Home is a native program** (webOS 5 to 23, Home taken over by the stand-in): there is no app manager restart at boot to read
  the screen saver's folder. A restart of its own would take down the launcher's page in `webapp-mgr`, and a folder mounted without a
  restart would leave the TV with no screen saver at all, so nothing is mounted.
- **LG's screen saver is a native program** (`helper/tvprofile.js` `saverTakeover` is `none`): not replaced.

Both could come in a later version, once they have been tried on such a TV.

## When it appears

`tvpowerd` starts it after the TV's idle timeout (two minutes, `com.webos.surfacemanager.userActivityTimeout`) and starts it again after
each dismissal, as LG's own saver does — **provided the window type is LG's own**. With `defaultWindowType: "overlay"` it started the
page once and then stayed at `Screen Saver Ready` for good; with `"screenSaver"` (inherited from the stock manifest, see
`scripts/jtool.js`) it re-arms. Three timed cycles on the tested TV: 61 s, 112 s, 61 s.

The service keeps a second, slower timer as a fallback (`helper/screensaver.js`): two quiet minutes with the launcher
in front and it opens the page itself. It covered one of those three cycles, where `tvpowerd` did not fire. "Quiet" is the launcher's
own word: its page reports every key, click and pointer movement to the service (`POST /api/screensaver/active`), and the timer only
fires when no report has come for two minutes — a TV being browsed with the remote is Home in front all evening, and only `tvpowerd`'s
timer knows about that. A launcher that reports nothing (LG's Home in front, a launcher from before this) is left to `tvpowerd`.

The limit that follows: over a video app the service cannot tell an idle TV from a watched one, so there the saver comes only from
`tvpowerd`.

The page ignores keys for its first two seconds: webOS delivers a key with the launch, and without that guard the page closed itself
right after opening.

## While it runs

- The page asks the service for the photos and closes itself through it (`POST /api/screensaver/dismiss`). The service closes the
  page with `com.palm.webappmanager/killApp` and the app manager's `closeByAppId`, each tried on its own, which is what works where
  `window.close()` does nothing.
- If the system ends the screen saver by itself (the TV is back on an app) and the page is still listed, the service closes it within
  about a minute. A page left behind would keep the remote.

## Turning it off and on

It is **off by default**. In the manager app: **Features → Screen saver** or **CleanYourTV as Home → Screen saver**, then **CleanYourTV's screen saver**, On or Off.
The same screen has **Show** (with the Aerials add-on) and **Photo style**, which take effect the next time the screen saver opens, without a restart.
Switching restarts the TV, as that switch does for Home; after the restart the screen saver is ours or LG's. The row under Features
also says which one runs now: ours or LG's own.

The same thing from a shell on the TV — LG's own screen saver back, and the TV restarts:

```sh
sh /media/developer/cleanyourtv/undo-screensaver.sh
```

Add `--no-reboot` to switch it off for the next restart only.

CleanYourTV's screen saver again (the next restart):

```sh
touch /media/developer/cleanyourtv/SCREENSAVER-ON
```

The setting is the file `SCREENSAVER-ON` in `/media/developer/cleanyourtv`: present means ours, absent (the default) means LG's.

## Limits

!!! warning "Power-off stalled on the first TV, then was fixed"
    On the LG 65UR91006LB (2026-10-31) turning the TV off while the page was up **stalled**: the picture stayed frozen for a few
    minutes before the TV went off. The page had no standby handling, and the service had closed it with `killApp` while `tvpowerd`
    owned it. The page now closes itself on `visibilitychange` (standby, another app on top), and with that in place a power-off with
    the saver on screen went cleanly (verified on the same TV). The `killApp` path on dismissal is still there, so treat this as
    "fixed once, watch it".

!!! note "What was verified on that TV"
    LG's screen saver is a **Flutter** app started by `tvpowerd`: after the mount and one app manager restart, sam reports `type: web`,
    `main: index.html`; `tvpowerd` starts the page after the idle timeout (`caller_id: com.webos.service.tvpower`), with the window type
    of the manifest, and the first key closes it and gives the launcher back. Without the app manager restart the registry keeps
    `type: flutter` and nothing appears — the restart is what makes the mount take effect.

The launch showed a grey "loading" screen with a spinner for a second, like any web app: the derived manifest now sets
`noSplashOnLaunch: true` and `spinnerOnLaunch: false`, so the page's own black background is what appears. (Not yet seen on the TV.)

- While the page is up the power state stays `Active` with `processing: "Screen Saver Ready"`; that is why the service treats it as the
  screen saver and leaves it alone (a page that was closed every minute by its own safety check was the first bug found on the TV).
  The safety close rests on that one string of LG's, seen on the tested TV: a build that reports `Active` with another `processing`
  while the page is up would see the page closed and opened again. To keep one odd reading from doing that, the service closes the
  page only after a minute and at two readings in a row (10 seconds apart) without "Screen Saver" in `processing`.
- A page the service opened itself (the fallback over an idle launcher) is not in `tvpowerd`'s saver slot: on an LG OLED C4 (webOS 25)
  the power state read `Active` with no `processing` all along, so the check above closed that page after about a minute, often at the
  end of the first film. For a page it opened, the service reads the app in front instead, which stays Home while the page is up, and
  closes the page only when another app is in front at two readings in a row.
- The page keeps LG's `screenSaver` window type: that is what makes `tvpowerd` arm it again after a dismissal (with `overlay` it started
  once and then stayed at `Screen Saver Ready`, see [When it appears](#when-it-appears)).
- "Closing it gives the app underneath back" was seen with the earlier `overlay` manifest, where the first key closed the page and gave
  the launcher back. With LG's own window type that is worth one look on a TV with a video app behind the saver.
- If the page does not open where its folder is mounted, the TV stays on the app it was showing: the screen stays on rather than
  turning black.
- LG's **Screen Saver** setting (Clock, Gallery, Photo) still exists and is untouched; only the app it starts is replaced.
- The TV's own sleep and power-off timers are untouched.
- Photos are streamed from the service on `127.0.0.1`, so they are as fast as the wallpaper library behind Home.
