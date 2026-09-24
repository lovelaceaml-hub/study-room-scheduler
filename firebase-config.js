// LV Zion Study Rooms — Firebase web config (public app identifiers, not
// secrets; access control lives in firestore.rules). If these ever stop
// resolving, app.js catches the init failure and falls back to
// localStorage-only mode automatically, so the app still works offline.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBYFl69YJSm1YBIr1Pg8vuVcCJPA4N0BEU",
  authDomain: "lvz-rooms.firebaseapp.com",
  projectId: "lvz-rooms",
  storageBucket: "lvz-rooms.firebasestorage.app",
  messagingSenderId: "681798360480",
  appId: "1:681798360480:web:8356fe0c56650fbca398c5"
};

// Firebase JS SDK version, set once here for every page that loads it.
window.FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
