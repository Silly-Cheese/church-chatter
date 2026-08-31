import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDD1o33y8YXP1AN3pkSmQXiCMo2gzVwCPA",
  authDomain: "church-chattrd.firebaseapp.com",
  projectId: "church-chattrd",
  storageBucket: "church-chattrd.firebasestorage.app",
  messagingSenderId: "817342903823",
  appId: "1:817342903823:web:e056fefc344d4b623f157a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Could not enable persistent authentication:", error);
});

export { app, auth, db, googleProvider };
