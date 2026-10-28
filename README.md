# Presence — Attendance Verification Prototype

A click-through demo of a no-proxy attendance system: one-time face
enrollment, then per-class check-in via dynamic QR (auto-expiring every
~6s) + Bluetooth pairing to a specific professor device + liveness
(randomized blink count) check against the enrolled face. Ends with a
downloadable Excel attendance report.

## ⚠️ Run this from a local server, not by double-clicking the file

**This is almost certainly why camera and Bluetooth didn't work before.**
Chrome (and most browsers) block camera access and disable the Web Bluetooth
API entirely on pages opened directly from disk (`file://…`). Both features
need what's called a "secure context" — `https://` or `http://localhost`.

It takes one command to fix. Open a terminal, `cd` into the unzipped
`attendance-system` folder, and run:

**If you have Python installed (most Mac/Linux, many Windows machines):**
```
python3 -m http.server 8000
```
(On Windows it may just be `python` instead of `python3`.)

Then open **`http://localhost:8000`** in Chrome — not `index.html` directly.

**If you don't have Python:** install [Node.js](https://nodejs.org) once,
then run `npx serve` in the folder and open the localhost URL it prints.

Every page in this build now detects a non-secure context and shows an
on-screen banner reminding you to do this, instead of silently failing.

## How to run the full demo

Open two browser windows (or two tabs), both pointed at
`http://localhost:8000`:

- **Window B (student, once ever)** → "I'm a student" → "Enroll your face
  once" → fill in details and capture a face photo. This only happens one
  time per student, ideally staff-supervised — see "Enrollment vs.
  check-in" below for why.
- **Window A** → "I'm the professor" → fill in class details **and your
  device's Bluetooth name** → project the QR code.
- **Window B (student, every class)** → "I'm a student" → enter roll
  number → confirm it's you → scan the QR (or type the manual code shown
  under it) → pair Bluetooth to the exact device name the professor
  entered → blink twice (or three times — randomized) → attendance
  confirmed.

Both windows share `localStorage`, so they need to be the same browser on
the same machine for this demo. See "Scope of this demo" below for how
this becomes a real multi-device backend.

## Enrollment vs. check-in — and why they're now separate

Earlier builds captured a student's face fresh on every single check-in,
seconds before comparing it against itself on the liveness page. That only
proved "the person a few steps ago in this one visit is the same person
now" — it never checked identity against anything durable. A friend could
type an absent classmate's roll number, register *their own* face on the
spot, and pass every check without issue.

Now:
- **`enroll.html`** — a one-time step. Ideally done with a TA/professor
  watching, since this is the photo everything else trusts from then on.
  Stored in `localStorage` under a persistent roster, keyed by roll number
  (`Store.enrollStudent()` / `Store.ROSTER`).
- **`student-login.html`** — now just a roll-number lookup
  (`Store.getEnrolledStudent()`). No camera, no form re-fill. The student
  confirms "is this you?" against the enrolled name, then proceeds.
- **`liveness.html`** — compares the live camera capture against the
  **enrolled** descriptor (`Store.matchesRegisteredFace()`), never one
  captured moments earlier. Typing someone else's roll number no longer
  helps, since the live face still has to match that roll number's real
  enrollment photo.

This is still enforced entirely client-side (see "Scope of this demo"),
so it's not a substitute for server-side verification in a real
deployment — but it closes the specific loophole above.

## No more one-click liveness bypass

The old "Simulate liveness pass" button skipped both blink detection and
face matching with a single click — meant as a demo fallback for a broken
camera, but in practice a one-second way for anyone to mark attendance
with no verification at all.

It's replaced with **"Report to professor"**: a genuine camera/model
failure now creates a pending entry the professor sees on their dashboard
(`Store.flagForManualReview()`), with the student's enrolled name and roll
number, that the professor approves or rejects by hand — since they can
actually see who's in the room. The student's page polls and moves on
automatically once approved. Approved-by-hand entries are marked
`manuallyApproved: true` and show a "manual" badge everywhere they appear
(dashboard, report), so they're never silently indistinguishable from a
fully-verified check-in.

## Randomized blink count

`liveness.html` now asks for a random 2 or 3 blinks
(`Store.pickBlinkRequirement()`), chosen fresh per attempt and only shown
once the camera is live. A pre-recorded video of the real student blinking
a fixed, predictable number of times is less likely to line up. Not a full
fix for video replay — nothing purely client-side is — but it raises the
bar over a static, guessable challenge.

## XSS fix

`professor-dashboard.html`, `report.html`, `success.html`, and
`bluetooth.html` used to interpolate student/professor-entered text (name,
roll number, subject, teacher name, a scanned Bluetooth device's broadcast
name) directly into `innerHTML`. A value like `<img src=x onerror=...>`
typed into any of those fields would have executed as script on whoever's
screen rendered it next. All of it now goes through `Util.escapeHtml()`
(`js/util.js`) before hitting the page.

## Backup / restore

Because everything still lives in one browser's `localStorage`, closing
that tab (or opening the report on a different device) loses the whole
session. The dashboard has a **Download backup (.json)** button
(`Store.exportBackup()`); `professor-login.html` has a matching **Restore
from a backup file** link (`Store.importBackup()`) to reload it. This is a
stopgap, not a fix — see "Scope of this demo" for the real one (a server).

## What's new in this version

**1. Close the session / Excel export**
The professor dashboard has a **Close session** button. Once clicked:
- The QR code and manual code stop working immediately — any further scan
  or manual entry shows "session closed."
- The professor gets a link to the **attendance report**, which now has a
  **Download Excel (.xlsx)** button (built with SheetJS, a real spreadsheet
  file — not a renamed CSV) containing name, roll no., present/absent
  status, branch, phone, institute email, time marked, and the full class
  context (lecture no., category, date, subject, teacher). CSV and
  Print-to-PDF are still available too.
- A "Full name" field was added to student check-in so the report can show
  names, not just roll numbers.

**2. Manual code fallback**
Next to the QR on the professor's dashboard is a large manual code (the
same token encoded in the QR). Students who can't scan can type it into a
field on the scan page instead — it's validated exactly the same way a
scanned code would be.

**3. QR codes expire every ~6 seconds**
The dashboard shows a countdown ring on the current code. Internally, each
token is stamped with an issue time; `Store.isTokenValid()` rejects any
token older than 6 seconds or that no longer matches the currently active
one. A screenshot of an old code, or scanning the frame the instant before
it rotates, gets rejected with an on-screen "code expired, rescan" message.

**4. Bluetooth as a best-effort proximity signal (not a hard gate)**
Session setup lets the professor optionally set their **device's Bluetooth
name** and generates a **random one-time pairing code** (e.g. `7K2QXP`)
each session. If the professor renames their device to include the code,
a student whose browser finds and selects that device gets a genuinely
verified match — the code, not just the ordinary device name, is what's
checked, so a coincidentally-similar nearby device can't pass.

**Why this is optional, not required, to advance:** `navigator.bluetooth
.requestDevice()` — the only API a website has for this — can **only
discover BLE devices that are actively broadcasting a GATT service**.
An ordinary phone or laptop that's simply "visible" in its normal
Bluetooth settings is, on most devices, broadcasting **Classic
Bluetooth**, which this API cannot see at all. In practice this means a
large fraction of students will see **no devices at all** in the picker
— through no fault of the app, the professor, or the student. Also worth
knowing: the device picker is a **native OS dialog** with no
customization possible — a website cannot add a search box, filter list,
or any other UI to it, so there was never a way to make "search through
200 devices" workable even where discovery does succeed.

Given that, the Bluetooth step now behaves like this:
- It still **tries** to find a match: a filtered request first (fast,
  precise when it works), then an unfiltered "show all nearby devices"
  request if that finds nothing, so a student can pick manually in the
  rarer case their browser can see something. See "Scaling to a full
  classroom" below for why the cascade exists.
- A student can also just click **"Continue without Bluetooth"** at any
  point — this doesn't silently pretend to be a real pairing; the
  record is stamped `bluetoothVerified: false` and shows as
  **"unverified"** on the professor's live roster and in the exported
  report, so the professor can see exactly which check-ins had a real
  Bluetooth match and which didn't.
- The actual anti-fraud checks that don't have this platform limitation
  are the **QR token** (rotates every ~5.5s, so a screenshot or shared
  code goes stale fast) and the **face match** at the liveness step —
  those two are what should be relied on; Bluetooth is a nice-to-have on
  top when it happens to work.

*Scaling to a full classroom:* a `namePrefix` filter alone doesn't hold up
once many students are pairing at once — Chrome's picker can come back
empty even though the professor's device is in range, simply because
nearby phones/laptops don't share that exact prefix. The picker
**cascades**: it tries the filtered request first, and if that finds
nothing (or the student backs out), it retries with an unfiltered
"show all nearby devices" request so the student can find and select the
right one manually — but as above, this only ever recovers cases where
the professor's device is BLE-discoverable in the first place.

*Why not just match the Bluetooth MAC/hardware address?* Web Bluetooth
deliberately does not expose a device's real hardware address to any
webpage, including the professor's own — this is a privacy protection
built into the browser spec, not a gap in this app. So "type in your
Bluetooth IP/MAC address" isn't something a browser-based tool can do,
which is why the one-time code exists as the closest practical
alternative for the cases where discovery does work.

**If you need a hard proximity requirement**, the real fix is a small
dedicated BLE beacon in the room (e.g. a ~$5 ESP32 flashed to advertise
the session code as a GATT service) — unlike a phone/laptop, a purpose-
built beacon reliably shows up to `requestDevice()`. That's a separate,
small hardware project outside the scope of this browser-only app; happy
to help design that firmware/pairing flow if useful.

**4b. Wi-Fi network check (public IP match)**
Added because Bluetooth device discovery is unreliable for ordinary
phones/laptops (see above) — this is a second, independent proximity
signal that works in **every** browser, including iPhone Safari, with
**no permission prompts**.

How it works: the classroom's Wi-Fi router almost certainly does NAT
(nearly all routers do), so every device connected to it shares the same
**public IP address** as seen from the open internet. When the professor
starts a session, the app calls a free, no-auth IP-lookup service
([ipify.org](https://www.ipify.org/)) to record the professor's own
public IP. When a student reaches the network-check screen, their
browser makes the same call and compares the result — no backend, no
account, and neither device's local/private IP is ever involved (only
the shared public-facing address).

- **Match** → strong signal the student is on the same network as the
  professor (very likely the same building or classroom Wi-Fi).
  `networkVerified: true`.
- **Mismatch or check unavailable** → shown clearly, but **does not
  block** the student — see below for why — and is logged as
  `networkVerified: false` (mismatch) or `null` (check unavailable, e.g.
  offline or the lookup service is blocked by the network), visible on
  the professor's live roster and in the exported report.

*Why this isn't a hard block, same reasoning as Bluetooth:* there are
several legitimate ways for this to mismatch even when a student is
genuinely present:
- A **large institutional network** (many campuses run one shared public
  IP or a small pool via carrier-grade NAT for the whole
  building/campus) would make this match too coarse to distinguish
  "this classroom" from "anywhere else on campus" — worth checking your
  network setup before relying on it as anything stronger than a
  campus-level signal.
- A student on **mobile data** with Wi-Fi off will legitimately mismatch
  even while sitting in the room.
- **IPv6** behaves differently from IPv4 here — many networks assign a
  unique public IPv6 address per device even behind the same router
  (no NAT needed for IPv6), which would make this check mismatch by
  default on IPv6-only networks. `api.ipify.org` returns an IPv4
  address specifically to sidestep this, but it's worth testing on your
  actual network.
- A student behind a **VPN** will show the VPN exit IP, not the
  classroom's.

None of these are spoofing risks in the attacker's favor (they'd cause
false *rejections* of legitimate students, not false approvals of absent
ones) except the VPN case, where a determined student could exit through
an IP chosen to match the classroom's — a low-likelihood, higher-effort
attack compared to just not showing up. Combined with QR rotation and
face match, this is a reasonable extra layer, not the primary defense.

**5. Face registration + face-match verification**
Student check-in now includes a **"Register your face"** step: the camera
opens as soon as the page loads, and the student clicks **Capture photo**
to take a registration photo. `face-api.js` computes a face descriptor
from it (a 128-number vector) which is stored alongside their other
details — a "Retake" option lets them redo it before continuing.

Later, on the liveness page, blinking twice no longer marks attendance by
itself — it **triggers an automatic verification photo capture**. That
photo's descriptor is compared against the one from registration
(`Store.matchesRegisteredFace()`, Euclidean distance, threshold 0.6). Only
a match marks attendance; a mismatch shows an error and resets the blink
counter so the student can try again. This means someone can no longer
scan the QR code, pair Bluetooth, and blink through liveness using a
different person's session — the face captured at verification has to be
the same face registered at check-in.

**6. Visual refresh + shorter branch labels**
Reworked the color system, added a flow diagram to the landing page, a
countdown ring, status banners, and general spacing/typography polish.
The branch dropdown now shows just `CSE`, `DSAI`, `ECE`, `AIC`.

**7. Camera and Bluetooth should now actually work**
Three real bugs from the first version are fixed:
- The face-tracking model was being loaded from an npm CDN path that
  doesn't actually contain the model weight files. It now loads from
  the model author's own GitHub Pages host, which does.
- Every camera/Bluetooth call now checks `window.isSecureContext` first
  and shows a clear banner if the page isn't being served correctly,
  instead of failing silently and forcing you to hit "Simulate."
- The QR code on the professor dashboard was loading `qrcode-generator`
  from cdnjs, which some campus/classroom networks block outright,
  making the QR code silently fail to render. It's now vendored locally
  as `js/qrcode-lib.js` (unmodified `qrcode-generator` v1.4.4, MIT
  licensed) and loaded from the project itself — no CDN, no network
  dependency to render the code.
- **The face-tracking/-recognition script tag had a `defer` attribute
  while the code that calls it ran in a normal, non-deferred `<script>`
  right after it.** Deferred scripts only run once the whole page has
  finished parsing — *after* normal scripts further down the page — so
  `faceapi` was still `undefined` at the moment liveness.html tried to
  use it, the error was swallowed by a try/catch, and it silently fell
  back to "camera or model unavailable" every time. This was the root
  cause of the photo/liveness step never actually working. The `defer`
  is removed, so the model script now runs and finishes before the page
  code that depends on it does.

If a camera or Bluetooth permission prompt appears, you still need to
**allow** it — browsers ask once per site the first time.

## Known limitation

**Most students will see no Bluetooth devices to pair with, and that's
expected, not a bug.** `navigator.bluetooth.requestDevice()` only
discovers BLE devices actively broadcasting a GATT service. An ordinary
phone or laptop that's just switched on and "visible" in its Bluetooth
settings is, on most devices, using **Classic Bluetooth**, a different
radio mode this API can't see at all. There's also **no way to add a
search box** to the device picker — it's a native OS dialog a website
can't customize — so even in the rare case a device does show up,
"search through 200 nearby devices" was never something a webpage could
offer. Because of this, Bluetooth here is a **best-effort bonus signal**
students can skip ("Continue without Bluetooth"), not a hard requirement
— see "What's new," item 4 for the full reasoning and what to use
instead if you need a real hard proximity gate (a small dedicated BLE
beacon device).

**Web Bluetooth also doesn't exist on iPhone Safari at all** — only
Chrome/Edge on Android and desktop support the API in the first place,
which is a second, separate reason a chunk of students will never be
able to pair even when their device would otherwise be discoverable.

Also worth knowing: browsers don't expose a device's Bluetooth MAC
address to web pages (privacy restriction), only its broadcast name
after the user picks it from the system chooser. This build works
around that with a **random one-time pairing code the professor appends
to their device's name each session** (see "What's new," item 4) rather
than matching on the device's ordinary name alone — meaningfully harder
to spoof than plain name-matching, since an attacker would have to guess
the current session's code, not just use a common device name. It's
still not a hardware-level guarantee: someone who overhears/sees the
code (e.g. from a classmate's screen) could rename another device to
include it. A native companion app using Bluetooth signal strength
(RSSI) or actual GATT-level attestation is the real fix if that matters
for your use case.

## Scope of this demo vs. the real system

Working in this prototype:
- Real QR generation, camera-based scanning, and expiring tokens
- Real Web Bluetooth device picker with pairing-code verification, **when
  the professor's device happens to be BLE-discoverable** — optional,
  not required to check in (see "Known limitation")
- Real Wi-Fi network check via public-IP comparison — also optional,
  not required to check in, for the same reason (see "Known limitation")
- Real camera-based blink detection (face-api.js) for liveness
- Real face registration at check-in and face-match verification at the
  liveness step (face-api.js descriptors, compared client-side)
- Real Excel (.xlsx) and CSV report generation, entirely client-side

Mocked / simplified, for the real build:
- **Backend & database**: everything currently lives in `localStorage`
  (`js/store.js`). Swap this for real API calls to a server with a proper
  database — the function signatures in `store.js` map directly onto REST
  endpoints (`startSession`, `markPresent`, `closeSession`, etc).
- **Identity verification**: liveness + face-match now confirms the person
  checking in matches a face captured once at enrollment (`enroll.html`),
  not one captured fresh at every check-in — see "Enrollment vs.
  check-in" above. What's still missing for a real deployment: everything
  runs client-side in the browser, so nothing stops a modified page (or a
  student's own devtools console) from lying about the match result —
  e.g. calling `Store.markPresent(...)` directly, or overwriting
  `Store.matchesRegisteredFace` to always return a match. The real build
  needs the descriptor comparison re-run server-side, with the browser
  treated as untrusted input, and enrollment itself should be tied to an
  institute-verified ID (e.g. an admin uploads the ID card photo, or
  enrollment only happens on a supervised kiosk) rather than a student's
  own unsupervised camera capture.
- **Bluetooth proximity**: a random per-session code appended to the
  device name, as above — meaningfully better than plain name-matching
  but still not hardware-level proof, and often finds nothing at all.
  A companion app using Bluetooth signal strength (RSSI) or GATT-level
  attestation would be a stronger proximity signal than the browser can
  provide.
- **Wi-Fi proximity**: public-IP comparison, as above — works reliably
  but only at whatever granularity the network's NAT actually operates
  at (classroom, building, or whole campus depending on your network).
  A production build on a network with per-classroom access-point
  identifiers could check those server-side for room-level precision.
- **Roster management**: the report needs the full roll list pasted in
  manually to compute absentees; the real build should pull this from a
  course roster stored server-side.
- **One session at a time**: the mock backend supports a single active
  session per browser. A real deployment needs concurrent sessions across
  multiple classrooms.

## Suggested database tables for the real build

- `students` — roll_no (PK), name, phone, branch, institute_email,
  registered_face_embedding
- `sessions` — session_id (PK), teacher_name, subject, lecture_no,
  lecture_category, class_date, bluetooth_device_name, locked, created_at,
  closed_at
- `attendance_records` — id (PK), session_id (FK), roll_no (FK), status,
  marked_at, verification_method, manually_approved
- `pending_reviews` — id (PK), session_id (FK), roll_no (FK), reason,
  status (pending/approved/rejected), flagged_at, resolved_by, resolved_at
