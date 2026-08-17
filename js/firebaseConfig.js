// Fill this in with YOUR Firebase project's config (see README "Online Play
// Setup" section for step-by-step instructions). Online mode simply won't
// work until you do this — Solo vs Bots and Pass & Play work with zero setup.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAyXRHDWlxYLcnDupcSQOUzyr8b2UNlggI",
  authDomain: "nature-c0ca2.firebaseapp.com",
  projectId: "nature-c0ca2",
  storageBucket: "nature-c0ca2.firebasestorage.app",
  messagingSenderId: "75641951138",
  appId: "1:75641951138:web:fbb76c3559b99b982d98fb"
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
