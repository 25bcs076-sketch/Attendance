/**
 * store.js — mock backend standing in for a real API + database.
 * Everything is persisted to localStorage so the demo works fully offline
 * and survives page navigation. In the real build this whole file is
 * replaced by fetch() calls to a proper server + DB (see README).
 */
const Store = (() => {
  const KEYS = {
    SESSION: 'ams_active_session',
    STUDENT: 'ams_current_student',     // the student currently checking in (this device, this visit)
    ATTENDANCE: 'ams_attendance_log',
    ROSTER: 'ams_enrolled_roster',      // one-time face enrollment, keyed by roll number — persists across sessions
    PENDING: 'ams_pending_reviews'      // check-ins flagged for the professor to manually approve/reject
  };

  // How long a single QR code stays valid after it's issued, in ms.
  const TOKEN_VALID_MS = 6000;
  // How often the professor dashboard rotates to a fresh QR code, in ms.
  const ROTATE_MS = 5500;
  // Max Euclidean distance between two face-api.js descriptors for them to
  // count as the same person. face-api.js's own docs suggest ~0.6 as the
  // typical cutoff; lower = stricter match, higher = more forgiving of
  // lighting/angle changes between registration and verification.
  const FACE_MATCH_THRESHOLD = 0.6;

  function _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function _write(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  return {
    ROTATE_MS,
    TOKEN_VALID_MS,
    FACE_MATCH_THRESHOLD,

    // ---------- Professor session ----------
    generateBluetoothCode() {
      // Short, human-typeable code the professor appends to their device's
      // Bluetooth name for this session. Unlike matching on the device's
      // existing name (which is often a guessable default like "iPhone" or
      // "DESKTOP-4F92K"), this is fresh per session and effectively
      // impossible for another nearby device to already be broadcasting.
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
      return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    },
    startSession(details) {
      const session = {
        id: 'SES-' + Date.now().toString(36).toUpperCase(),
        teacherName: details.teacherName,
        subject: details.subject,
        lectureNo: details.lectureNo,
        lectureCategory: details.lectureCategory,
        classDate: details.classDate,
        bluetoothDeviceName: details.bluetoothDeviceName || '',
        bluetoothCode: details.bluetoothCode || '',
        professorNetworkIp: null, // set async after session creation, see setProfessorIp()
        createdAt: new Date().toISOString(),
        locked: false,
        qrToken: null,
        qrIssuedAt: null
      };
      _write(KEYS.SESSION, session);
      _write(KEYS.ATTENDANCE, { [session.id]: [] });
      Store.rotateToken();
      return session;
    },
    getSession() {
      return _read(KEYS.SESSION, null);
    },
    setProfessorIp(ip) {
      // Captured once, right after the professor starts the session, from
      // the same public-IP lookup students use in network-check.html. If
      // both are behind the same classroom/campus router doing NAT, they'll
      // report the same public IP — a proximity signal that works in every
      // browser (unlike Web Bluetooth) with no special permissions.
      const session = Store.getSession();
      if (!session) return null;
      session.professorNetworkIp = ip;
      _write(KEYS.SESSION, session);
      return session;
    },
    rotateToken() {
      // Dynamic QR: a fresh random token is what the QR encodes, refreshed
      // every ROTATE_MS so a screenshot / re-scan of a stale code is rejected.
      const session = Store.getSession();
      if (!session || session.locked) return null;
      const token = Array.from({ length: 6 }, () =>
        Math.random().toString(36).charAt(2)
      ).join('').toUpperCase();
      session.qrToken = token;
      session.qrIssuedAt = Date.now();
      _write(KEYS.SESSION, session);
      return token;
    },
    isTokenValid(token) {
      const session = Store.getSession();
      if (!session || session.locked) return false;
      if (!session.qrToken || session.qrToken !== token) return false;
      return (Date.now() - session.qrIssuedAt) <= TOKEN_VALID_MS;
    },
    tokenMsRemaining() {
      const session = Store.getSession();
      if (!session || !session.qrIssuedAt) return 0;
      return Math.max(0, TOKEN_VALID_MS - (Date.now() - session.qrIssuedAt));
    },
    closeSession() {
      const session = Store.getSession();
      if (!session) return null;
      session.locked = true;
      session.closedAt = new Date().toISOString();
      _write(KEYS.SESSION, session);
      return session;
    },
    isLocked() {
      const session = Store.getSession();
      return !session || !!session.locked;
    },
    endSession() {
      localStorage.removeItem(KEYS.SESSION);
    },

    // ---------- One-time face enrollment (persists across every future session) ----------
    // This is the fix for the biggest gap in the old design: face
    // "registration" used to happen fresh every single check-in, seconds
    // before the liveness page compared a new capture against it — which
    // only proved two photos taken moments apart in the same sitting show
    // the same person, never that the person is actually the enrolled
    // student. A friend could type an absent classmate's roll number,
    // register their own face on the spot, and pass every check.
    //
    // Now enrollment happens once (ideally staff-supervised, in enroll.html)
    // and is stored here, keyed by roll number. Every check-in afterwards
    // looks up the *existing* descriptor and compares against *that* — so
    // typing someone else's roll number doesn't help; the live face still
    // has to match what was captured at that student's real enrollment.
    enrollStudent(details) {
      const roster = _read(KEYS.ROSTER, {});
      const rollNo = (details.rollNo || '').trim().toUpperCase();
      roster[rollNo] = {
        name: details.name,
        rollNo,
        phone: details.phone,
        branch: details.branch,
        instituteEmail: details.instituteEmail,
        faceDescriptor: details.faceDescriptor,
        facePhoto: details.facePhoto || null,
        enrolledAt: new Date().toISOString()
      };
      _write(KEYS.ROSTER, roster);
      return roster[rollNo];
    },
    getEnrolledStudent(rollNo) {
      const roster = _read(KEYS.ROSTER, {});
      return roster[(rollNo || '').trim().toUpperCase()] || null;
    },
    isEnrolled(rollNo) {
      return !!Store.getEnrolledStudent(rollNo);
    },
    enrolledCount() {
      return Object.keys(_read(KEYS.ROSTER, {})).length;
    },

    // ---------- Student identity (this check-in, this device) ----------
    // Populated from the roster entry looked up by roll number — never
    // from a freshly-captured descriptor — so the face compared against in
    // matchesRegisteredFace() is always the one-time enrollment photo.
    setCheckInStudent(rosterEntry) {
      _write(KEYS.STUDENT, rosterEntry);
      return rosterEntry;
    },
    getStudent() {
      return _read(KEYS.STUDENT, null);
    },
    hasRegisteredFace() {
      const student = Store.getStudent();
      return !!(student && Array.isArray(student.faceDescriptor) && student.faceDescriptor.length);
    },
    // Compares a freshly-captured face descriptor (plain array of numbers,
    // from face-api.js's withFaceDescriptor()) against the one captured at
    // this student's one-time enrollment. Kept here rather than in the page
    // scripts since, like the rest of this file, it's a stand-in for a
    // server-side check the real backend would run (face-api.js runs
    // entirely client-side in this demo, so there's nothing stopping a
    // browser from lying about the result — the real build should
    // re-verify server-side).
    matchesRegisteredFace(liveDescriptor) {
      const student = Store.getStudent();
      const registered = student && student.faceDescriptor;
      if (!registered || !Array.isArray(registered) || !registered.length) {
        return { matched: false, reason: 'NOT_REGISTERED', distance: null };
      }
      if (!liveDescriptor || registered.length !== liveDescriptor.length) {
        return { matched: false, reason: 'BAD_DESCRIPTOR', distance: null };
      }
      let sumSq = 0;
      for (let i = 0; i < registered.length; i++) {
        const d = registered[i] - liveDescriptor[i];
        sumSq += d * d;
      }
      const distance = Math.sqrt(sumSq);
      return { matched: distance <= FACE_MATCH_THRESHOLD, reason: null, distance };
    },
    // A random requirement (2 or 3 blinks) chosen fresh per check-in
    // attempt and only revealed once the camera is live. A canned
    // pre-recorded video of the real student blinking twice — the old
    // fixed requirement — would no longer reliably pass. Not bulletproof
    // (nothing client-side truly is), but it raises the bar above a fixed,
    // predictable challenge.
    pickBlinkRequirement() {
      return Math.random() < 0.5 ? 2 : 3;
    },

    // ---------- Attendance ----------
    markPresent(sessionId, student, opts) {
      opts = opts || {};
      const session = Store.getSession();
      if (!session || session.locked || session.id !== sessionId) {
        return { error: 'SESSION_CLOSED' };
      }
      const log = _read(KEYS.ATTENDANCE, {});
      if (!log[sessionId]) log[sessionId] = [];
      const already = log[sessionId].find(r => r.rollNo === student.rollNo);
      if (already) return already;
      const btVerified = sessionStorage.getItem('ams_bt_verified') === 'true';
      const netFlag = sessionStorage.getItem('ams_net_verified'); // 'true' | 'false' | 'unknown' | null
      const netVerified = netFlag === 'true' ? true : (netFlag === 'false' ? false : null);
      const record = {
        name: student.name,
        rollNo: student.rollNo,
        phone: student.phone,
        branch: student.branch,
        instituteEmail: student.instituteEmail,
        status: 'present',
        markedAt: new Date().toISOString(),
        bluetoothVerified: btVerified,
        networkVerified: netVerified,
        manuallyApproved: !!opts.manuallyApproved,
        verifiedVia: opts.manuallyApproved
          ? 'QR + manually approved by professor (camera/model issue reported)'
          : 'QR + ' +
            (btVerified ? 'Bluetooth pairing code match' : 'Bluetooth unverified') + ' + ' +
            (netVerified === true ? 'Wi-Fi network match' : netVerified === false ? 'Wi-Fi network MISMATCH' : 'Wi-Fi check unavailable') + ' + ' +
            'liveness blink + face match'
      };
      log[sessionId].push(record);
      _write(KEYS.ATTENDANCE, log);
      return record;
    },
    getAttendance(sessionId) {
      const log = _read(KEYS.ATTENDANCE, {});
      return log[sessionId] || [];
    },

    // ---------- Manual review queue ----------
    // Replaces the old "Simulate liveness pass" button, which let any
    // student mark themselves present with one click and zero camera
    // check — exactly the shortcut a proxy check-in would take. A genuine
    // camera/model failure is now routed to the professor instead: it
    // shows up on the dashboard as a pending item the professor (who can
    // actually see who's in the room) approves or rejects by hand, rather
    // than the student's own browser deciding to wave itself through.
    flagForManualReview(sessionId, student, reason) {
      const pending = _read(KEYS.PENDING, {});
      if (!pending[sessionId]) pending[sessionId] = [];
      // One outstanding request per roll number at a time.
      const existing = pending[sessionId].find(p => p.rollNo === student.rollNo && p.status === 'pending');
      if (existing) return existing;
      const entry = {
        id: 'REV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
        rollNo: student.rollNo,
        name: student.name,
        branch: student.branch,
        reason: reason || 'Camera or model unavailable',
        status: 'pending', // 'pending' | 'approved' | 'rejected'
        flaggedAt: new Date().toISOString()
      };
      pending[sessionId].push(entry);
      _write(KEYS.PENDING, pending);
      return entry;
    },
    getPendingReviews(sessionId) {
      const pending = _read(KEYS.PENDING, {});
      return pending[sessionId] || [];
    },
    getReviewStatus(sessionId, reviewId) {
      const list = Store.getPendingReviews(sessionId);
      return list.find(p => p.id === reviewId) || null;
    },
    approveReview(sessionId, reviewId, student) {
      const pending = _read(KEYS.PENDING, {});
      const list = pending[sessionId] || [];
      const entry = list.find(p => p.id === reviewId);
      if (!entry) return null;
      entry.status = 'approved';
      _write(KEYS.PENDING, pending);
      // markPresent() reads bluetooth/network flags from sessionStorage,
      // which only exist on the *student's* device/tab, not the
      // professor's — so the resulting record correctly shows those as
      // unavailable for a manually-approved entry rather than guessing.
      Store.markPresent(sessionId, student, { manuallyApproved: true });
      return entry;
    },
    rejectReview(sessionId, reviewId) {
      const pending = _read(KEYS.PENDING, {});
      const list = pending[sessionId] || [];
      const entry = list.find(p => p.id === reviewId);
      if (!entry) return null;
      entry.status = 'rejected';
      _write(KEYS.PENDING, pending);
      return entry;
    },

    // ---------- Backup / restore ----------
    // Everything in this app lives in one browser's localStorage — close
    // that tab's browser profile (or open the report on a different
    // device) and the roster and attendance log are simply gone. Until
    // there's a real backend, this is the mitigation: a one-click JSON
    // export the professor can save mid-class, and an import to restore it.
    exportBackup() {
      return {
        exportedAt: new Date().toISOString(),
        session: _read(KEYS.SESSION, null),
        attendance: _read(KEYS.ATTENDANCE, {}),
        pending: _read(KEYS.PENDING, {})
      };
    },
    importBackup(data) {
      if (!data || typeof data !== 'object') throw new Error('Invalid backup file');
      if (data.session) _write(KEYS.SESSION, data.session);
      if (data.attendance) _write(KEYS.ATTENDANCE, data.attendance);
      if (data.pending) _write(KEYS.PENDING, data.pending);
      return true;
    },

    // ---------- Utilities ----------
    clearAll() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    }
  };
})();
