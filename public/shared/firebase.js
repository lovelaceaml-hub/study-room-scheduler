// The connection to the Cloud Functions, shared by the member app and the
// Admin page. These are public app identifiers, not secrets: the functions
// decide what each caller may see or change.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBYFl69YJSm1YBIr1Pg8vuVcCJPA4N0BEU',
  authDomain: 'lvz-rooms.firebaseapp.com',
  projectId: 'lvz-rooms',
  storageBucket: 'lvz-rooms.firebasestorage.app',
  messagingSenderId: '681798360480',
  appId: '1:681798360480:web:8356fe0c56650fbca398c5'
};
const SDK = 'https://www.gstatic.com/firebasejs/13.2.0';
const REGION = 'us-west1';

let connecting = null;

// Signs this browser in anonymously (the same identity every visit) and
// returns { uid, call(name, data) }.
export function connect() {
  connecting ??= open().catch(error => {
    connecting = null;
    throw error;
  });
  return connecting;
}

async function open() {
  const [appSdk, authSdk, functionsSdk] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-functions.js`)
  ]);
  const app = appSdk.getApps()[0] || appSdk.initializeApp(FIREBASE_CONFIG);
  const auth = authSdk.getAuth(app);
  await new Promise((resolve, reject) => {
    const stop = authSdk.onAuthStateChanged(auth, () => { stop(); resolve(); }, reject);
  });
  if (!auth.currentUser) await authSdk.signInAnonymously(auth);
  const functions = functionsSdk.getFunctions(app, REGION);
  return {
    uid: auth.currentUser.uid,
    async call(name, data = {}) {
      const result = await functionsSdk.httpsCallable(functions, name)(data);
      return result.data;
    }
  };
}

const SERVER_MESSAGES = ['invalid-argument', 'failed-precondition', 'already-exists', 'permission-denied', 'resource-exhausted', 'not-found'];

// The server writes its refusals for people to read; anything else (a dropped
// connection, a server fault) gets `fallback`.
export function errorMessage(error, fallback) {
  const code = String(error?.code || '').replace(/^functions\//, '');
  if (SERVER_MESSAGES.includes(code) && error.message) return error.message;
  if (code === 'unauthenticated') return 'Your sign-in expired. Reload the page and try again.';
  return fallback;
}
