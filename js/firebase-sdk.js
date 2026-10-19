// Laadt de Firebase SDK (ES modules) en maakt hem beschikbaar voor de gewone scripts.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, getDoc, writeBatch, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.FirebaseSDK = {
    initializeApp,
    getAuth, signInAnonymously, signInWithCustomToken, GoogleAuthProvider,
    signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
    getFirestore, doc, setDoc, onSnapshot, collection, getDocs, getDoc, writeBatch, query, where
};
