// LV Zion Study Rooms — Firebase web config (public app identifiers, not
// secrets; access control lives in firestore.rules).
//
// PLACEHOLDER — the real config for the Firebase project `lvz-rooms` gets
// pasted here once that project is created. Until then these values won't
// resolve to a real project; app.js catches the init failure and falls back
// to localStorage-only mode automatically, so the app still works offline.
window.FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "lvz-rooms.firebaseapp.com",
  projectId: "lvz-rooms",
  storageBucket: "lvz-rooms.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};
