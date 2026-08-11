// Fill this in with YOUR Firebase project's config (see README "Online Play
// Setup" section for step-by-step instructions). Online mode simply won't
// work until you do this — Solo vs Bots and Pass & Play work with zero setup.

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let firebaseApp = null;
let firestoreDb = null;

function getFirestore() {
  if (!firestoreDb) {
    if (!firebaseApp) firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();
  }
  return firestoreDb;
}

function isFirebaseConfigured() {
  return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
}
